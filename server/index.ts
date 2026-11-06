import 'dotenv/config';
import { resolve } from 'node:path';
import { connect, migrate } from './db.js';
import { createApp } from './app.js';
const db = await connect(process.env.DATABASE_URL, process.env.SQLITE_PATH || 'data/relay.sqlite');
await migrate(db);
if ((process.env.AGENT_MODE || 'demo') === 'openai' && !process.env.OPENAI_API_KEY)
  throw new Error('Configure OPENAI_API_KEY before enabling openai mode.');
const app = createApp(db, { staticDir: resolve('dist/client') });
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '0.0.0.0', () =>
  console.log(
    `Relay running on port ${port} · ${process.env.AGENT_MODE || 'demo'} · ${db.dialect}`,
  ),
);
process.on('SIGTERM', () =>
  server.close(async () => {
    await db.close();
    process.exit(0);
  }),
);
