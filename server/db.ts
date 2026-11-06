import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

export interface SQL {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;
}
export interface Store extends SQL {
  transaction<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  dialect: 'sqlite' | 'postgres';
}
export async function connect(url?: string, file = 'data/relay.sqlite'): Promise<Store> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 8 });
    const adapt = (db: pg.Pool | pg.PoolClient): SQL => ({
      async query(sql, params = []) {
        let i = 0;
        return (
          await db.query(
            sql.replace(/\?/g, () => `$${++i}`),
            params,
          )
        ).rows;
      },
    });
    const base = adapt(pool);
    return {
      ...base,
      dialect: 'postgres',
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn(adapt(client));
          await client.query('COMMIT');
          return value;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const direct: SQL = {
    async query(sql, params = []) {
      return sqlite.prepare(sql).all(...params) as any;
    },
  };
  // Serialize all access around asynchronous transaction callbacks, including reads.
  let tail: Promise<any> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
  return {
    dialect: 'sqlite',
    query(sql, params) {
      return locked(() => direct.query(sql, params));
    },
    transaction(fn) {
      return locked(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(direct);
          sqlite.exec('COMMIT');
          return result;
        } catch (e) {
          sqlite.exec('ROLLBACK');
          throw e;
        }
      });
    },
    async close() {
      await tail;
      sqlite.close();
    },
  };
}

export async function migrate(db: Store) {
  const statements = [
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
    'CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)',
    `CREATE TABLE IF NOT EXISTS orders (tenant TEXT NOT NULL, id TEXT NOT NULL, product TEXT NOT NULL, sku TEXT NOT NULL, amount INTEGER NOT NULL, delivered_at TEXT, status TEXT NOT NULL, category TEXT NOT NULL, PRIMARY KEY(tenant,id))`,
    'CREATE TABLE IF NOT EXISTS inventory (tenant TEXT NOT NULL, sku TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock >= 0), PRIMARY KEY(tenant,sku))',
    'CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, conversation TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages(tenant,conversation,created_at)',
    'CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, conversation TEXT NOT NULL, order_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS resolutions (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, order_id TEXT NOT NULL, proposal_id TEXT NOT NULL UNIQUE, action TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant,order_id))',
    'CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, conversation TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS eval_runs (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, report TEXT NOT NULL, created_at TEXT NOT NULL)',
    'INSERT INTO schema_version(version) VALUES(1) ON CONFLICT(version) DO NOTHING',
  ];
  await db.transaction(async (tx) => {
    for (const sql of statements) await tx.query(sql);
  });
}

export const catalog = [
  {
    id: 'RL-1042',
    product: 'Studio Wireless Headphones',
    sku: 'STUDIO-01',
    amount: 12900,
    days: 8,
    status: 'delivered',
    category: 'electronics',
    stock: 12,
  },
  {
    id: 'RL-1043',
    product: 'Everyday Canvas Tote',
    sku: 'TOTE-02',
    amount: 3800,
    days: 19,
    status: 'delivered',
    category: 'accessories',
    stock: 24,
  },
  {
    id: 'RL-1031',
    product: 'Compact Bluetooth Speaker',
    sku: 'SPEAKER-03',
    amount: 7900,
    days: 47,
    status: 'delivered',
    category: 'electronics',
    stock: 7,
  },
  {
    id: 'RL-1048',
    product: 'Travel Charging Dock',
    sku: 'DOCK-04',
    amount: 5900,
    days: 3,
    status: 'delivered',
    category: 'electronics',
    stock: 0,
  },
  {
    id: 'RL-1050',
    product: 'Merino Everyday Beanie',
    sku: 'BEANIE-05',
    amount: 2900,
    days: 0,
    status: 'in_transit',
    category: 'accessories',
    stock: 8,
  },
  {
    id: 'RL-1020',
    product: 'Personalized Leather Wallet',
    sku: 'WALLET-06',
    amount: 6500,
    days: 6,
    status: 'delivered',
    category: 'personalized',
    stock: 5,
  },
];
export async function seed(db: Store, tenant: string) {
  await db.transaction(async (tx) => {
    const inserted = await tx.query(
      'INSERT INTO tenants(id,created_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING RETURNING id',
      [tenant, new Date().toISOString()],
    );
    if (!inserted.length) return;
    for (const o of catalog) {
      await tx.query(
        'INSERT INTO orders(tenant,id,product,sku,amount,delivered_at,status,category) VALUES(?,?,?,?,?,?,?,?)',
        [
          tenant,
          o.id,
          o.product,
          o.sku,
          o.amount,
          o.status === 'delivered' ? new Date(Date.now() - o.days * 86400000).toISOString() : null,
          o.status,
          o.category,
        ],
      );
      await tx.query('INSERT INTO inventory(tenant,sku,stock) VALUES(?,?,?)', [
        tenant,
        o.sku,
        o.stock,
      ]);
    }
  });
}
