# Verification record

Verified in the authoring environment on 2026-11-06 with Node.js 24.22.1.

| Check                                       | Observed result                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TypeScript + production client/server build | Passed                                                                                           |
| Core automated tests                        | 25 passed                                                                                        |
| Local setup safety tests                    | 3 passed; secret-free output, stable session, symlink and ignore checks                          |
| PostgreSQL 17 integration test              | 1 passed against an actual local container                                                       |
| Offline authored agent scenarios            | 20 / 20 passed, 79 assertions                                                                    |
| Built HTTP smoke check                      | HTML, 2 built assets, health endpoint, and unknown-API 404 passed                                |
| Live OpenAI calls                           | Verified on Render with gpt-4.1-mini; exchange + expired-return workflow checks; see live report |
| Browser visual / interaction QA             | Not verified: supported browser-control tool unavailable                                         |
| Docker build + running container            | Passed: health, static UI, tool workflow, confirmation, idempotent retry                         |
| Public deployment                           | Passed on Render: https://relay-support-agent-9jls.onrender.com (offline demo mode)              |

The core tests include an OpenAI-compatible **mock** to verify the multi-step tool protocol and usage accounting. This is not proof of real model behavior. The offline suite uses deterministic intent routing with the same real tools and database constraints as live mode. Its passing results are regression evidence for this demo, not an LLM benchmark.

See `verification/evaluation-demo.json` for the exported authored-scenario report. Runtime timings vary by machine. Re-run after changing prompts, rules, models, or tools.

Latest iteration: 28 local tests passed; the unchanged PostgreSQL integration test was skipped without TEST_DATABASE_URL (its earlier container-backed result remains recorded above). macOS launcher passed bash syntax checking. Windows launcher was not executed on Windows. New live-verification command has not run against OpenAI.

## Public deployment verification

Render deploy `dep-dbn54rbm8hqs73a3pqi0` is live, built from source commit `a0c9e389a9f3f7c59b38c608ea8370c3d5115dd5`. Hosted HTTPS checks verified HTML/assets, chat tool calls, confirmation, persisted stock/order changes, idempotency, conversation reload, cross-visitor isolation, expired-order rejection, origin checks, and all 20 offline regression scenarios (79 assertions). See `verification/deployment.json`. No error-level runtime logs were found after these checks. Visual browser QA and real OpenAI calls remain unverified.

## Live model enabled

Render deployment `dep-dbn5c2ei0phs73bjn480` runs the OpenAI adapter with `gpt-4.1-mini`. Actual live API responses and nonzero token usage were observed. An eligible exchange completed after an initial no-proposal attempt was retried; an expired-order return produced no proposal and no order mutation. Confirmation, inventory updates, idempotency, isolation and origin checks passed. The 20 authored evaluation scenarios continue to use the offline engine; no 20/20 live-model claim is made. See `verification/live-deployment.json`.
