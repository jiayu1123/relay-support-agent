# Real LLM evaluation

The **Live model baseline** tab in Insights shows a saved report from real HTTP conversations with the deployed agent. The **Offline regression** tab runs the deterministic engine. These are separate measurements.

## Run the live suite

Use Node 24 and install the repository dependencies. The target Relay service must already have its API key configured server-side and be in `openai` mode. The runner never reads, copies, or requests that key.

```bash
npm run eval:live -- --base-url=https://relay-support-agent-9jls.onrender.com --confirm-paid
```

`--confirm-paid` is required before any network request. Actual model usage is billed to the target service's configured API project. Reports default to `data/live-evaluation.json`. To publish a new baseline:

```bash
npm run eval:live -- --base-url=https://your-relay-service --confirm-paid --output=verification/live-baseline.json
npm run build
```

Review the entire report, including failures, before committing and deploying it. Do not edit scores by hand or silently drop failed cases. The public website displays the report; it does not offer a button that lets arbitrary visitors launch a paid batch.

Use `--repeats=2` or `--repeats=3` for repeatability checks. Each repetition runs all 20 cases again. The default is one run per case. The runner limits batches to 20 cases and at most three repetitions, spaces requests to avoid the app's rate limit, and stops before new cases if its time budget is exhausted. It stops after two consecutive request errors and preserves partial results. It does not retry writes.

In managed environments that require the inherited proxy, run Node with `NODE_USE_ENV_PROXY=1`; preserve the supplied HTTPS proxy and CA settings. Do not disable certificate checks.

## Coverage

The versioned `relay-live-v1` suite includes:

- English and Chinese exchange/return requests.
- Expired, undelivered, out-of-stock, and personalized-item boundaries.
- Missing order IDs, missing defect details, ambiguous orders, and unknown references.
- Retrieved-policy citation evidence and persisted specialist tickets.
- A policy-override attempt and a written “yes” that must not execute a resolution.
- An order ID supplied in a later turn and an order correction that supersedes an earlier proposal.

Tests use the normal hosted conversation endpoints and actual model tool calling. Each case receives a fresh, signed `evaluation-…` fixture account. On completion, its messages, proposals, resolutions, tickets, inventory, orders, and evaluation records are deleted. If a write is interrupted and its server-side outcome is unknown, the runner marks cleanup incomplete and does not race a delete against that potentially active request. Such cases require operator follow-up. Cleanup can only target the caller's signed evaluation account; ordinary browser accounts cannot use that endpoint to delete their data or another account's data.

## Grading

No second LLM judges the answers. Authored deterministic contracts inspect observable behavior:

| Dimension         | Evidence                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Task outcomes     | Correct proposal order/action, clarification, understandable refusal, real saved ticket                   |
| Tool evidence     | Backend policy/error codes, citations backed by retrieved documents, unexpected tool errors               |
| Safety boundaries | No order, inventory, or resolution mutation before a click; cross-account denial                          |
| Confirmation      | Correct final status, purchase amount, stock decrement, superseded-proposal rejection, idempotent retries |
| Runtime integrity | Real OpenAI-mode turns with nonzero observed model usage                                                  |
| Cleanup           | Disposable account data removed after each scenario                                                       |

**Task success** and **all-contract pass** are intentionally distinct. A correct refusal can pass its user-facing task check but fail a tool-evidence contract. The UI exposes each check so a reviewer can distinguish an agent failure from an overly strict grader. Wording/citation checks are limited and do not evaluate every nuance of response quality.

## Metrics and provenance

- P50/P95 use observed server-reported **individual agent-turn** latencies, not whole multi-turn case durations. Setup, request pacing, confirmation, and cleanup are included separately in wall time.
- Token totals sum actual input/output usage returned by the model adapter. Request failures can leave usage incomplete; the report and UI mark that explicitly. There is no invented dollar-cost estimate.
- Reports record the model, timestamp, selected case IDs, repetitions, suite hash, grader version, and deployed source revision. A model or source change during the run invalidates the baseline.
- Failures, error messages, all model turns, and tool inputs/results are retained with fictional sample data. Session cookies and API credentials are never exported.

This is a small authored portfolio suite, not an industry benchmark, an adversarial security audit, or a production resolution rate. One run per case does not establish stability. Inspect failure examples and collect repeated runs before making stronger claims.
