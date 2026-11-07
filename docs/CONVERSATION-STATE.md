# Structured conversation state

Relay persists a versioned state document per `(tenant, conversation)` in `conversation_states`. It supplies this document to the model independently of the last 24 chat messages. It is separate from immutable per-turn snapshots in message metadata, tool execution traces, and the authoritative orders/proposals/resolutions tables.

## Saved fields

| Field                                            | Meaning and source                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `schemaVersion`, `revision`, `turn`, `updatedAt` | Validated schema, storage revision and user-turn counter                        |
| `intent`                                         | Active exchange, refund or internal handoff request                             |
| `orderId`, `orderCandidates`, `orderVerified`    | Customer-selected reference; verification only follows a scoped backend lookup  |
| `issue`, `defectReported`                        | Customer-reported evidence, not independent proof that the product is defective |
| `missingSlots`                                   | Order number, requested action or defect details still needed                   |
| `stage`, `turnKind`                              | Workflow stage and the purpose of the latest turn                               |
| `pendingProposal`, `lastDecision`                | Server-created proposal pointer and observed eligibility decision               |
| `ticketId`, `resolutionId`                       | Persisted tool/confirmation outcomes; assistant claims cannot set them          |
| `processing`, `lastError`                        | Turn coordination and interrupted-turn recovery                                 |

Common stages: `awaiting_order` → `awaiting_details` → `awaiting_confirmation` → `resolved`. A flow may instead be `blocked`, `cancelled`, `escalated`, `expired`, or `interrupted`. State does not itself authorize a business operation; the backend still rechecks ownership, eligibility, stock and idempotency.

## Transition rules

- Preserve an exchange intent and its reported defect while waiting for the first order ID, even when earlier messages are absent from the model's history.
- Switching to another order clears the previous order's issue and verified lookup. Never apply the first item's defect claim to a different product.
- Multiple order references require a choice. Ambiguous exchange-versus-refund requests clear the active action.
- Cancellation clears the active intent and pending proposal. Order/action changes, ambiguity, a defect retraction, and handoff invalidate the old pending proposal **before** the model runs. A later failed model call cannot leave that old card executable.
- Informational questions preserve the active workflow but cannot prepare a new resolution. Written “yes” preserves the pending card and cannot confirm it.
- An actual customer click moves state to `resolved` in the same transaction as the resolution and stock update. Cancellation updates state and proposal together. Reads reconcile expiry with the proposal table.
- A failed model turn preserves supplied slots, revokes unreported pending proposals, and marks `interrupted`. An abandoned processing lease may be replaced after five minutes; the old worker cannot write proposals or overwrite a newer revision.

## Grounding and concurrency

The state reducer uses bounded English/Chinese slot rules over customer messages. Tool results supply verified facts. A model cannot propose a different order or action than the active slots, and policy checks use stored customer issue evidence rather than a model-invented reason. Explicit negation such as “not defective” is excluded from positive defect evidence, fixing the first baseline's personalized-item exception bug.

A per-conversation PostgreSQL row lock (or the SQLite transaction queue) serializes turn admission, proposal invalidation and customer confirmation. Model/network calls occur outside the transaction. The persisted processing flag rejects simultaneous turns across app instances; revision checks reject stale workers. A signed tenant scope applies to both state reads and writes. `GET /api/conversations/:id` returns current state only after conversation ownership verification. There is no public state-edit endpoint.

Legacy conversations are bootstrapped from customer messages and authoritative proposal rows. New tables are additive and support SQLite/PostgreSQL. State is durable only as long as its database: the current free Render deployment still uses ephemeral SQLite, so an instance replacement can reset sample data. Use existing PostgreSQL support for durability across deploys.

The parser is deliberately limited, not a general semantic understanding guarantee. More paraphrases, pronoun ambiguity, negation, unusual defects and multi-order tasks need additional labeled cases. No real customer authentication or production adoption is implied.

## Inspect and test

In **Playground → Execution trace**, the **Conversation state** card shows current slots, missing information, the pending action and the complete saved JSON. Reload and select the saved conversation to inspect its restored state.

Try these as separate messages:

1. `My headphones are broken. I need an exchange.`
2. `RL-1042`
3. `Actually, RL-1043.`
4. `The strap is broken.`
5. `Cancel that request.`

Expected stages: awaiting order → awaiting confirmation → awaiting details → awaiting confirmation → cancelled. Old confirmation cards become inactive, and no order is changed.

Automated contracts cover scoped persistence, app recreation, missing information, order/action corrections, ambiguity, negation, cancellation, expiry, confirmation/replay, model failure, abandoned processing leases and stale workers. CI also exercises the state transaction path on actual PostgreSQL.

Run the explicitly paid hosted state suite with the existing remote evaluator:

```bash
npm run eval:live -- --suite=state --base-url=https://relay-support-agent-9jls.onrender.com --confirm-paid --output=verification/state-live-baseline.json
```

It runs six authored cases with 12 real model turns, checking intermediate state snapshots, tool outcomes, no unconfirmed changes and stale/cancelled proposal rejection. Failed contracts remain in the report. Use `--suite=core` (default) for the existing 20-case suite. Both suites record the actual evaluated source revision; one run is not a production success rate.
