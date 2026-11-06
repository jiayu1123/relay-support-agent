import request from 'supertest';
import { resolve } from 'node:path';
import { connect, migrate } from '../server/db.js';
import { createApp } from '../server/app.js';
const db = await connect(undefined, ':memory:');
await migrate(db);
try {
  const app = createApp(db, { mode: 'demo', staticDir: resolve('dist/client') });
  const html = await request(app).get('/').expect(200).expect('Content-Type', /html/);
  if (!html.text.includes('Relay')) throw new Error('Missing application title.');
  const assets = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((m) => m[1]);
  if (assets.length < 2) throw new Error('Missing built assets.');
  for (const asset of assets) await request(app).get(asset).expect(200);
  await request(app).get('/api/health').expect(200);
  await request(app).get('/api/does-not-exist').expect(404);
  console.log(
    `Production HTTP smoke passed: HTML, ${assets.length} assets, health endpoint, API 404.`,
  );
} finally {
  await db.close();
}
