import { beforeEach, afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect, migrate, type Store } from '../server/db.js';
import { sessions } from '../server/sessions.js';
import { createApp } from '../server/app.js';

let db: Store;
beforeEach(async () => {
  db = await connect(undefined, ':memory:');
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});
const DAY = 86400000;
it('stores only a token hash and restores the same tenant without reseeding', async () => {
  const store = sessions(db),
    a = await store.create();
  const rows = await db.query('SELECT * FROM sessions');
  expect(rows[0].token_hash).toHaveLength(64);
  expect(JSON.stringify(rows)).not.toContain(a.cookie!.slice(3));
  await db.query("UPDATE orders SET product='Saved product' WHERE tenant=? AND id=?", [
    a.tenant,
    'RL-1042',
  ]);
  const b = await store.resolve(a.cookie);
  expect(b.tenant).toBe(a.tenant);
  expect(b.cookie).toBeUndefined();
  expect(
    (await db.query('SELECT product FROM orders WHERE tenant=? AND id=?', [a.tenant, 'RL-1042']))[0]
      .product,
  ).toBe('Saved product');
});
it('restores across app recreation with a different legacy signing key', async () => {
  const first = request.agent(createApp(db, { mode: 'demo', secret: 'old key' }));
  const c = await first.post('/api/conversations').send({ title: 'Keep this' }).expect(201);
  const cookie = c.headers['set-cookie'][0].split(';')[0];
  const restored = await request(createApp(db, { mode: 'demo', secret: 'new key' }))
    .get(`/api/conversations/${c.body.id}`)
    .set('Cookie', cookie)
    .expect(200);
  expect(restored.body.state.stage).toBe('idle');
  expect(
    (
      await request(createApp(db, { mode: 'demo' }))
        .get('/api/bootstrap')
        .set('Cookie', cookie)
    ).body.conversations[0].id,
  ).toBe(c.body.id);
});
it('upgrades a verified legacy cookie without losing its tenant', async () => {
  const tenant = randomUUID(),
    expires = Date.now() + DAY,
    secret = 'legacy-only';
  const signature = createHmac('sha256', secret).update(`${tenant}.${expires}`).digest('hex');
  const migrated = await sessions(db, secret).resolve(`${tenant}.${expires}.${signature}`);
  expect(migrated.tenant).toBe(tenant);
  expect(migrated.cookie).toMatch(/^v2\./);
  const restored = await sessions(db, 'different key').resolve(migrated.cookie);
  expect(restored.tenant).toBe(tenant);
  const forged = await sessions(db, 'different key').resolve(`${tenant}.${expires}.${signature}`);
  expect(forged.tenant).not.toBe(tenant);
});
it('renews active sessions once per day and caps them at 30 days', async () => {
  let now = Date.now();
  const start = now,
    store = sessions(db, undefined, () => now),
    a = await store.create();
  now += DAY / 2;
  expect((await store.resolve(a.cookie)).cookie).toBeUndefined();
  now = start + 2 * DAY;
  const renewed = await store.resolve(a.cookie);
  expect(renewed.cookie).toBe(a.cookie);
  expect(Date.parse(renewed.expiresAt)).toBe(now + 7 * DAY);
  for (let day = 4; day <= 28; day += 2) {
    now = start + day * DAY;
    await store.resolve(a.cookie);
  }
  now = start + 29 * DAY;
  const final = await store.resolve(a.cookie);
  expect(final.tenant).toBe(a.tenant);
  expect(Date.parse(final.expiresAt)).toBe(start + 30 * DAY);
  now = start + 30 * DAY + 1;
  expect((await store.resolve(a.cookie)).tenant).not.toBe(a.tenant);
});
it('idle expiry and revocation cannot restore an old account', async () => {
  let now = Date.now();
  const store = sessions(db, undefined, () => now),
    a = await store.create();
  now += 8 * DAY;
  expect((await store.resolve(a.cookie)).tenant).not.toBe(a.tenant);
  const b = await store.create();
  await store.revoke(b);
  expect((await store.resolve(b.cookie)).tenant).not.toBe(b.tenant);
});
it('database outages fail closed without issuing a fresh profile cookie', async () => {
  const store = sessions(db),
    a = await store.create();
  const unavailable = {
    ...db,
    query: async () => {
      throw new Error('database unavailable');
    },
  };
  await expect(sessions(unavailable).resolve(a.cookie)).rejects.toThrow('database unavailable');
  const response = await request(createApp(unavailable, { mode: 'demo' }))
    .get('/api/bootstrap')
    .set('Cookie', `relay_session=${a.cookie}`)
    .expect(500);
  expect(response.headers['set-cookie']).toBeUndefined();
});
it('readiness checks the database and returns 503 without session side effects', async () => {
  const unavailable = {
    ...db,
    query: async () => {
      throw new Error('private database details');
    },
  };
  const result = await request(createApp(unavailable, { mode: 'demo' }))
    .get('/api/health')
    .expect(503);
  expect(result.body.ok).toBe(false);
  expect(result.headers['set-cookie']).toBeUndefined();
  expect(JSON.stringify(result.body)).not.toContain('private database details');
});
it('logout revokes the token and never deletes stored conversations', async () => {
  const app = createApp(db, { mode: 'demo' }),
    agent = request.agent(app);
  const c = await agent.post('/api/conversations').send({ title: 'Keep after logout' }).expect(201);
  const cookie = c.headers['set-cookie'][0].split(';')[0];
  await agent.post('/api/session/logout').send({}).expect(204);
  await request(app).get(`/api/conversations/${c.body.id}`).set('Cookie', cookie).expect(404);
  expect(await db.query('SELECT * FROM conversations WHERE id=?', [c.body.id])).toHaveLength(1);
});
it('rejects malformed and JSON cookie values safely and keeps cookie security flags', async () => {
  const response = await request(createApp(db, { mode: 'demo' }))
    .get('/api/bootstrap')
    .set('Cookie', 'relay_session=j:%7B%22tenant%22%3A%22alice%22%7D')
    .expect(200);
  const cookie = response.headers['set-cookie'][0];
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(response.body.session).toMatchObject({ version: 2, storage: 'database', anonymous: true });
  expect(JSON.stringify(response.body.session)).not.toContain('token');
});
it('a concurrent revocation wins over cookie renewal', async () => {
  let now = Date.now();
  const original = sessions(db, undefined, () => now),
    a = await original.create();
  now += 2 * DAY;
  const racing = {
    ...db,
    query: async (sql: string, params?: any[]) => {
      const result = await db.query(sql, params);
      if (sql.startsWith('SELECT s.*')) await original.revoke(a);
      return result;
    },
  } as Store;
  expect((await sessions(racing, undefined, () => now).resolve(a.cookie)).tenant).not.toBe(
    a.tenant,
  );
});
it('restores a signed browser session after SQLite closes and reopens', async () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-sessions-')),
    file = join(root, 'db.sqlite');
  try {
    let persistent = await connect(undefined, file);
    await migrate(persistent);
    const a = await sessions(persistent).create();
    await persistent.close();
    persistent = await connect(undefined, file);
    await migrate(persistent);
    try {
      expect((await sessions(persistent).resolve(a.cookie)).tenant).toBe(a.tenant);
    } finally {
      await persistent.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('hosted PostgreSQL configuration cannot silently create SQLite', () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-config-')),
    file = join(root, 'must-not-exist.sqlite');
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('server/index.ts')], {
      encoding: 'utf8',
      env: { ...process.env, REQUIRE_POSTGRES: 'true', DATABASE_URL: '', SQLITE_PATH: file },
      timeout: 10000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing SQLite fallback');
    expect(existsSync(file)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
