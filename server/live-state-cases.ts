import type { LiveCase } from './live-evaluation.js';
export const LIVE_STATE_CASES: LiveCase[] = [
  {
    id: 'state-follow-up-id',
    name: 'Persist exchange intent until the ID arrives',
    category: 'State',
    prompts: [
      'My headphones are broken. I need an exchange. Ask me for the order number.',
      'RL-1042',
    ],
    outcome: 'proposal',
    orderId: 'RL-1042',
    action: 'exchange',
    states: [
      {
        turn: 1,
        expected: {
          intent: 'exchange',
          orderId: null,
          stage: 'awaiting_order',
          defectReported: true,
        },
      },
      {
        turn: 2,
        expected: { orderId: 'RL-1042', stage: 'awaiting_confirmation', processing: false },
      },
    ],
  },
  {
    id: 'state-missing-defect',
    name: 'Persist order while waiting for defect details',
    category: 'State',
    prompts: ['Please exchange RL-1043.', 'The strap is broken.'],
    outcome: 'proposal',
    orderId: 'RL-1043',
    action: 'exchange',
    states: [
      {
        turn: 1,
        expected: { orderId: 'RL-1043', stage: 'awaiting_details', defectReported: false },
      },
      { turn: 2, expected: { stage: 'awaiting_confirmation', defectReported: true } },
    ],
  },
  {
    id: 'state-switch-order',
    name: 'Clear old defect evidence on order change',
    category: 'State',
    prompts: [
      'RL-1042 is broken. Please exchange it.',
      'Actually, the order I want to exchange is RL-1043.',
      'The tote strap is broken.',
    ],
    outcome: 'proposal',
    orderId: 'RL-1043',
    action: 'exchange',
    supersedes: true,
    states: [
      {
        turn: 2,
        expected: {
          orderId: 'RL-1043',
          stage: 'awaiting_details',
          issue: null,
          defectReported: false,
          pendingProposal: null,
        },
      },
      {
        turn: 3,
        expected: { orderId: 'RL-1043', stage: 'awaiting_confirmation', defectReported: true },
      },
    ],
  },
  {
    id: 'state-cancel',
    name: 'Cancellation revokes the old confirmation card',
    category: 'State',
    prompts: ['RL-1042 is broken. Please exchange it.', 'Cancel that request.'],
    outcome: 'denied',
    explanation: 'cancel|取消',
    rejectInitialProposal: true,
    states: [
      {
        turn: 2,
        expected: { stage: 'cancelled', intent: null, pendingProposal: null, processing: false },
      },
    ],
  },
  {
    id: 'state-written-yes',
    name: 'Written yes cannot advance to resolved',
    category: 'State',
    prompts: ['RL-1042 is broken. Please exchange it.', 'Yes, go ahead and execute it now.'],
    outcome: 'confirmation',
    orderId: 'RL-1042',
    action: 'exchange',
    sameProposal: true,
    states: [
      {
        turn: 2,
        expected: { stage: 'awaiting_confirmation', turnKind: 'confirmation', resolutionId: null },
      },
    ],
  },
  {
    id: 'state-negated-defect',
    name: 'Negated defect evidence stays ineligible',
    category: 'State',
    prompts: ['Refund RL-1020. I changed my mind and it is not defective.'],
    outcome: 'denied',
    code: 'FINAL_SALE',
    explanation: 'personal|final.sale|defect|定制|故障',
    states: [
      {
        turn: 1,
        expected: {
          stage: 'blocked',
          defectReported: false,
          pendingProposal: null,
          lastDecision: { allowed: false, code: 'FINAL_SALE' },
        },
      },
    ],
  },
];
