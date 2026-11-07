import { beforeEach, afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { connect, migrate, type Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import {
  LIVE_CASES,
  gradeLiveOutcome,
  evaluateLiveRemote,
  type LiveTurn,
} from '../server/live-evaluation.js';

let db: Store;
beforeEach(async () => {
  db = await connect(undefined, ':memory:');
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});
const turn = (overrides: Partial<LiveTurn> = {}): LiveTurn => ({
  prompt: 'Please exchange RL-1042.',
  text: 'Please confirm your replacement.',
  proposal: { order_id: 'RL-1042', action: 'exchange' },
  traces: [],
  usage: { inputTokens: 100, outputTokens: 20 },
  latencyMs: 500,
  model: 'test-model',
  mode: 'openai',
  ...overrides,
});
it('grades the requested order and action rather than accepting any proposal', () => {
  const checks = gradeLiveOutcome(
    LIVE_CASES[0],
    [turn({ proposal: { order_id: 'RL-1043', action: 'refund' } })],
    { tickets: [] },
  );
  expect(checks.find((c) => c.name === 'Correct order and action proposed')?.passed).toBe(false);
  expect(checks.find((c) => c.dimension === 'runtime')?.passed).toBe(true);
});
it('does not treat a policy-looking answer as retrieved citation evidence', () => {
  const s = LIVE_CASES.find((s) => s.id === 'policy-citation')!;
  const checks = gradeLiveOutcome(
    s,
    [turn({ text: 'Returns are allowed within 30 days. [RET-01]', proposal: null })],
    { tickets: [] },
  );
  expect(checks.find((c) => c.name === 'Cites the relevant policy')?.passed).toBe(true);
  expect(checks.find((c) => c.name === 'Citation has retrieved source evidence')?.passed).toBe(
    false,
  );
});
it('requires a persisted handoff, not just plausible text', () => {
  const s = LIVE_CASES.find((s) => s.id === 'handoff')!;
  const response = turn({ text: 'Your ticket TKT-FAKE is created.', proposal: null });
  expect(
    gradeLiveOutcome(s, [response], { tickets: [] }).find((c) => c.dimension === 'task')?.passed,
  ).toBe(false);
  expect(
    gradeLiveOutcome(s, [response], { tickets: [{ id: 'TKT-FAKE' }] }).find(
      (c) => c.dimension === 'task',
    )?.passed,
  ).toBe(true);
});
it('creates and cleans only the signed evaluation account, preserving normal accounts', async () => {
  const app = createApp(db, { mode: 'demo' }),
    normal = request.agent(app),
    fixture = request.agent(app);
  const c = await normal.post('/api/conversations').send({ title: 'Keep this' }).expect(201);
  await normal.delete('/api/evaluation-fixtures/current').expect(403);
  await fixture.post('/api/evaluation-fixtures').send({}).expect(201);
  await fixture.post('/api/conversations').send({ title: 'Temporary' }).expect(201);
  expect(await db.query("SELECT * FROM tenants WHERE id LIKE 'evaluation-%'")).toHaveLength(1);
  await fixture.delete('/api/evaluation-fixtures/current').expect(204);
  expect(await db.query("SELECT * FROM tenants WHERE id LIKE 'evaluation-%'")).toHaveLength(0);
  expect(await db.query("SELECT * FROM conversations WHERE title='Temporary'")).toHaveLength(0);
  await normal.get(`/api/conversations/${c.body.id}`).expect(200);
});
it('rejects cross-origin fixture creation', async () => {
  await request(createApp(db, { mode: 'demo' }))
    .post('/api/evaluation-fixtures')
    .set('Origin', 'https://foreign.example')
    .send({})
    .expect(403);
  expect(await db.query('SELECT * FROM tenants')).toHaveLength(0);
});

function appFetch(app: ReturnType<typeof createApp>): typeof fetch {
  return (async (url: any, init: any = {}) => {
    const path = new URL(String(url)).pathname;
    let req = (request(app) as any)[(init.method || 'GET').toLowerCase()](path);
    req = req.set('Host', new URL(String(url)).host);
    for (const [k, v] of Object.entries(init.headers || {})) req = req.set(k, String(v));
    if (init.body) req = req.send(JSON.parse(init.body));
    const res = await req;
    const headers = new Headers();
    if (res.headers['set-cookie']) headers.set('set-cookie', res.headers['set-cookie'][0]);
    return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
      status: res.status,
      headers,
    });
  }) as typeof fetch;
}
it('refuses a demo-mode target before creating evaluation fixtures', async () => {
  await expect(
    evaluateLiveRemote('http://localhost', {
      fetcher: appFetch(createApp(db, { mode: 'demo' })),
      minRequestIntervalMs: 0,
    }),
  ).rejects.toThrow('not configured for live');
  expect(await db.query('SELECT * FROM tenants')).toHaveLength(0);
});
it('exercises the HTTP harness and keeps offline responses from passing live integrity', async () => {
  const report = await evaluateLiveRemote('http://localhost', {
    cases: [LIVE_CASES[0]],
    fetcher: appFetch(createApp(db, { mode: 'demo' })),
    minRequestIntervalMs: 0,
    requireLive: false,
  });
  expect(report.total).toBe(1);
  expect(report.taskPassed).toBe(1);
  expect(report.passed).toBe(0);
  expect(report.breakdown.runtime.passed).toBe(0);
  expect(report.breakdown.safety.passed).toBe(report.breakdown.safety.total);
  expect(report.breakdown.confirmation.passed).toBe(report.breakdown.confirmation.total);
  expect(report.results[0].cleanup).toBe(true);
  expect(report.results[0].turns[0].proposal).not.toHaveProperty('tenant');
  expect(await db.query("SELECT * FROM tenants WHERE id LIKE 'evaluation-%'")).toHaveLength(0);
});
it('retains request failures and stops after two consecutive errors', async () => {
  const app = createApp(db, { mode: 'demo' }),
    realFetch = appFetch(app);
  const fake = (async (url: any, init: any) =>
    String(url).endsWith('/messages')
      ? new Response(JSON.stringify({ error: 'SERVER_ERROR' }), { status: 500 })
      : realFetch(url, init)) as typeof fetch;
  const report = await evaluateLiveRemote('http://localhost', {
    cases: LIVE_CASES.slice(0, 3),
    fetcher: fake,
    minRequestIntervalMs: 0,
    requireLive: false,
  });
  expect(report.status).toBe('incomplete');
  expect(report.total).toBe(2);
  expect(report.planned).toBe(3);
  expect(report.passed).toBe(0);
  expect(report.results.every((r) => r.error && r.cleanup)).toBe(true);
  expect(report.usage.complete).toBe(false);
});
it('does not claim cleanup after an interrupted write whose server outcome is unknown', async () => {
  const realFetch = appFetch(createApp(db, { mode: 'demo' }));
  const fake = (async (url: any, init: any) => {
    if (String(url).endsWith('/messages')) throw new Error('Simulated connection loss');
    return realFetch(url, init);
  }) as typeof fetch;
  const report = await evaluateLiveRemote('http://localhost', {
    cases: [LIVE_CASES[0]],
    fetcher: fake,
    minRequestIntervalMs: 0,
    requireLive: false,
  });
  expect(report.passed).toBe(0);
  expect(report.results[0].cleanup).toBe(false);
  expect(report.breakdown.cleanup.passed).toBe(0);
  expect(report.usage.complete).toBe(false);
});

it('grades structured state evidence rather than accepting a plausible final answer', () => {
  const s = {
    ...LIVE_CASES[0],
    states: [
      { turn: 1, expected: { stage: 'awaiting_confirmation' as const, orderId: 'RL-1042' } },
    ],
  };
  const absent = gradeLiveOutcome(s, [turn()], { tickets: [] });
  expect(absent.find((c) => c.name.startsWith('Structured state'))?.passed).toBe(false);
  const present = gradeLiveOutcome(
    s,
    [turn({ state: { stage: 'awaiting_confirmation', orderId: 'RL-1042' } as any })],
    { tickets: [] },
  );
  expect(present.find((c) => c.name.startsWith('Structured state'))?.passed).toBe(true);
});
