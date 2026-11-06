# Relay

**Customer support, resolved—with explicit confirmation and inspectable tools.**

**[Open the live demo](https://relay-support-agent-9jls.onrender.com)** · [Source code](https://github.com/jiayu1123/relay-support-agent)

The public demo is running on Render with **OpenAI tool calling (`gpt-4.1-mini`)**. Visitors do not need to supply an API key. It executes sample-store database workflows after explicit confirmation; no real payments are processed. The free instance may take time to wake after inactivity, and sample data resets on instance replacement. Live-model usage is charged to the configured API project.

Relay is a full-stack portfolio project for a fictional ecommerce store. An agent investigates order issues, retrieves store policies, prepares exchange or return/refund proposals, and hands difficult cases to an internal specialist queue. Order changes require an explicit customer confirmation and a fresh server-side eligibility check.

[Deploy your own instance on Render](https://render.com/deploy?repo=https://github.com/jiayu1123/relay-support-agent) · [Deployment details](docs/RENDER.md)

The Render Blueprint creates a free demo-mode Node service with an automatically generated session secret. No API key is required to try sample workflows. Free instances may sleep when idle and their sample data resets on redeploy; use PostgreSQL for durable storage.

## Quick start

After installing Node 24, Mac users can run `START-MAC.command` and Windows users can run `START-WINDOWS.cmd`. The launchers install missing dependencies, run the local setup wizard, build, and start the app. Alternatively, use the commands below. Run `npm run setup` to change modes; API-key input is hidden in your local terminal.

Requires **Node.js 24+** and npm. No API key or Docker is needed for the offline demo.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. On Windows PowerShell, replace `cp` with `Copy-Item`. For the production build:

```bash
npm run build
npm start
```

Open **http://localhost:3001**. SQLite creates its local database automatically. Set a persistent `SESSION_SECRET` in `.env` to preserve demo sessions across server restarts. Generate a value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Agent Studio interface

The light Studio UI includes top navigation, an account overview, conversation history, and enforced-policy summaries. Overview metrics come from the current account and its latest offline evaluation; no success-rate, customer-rating, or compliance badges are pre-filled. Open **Test agent** to chat, or use the top navigation to inspect orders, knowledge, insights, and workflows.

## What works

- Responsive React/TypeScript support workspace with persisted conversations.
- Six sample orders covering eligible, expired, in-transit, personalized, and out-of-stock situations.
- Order lookup, policy retrieval, inventory checks, expiring proposals, explicit confirmation, and internal support tickets.
- Server-side ownership checks and strict Zod validation of model tool arguments.
- Atomic inventory reservation, one resolution per order, and replay-safe confirmation.
- Execution traces showing tool inputs, outputs, timing, and errors.
- A policy knowledge base with TF-IDF retrieval, bilingual keyword matching, and source IDs.
- A 20-scenario agent regression suite with structured assertions and exportable JSON results.
- OpenAI Chat Completions tool-calling adapter with bounded steps, SDK retries, timeout, and token usage.
- SQLite and PostgreSQL adapters, Docker Compose, and GitHub Actions CI configuration.

## Two execution modes

| Mode             | Behavior                                                                                               | Needs a key? |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| `demo` (default) | Deterministic intent routing through the real backend tools. Real database changes after confirmation. | No           |
| `openai`         | A model chooses tools and writes responses. The same backend rules and confirmation boundary apply.    | Yes          |

For live mode, put your own key in the **server-side, gitignored** `.env` and set `AGENT_MODE=openai`. `OPENAI_MODEL` defaults to `gpt-4.1-mini`; use a tool-capable model available to your API project. Restart after configuration. The app fails clearly if live mode is missing a key; it does not silently fall back to demo. API usage is billed separately from ChatGPT subscriptions.

Never commit `.env` or enter keys in browser code. The app does not ask visitors for API credentials. A mocked OpenAI-compatible client verifies adapter behavior in tests; successful live API calls require separate verification with your credentials.

## A two-minute demo

1. Click the exchange example or send: **“My RL-1042 headphones have no sound on the left side. Can I get a replacement?”**
2. Inspect **Execution trace**: lookup → policy retrieval → inventory check → proposal.
3. Before confirming, open **Orders & resolutions**. The order is still delivered and there is no resolution.
4. Return to the conversation and click **Confirm exchange**. Inspect the saved resolution and stock change.
5. Start another conversation: **“RL-1048 is broken. Please exchange it.”** Relay reports unavailable stock and offers alternatives.
6. Ask for a **human specialist**. Inspect the internal ticket, then run the offline regression suite in **Evaluations**.

Other scenarios: refund `RL-1043`, out-of-window `RL-1031`, undelivered `RL-1050`, final-sale `RL-1020`, or Chinese exchange requests.

## Architecture

```mermaid
flowchart LR
  UI[React workspace] --> API[Express API]
  API --> AG[Bounded agent loop]
  AG --> MODEL[OpenAI or offline demo]
  AG --> TOOLS[Validated tool allowlist]
  TOOLS --> RAG[Policy retrieval]
  TOOLS --> DB[(SQLite / PostgreSQL)]
  TOOLS --> PROP[Expiring proposal]
  UI --> CONF[Explicit confirmation endpoint]
  PROP --> CONF
  CONF --> RULES[Recheck ownership + policy + stock]
  RULES --> TX[Atomic transaction]
  TX --> DB
```

The model cannot call the confirmation operation. Business constraints live in backend code. Tool traces are execution logs, not private chain-of-thought. Policy retrieval is lexical RAG over a deliberately small corpus, not vector search.

## Verification

```bash
npm test
npm run eval
npm run build
npx tsx scripts/smoke.ts
```

Run the PostgreSQL integration test against a disposable database:

```bash
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/relay_test npm test
```

The PostgreSQL test is skipped when `TEST_DATABASE_URL` is absent. GitHub Actions configures a PostgreSQL service and runs it. Windows PowerShell sets the environment variable with `$env:TEST_DATABASE_URL="..."` first.

For **paid live-model evaluations**, explicitly opt in:

```bash
npm run eval -- --mode=openai
```

Reports are written to `data/evaluation-demo.json` or `data/evaluation-openai.json`. Assertions check expected tools, policy codes, proposals, no mutation before confirmation, persisted order states, and idempotent retries. These are authored portfolio scenarios, not an industry benchmark or a production success rate. Demo latency excludes model/network latency. No dollar-cost estimate is invented; actual live input/output token counts are recorded.

## PostgreSQL and Docker

Local Node execution uses SQLite unless `DATABASE_URL` is supplied. For Docker Compose, set a hex `POSTGRES_PASSWORD` and persistent `SESSION_SECRET` in `.env`, then:

```bash
docker compose up --build
```

Open http://localhost:3001. PostgreSQL persists in a named volume. Credentials are supplied through environment variables. See [deployment](docs/DEPLOYMENT.md) for hosted setup and managed-proxy builds.

## Project map

```text
client/main.tsx       Workspace, orders, policy library, evaluations
client/style.css      Responsive visual system
server/agent.ts       System prompt, real-model loop, offline engine
server/tools.ts       Tool schemas, authorization, proposals, confirmations
server/policy.ts      Policy corpus, retrieval, eligibility rules
server/db.ts          Database adapters and initial schema
server/app.ts         HTTP routes, signed demo sessions, error handling
server/evaluation.ts  Authored scenarios and assertion runner
tests/                Workflow, API, policy, concurrency, adapter tests
scripts/              Evaluation CLI and built-HTTP smoke check
docs/                 Setup, architecture, deployment, resume guidance
```

## Boundaries

Northstar is fictional. Refunds are **requests**, not actual payments. Replacements and prepaid labels are recorded requests; there is no carrier API. Specialist tickets stay in the app. Signed demo cookies isolate sample data; they do not verify real customer identities. Do not connect real customer data without proper authentication, authorization, retention controls, and operational review.

This is a portfolio application, not a claim of production adoption. See [architecture](docs/ARCHITECTURE.md), [中文上手与学习路线](docs/START-HERE.zh-CN.md), and [resume wording](docs/RESUME.md).

For a short, explicitly paid real-model integration check after configuring your key, run `npm run verify:live`. It writes `data/live-verification.json` and tests live tool calling plus persisted outcomes.

## Live-model verification

The hosted OpenAI adapter was verified with an eligible exchange and an out-of-window return request. Checks covered actual token usage, tool execution, no order mutation before confirmation, atomic confirmation, replay safety, and cross-visitor isolation. An initial exchange attempt returned no proposal; a retry passed. These checks demonstrate integration, not a production success rate. See `verification/live-deployment.json`. The 20-scenario UI evaluation intentionally remains offline and incurs no model usage.
