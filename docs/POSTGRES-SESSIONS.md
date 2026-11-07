# Hosted PostgreSQL and stable anonymous sessions

Relay supports a managed PostgreSQL database for conversations, structured state, orders, proposals, resolutions, tickets, evaluations and browser sessions. Its existing SQLite mode remains available for local development. Switching a hosted service to PostgreSQL must be verified through `/api/health`; adding a database resource alone does not switch the running application.

## Chosen infrastructure

The user selected **Free PostgreSQL**, accepting its 30-day expiry. The provisioned resource is `relay-support-agent-db` (`dpg-dbnbv0k9v7es73cbe1l0-a`), PostgreSQL 17 in the existing **My Workspace / Virginia** region. It expires **December 7, 2026 at approximately 1:04 AM America/New_York**. The web service remains on its existing free plan and retains its public URL. No paid upgrade, managed PgBouncer or new worker is requested.

Free PostgreSQL has no managed backups and stops being accessible at expiry. This supports a time-limited portfolio demo, not indefinite retention. Upgrade or export before expiry if continued use is needed. Free web services still sleep when idle; persistent storage does not remove cold-start delays.

## Connection and configuration

`deploy/render-postgres.yaml` describes the **existing** web service and database by their exact resource names. Use Render Blueprint `existingResources: adopt` only after inspecting the plan. This is distinct from the original `render.yaml`, which remains a standalone offline SQLite demo template. Do not create a second web service or duplicate free database.

The existing-resource Blueprint:

- Keeps both resources on Free in Virginia.
- Wires `DATABASE_URL` through `fromDatabase.connectionString`, so credentials stay within Render and are not copied into Git or chat.
- Preserves existing, omitted `OPENAI_API_KEY`, `OPENAI_MODEL`, `AGENT_MODE` and `SESSION_SECRET` values.
- Sets `REQUIRE_POSTGRES=true`, refusing a missing-URL SQLite fallback.
- Uses an actual database-backed `/api/health` check, which returns 503 on failure.
- Keeps the database private (`ipAllowList: []`) and uses a small application-side pool of five connections.
- Disables automatic infrastructure syncing and application auto-deploy for controlled migration/verification. Ordinary code deploys can still be manually triggered after CI passes.

The Render MCP server can manage this private resource but its SQL-query tool cannot reach a database with external access disabled. Do not open it to all IPs just to make that tool work. Verify application behavior through its HTTPS API, and exercise database contracts with disposable PostgreSQL in CI.

The initial managed database is fresh. History in the previous ephemeral Render SQLite filesystem is **not migrated**. Free web services do not expose shell access, and old local files are lost when replaced. The user was informed before cutover. New records will reside in PostgreSQL once the connection is applied and verified. Keeping the old signing key can preserve a valid browser's anonymous tenant identifier during v1-cookie migration; it cannot recover missing SQLite rows.

## Session design

New cookies use `v2.<256-bit random token>`. The HttpOnly, SameSite=Lax cookie contains no tenant identifier. HTTPS deployments also mark it Secure. Only the token's SHA-256 hash is stored in `sessions`; raw tokens never enter logs, reports, URLs, browser JavaScript or localStorage.

Session rows store the tenant, creation/last-seen times, expiry, absolute expiry and revocation time. A normal active request restores the stored tenant without reseeding orders. Idle expiry is seven days; activity renews at most once per day, capped at thirty days from creation. Revocation wins over concurrent renewal. `POST /api/session/logout` revokes the session and clears the cookie without deleting conversations. This remains an anonymous demo identity, not verified customer authentication or cross-device login.

The new opaque sessions do not depend on a per-process random signing secret. They survive a new app process or legacy signing-key change as long as the database and browser cookie remain available. An existing valid v1 HMAC cookie can exchange for a v2 token using the existing `SESSION_SECRET`; that key is retained for compatibility and is never printed or rotated during migration.

Database errors propagate. The app does not turn an outage into a fresh empty profile. Connection/statement timeouts bound failures; idle pool errors are logged without connection details. PostgreSQL startup migrations use a transaction advisory lock to coordinate multiple instances.

## Browser restoration

The client remembers only the selected page and conversation ID in localStorage. On load it fetches the authenticated account's conversation list and restores a pointer only if that account owns it. A new/expired/revoked session clears the stale pointer. Messages, drafts, API keys and session tokens are never stored in localStorage. Bootstrap requests are deduplicated so React development StrictMode cannot race creation of the first cookie. Disabled browser storage falls back to the normal conversation selector.

## Verification

Automated tests cover hash-only storage, renewal and absolute expiry, legacy upgrade, revocation, concurrent revoke/renew, malformed cookies, failure without identity reset, database readiness, real SQLite reopen, missing hosted URL refusal and cross-account access. PostgreSQL CI uses independent connection pools and changed app signing keys to restore a conversation, confirm a proposal, read saved state from another app instance and revoke the session.

Browser QA runs the built app, confirms a request, actually stops/restarts the server twice, reloads without manually selecting the conversation, checks saved order/stock/state, and verifies isolation, mobile layout and logout recovery.

After applying the reviewed infrastructure plan, verify the actual managed database with a disposable signed fixture: save a multi-turn conversation, preserve its cookie privately, deploy/restart the web service, and restore the same conversation and state. Record the observed revision, database dialect and cookie flags; never commit the cookie or database URL. Do not claim this hosted continuity check passed until it has run.
