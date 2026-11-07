# Public deployment on Render

`render.yaml` defines a free Node web service. It serves the frontend and backend from the same HTTPS origin. It requires no model API key in demo mode. Visitors do not need an account to try the isolated sample-store workflows.

## Deploy from GitHub

1. Connect Render to the GitHub repository that contains this source.
2. Create a Blueprint using the repository and its `render.yaml`, or create a Node Web Service with the same settings.
3. Confirm the free plan, then wait for the build and health check.
4. Open the **actual URL returned by Render**, then complete an exchange and reload the conversation to verify persistence within the running instance.

Build: `npm ci --include=dev && npm run build`  
Start: `npm start`  
Health check: `/api/health`  
Node: 24

`SESSION_SECRET` is retained for legacy v1 cookie migration. New opaque v2 sessions are stored in the configured database. `COOKIE_SECURE=true` protects the browser cookie over HTTPS. The app uses Render's `RENDER_EXTERNAL_URL` for origin validation and trusts the immediate Render proxy hop.

## Standalone SQLite template limitations

Free services can spin down when idle, so the first request after inactivity can take time. SQLite lives on the instance's ephemeral filesystem and sample conversations reset on redeployment or instance replacement. This is appropriate for a labelled portfolio sandbox, not persistent real customer records.

For durable data, create a PostgreSQL instance and set `DATABASE_URL`. Review the provider's current plan and price before choosing paid resources. The existing PostgreSQL adapter and integration test support that path.

## Enable live model mode later

Configure `OPENAI_API_KEY` as a Render secret, select an accessible tool-capable `OPENAI_MODEL`, and set `AGENT_MODE=openai`. Redeploy and run live-model checks. Do not store the key in `render.yaml`, GitHub source, or frontend build variables.

The public demo permits unauthenticated sample accounts. Before exposing a paid model to unrestricted visitors, add appropriate access and usage controls. No real payments, shipping labels, or external notifications are performed.

## GitHub Actions

The included CI workflow runs tests with PostgreSQL, authored demo evaluations, and the production build. The Blueprint's `checksPass` auto-deploy trigger waits for successful checks on future pushes. Initial deployment must still be verified with its build status, HTTP health, and end-to-end workflow.

## Current hosted instance

Live demo: https://relay-support-agent-9jls.onrender.com

The existing free Node service in My Workspace / Virginia is now adopted by Blueprint `exs-dbnc3gqjnfac73bvc5o0`, using `deploy/render-postgres.yaml`. It connects over the private network to Free PostgreSQL 17, resource `dpg-dbnbv0k9v7es73cbe1l0-a`, which expires **December 7, 2026**. Its URL is unchanged. The root `render.yaml` remains the separate offline SQLite starter template.

Automatic infrastructure sync and application auto-deploy are off for this controlled deployment. A paused Blueprint means automatic sync is paused; it does not stop either running resource. Manually deploy reviewed code after CI passes.

The current service uses `AGENT_MODE=openai` and `OPENAI_MODEL=gpt-4.1-mini`; its API key remains only in Render environment configuration. Database credentials are wired internally via `fromDatabase`, and opaque sessions are stored as token hashes in PostgreSQL. Actual cross-deployment recovery of a conversation, confirmed exchange, stock, state and evaluation report passed. See [session design](POSTGRES-SESSIONS.md) and [evidence](../verification/postgres-persistence.json). Free web cold starts and Free database expiry still apply.
