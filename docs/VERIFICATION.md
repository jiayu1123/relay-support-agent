# Verification record

Historical checks below were recorded on 2026-11-06. Current live-evaluation and browser checks are recorded in the latest section at the end. Node.js 24.22.1.

| Check                                       | Observed result                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TypeScript + production client/server build | Passed                                                                                           |
| Core automated tests                        | 34 passed                                                                                        |
| Local setup safety tests                    | 3 passed; secret-free output, stable session, symlink and ignore checks                          |
| PostgreSQL 17 integration test              | 1 passed against an actual local container                                                       |
| Offline authored agent scenarios            | 20 / 20 passed, 79 assertions                                                                    |
| Built HTTP smoke check                      | HTML, 2 built assets, health endpoint, and unknown-API 404 passed                                |
| Live OpenAI calls                           | Verified on Render with gpt-4.1-mini; exchange + expired-return workflow checks; see live report |
| Browser visual / interaction QA             | Subsequently verified with Playwright + Chromium; see latest section below                       |
| Docker build + running container            | Passed: health, static UI, tool workflow, confirmation, idempotent retry                         |
| Public deployment                           | Passed on Render: https://relay-support-agent-9jls.onrender.com (now OpenAI mode)                |

The core tests include an OpenAI-compatible **mock** to verify the multi-step tool protocol and usage accounting. This is not proof of real model behavior. The offline suite uses deterministic intent routing with the same real tools and database constraints as live mode. Its passing results are regression evidence for this demo, not an LLM benchmark.

See `verification/evaluation-demo.json` for the exported authored-scenario report. Runtime timings vary by machine. Re-run after changing prompts, rules, models, or tools.

Latest iteration: 28 local tests passed; the unchanged PostgreSQL integration test was skipped without TEST_DATABASE_URL (its earlier container-backed result remains recorded above). macOS launcher passed bash syntax checking. Windows launcher was not executed on Windows. New live-verification command has not run against OpenAI.

## Public deployment verification

Render deploy `dep-dbn54rbm8hqs73a3pqi0` is live, built from source commit `a0c9e389a9f3f7c59b38c608ea8370c3d5115dd5`. Hosted HTTPS checks verified HTML/assets, chat tool calls, confirmation, persisted stock/order changes, idempotency, conversation reload, cross-visitor isolation, expired-order rejection, origin checks, and all 20 offline regression scenarios (79 assertions). See `verification/deployment.json`. No error-level runtime logs were found after these checks. Visual browser QA and real OpenAI calls remain unverified.

## Live model enabled

Render deployment `dep-dbn5c2ei0phs73bjn480` runs the OpenAI adapter with `gpt-4.1-mini`. Actual live API responses and nonzero token usage were observed. An eligible exchange completed after an initial no-proposal attempt was retried; an expired-order return produced no proposal and no order mutation. Confirmation, inventory updates, idempotency, isolation and origin checks passed. The 20 authored evaluation scenarios continue to use the offline engine; no 20/20 live-model claim is made. See `verification/live-deployment.json`.

## Studio UI refresh

Source commit `085bafd0f4b1456dfcbd74d4669363ba47adb3c8` is live in Render deployment `dep-dbn5hp8n74is73emh02g`. GitHub CI passed 30 tests, the 20-scenario offline suite, and the production build. Hosted CSS and JavaScript match the locally verified build byte for byte. Bootstrap works and the OpenAI mode and model configuration remain intact. Visual browser and screenshot QA remain unverified; no supported browser-control tool was available. See `verification/ui-deployment.json`.

## Explicit order reference regression

After a customer screenshot showed the model asking again for an already supplied order ID, the live orchestrator was changed to prefetch a single explicit order through the scoped tool executor. A bounded correction prevents repeated ID requests. Testing the first revision revealed a second premature stop: offering to prepare an exchange instead of actually preparing it. A completion guard now requires the backend proposal check for clear resolution requests, while leaving informational, negated, missing-ID, and ambiguous requests unforced. Confirmation remains a separate customer action.

CI passed 38 tests, the 20-scenario offline suite, and the production build. Render deployment `dep-dbn5qee1egvs73801aq0`, source `4a247a948ea4108205babddb382d3d9ec52c8c58`, is live. The exact starter prompt completed three targeted real-model attempts with correct proposals; one attempt also verified confirmed order/stock state and idempotent retries. These are targeted smoke results, not a production success-rate estimate. See `verification/order-reference-regression.json`, including the previous revision’s observed failure.

## Composer visibility fix

Source `d5e97fb3a3f6283c21b0f3f842ea61bb5e888739` fixes the playground grid’s automatic minimum sizing, anchors the composer in its own row, and limits automatic scrolling to the message container. The content region can shrink and scroll independently on short viewports. Render deployment `dep-dbn5tj4ipgvc738o0rng` is live; CI, production build, and HTTP smoke checks passed. Hosted frontend assets match the verified local build, bootstrap succeeds, and OpenAI configuration is preserved. Browser visual verification remains pending because no supported browser tool was available. See `verification/composer-layout.json`.

## Hosted LLM evaluation expansion — 2026-11-07

Feature revision `2ac99009c9555d2e4b768b04aaac8166e92cdec7` passed GitHub CI with **47 tests**, including PostgreSQL integration, the unchanged **20/20 offline suite (79 assertions)**, and the production build. It went live in Render deployment `dep-dbnbcp2jnfac73bth4e0` before the hosted-model run.

The actual HTTP evaluation completed **20 cases / 23 model turns** with `gpt-4.1-mini`: **18/20 task outcomes**, **18/20 all-contract scenarios**, **131/134 individual contracts**, **24/24 safety**, **9/9 confirmation/replay**, and **20/20 fixture cleanup**. P50/P95 agent-turn latency was **1,457/2,199 ms**; observed usage was **42,019 input + 1,948 output tokens**. Failures were retained without retries. Source/model stability and complete usage were observed. See [baseline evidence](../verification/live-baseline.json) and [failure analysis](LIVE-BASELINE.md).

Playwright with headless Chromium verified the built app at desktop 1440×900 and mobile 390×844: live/offline tab separation, offline evaluation execution, live failure/category filters, expanded contract/tool evidence, JSON download, visible playground composer, contained message scrolling, no mobile horizontal overflow, and no browser runtime errors. These browser checks supersede the earlier tool-unavailability notes, which describe historical verification limits.

## Structured conversation state — 2026-11-07

Feature revision `963d7e5740e6c6105f3e7ae428b1fc839806d8aa` passed CI with **73 tests**, including the new PostgreSQL state/turn-serialization integration check. The offline regression suite remained **20/20, 79 assertions**. Production build and built-HTTP smoke passed.

A real hosted `relay-state-v1` run completed **6/6 scenarios, 52/52 contracts, 12 model turns** with `gpt-4.1-mini`. It checked intermediate slot snapshots, missing information, order switching and defect reset, cancelled/superseded proposal denial, written-yes preservation and negated defect evidence. All six fixture accounts were cleaned up, with stable source/model and complete token usage. See [state report](../verification/state-live-baseline.json) and [design/limitations](CONVERSATION-STATE.md).

Playwright + Chromium checked the built frontend at desktop 1440×900 and mobile 390×844: slot progression, state inspector, order switch, inactive old confirmation cards, cancellation, saved-conversation reload, visible composer, no horizontal overflow, separate core/state report selection, filter reset and intermediate state JSON. No browser runtime errors were observed. Public-browser automation is still affected by the managed proxy CA trust; the actual public deployment is checked separately with trusted HTTPS and built-asset comparison.

The unchanged 20-case hosted core suite was rerun on the state feature revision: **19/20 scenarios, 133/134 contracts**, **24/24 safety**, **9/9 confirmation/replay** and **20/20 cleanup**. The personalized final-sale negation case now passes. A real handoff ticket was created, but its reference was omitted from the model's response, failing the existing response-reference contract. P50/P95 agent-turn latency was **1,600/2,154 ms**, with **58,369 input + 2,288 output tokens**. The initial 18/20 evidence remains archived; see [comparison and remaining failure](LIVE-BASELINE.md).

An export-only correction removes disposable fixture tenant identifiers from proposal payloads as well as tool traces. The captured reports received the same identifier redaction; every measured score, failure, model response and evaluated source revision was preserved. The HTTP harness regression test checks this export boundary.
