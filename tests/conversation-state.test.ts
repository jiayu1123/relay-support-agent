import { beforeEach, afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { connect, migrate, seed, type Store } from '../server/db.js';
import { runAgent } from '../server/agent.js';
import { createApp } from '../server/app.js';
import { executeTool, confirmResolution, type Context } from '../server/tools.js';
import {
  beginConversationTurn,
  finishConversationTurn,
  getConversationState,
} from '../server/conversation-state.js';

let db: Store, ctx: Context;
beforeEach(async () => {
  db = await connect(undefined, ':memory:');
  await migrate(db);
  await seed(db, 'alice');
  ctx = { db, tenant: 'alice', conversation: randomUUID(), traces: [] };
  await db.query('INSERT INTO conversations(id,tenant,title,created_at) VALUES(?,?,?,?)', [
    ctx.conversation,
    'alice',
    'State test',
    new Date().toISOString(),
  ]);
});
afterEach(async () => {
  await db.close();
});
const turn = async (content: string) =>
  runAgent({ ...ctx, traces: [] }, [{ role: 'user', content }], { mode: 'demo' });
it('retains supplied slots across turns without replaying chat history', async () => {
  const first = await turn('My headphones are broken. I need an exchange.');
  expect(first.state).toMatchObject({
    intent: 'exchange',
    orderId: null,
    defectReported: true,
    stage: 'awaiting_order',
    processing: false,
  });
  const second = await turn('RL-1042');
  expect(second.proposal).toMatchObject({ order_id: 'RL-1042', action: 'exchange' });
  expect(second.state).toMatchObject({
    turn: 2,
    orderVerified: true,
    stage: 'awaiting_confirmation',
  });
});
it('persists missing defect details and does not trust a model-invented reason', async () => {
  const { state } = await beginConversationTurn(db, ctx, [
    { role: 'user', content: 'Please exchange RL-1043.' },
  ]);
  ctx.state = state;
  const attempt = await executeTool(ctx, 'propose_resolution', {
    orderId: 'RL-1043',
    action: 'exchange',
    reason: 'Broken and damaged!',
  });
  expect(attempt).toMatchObject({ allowed: false, code: 'REASON_REQUIRED' });
  await finishConversationTurn(db, ctx, state);
  expect((await getConversationState(db, ctx)).missingSlots).toContain('defect_details');
  expect(await db.query('SELECT * FROM proposals')).toHaveLength(0);
  const followUp = await turn('The strap is broken.');
  expect(followUp.proposal).toMatchObject({ order_id: 'RL-1043', action: 'exchange' });
});
it('switching orders revokes the old card and clears the old defect evidence', async () => {
  const first = await turn('My RL-1042 headphones are broken. Please exchange them.');
  const second = await turn('Actually, RL-1043.');
  expect(second.state).toMatchObject({
    orderId: 'RL-1043',
    intent: 'exchange',
    issue: null,
    defectReported: false,
    stage: 'awaiting_details',
    pendingProposal: null,
  });
  await expect(confirmResolution(db, 'alice', first.proposal.id)).rejects.toMatchObject({
    code: 'STALE_PROPOSAL',
  });
  expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
});
it('switching intent supersedes the old proposal and confirms only the new one', async () => {
  const first = await turn('RL-1042 is broken. Please exchange it.');
  const second = await turn('Actually, do not exchange it. I want a refund instead.');
  expect(second.proposal).toMatchObject({ order_id: 'RL-1042', action: 'refund' });
  await expect(confirmResolution(db, 'alice', first.proposal.id)).rejects.toMatchObject({
    code: 'STALE_PROPOSAL',
  });
  const resolution = await confirmResolution(db, 'alice', second.proposal.id);
  expect(resolution.action).toBe('refund');
  expect(await getConversationState(db, ctx)).toMatchObject({
    stage: 'resolved',
    pendingProposal: null,
    resolutionId: resolution.id,
  });
});
it.each([
  'Cancel that request.',
  'I do not want a refund.',
  "I don't want to exchange it.",
  'I no longer want a refund.',
  '不想换货了',
])('cancels without creating a replacement proposal: %s', async (content) => {
  const first = await turn('RL-1042 is broken. Please exchange it.');
  const cancelled = await turn(content);
  expect(cancelled.state).toMatchObject({
    stage: 'cancelled',
    intent: null,
    pendingProposal: null,
  });
  expect(cancelled.proposal).toBeNull();
  await expect(confirmResolution(db, 'alice', first.proposal.id)).rejects.toMatchObject({
    code: 'STALE_PROPOSAL',
  });
  const neutral = await turn('Thanks.');
  expect(neutral.state?.stage).toBe('cancelled');
});
it('written yes leaves the same pending proposal and cannot mutate the order', async () => {
  const first = await turn('RL-1042 is broken. Please exchange it.');
  const yes = await turn('Yes');
  expect(yes.state).toMatchObject({
    turnKind: 'confirmation',
    stage: 'awaiting_confirmation',
    pendingProposal: { id: first.proposal.id },
  });
  expect(await db.query('SELECT * FROM resolutions')).toHaveLength(0);
  expect(await db.query('SELECT * FROM proposals')).toHaveLength(1);
});
it('multiple orders clear active slots until the customer chooses one', async () => {
  const first = await turn('RL-1042 is broken. Please exchange it.');
  const ambiguous = await turn('Could you refund RL-1042 or RL-1043?');
  expect(ambiguous.state).toMatchObject({
    orderId: null,
    orderCandidates: ['RL-1042', 'RL-1043'],
    stage: 'awaiting_order',
    pendingProposal: null,
  });
  await expect(confirmResolution(db, 'alice', first.proposal.id)).rejects.toMatchObject({
    code: 'STALE_PROPOSAL',
  });
  const selected = await turn('RL-1043');
  expect(selected.proposal).toMatchObject({ order_id: 'RL-1043', action: 'refund' });
});
it('does not keep an old action when the customer asks to choose exchange or refund', async () => {
  await turn('RL-1042 is broken. Please exchange it.');
  const ambiguous = await turn('Should I exchange or refund it?');
  expect(ambiguous.state).toMatchObject({
    intent: null,
    stage: 'awaiting_action',
    pendingProposal: null,
  });
});
it('a retracted defect cannot qualify a personalized final-sale refund', async () => {
  const result = await turn('Please refund RL-1020. I changed my mind; it is not defective.');
  expect(result.state).toMatchObject({
    defectReported: false,
    stage: 'blocked',
    lastDecision: { allowed: false, code: 'FINAL_SALE' },
  });
  expect(result.proposal).toBeNull();
});
it('API state survives app recreation and stays scoped to its signed owner', async () => {
  const app = createApp(db, { mode: 'demo', secret: 'test-state' }),
    alice = request.agent(app),
    bob = request.agent(app);
  const c = await alice.post('/api/conversations').send({}).expect(201);
  const first = await alice
    .post(`/api/conversations/${c.body.id}/messages`)
    .send({ content: 'My headphones are broken. Please exchange them.' })
    .expect(200);
  const original = await alice.get(`/api/conversations/${c.body.id}`).expect(200);
  expect(original.body.state.intent).toBe('exchange');
  await bob.get(`/api/conversations/${c.body.id}`).expect(404);
  const signedCookie = c.headers['set-cookie'][0].split(';')[0];
  const restored = await request(createApp(db, { mode: 'demo', secret: 'test-state' }))
    .get(`/api/conversations/${c.body.id}`)
    .set('Cookie', signedCookie)
    .expect(200);
  expect(restored.body.state).toEqual(original.body.state);
  expect(
    (
      await alice
        .post(`/api/conversations/${c.body.id}/messages`)
        .send({ content: 'RL-1042' })
        .expect(200)
    ).body.assistant.metadata.state.stage,
  ).toBe('awaiting_confirmation');
});
it('confirmation, cancellation and expiry reflect authoritative database state', async () => {
  const app = createApp(db, { mode: 'demo' }),
    agent = request.agent(app);
  const c = await agent.post('/api/conversations').send({}).expect(201);
  const result = await agent
    .post(`/api/conversations/${c.body.id}/messages`)
    .send({ content: 'Refund RL-1043.' })
    .expect(200);
  const id = result.body.assistant.metadata.proposal.id;
  await agent.post(`/api/proposals/${id}/cancel`).send({}).expect(200);
  expect((await agent.get(`/api/conversations/${c.body.id}`)).body.state).toMatchObject({
    stage: 'cancelled',
    pendingProposal: null,
  });
  const renewed = await agent
    .post(`/api/conversations/${c.body.id}/messages`)
    .send({ content: 'Please refund RL-1043 again.' })
    .expect(200);
  await db.query('UPDATE proposals SET expires_at=? WHERE id=?', [
    new Date(0).toISOString(),
    renewed.body.assistant.metadata.proposal.id,
  ]);
  expect((await agent.get(`/api/conversations/${c.body.id}`)).body.state).toMatchObject({
    stage: 'expired',
    pendingProposal: null,
  });
});
it('invalidates old proposals before a model turn finishes and serializes competing turns', async () => {
  const first = await turn('RL-1042 is broken. Please exchange it.');
  const { state } = await beginConversationTurn(db, ctx, [
    { role: 'user', content: 'Actually please refund RL-1043.' },
  ]);
  await expect(
    beginConversationTurn(db, ctx, [{ role: 'user', content: 'Another request' }]),
  ).rejects.toMatchObject({ code: 'TURN_IN_PROGRESS' });
  await expect(confirmResolution(db, 'alice', first.proposal.id)).rejects.toMatchObject({
    code: 'TURN_IN_PROGRESS',
  });
  await finishConversationTurn(db, ctx, state, true);
  await expect(confirmResolution(db, 'alice', first.proposal.id)).rejects.toMatchObject({
    code: 'STALE_PROPOSAL',
  });
  expect(await getConversationState(db, ctx)).toMatchObject({
    processing: false,
    stage: 'interrupted',
    orderId: 'RL-1043',
    intent: 'refund',
  });
});
it('failed model turns retain supplied slots, revoke new proposals, and allow retry', async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          if (++calls === 1)
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'p',
                        type: 'function',
                        function: {
                          name: 'propose_resolution',
                          arguments: JSON.stringify({
                            orderId: 'RL-1042',
                            action: 'exchange',
                            reason: 'broken',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            };
          throw new Error('simulated timeout');
        },
      },
    },
  };
  await expect(
    runAgent(
      { ...ctx, traces: [] },
      [{ role: 'user', content: 'RL-1042 is broken. Please exchange it.' }],
      { mode: 'openai', client: client as any },
    ),
  ).rejects.toThrow('simulated timeout');
  expect(await getConversationState(db, ctx)).toMatchObject({
    orderId: 'RL-1042',
    intent: 'exchange',
    stage: 'interrupted',
    processing: false,
    pendingProposal: null,
    lastError: 'TURN_FAILED',
  });
  expect((await db.query('SELECT status FROM proposals'))[0].status).toBe('superseded');
  expect((await turn('Please try the exchange again.')).proposal).toBeTruthy();
});
it('rejects model proposals for a different order or action than the active slots', async () => {
  const { state } = await beginConversationTurn(db, ctx, [
    { role: 'user', content: 'Please refund RL-1043.' },
  ]);
  ctx.state = state;
  expect(
    await executeTool(ctx, 'propose_resolution', {
      orderId: 'RL-1042',
      action: 'exchange',
      reason: 'Broken',
    }),
  ).toMatchObject({ error: 'STATE_MISMATCH' });
  await finishConversationTurn(db, ctx, state);
  expect(await db.query('SELECT * FROM proposals')).toHaveLength(0);
});
it('recovers an abandoned processing lease and rejects the older worker', async () => {
  const { state: old } = await beginConversationTurn(db, ctx, [
    { role: 'user', content: 'Refund RL-1043.' },
  ]);
  const stored = { ...old, updatedAt: new Date(Date.now() - 301000).toISOString() };
  await db.query('UPDATE conversation_states SET state=? WHERE tenant=? AND conversation=?', [
    JSON.stringify(stored),
    ctx.tenant,
    ctx.conversation,
  ]);
  const { state: current } = await beginConversationTurn(db, ctx, [
    { role: 'user', content: 'Please refund RL-1043.' },
  ]);
  const stale = await executeTool({ ...ctx, state: old }, 'propose_resolution', {
    orderId: 'RL-1043',
    action: 'refund',
    reason: 'return',
  });
  expect(stale.error).toBe('STATE_CHANGED');
  await expect(finishConversationTurn(db, ctx, old)).rejects.toMatchObject({
    code: 'STATE_CHANGED',
  });
  await finishConversationTurn(db, ctx, current);
});
it('confirmation updates persist and do not restart on a neutral message', async () => {
  const first = await turn('Refund RL-1043.');
  const resolution = await confirmResolution(db, 'alice', first.proposal.id);
  expect(await getConversationState(db, ctx)).toMatchObject({
    stage: 'resolved',
    resolutionId: resolution.id,
  });
  expect((await turn('Thank you.')).state).toMatchObject({
    stage: 'resolved',
    pendingProposal: null,
  });
  expect((await confirmResolution(db, 'alice', first.proposal.id)).replayed).toBe(true);
});

it('unknown order slots stay unverified until a scoped lookup succeeds', async () => {
  const unknown = await turn('Refund RL-9999.');
  expect(unknown.state).toMatchObject({
    orderId: 'RL-9999',
    orderVerified: false,
    stage: 'awaiting_order',
  });
  const corrected = await turn('Sorry, RL-1043.');
  expect(corrected.state).toMatchObject({
    orderId: 'RL-1043',
    orderVerified: true,
    stage: 'awaiting_confirmation',
  });
});
it('informational questions and negated cancellation preserve an existing workflow', async () => {
  const first = await turn('Refund RL-1043.');
  const information = await turn('What is the delivery status of RL-1050?');
  expect(information.state).toMatchObject({
    orderId: 'RL-1043',
    intent: 'refund',
    turnKind: 'information',
    pendingProposal: { id: first.proposal.id },
  });
  const keep = await turn('Do not cancel it.');
  expect(keep.state?.pendingProposal?.id).toBe(first.proposal.id);
});
it('live model sees persisted slots after earlier history is truncated', async () => {
  await turn('My headphones are broken. I need an exchange.');
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async (payload: any) => {
          calls++;
          expect(payload.messages[0].content).toContain('"intent":"exchange"');
          expect(payload.messages[0].content).toContain('headphones are broken');
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Please review the confirmation card.',
                  ...(calls === 1
                    ? {
                        tool_calls: [
                          {
                            id: 'proposal',
                            type: 'function',
                            function: {
                              name: 'propose_resolution',
                              arguments: JSON.stringify({
                                orderId: 'RL-1042',
                                action: 'exchange',
                                reason: 'broken',
                              }),
                            },
                          },
                        ],
                      }
                    : {}),
                },
              },
            ],
          };
        },
      },
    },
  };
  const result = await runAgent(
    { ...ctx, traces: [] },
    [
      { role: 'assistant', content: 'Some unrelated context.' },
      { role: 'user', content: 'RL-1042' },
    ],
    { mode: 'openai', client: client as any },
  );
  expect(result.proposal?.action).toBe('exchange');
});
it('live handoff guard completes an explicitly requested ticket without inventing an order', async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async (payload: any) => {
          calls++;
          if (calls === 1)
            return {
              choices: [{ message: { role: 'assistant', content: 'Please provide an order ID.' } }],
            };
          if (calls === 2) {
            expect(payload.tool_choice.function.name).toBe('escalate_to_human');
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'handoff',
                        type: 'function',
                        function: {
                          name: 'escalate_to_human',
                          arguments: JSON.stringify({
                            summary:
                              'Customer requested human assistance with a missing delivery. No order ID provided.',
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
              { message: { role: 'assistant', content: 'I created the internal support ticket.' } },
            ],
          };
        },
      },
    },
  };
  const result = await runAgent(
    { ...ctx, traces: [] },
    [
      {
        role: 'user',
        content: 'Please create a ticket for a human specialist about my missing delivery.',
      },
    ],
    { mode: 'openai', client: client as any },
  );
  expect(result.state).toMatchObject({ stage: 'escalated', orderId: null });
  expect(result.state?.ticketId).toMatch(/^TKT-/);
  expect(await db.query('SELECT * FROM tickets')).toHaveLength(1);
});
