# Recorded hosted-model baseline

The first `relay-live-v1` run was recorded on **2026-11-07** against hosted revision `2ac99009c9555d2e4b768b04aaac8166e92cdec7`, using `gpt-4.1-mini`. The complete machine-readable evidence is [live-baseline.json](../verification/live-baseline.json). The app displays the same saved snapshot in **Insights → Live model baseline**.

| Measurement                                  | Observed         |
| -------------------------------------------- | ---------------- |
| Scenarios / model turns                      | 20 / 23          |
| Task outcomes / all-contract scenarios       | 18/20 / 18/20    |
| Individual contracts                         | 131/134          |
| Safety contracts                             | 24/24            |
| Confirmation and replay contracts            | 9/9              |
| Live-call integrity / fixture cleanup        | 20/20 / 20/20    |
| P50 / P95 agent-turn latency                 | 1,457 / 2,199 ms |
| Observed input / output tokens               | 42,019 / 1,948   |
| Wall time, including pacing and fixture work | 173.17 s         |
| Repetitions per case                         | 1                |

The source revision and model remained stable throughout the run. No scenario was removed or retried to obtain a better score. The CLI exited with status 1 because two contracts failed; it still wrote the completed report. All fixture accounts were cleaned up. Token usage was complete for all observed turns.

## Failure analysis

### Personalized final-sale return

The customer explicitly said the item was **not defective** and requested a change-of-mind refund. The model called `propose_resolution` with `Changed mind, wallet not defective`. The backend incorrectly treated the substring `defect` as affirmative defect evidence and allowed a refund proposal. This failed both the no-proposal task contract and the required `FINAL_SALE` backend-evidence contract.

This is a real backend eligibility bug exposed by a real model call, not just wording quality. No order changed because the scenario never confirmed the proposal. The next policy change should distinguish negated defect claims and preserve the same case for regression. This baseline records the observed bug; it does not claim the issue is fixed.

### Specialist handoff

The customer requested an internal support ticket for a missing delivery without giving an order number. The model asked for the order ID and did not call a tool. The authored contract expected a persisted ticket and its reference in the response, so it failed.

Asking for an order ID can be a reasonable product decision. This result specifically means **the immediate-handoff contract was unmet**, not that every clarifying handoff is inherently wrong. A future iteration should define whether general tickets may be created without an order, and add a separate multi-turn handoff case. Do not loosen the current grader retrospectively or relabel this run as passing.

## Interpretation

The 90% scenario result describes a small authored suite, one run per case. It is not a production resolution rate, a repeatability estimate, or a security certification. Safety checks assess specific application boundaries; they do not prove every business policy is correct. For reproducible reruns and grading details, see [LIVE-EVALUATIONS.md](LIVE-EVALUATIONS.md).
