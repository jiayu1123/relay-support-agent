# Recorded hosted-model baselines

The latest core report is [live-baseline.json](../verification/live-baseline.json). The independent structured-state report is [state-live-baseline.json](../verification/state-live-baseline.json). Both evaluated hosted source `963d7e5740e6c6105f3e7ae428b1fc839806d8aa` with `gpt-4.1-mini` on **2026-11-07**. Insights lets you select either saved suite; the scores are never combined.

| Measurement                                 | Core support suite | State suite      |
| ------------------------------------------- | ------------------ | ---------------- |
| Scenarios / model turns                     | 20 / 23            | 6 / 12           |
| Task outcomes / all-contract scenarios      | 19/20 / 19/20      | 6/6 / 6/6        |
| Individual contracts                        | 133/134            | 52/52            |
| Safety contracts                            | 24/24              | 12/12            |
| Confirmation and replay contracts           | 9/9                | 3/3              |
| Live-call integrity / fixture cleanup       | 20/20 / 20/20      | 6/6 / 6/6        |
| P50 / P95 agent-turn latency                | 1,600 / 2,154 ms   | 1,614 / 2,765 ms |
| Observed input / output tokens              | 58,369 / 2,288     | 26,586 / 1,056   |
| Wall time including pacing and fixture work | 171.349 s          | 65.023 s         |
| Repetitions per case                        | 1                  | 1                |

Both runs completed with stable source/model, complete observed usage, and all disposable fixture accounts cleaned up. No failed cases were removed or retried for a better score. The core CLI exited 1 because a contract failed, while still saving the completed report. The state CLI exited 0.

## Current remaining failure: ticket reference omitted from the answer

The core handoff case **created a real internal ticket** through `escalate_to_human`. The saved conversation state correctly became `escalated` and contained the actual `TKT-…` reference. However, the model's answer said it created a ticket without including that reference. The grader requires both a persisted ticket **and its exact reference in the response**, so this scenario remains failed.

This is a response-completeness failure, not a missing-ticket database failure. The state inspector exposes the correct reference. A future response-format change can require the model to include it, followed by a new recorded run; this report is not retrospectively relabeled.

## Preserved first baseline

The original `relay-live-v1` run against `2ac99009c9555d2e4b768b04aaac8166e92cdec7` remains in [live-baseline-initial.json](../verification/live-baseline-initial.json): **18/20 scenarios**, **131/134 contracts**, with failures in personalized final-sale refund handling and handoff. Its P50/P95 was 1,457/2,199 ms and usage was 42,019 input + 1,948 output tokens.

In that run, the backend treated the substring `defect` in **“not defective”** as affirmative evidence and allowed a personalized-item change-of-mind refund proposal. No order changed because the scenario did not confirm it. Structured state now retains customer evidence, policy checks exclude explicit defect negation, and model-supplied invented reasons cannot supply missing defect evidence. The unchanged core case and a dedicated state case both passed on the new revision.

The original handoff case asked for an order ID and created no ticket. The new revision permits general handoff without an order ID and created the ticket in the live run, but still failed the unchanged response-reference contract described above. The core case definitions and suite hash are unchanged. `contracts-v2` adds optional state contracts for the separate state suite; it does not loosen the core handoff requirement.

## Interpretation

These are small authored suites with one run per case. The 95% core result is not a production resolution rate, repeatability estimate, or security certification. Safety checks assess specific application boundaries and do not prove every business policy is correct. The snapshots record the evaluated source, not continuously measured current performance. See [methodology](LIVE-EVALUATIONS.md) and [state design](CONVERSATION-STATE.md).
