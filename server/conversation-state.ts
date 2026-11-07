import { z } from 'zod';
import type { SQL, Store } from './db.js';
import { AppError } from './errors.js';

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  processing: z.boolean(),
  updatedAt: z.string(),
  language: z.enum(['en', 'zh']),
  intent: z.enum(['exchange', 'refund', 'handoff']).nullable(),
  orderId: z.string().nullable(),
  orderCandidates: z.array(z.string()),
  orderVerified: z.boolean(),
  issue: z.string().nullable(),
  defectReported: z.boolean(),
  missingSlots: z.array(z.enum(['order_id', 'action', 'defect_details'])),
  stage: z.enum([
    'idle',
    'awaiting_order',
    'awaiting_action',
    'awaiting_details',
    'ready',
    'awaiting_confirmation',
    'blocked',
    'cancelled',
    'resolved',
    'escalated',
    'expired',
    'interrupted',
  ]),
  turnKind: z.enum(['task', 'information', 'confirmation', 'cancel', 'ambiguous']),
  pendingProposal: z
    .object({
      id: z.string(),
      orderId: z.string(),
      action: z.enum(['exchange', 'refund']),
      expiresAt: z.string(),
    })
    .nullable(),
  lastDecision: z.object({ allowed: z.boolean(), code: z.string() }).nullable(),
  ticketId: z.string().nullable(),
  resolutionId: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type ConversationState = z.infer<typeof stateSchema>;
export type StateKey = { tenant: string; conversation: string };
export function emptyState(): ConversationState {
  return {
    schemaVersion: 1,
    revision: 0,
    turn: 0,
    processing: false,
    updatedAt: new Date().toISOString(),
    language: 'en',
    intent: null,
    orderId: null,
    orderCandidates: [],
    orderVerified: false,
    issue: null,
    defectReported: false,
    missingSlots: [],
    stage: 'idle',
    turnKind: 'information',
    pendingProposal: null,
    lastDecision: null,
    ticketId: null,
    resolutionId: null,
    lastError: null,
  };
}

// These are bounded, bilingual slot rules, not a general semantic classifier.
// Strip explicit negations before checking positive evidence. "not working" remains a defect.
export const deniesDefect = (s: string) =>
  /\b(?:not|never)\s+(?:defective|broken|damaged|faulty)|\b(?:isn't|is not|wasn't|was not)\s+(?:defective|broken|damaged|faulty)|没有(?:故障|损坏|问题)|(?:不是|并非).{0,4}(?:坏|故障)|没坏/i.test(
    s,
  );
export function hasDefectEvidence(s: string) {
  const positive = s.replace(
    /\b(?:isn't|is not|wasn't|was not|not|never)\s+(?:defective|broken|damaged|faulty)\b|没有(?:故障|损坏|问题)|(?:不是|并非).{0,4}(?:坏|故障)|没坏/gi,
    '',
  );
  return /\b(?:defective|defect|broken|damaged|damage|faulty)\b|no sound|(?:not|n't) work|stopped work|坏了|损坏|破损|故障|没有声音|没声音|无法使用|不能用|不工作/i.test(
    positive,
  );
}
export function orderReferences(text: string): string[] {
  const ids = [...text.matchAll(/\bRL[-\s]?(\d{4})(?!\d)/gi)].map((m) => `RL-${m[1]}`);
  const bare = text.trim().match(/^(?:order\s*|订单(?:号)?\s*)?(\d{4})[.!。！\s]*$/i);
  if (bare) ids.push(`RL-${bare[1]}`);
  return [...new Set(ids)];
}
function slots(s: ConversationState) {
  s.missingSlots = [];
  if (s.intent === 'handoff') {
    s.stage = 'ready';
    return;
  }
  if (s.intent || s.orderId || s.orderCandidates.length) {
    if (!s.orderId) s.missingSlots.push('order_id');
    if (!s.intent) s.missingSlots.push('action');
    if (s.intent === 'exchange' && !s.defectReported) s.missingSlots.push('defect_details');
  }
  s.stage = s.missingSlots.includes('order_id')
    ? 'awaiting_order'
    : s.missingSlots.includes('action')
      ? 'awaiting_action'
      : s.missingSlots.includes('defect_details')
        ? 'awaiting_details'
        : s.intent
          ? 'ready'
          : 'idle';
}
export function reduceUserState(previous: ConversationState, text: string): ConversationState {
  const s = structuredClone(previous);
  s.turn++;
  s.processing = true;
  s.lastError = null;
  s.language = /[\u4e00-\u9fff]/.test(text) ? 'zh' : s.language;
  const refs = orderReferences(text);
  const informational =
    /\b(?:explain|describe|what|tell me about)\b[^\n]*\b(?:polic(?:y|ies)|rules|window)\b|(?:了解|什么|介绍).*(?:政策|规则)|\b(?:what(?:'s| is)|where(?:'s| is)|show me)\b.*\b(?:status|tracking|delivery)\b|(?:查询|查看).*(?:物流|状态)/i.test(
      text,
    );
  const positive = text.replace(
    /\b(?:don't|do not|not|never|no longer)\s+(?:(?:want|need|request)(?:\s+to)?\s+)?(?:(?:an?|the)\s+)?(?:refund|exchange|replace|replacement|return)\b|(?:不要|不想|不需要)(?:再)?(?:退货|退款|换货)/gi,
    '',
  );
  const exchange = /\b(?:exchange|replace|replacement)\b|换货|换一个/i.test(positive);
  const refund = /\b(?:refund|return)\b|退货|退款/i.test(positive);
  const handoff = /\b(?:human|specialist|escalate)\b|人工|转人工/i.test(positive);
  const action = exchange === refund ? null : exchange ? 'exchange' : 'refund';
  const cancel =
    /\b(?:cancel|stop|never mind|nevermind)\b|\b(?:don't|do not|no longer)\s+(?:want|need|exchange|refund|return)|取消|算了|(?:不要|不想|不需要)(?:再)?(?:换货|退款|退货)/i.test(
      text.replace(/\b(?:don't|do not|never)\s+(?:cancel|stop)\b|不要取消/gi, ''),
    );
  s.turnKind = 'information';
  if (
    !informational &&
    (handoff || action || cancel || refs.length || hasDefectEvidence(text) || deniesDefect(text))
  )
    s.turnKind = 'task';
  if (informational) return s;
  if (cancel && !action && !handoff) {
    s.intent = null;
    s.issue = null;
    s.defectReported = false;
    s.pendingProposal = null;
    s.lastDecision = null;
    s.stage = 'cancelled';
    s.turnKind = 'cancel';
    s.missingSlots = [];
    return s;
  }
  if (
    /^(?:yes|confirm|go ahead|yes[,\s]+go ahead(?: and execute it now)?|确认|好的|是的)[.!。！\s]*$/i.test(
      text.trim(),
    ) ||
    /execute it now|现在执行/i.test(text)
  ) {
    s.turnKind = 'confirmation';
    return s;
  }
  if (refs.length > 1) {
    s.orderId = null;
    s.orderVerified = false;
    s.orderCandidates = refs;
    s.issue = null;
    s.defectReported = false;
    s.pendingProposal = null;
    s.lastDecision = null;
    s.turnKind = 'ambiguous';
    if (action) s.intent = action;
    slots(s);
    s.stage = 'awaiting_order';
    if (!s.missingSlots.includes('order_id')) s.missingSlots.unshift('order_id');
    return s;
  }
  if (exchange && refund && !handoff) {
    s.intent = null;
    s.pendingProposal = null;
    s.lastDecision = null;
    s.turnKind = 'ambiguous';
    slots(s);
    return s;
  }
  const changedOrder = refs.length === 1 && refs[0] !== s.orderId;
  if (previous.stage === 'resolved' && !action && !handoff && !changedOrder) {
    s.turnKind = 'information';
    return s;
  }
  if (changedOrder && previous.stage === 'resolved' && !action && !handoff) s.intent = null;

  if (changedOrder) {
    s.orderId = refs[0];
    s.orderCandidates = [];
    s.orderVerified = false;
    if (previous.orderId || previous.orderCandidates.length) {
      s.issue = null;
      s.defectReported = false;
    }
    s.pendingProposal = null;
    s.lastDecision = null;
    s.resolutionId = null;
    s.ticketId = null;
  }
  if (handoff) {
    s.intent = 'handoff';
    s.pendingProposal = null;
  } else if (action) {
    if (action !== s.intent) {
      s.pendingProposal = null;
      s.lastDecision = null;
      s.resolutionId = null;
    }
    s.intent = action;
  }
  if (
    s.turnKind === 'task' &&
    (hasDefectEvidence(text) ||
      deniesDefect(text) ||
      /changed (?:my )?mind|改变主意|不喜欢/i.test(text))
  ) {
    s.issue = text.slice(-1000);
    s.defectReported = hasDefectEvidence(text);
    // A retraction must invalidate a previously prepared exception.
    if (deniesDefect(text)) {
      s.pendingProposal = null;
      s.lastDecision = null;
    }
  }
  if (s.turnKind === 'task') {
    if (!s.pendingProposal) slots(s);
    else s.stage = 'awaiting_confirmation';
  }
  return s;
}
export async function lockConversation(tx: SQL, db: Store, key: StateKey) {
  await tx.query(
    'SELECT id FROM conversations WHERE tenant=? AND id=?' +
      (db.dialect === 'postgres' ? ' FOR UPDATE' : ''),
    [key.tenant, key.conversation],
  );
}
export async function readState(tx: SQL, key: StateKey): Promise<ConversationState | null> {
  const [row] = await tx.query(
    'SELECT state FROM conversation_states WHERE tenant=? AND conversation=?',
    [key.tenant, key.conversation],
  );
  return row ? stateSchema.parse(JSON.parse(row.state)) : null;
}
export async function writeState(tx: SQL, key: StateKey, state: ConversationState) {
  state.revision++;
  state.updatedAt = new Date().toISOString();
  await tx.query(
    'INSERT INTO conversation_states(tenant,conversation,state) VALUES(?,?,?) ON CONFLICT(tenant,conversation) DO UPDATE SET state=excluded.state',
    [key.tenant, key.conversation, JSON.stringify(stateSchema.parse(state))],
  );
}
export async function reconcileState(tx: SQL, key: StateKey, s: ConversationState) {
  if (!s.pendingProposal) return;
  const [p] = await tx.query('SELECT * FROM proposals WHERE tenant=? AND conversation=? AND id=?', [
    key.tenant,
    key.conversation,
    s.pendingProposal.id,
  ]);
  if (p?.status === 'confirmed') {
    const [r] = await tx.query('SELECT id FROM resolutions WHERE tenant=? AND proposal_id=?', [
      key.tenant,
      p.id,
    ]);
    s.stage = 'resolved';
    s.resolutionId = r?.id || null;
    s.pendingProposal = null;
  } else if (!p || p.status !== 'pending' || Date.parse(p.expires_at) <= Date.now()) {
    s.stage = p?.status === 'cancelled' ? 'cancelled' : 'expired';
    s.pendingProposal = null;
  }
}
export async function getConversationState(db: Store, key: StateKey) {
  return db.transaction(async (tx) => {
    await lockConversation(tx, db, key);
    const state = (await readState(tx, key)) || emptyState();
    const before = JSON.stringify(state);
    if (!state.processing) await reconcileState(tx, key, state);
    if (before !== JSON.stringify(state)) await writeState(tx, key, state);
    return state;
  });
}
export async function beginConversationTurn(
  db: Store,
  key: StateKey,
  history: { role: string; content: string }[],
) {
  return db.transaction(async (tx) => {
    await lockConversation(tx, db, key);
    let before = await readState(tx, key);
    if (before?.processing) {
      if (Date.now() - Date.parse(before.updatedAt) < 300000)
        throw new AppError(409, 'TURN_IN_PROGRESS', 'Please wait for the current reply.');
      await tx.query(
        "UPDATE proposals SET status='superseded' WHERE tenant=? AND conversation=? AND status='pending'",
        [key.tenant, key.conversation],
      );
      before.processing = false;
      before.pendingProposal = null;
      before.stage = 'interrupted';
    }
    if (!before) {
      before = emptyState();
      // Migrate legacy conversations using customer messages only, never assistant claims.
      for (const turn of history.slice(0, -1))
        if (turn.role === 'user') before = reduceUserState(before, turn.content);
      before.processing = false;
      const [p] = await tx.query(
        "SELECT * FROM proposals WHERE tenant=? AND conversation=? AND status='pending' ORDER BY expires_at DESC LIMIT 1",
        [key.tenant, key.conversation],
      );
      if (p)
        before.pendingProposal = {
          id: p.id,
          orderId: p.order_id,
          action: p.action,
          expiresAt: p.expires_at,
        };
    }
    await reconcileState(tx, key, before);
    const state = reduceUserState(before, history.at(-1)?.content || '');
    if (
      before.pendingProposal &&
      (!state.pendingProposal || before.orderId !== state.orderId || before.intent !== state.intent)
    ) {
      await tx.query(
        "UPDATE proposals SET status='superseded' WHERE tenant=? AND conversation=? AND status='pending'",
        [key.tenant, key.conversation],
      );
      state.pendingProposal = null;
    }
    await writeState(tx, key, state);
    return { before, state };
  });
}
export function observeTool(state: ConversationState, name: string, input: any, output: any) {
  if (name === 'get_order' && input?.orderId === state.orderId) {
    state.orderVerified = !output.error;
    if (output.error === 'ORDER_NOT_FOUND') {
      state.stage = 'awaiting_order';
      state.missingSlots = ['order_id'];
      state.lastDecision = { allowed: false, code: 'ORDER_NOT_FOUND' };
    }
  }
  if (name === 'propose_resolution' && !output.error) {
    state.lastDecision = { allowed: !!output.allowed, code: output.code || 'ELIGIBLE' };
    if (output.proposal) {
      const p = output.proposal;
      state.pendingProposal = {
        id: p.id,
        orderId: p.order_id,
        action: p.action,
        expiresAt: p.expires_at,
      };
      state.stage = 'awaiting_confirmation';
      state.orderVerified = true;
      state.missingSlots = [];
    } else if (output.code === 'REASON_REQUIRED') {
      slots(state);
    } else state.stage = 'blocked';
  }
  if (name === 'escalate_to_human' && output.ticketId) {
    state.intent = 'handoff';
    state.ticketId = output.ticketId;
    state.stage = 'escalated';
    state.pendingProposal = null;
    state.missingSlots = [];
  }
}
export async function finishConversationTurn(
  db: Store,
  key: StateKey,
  state: ConversationState,
  failed = false,
) {
  return db.transaction(async (tx) => {
    await lockConversation(tx, db, key);
    const current = await readState(tx, key);
    if (!current || current.revision !== state.revision)
      throw new AppError(
        409,
        'STATE_CHANGED',
        'Conversation state changed; reload before retrying.',
      );
    if (failed) {
      await tx.query(
        "UPDATE proposals SET status='superseded' WHERE tenant=? AND conversation=? AND status='pending'",
        [key.tenant, key.conversation],
      );
      state.pendingProposal = null;
      state.lastError = 'TURN_FAILED';
      state.stage = 'interrupted';
    }
    state.processing = false;
    await reconcileState(tx, key, state);
    await writeState(tx, key, state);
    return state;
  });
}
