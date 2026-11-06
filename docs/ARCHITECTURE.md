# Architecture and API

## Request lifecycle

1. The browser receives a signed, HttpOnly, SameSite=Lax demo-session cookie. Its random tenant ID scopes sample records.
2. A conversation ID is created and checked against that tenant before every read or turn.
3. The agent receives recent conversational context. The real adapter uses OpenAI Chat Completions tools; the demo engine calls the same executor.
4. Zod validates tool arguments. The executor supplies identity from server context; model-supplied identity or price fields are rejected.
5. Read tools query scoped order and inventory rows. Policy search supplies citable excerpts. Proposal creation rechecks business eligibility.
6. A proposal expires after 15 minutes. Creating a new proposal in the same conversation supersedes older pending proposals.
7. Only the confirmation HTTP endpoint can execute a resolution. The agent tool allowlist has no execution operation.
8. Inside a transaction, confirmation locks the proposal and order on PostgreSQL, checks ownership/expiry/policy, atomically decrements available stock, inserts one resolution, changes the order state, and marks the proposal confirmed.
9. Confirmation retries return the existing resolution. A unique `(tenant, order_id)` constraint also prevents different proposals from resolving the same order twice.

## Data model

| Table                    | Role                                                      |
| ------------------------ | --------------------------------------------------------- |
| tenants                  | Isolated demo account creation                            |
| orders                   | Scoped sample purchase data and lifecycle status          |
| inventory                | Per-tenant sample stock, constrained nonnegative          |
| conversations / messages | Persisted user/assistant turns, metadata, and tool traces |
| proposals                | Proposed action, reason, order, expiry, and lifecycle     |
| resolutions              | Committed requests; unique order and proposal constraints |
| tickets                  | Internal demo handoff summaries                           |
| eval_runs                | Scoped JSON evaluation results                            |
| schema_version           | Initial schema version marker                             |

The initial schema is created with idempotent DDL at startup. Future schema changes should be added as versioned migrations; the existing `CREATE TABLE IF NOT EXISTS` statements do not upgrade existing columns.

## API

All stateful endpoints use the demo session cookie. JSON writes must be same-origin when an Origin header is supplied.

| Method | Path                              | Purpose                                                                                |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/health`                     | Runtime mode and database health/configuration metadata                                |
| GET    | `/api/bootstrap`                  | Current demo account, orders, history index, policies, requests, and latest evaluation |
| POST   | `/api/conversations`              | Create conversation; `{ "title": "optional" }`                                         |
| GET    | `/api/conversations/:id`          | Resume owned conversation and current proposal states                                  |
| POST   | `/api/conversations/:id/messages` | Send `{ "content": "..." }`; response includes user and assistant turns                |
| POST   | `/api/proposals/:id/confirm`      | Execute exact proposal with `{ "confirmed": true }`                                    |
| POST   | `/api/proposals/:id/cancel`       | Cancel pending proposal                                                                |
| POST   | `/api/evaluations`                | Run offline authored suite; live paid evaluations use CLI                              |

## Reliability choices

- SQLite serializes access around transaction callbacks so async continuation cannot accidentally interleave transactions on the single connection.
- PostgreSQL uses pooled connections with `BEGIN/COMMIT/ROLLBACK` and `FOR UPDATE` locks. Stock changes use a conditional update with `stock > 0`.
- Confirmation uses the proposal ID as the idempotency key. Check for a committed result before rejecting a consumed or expired proposal.
- Live model requests have a 20-second SDK timeout, one SDK retry, a seven-response step cap, and a maximum of eight tool calls per response.
- Business writes are not automatically retried by the tool executor. Handoff creation and proposal writes are visible in traces.
- API errors do not silently switch execution modes or invent successful business actions.
- Confirmation notes are persisted outside the core transaction with a unique deterministic message ID. If this presentation write fails, retrying confirmation recovers the existing resolution and can recreate the note.

## Evaluation design

20 authored prompts each receive their own temporary tenant and fixtures. Checks include tool choice, expected policy/error code, proposal presence, response requirements, no execution before confirmation, order state after confirmation, and replay safety. Temporary tenant data is cleaned up.

The suite is intentionally small and task-specific. It does not measure general intelligence, adversarial robustness, or production reliability. Regex content assertions are only lightweight checks. Live-model runs may fail authored expectations and should be analyzed, not hidden.

Additional tests independently exercise transaction rollback, race conditions, cross-account access, policy boundaries, invalid model arguments, conversation persistence, CSRF-origin checks, and a mocked multi-step OpenAI tool loop.

## Known limits and next work

- **Demo identity:** signed sessions isolate sample records but do not verify real customers. Add proper authentication and map order ownership before real use.
- **External actions:** there are no payment, carrier, ecommerce, or helpdesk integrations. Connect test/sandbox providers first and reconcile external idempotency keys.
- **Dialogue context:** recent turns are bounded; structured long-term state and transcript summarization would improve long conversations. Demo intent parsing covers selected cases, not arbitrary natural language.
- **Retrieval:** four static policy documents; lexical scoring is sufficient here. Larger corpora need ingestion, freshness controls, retrieval evaluation, and potentially hybrid/vector search.
- **Observability:** traces persist in SQL; there is no OpenTelemetry exporter, distributed tracing, or log aggregation yet.
- **Operations:** no worker queue, multi-instance turn lock, global distributed rate limiter, retention job, or production alerting. In-memory turn locks apply to one process only.
- **Model behavior:** backend constraints protect business writes; generated text still needs live evaluation for hallucinations and unsupported promises.
- **UI QA:** TypeScript/build and production HTTP/asset checks are automated. Visual browser QA was not available in the authoring environment and remains a manual step.
