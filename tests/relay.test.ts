import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { connect, migrate, seed, type Store } from '../server/db.js';
import { executeTool, confirmResolution, type Context, AppError } from '../server/tools.js';
import { createApp } from '../server/app.js';
import { evaluate } from '../server/evaluation.js';
import { eligible, retrieve } from '../server/policy.js';
import { runAgent } from '../server/agent.js';

let db: Store, ctx: Context;
beforeEach(async () => {
  db = await connect(undefined, ':memory:');
  await migrate(db);
  await seed(db, 'alice');
  await seed(db, 'bob');
  ctx = { db, tenant: 'alice', conversation: randomUUID(), traces: [] };
  await db.query('INSERT INTO conversations(id,tenant,title,created_at) VALUES(?,?,?,?)', [
    ctx.conversation,
    ctx.tenant,
    'Test',
    new Date().toISOString(),
  ]);
});
afterEach(async () => {
  await db.close();
});
const propose = (overrides = {}) =>
  executeTool(ctx, 'propose_resolution', {
    orderId: 'RL-1042',
    action: 'exchange',
    reason: 'Left speaker is broken',
    ...overrides,
  });

describe('Atomic resolutions', () => {
  it('requires confirmation before inventory or order state changes', async () => {
    const p = await propose();
    expect(p.proposal).toBeTruthy();
    const [o] = await db.query('SELECT * FROM orders WHERE tenant=? AND id=?', [
      'alice',
      'RL-1042',
    ]);
    const [i] = await db.query('SELECT stock FROM inventory WHERE tenant=? AND sku=?', [
      'alice',
      'STUDIO-01',
    ]);
    expect(o.status).toBe('delivered');
    expect(i.stock).toBe(12);
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
  });
  it('confirms once and replays concurrent retries without decrementing stock twice', async () => {
    const p = await propose();
    const result = await Promise.all([
      confirmResolution(db, 'alice', p.proposal.id),
      confirmResolution(db, 'alice', p.proposal.id),
    ]);
    expect(result[0].id).toBe(result[1].id);
    expect(result[1].replayed).toBe(true);
    const [i] = await db.query('SELECT stock FROM inventory WHERE tenant=? AND sku=?', [
      'alice',
      'STUDIO-01',
    ]);
    expect(i.stock).toBe(11);
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(1);
  });
  it('rechecks stock at confirmation and rolls back when no stock remains', async () => {
    const p = await propose();
    await db.query('UPDATE inventory SET stock=0 WHERE tenant=? AND sku=?', ['alice', 'STUDIO-01']);
    await expect(confirmResolution(db, 'alice', p.proposal.id)).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
    });
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
    const [o] = await db.query('SELECT status FROM orders WHERE tenant=? AND id=?', [
      'alice',
      'RL-1042',
    ]);
    expect(o.status).toBe('delivered');
  });
  it('rejects an expired proposal', async () => {
    const p = await propose();
    await db.query('UPDATE proposals SET expires_at=? WHERE id=?', [
      new Date(Date.now() - 1000).toISOString(),
      p.proposal.id,
    ]);
    await expect(confirmResolution(db, 'alice', p.proposal.id)).rejects.toMatchObject({
      code: 'EXPIRED',
    });
  });
  it('rejects cancelled and superseded proposals', async () => {
    const old = await propose();
    const current = await propose();
    await expect(confirmResolution(db, 'alice', old.proposal.id)).rejects.toMatchObject({
      code: 'STALE_PROPOSAL',
    });
    await db.query("UPDATE proposals SET status='cancelled' WHERE id=?", [current.proposal.id]);
    await expect(confirmResolution(db, 'alice', current.proposal.id)).rejects.toMatchObject({
      code: 'STALE_PROPOSAL',
    });
  });
  it('protects a one-unit inventory against simultaneous confirmations from separate conversations', async () => {
    await db.query('UPDATE inventory SET stock=1 WHERE tenant=? AND sku=?', ['alice', 'STUDIO-01']);
    const a = await propose();
    const other = { ...ctx, conversation: randomUUID(), traces: [] };
    const b = await executeTool(other, 'propose_resolution', {
      orderId: 'RL-1042',
      action: 'exchange',
      reason: 'Broken item',
    });
    const outcomes = await Promise.allSettled([
      confirmResolution(db, 'alice', a.proposal.id),
      confirmResolution(db, 'alice', b.proposal.id),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const [i] = await db.query('SELECT stock FROM inventory WHERE tenant=? AND sku=?', [
      'alice',
      'STUDIO-01',
    ]);
    expect(i.stock).toBe(0);
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(1);
  });
  it('records a refund request for the server-trusted purchase amount', async () => {
    const p = await propose({ action: 'refund' });
    const r = await confirmResolution(db, 'alice', p.proposal.id);
    expect(r.amount).toBe(12900);
    expect(r.action).toBe('refund');
    const [i] = await db.query('SELECT stock FROM inventory WHERE tenant=? AND sku=?', [
      'alice',
      'STUDIO-01',
    ]);
    expect(i.stock).toBe(12);
  });
  it('rechecks policy eligibility at confirmation', async () => {
    const p = await propose();
    await db.query('UPDATE orders SET delivered_at=? WHERE tenant=? AND id=?', [
      new Date(Date.now() - 40 * 86400000).toISOString(),
      'alice',
      'RL-1042',
    ]);
    await expect(confirmResolution(db, 'alice', p.proposal.id)).rejects.toMatchObject({
      code: 'OUTSIDE_WINDOW',
    });
  });
});
describe('Ownership and tool boundaries', () => {
  it('rejects cross-tenant proposal access', async () => {
    const p = await propose();
    await expect(confirmResolution(db, 'bob', p.proposal.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('filters order lookup by customer identity', async () => {
    await db.query("UPDATE orders SET product='Alice-only product' WHERE tenant=? AND id=?", [
      'alice',
      'RL-1042',
    ]);
    const a = await executeTool({ ...ctx, tenant: 'bob', traces: [] }, 'get_order', {
      orderId: 'RL-1042',
    });
    expect(a.product).toBe('Studio Wireless Headphones');
  });
  it('rejects model-supplied amount and tenant overrides', async () => {
    const result = await propose({ amount: 1, tenant: 'bob' });
    expect(result.error).toBe('INVALID_ARGUMENTS');
    expect(await db.query('SELECT * FROM proposals')).toHaveLength(0);
  });
  it('does not expose confirmation as a model tool', async () => {
    const r = await executeTool(ctx, 'confirm_resolution', { proposalId: 'anything' });
    expect(r.error).toBe('UNKNOWN_TOOL');
  });
  it('stores handoff tickets with the conversation summary', async () => {
    const r = await executeTool(ctx, 'escalate_to_human', {
      summary: 'Customer needs a specialist for a disputed charge.',
    });
    expect(r.externalNotificationSent).toBe(false);
    const [t] = await db.query('SELECT * FROM tickets WHERE id=?', [r.ticketId]);
    expect(t.tenant).toBe('alice');
    expect(t.summary).toContain('disputed charge');
  });
});
describe('Policy and retrieval', () => {
  it('handles 30-day boundary exactly', () => {
    const now = Date.now();
    const o = {
      status: 'delivered',
      delivered_at: new Date(now - 30 * 86400000).toISOString(),
      category: 'electronics',
    };
    expect(eligible(o, 'refund', 'Changed mind', now).allowed).toBe(true);
    expect(eligible(o, 'refund', 'Changed mind', now + 1).allowed).toBe(false);
  });
  it('finds a citable return policy and supports Chinese keywords', () => {
    expect(retrieve('refund policy')[0].id).toBe('RET-01');
    expect(retrieve('换货')[0].id).toBe('EXC-02');
    expect(retrieve('')).toHaveLength(0);
  });
  it('keeps written confirmation separate from execution', async () => {
    await propose();
    const r = await runAgent(ctx, [{ role: 'user', content: 'yes' }], { mode: 'demo' });
    expect(r.text).toContain('confirmation card');
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
  });
  it('remembers exchange intent when the customer supplies an order number in a follow-up', async () => {
    const r = await runAgent(
      ctx,
      [
        { role: 'user', content: 'My headphones are broken. Can you exchange them?' },
        { role: 'assistant', content: 'Which order?' },
        { role: 'user', content: 'RL-1042' },
      ],
      { mode: 'demo' },
    );
    expect(r.proposal?.action).toBe('exchange');
  });
  it('creates a handoff for a one-word request', async () => {
    const r = await runAgent(ctx, [{ role: 'user', content: 'human' }], { mode: 'demo' });
    expect(r.text).toContain('TKT-');
    expect(await db.query('SELECT * FROM tickets')).toHaveLength(1);
  });
});
describe('HTTP integration', () => {
  it('keeps UI evaluations offline when chat is configured for a live model', async () => {
    const agent = request.agent(createApp(db, { mode: 'openai' }));
    const result = await agent.post('/api/evaluations').send({}).expect(200);
    expect(result.body.mode).toBe('demo');
    expect(result.body.passed).toBe(20);
    expect(result.body.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
  it('runs a complete persisted exchange workflow and prevents account crossover', async () => {
    const app = createApp(db, { mode: 'demo', secret: 'test-only' }),
      alice = request.agent(app),
      bob = request.agent(app);
    await alice.get('/api/bootstrap').expect(200);
    const c = await alice
      .post('/api/conversations')
      .send({ title: 'Broken headphones' })
      .expect(201);
    const turn = await alice
      .post(`/api/conversations/${c.body.id}/messages`)
      .send({ content: 'My RL-1042 headphones are broken. Exchange them.' })
      .expect(200);
    const id = turn.body.assistant.metadata.proposal.id;
    expect(turn.body.assistant.metadata.traces.length).toBeGreaterThan(2);
    await bob.get(`/api/conversations/${c.body.id}`).expect(404);
    await bob.post(`/api/proposals/${id}/confirm`).send({ confirmed: true }).expect(404);
    await alice.post(`/api/proposals/${id}/confirm`).send({ confirmed: false }).expect(400);
    const confirmation = await alice
      .post(`/api/proposals/${id}/confirm`)
      .send({ confirmed: true })
      .expect(200);
    const replay = await alice
      .post(`/api/proposals/${id}/confirm`)
      .send({ confirmed: true })
      .expect(200);
    expect(replay.body.id).toBe(confirmation.body.id);
    const state = await alice.get('/api/bootstrap').expect(200);
    expect(state.body.orders.find((o: any) => o.id === 'RL-1042').status).toBe(
      'exchange_requested',
    );
    const resumed = await alice.get(`/api/conversations/${c.body.id}`).expect(200);
    expect(resumed.body.messages).toHaveLength(3);
  });
  it('rejects cross-origin writes and oversized or empty content', async () => {
    const agent = request.agent(createApp(db, { mode: 'demo' }));
    await agent
      .post('/api/conversations')
      .set('Origin', 'https://evil.example')
      .send({ title: 'X' })
      .expect(403);
    const c = await agent.post('/api/conversations').send({}).expect(201);
    await agent.post(`/api/conversations/${c.body.id}/messages`).send({ content: '' }).expect(400);
    await agent
      .post(`/api/conversations/${c.body.id}/messages`)
      .send({ content: 'x'.repeat(3001) })
      .expect(400);
  });
  it('accepts the Render HTTPS origin behind its proxy and still rejects foreign origins', async () => {
    vi.stubEnv('RENDER', 'true');
    vi.stubEnv('RENDER_EXTERNAL_URL', 'https://relay-example.onrender.com');
    vi.stubEnv('APP_ORIGIN', '');
    try {
      const agent = request.agent(createApp(db, { mode: 'demo' }));
      await agent
        .post('/api/conversations')
        .set('Origin', 'https://relay-example.onrender.com')
        .set('X-Forwarded-Proto', 'https')
        .send({})
        .expect(201);
      await agent
        .post('/api/conversations')
        .set('Origin', 'https://foreign.example')
        .send({})
        .expect(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('invalidates a cancelled proposal', async () => {
    const agent = request.agent(createApp(db, { mode: 'demo' }));
    const c = await agent.post('/api/conversations').send({}).expect(201);
    const turn = await agent
      .post(`/api/conversations/${c.body.id}/messages`)
      .send({ content: 'Refund RL-1043.' })
      .expect(200);
    const id = turn.body.assistant.metadata.proposal.id;
    await agent.post(`/api/proposals/${id}/cancel`).send({}).expect(200);
    await agent.post(`/api/proposals/${id}/confirm`).send({ confirmed: true }).expect(409);
  });
});
describe('Live model adapter (mocked API, no paid calls)', () => {
  it('finishes an explicitly requested exchange instead of asking whether to prepare it', async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async (payload: any) => {
            if (++calls === 1)
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content:
                        'The replacement is in stock. Would you like me to prepare an exchange for you now?',
                    },
                  },
                ],
              };
            if (calls === 2) {
              expect(payload.tool_choice).toEqual({
                type: 'function',
                function: { name: 'propose_resolution' },
              });
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'requested_exchange',
                          type: 'function',
                          function: {
                            name: 'propose_resolution',
                            arguments: JSON.stringify({
                              orderId: 'RL-1042',
                              action: 'exchange',
                              reason: 'Headphones have no sound on the left side.',
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            }
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Please review and confirm the replacement proposal below.',
                  },
                },
              ],
            };
          },
        },
      },
    };
    const result = await runAgent(
      ctx,
      [
        {
          role: 'user',
          content: 'My RL-1042 headphones have no sound on the left side. Can I get a replacement?',
        },
      ],
      { mode: 'openai', client: client as any },
    );
    expect(calls).toBe(3);
    expect(result.proposal?.action).toBe('exchange');
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
  });
  it.each(['Please explain the return policy for RL-1042.', 'I do not want a refund for RL-1042.'])(
    'does not prepare a proposal for informational or negated requests: %s',
    async (content) => {
      let calls = 0;
      const client = {
        chat: {
          completions: {
            create: async () => {
              calls++;
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: 'No order changes have been requested or made.',
                    },
                  },
                ],
              };
            },
          },
        },
      };
      const result = await runAgent(ctx, [{ role: 'user', content }], {
        mode: 'openai',
        client: client as any,
      });
      expect(calls).toBe(1);
      expect(result.proposal).toBeNull();
      expect(await db.query('SELECT * FROM proposals')).toHaveLength(0);
    },
  );
  it('looks up a supplied order and repairs a redundant ID question before preparing the exchange', async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async (payload: any) => {
            calls++;
            if (calls === 1) {
              expect(payload.messages.at(-1).role).toBe('tool');
              expect(JSON.parse(payload.messages.at(-1).content).id).toBe('RL-1042');
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content:
                        'Could you please provide the order ID or any details to identify the order?',
                    },
                  },
                ],
              };
            }
            if (calls === 2) {
              expect(payload.tool_choice).toBe('required');
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'policy',
                          type: 'function',
                          function: {
                            name: 'search_policy',
                            arguments: JSON.stringify({ query: 'defective exchange' }),
                          },
                        },
                        {
                          id: 'stock',
                          type: 'function',
                          function: {
                            name: 'check_inventory',
                            arguments: JSON.stringify({ orderId: 'RL-1042' }),
                          },
                        },
                        {
                          id: 'proposal',
                          type: 'function',
                          function: {
                            name: 'propose_resolution',
                            arguments: JSON.stringify({
                              orderId: 'RL-1042',
                              action: 'exchange',
                              reason: 'Headphones have no sound on the left side.',
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            }
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content:
                      'Your replacement proposal is ready. Please review and confirm it. [EXC-02]',
                  },
                },
              ],
            };
          },
        },
      },
    };
    const result = await runAgent(
      ctx,
      [
        {
          role: 'user',
          content: 'My RL-1042 headphones have no sound on the left side. Can I get a replacement?',
        },
      ],
      { mode: 'openai', client: client as any },
    );
    expect(calls).toBe(3);
    expect(result.proposal?.order_id).toBe('RL-1042');
    expect(result.text).not.toContain('provide the order ID');
    expect(ctx.traces.map((t) => t.tool)).toEqual([
      'get_order',
      'search_policy',
      'check_inventory',
      'propose_resolution',
    ]);
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
    const [order] = await db.query('SELECT status FROM orders WHERE tenant=? AND id=?', [
      'alice',
      'RL-1042',
    ]);
    expect(order.status).toBe('delivered');
  });
  it.each([
    'My headphones have no sound. Can I get a replacement?',
    'Please compare RL-1042 and RL-1043.',
  ])('does not choose an order when the request is missing or ambiguous: %s', async (content) => {
    const client = {
      chat: {
        completions: {
          create: async (payload: any) => {
            expect(payload.messages.some((m: any) => m.role === 'tool')).toBe(false);
            return {
              choices: [
                {
                  message: { role: 'assistant', content: 'Which order would you like help with?' },
                },
              ],
            };
          },
        },
      },
    };
    const result = await runAgent(ctx, [{ role: 'user', content }], {
      mode: 'openai',
      client: client as any,
    });
    expect(ctx.traces).toHaveLength(0);
    expect(result.proposal).toBeNull();
  });
  it('keeps unknown order references scoped and does not substitute a valid order', async () => {
    const client = {
      chat: {
        completions: {
          create: async (payload: any) => {
            expect(JSON.parse(payload.messages.at(-1).content).error).toBe('ORDER_NOT_FOUND');
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content:
                      'I could not find that order in your account. Please check the order number.',
                  },
                },
              ],
            };
          },
        },
      },
    };
    const result = await runAgent(
      ctx,
      [{ role: 'user', content: 'Please exchange my broken RL-9999.' }],
      { mode: 'openai', client: client as any },
    );
    expect(ctx.traces).toHaveLength(1);
    expect(ctx.traces[0].input).toEqual({ orderId: 'RL-9999' });
    expect(result.proposal).toBeNull();
  });
  it('stops a repeated ID-question loop without claiming a completed action', async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls++;
            return {
              choices: [
                { message: { role: 'assistant', content: 'Please provide your order number.' } },
              ],
            };
          },
        },
      },
    };
    const result = await runAgent(
      ctx,
      [{ role: 'user', content: 'My RL-1042 headphones are broken.' }],
      { mode: 'openai', client: client as any },
    );
    expect(calls).toBe(2);
    expect(result.text).toContain('I located order RL-1042');
    expect(result.text).not.toContain('provide your order number');
    expect(result.proposal).toBeNull();
    expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
  });
  it('executes validated model tool calls and continues with tool results', async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async (payload: any) => {
            calls++;
            if (calls === 1)
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'call_1',
                          type: 'function',
                          function: { name: 'get_order', arguments: '{"orderId":"RL-1042"}' },
                        },
                      ],
                    },
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5 },
              };
            expect(payload.messages.at(-1).role).toBe('tool');
            expect(JSON.parse(payload.messages.at(-1).content).id).toBe('RL-1042');
            return {
              choices: [
                { message: { role: 'assistant', content: 'Your headphones were delivered.' } },
              ],
              usage: { prompt_tokens: 20, completion_tokens: 8 },
            };
          },
        },
      },
    };
    const result = await runAgent(ctx, [{ role: 'user', content: 'Check RL-1042' }], {
      mode: 'openai',
      client: client as any,
    });
    expect(calls).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 13 });
    expect(ctx.traces[0].tool).toBe('get_order');
  });
  it('returns a safe tool error to the model for invalid arguments', async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async (payload: any) => {
            if (++calls === 1)
              return {
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'x',
                          type: 'function',
                          function: { name: 'get_order', arguments: 'not json' },
                        },
                      ],
                    },
                  },
                ],
              };
            expect(JSON.parse(payload.messages.at(-1).content).error).toBe('INVALID_ARGUMENTS');
            return {
              choices: [
                { message: { role: 'assistant', content: 'Please provide an order number.' } },
              ],
            };
          },
        },
      },
    };
    const r = await runAgent(ctx, [{ role: 'user', content: 'Help' }], {
      mode: 'openai',
      client: client as any,
    });
    expect(r.text).toContain('order number');
    expect(ctx.traces[0].status).toBe('error');
  });
});
describe('Agent regression suite', () => {
  it('checks 20 isolated scenarios and removes their fixture data', async () => {
    const report = await evaluate(db, 'alice', 'demo');
    expect(report.total).toBe(20);
    expect(report.results.filter((r) => !r.passed)).toEqual([]);
    expect(await db.query("SELECT * FROM tenants WHERE id LIKE 'eval-%'")).toHaveLength(0);
    expect(await db.query('SELECT * FROM eval_runs WHERE tenant=?', ['alice'])).toHaveLength(1);
  });
});
