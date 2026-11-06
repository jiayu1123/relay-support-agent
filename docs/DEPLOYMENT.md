# Deployment

The delivered application is a standard Node service with a Vite-built client. The service serves both `/api` and built frontend assets. The verified public demo is https://relay-support-agent-9jls.onrender.com, deployed on Render in offline demo mode. See `verification/deployment.json` for the hosted workflow checks.

## Option A: Node host + PostgreSQL

Use a host that supports **Node 24**, a long-running HTTP process, and a managed PostgreSQL database.

1. Push this source to your own repository.
2. Configure build command `npm ci && npm run build` and start command `npm start`.
3. Set `DATABASE_URL` to the managed database connection URL.
4. Set a persistent, random `SESSION_SECRET`.
5. Set `APP_ORIGIN` to the exact HTTPS origin, without a trailing slash, and `COOKIE_SECURE=true`.
6. Start with `AGENT_MODE=demo`, verify the site, then configure server-side `OPENAI_API_KEY`, `OPENAI_MODEL`, and `AGENT_MODE=openai`.
7. Inspect health, execute one complete confirmed workflow, verify persistence after a restart, and run live-model evaluations separately.

The process listens on the injected `PORT` or 3001. Do not use ephemeral SQLite on a host that deletes its filesystem between deployments; use PostgreSQL or a persistent disk. Follow your provider's TLS guidance for the PostgreSQL connection. Do not disable TLS verification to work around certificate errors.

When HTTPS terminates at a proxy, setting the explicit `APP_ORIGIN` avoids relying on the internal request protocol for origin validation. Cookie security is explicitly configured. Keep the app behind your hosting boundary and limit sample-data usage. Proper verified authentication is required before using real customer information.

## Option B: Docker Compose

In `.env`, set a random hex `POSTGRES_PASSWORD` (hex avoids URL-encoding issues in the connection URL), `SESSION_SECRET`, mode, and optional model settings. For local use, leave `COOKIE_SECURE=false` and use `APP_ORIGIN=http://localhost:3001`.

```bash
docker compose up --build
```

The database is not published to the host. Its data lives in `postgres-data`. Do not run `docker compose down -v` if you want to keep it. For public deployment, use HTTPS, a reverse proxy, explicit origin configuration, and appropriate authentication.

## Managed proxy environments

The Dockerfile supports an optional BuildKit CA secret without copying a session CA into the image:

```bash
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t relay-support .
```

Preserve the environment's supported Docker proxy configuration. Do not disable certificate checks. Local builds outside such environments can use `docker build -t relay-support .`.

## Sites hosting note

The authoring environment did not provide the Sites source/build helpers, so this Node implementation was packaged for standard Node/Docker hosting rather than reported as deployed. Native Sites server hosting requires a Cloudflare Worker fetch entrypoint, D1-compatible storage, and its source publication workflow. Do not upload the Node bundle as a Worker: `node:sqlite`, Express, and TCP PostgreSQL are not a drop-in match for that runtime.

## Before sharing with recruiters

- Verify the exact public URL in a fresh browser session.
- Use fictional/sample data and label simulation boundaries.
- Set an API usage budget in your provider account and monitor it.
- Record a short demo showing a confirmed resolution plus a failure case.
- Keep the repository and README aligned with what is actually deployed.
