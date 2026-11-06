# Verification record

Verified in the authoring environment on 2026-11-06 with Node.js 24.22.1.

| Check                                       | Observed result                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| TypeScript + production client/server build | Passed                                                                                        |
| Core automated tests                        | 25 passed                                                                                     |
| Local setup safety tests                    | 3 passed; secret-free output, stable session, symlink and ignore checks                       |
| PostgreSQL 17 integration test              | 1 passed against an actual local container                                                    |
| Offline authored agent scenarios            | 20 / 20 passed, 79 assertions                                                                 |
| Built HTTP smoke check                      | HTML, 2 built assets, health endpoint, and unknown-API 404 passed                             |
| Live OpenAI calls                           | Not verified: a server-side API key was not configured                                        |
| Browser visual / interaction QA             | Not verified: supported browser-control tool unavailable                                      |
| Docker build + running container            | Passed: health, static UI, tool workflow, confirmation, idempotent retry                      |
| Public deployment                           | Not performed: Sites helper scripts unavailable; Node/Docker deployment instructions included |

The core tests include an OpenAI-compatible **mock** to verify the multi-step tool protocol and usage accounting. This is not proof of real model behavior. The offline suite uses deterministic intent routing with the same real tools and database constraints as live mode. Its passing results are regression evidence for this demo, not an LLM benchmark.

See `verification/evaluation-demo.json` for the exported authored-scenario report. Runtime timings vary by machine. Re-run after changing prompts, rules, models, or tools.

Latest iteration: 28 local tests passed; the unchanged PostgreSQL integration test was skipped without TEST_DATABASE_URL (its earlier container-backed result remains recorded above). macOS launcher passed bash syntax checking. Windows launcher was not executed on Windows. New live-verification command has not run against OpenAI.
