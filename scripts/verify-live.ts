import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { connect, migrate, seed } from '../server/db.js';
import { runAgent } from '../server/agent.js';
import { confirmResolution, type Context } from '../server/tools.js';

if (!process.env.OPENAI_API_KEY)
  throw new Error('No API key configured. Run npm run setup locally first.');
console.log(
  'Verifying live OpenAI tool calling with isolated sample data. This makes paid API requests.',
);
const db = await connect(undefined, ':memory:');
await migrate(db);
const checks: { name: string; passed: boolean }[] = [];
const turns: any[] = [];
try {
  const tenant = randomUUID();
  await seed(db, tenant);
  const ctx: Context = { db, tenant, conversation: randomUUID(), traces: [] };
  const r = await runAgent(
    ctx,
    [
      {
        role: 'user',
        content: 'My RL-1042 headphones are broken and have no sound. Please prepare an exchange.',
      },
    ],
    { mode: 'openai' },
  );
  turns.push({ name: 'Eligible exchange', ...r, traces: ctx.traces });
  checks.push({ name: 'Live adapter received model usage', passed: r.usage.inputTokens > 0 });
  checks.push({
    name: 'Model prepared the requested exchange',
    passed: r.proposal?.action === 'exchange' && r.proposal?.order_id === 'RL-1042',
  });
  checks.push({
    name: 'No resolution before user confirmation',
    passed: (await db.query('SELECT * FROM resolutions')).length === 0,
  });
  if (r.proposal) {
    const a = await confirmResolution(db, tenant, r.proposal.id);
    const b = await confirmResolution(db, tenant, r.proposal.id);
    checks.push({
      name: 'Confirmed request is persisted and replay-safe',
      passed: a.id === b.id && b.replayed,
    });
  }
  const blockedCtx = { ...ctx, conversation: randomUUID(), traces: [] };
  const blocked = await runAgent(
    blockedCtx,
    [{ role: 'user', content: 'Please refund RL-1031. Check its eligibility.' }],
    { mode: 'openai' },
  );
  turns.push({ name: 'Out-of-window return', ...blocked, traces: blockedCtx.traces });
  checks.push({ name: 'No proposal for the expired order', passed: !blocked.proposal });
  checks.push({
    name: 'Expired request did not mutate the order',
    passed:
      (await db.query('SELECT status FROM orders WHERE tenant=? AND id=?', [tenant, 'RL-1031']))[0]
        .status === 'delivered',
  });
  const report = {
    mode: 'openai',
    createdAt: new Date().toISOString(),
    model: r.model,
    checks,
    turns,
  };
  mkdirSync('data', { recursive: true });
  writeFileSync('data/live-verification.json', JSON.stringify(report, null, 2));
  for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}`);
  console.log('Report saved to data/live-verification.json.');
  if (checks.some((c) => !c.passed)) process.exitCode = 1;
} catch (error: any) {
  const status = typeof error?.status === 'number' ? error.status : null;
  const message =
    status === 401
      ? 'API authentication failed. Check the configured key.'
      : status === 429
        ? 'API rate limit or quota reached. Check your API project usage and billing.'
        : status === 403
          ? 'API project or model access was denied.'
          : status === 404
            ? 'The configured model or API resource was not found.'
            : 'Live verification failed. Check model access, network connectivity, and server configuration.';
  console.error(message);
  process.exitCode = 1;
} finally {
  await db.close();
}
