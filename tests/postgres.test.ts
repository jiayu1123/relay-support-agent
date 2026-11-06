import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect, migrate, seed } from '../server/db.js';
import { executeTool, confirmResolution } from '../server/tools.js';

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'PostgreSQL: concurrent confirmations are atomic, scoped, and idempotent',
  async () => {
    const db = await connect(process.env.TEST_DATABASE_URL);
    const tenant = `pg-test-${randomUUID()}`;
    try {
      await migrate(db);
      await seed(db, tenant);
      const ctx = { db, tenant, conversation: randomUUID(), traces: [] };
      await db.query('UPDATE inventory SET stock=1 WHERE tenant=? AND sku=?', [
        tenant,
        'STUDIO-01',
      ]);
      const a = await executeTool(ctx, 'propose_resolution', {
        orderId: 'RL-1042',
        action: 'exchange',
        reason: 'Broken headphones',
      });
      const b = await executeTool({ ...ctx, conversation: randomUUID() }, 'propose_resolution', {
        orderId: 'RL-1042',
        action: 'exchange',
        reason: 'Broken headphones',
      });
      const outcomes = await Promise.allSettled([
        confirmResolution(db, tenant, a.proposal.id),
        confirmResolution(db, tenant, b.proposal.id),
      ]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const success = outcomes.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
      const replay = await confirmResolution(db, tenant, success.value.proposal_id);
      expect(replay.replayed).toBe(true);
      expect(replay.id).toBe(success.value.id);
      const [stock] = await db.query('SELECT stock FROM inventory WHERE tenant=? AND sku=?', [
        tenant,
        'STUDIO-01',
      ]);
      expect(stock.stock).toBe(0);
      expect(await db.query('SELECT * FROM resolutions WHERE tenant=?', [tenant])).toHaveLength(1);
      await expect(
        confirmResolution(db, 'different-tenant', success.value.proposal_id),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await db.transaction(async (tx) => {
        for (const table of ['proposals', 'resolutions', 'inventory', 'orders', 'tenants'])
          await tx.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant'}=?`, [
            tenant,
          ]);
      });
      await db.close();
    }
  },
);
