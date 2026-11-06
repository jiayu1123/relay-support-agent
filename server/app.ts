import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Store } from './db.js';
import { seed } from './db.js';
import { AppError, confirmResolution, ownedConversation, type Context } from './tools.js';
import { runAgent, type Turn } from './agent.js';
import { policies } from './policy.js';
import { evaluate } from './evaluation.js';

export function createApp(
  db: Store,
  options: { mode?: string; secret?: string; staticDir?: string } = {},
) {
  const app = express();
  const secret = options.secret || process.env.SESSION_SECRET || randomBytes(32).toString('hex');
  const mode = options.mode || process.env.AGENT_MODE || 'demo';
  // Render terminates TLS at its reverse proxy. Trust only the immediate hop.
  if (process.env.RENDER === 'true') app.set('trust proxy', 1);
  const busy = new Set<string>();
  const evalBusy = new Set<string>();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '16kb' }), cookieParser());
  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      mode,
      database: db.dialect,
      model: mode === 'demo' ? 'deterministic-demo-v1' : process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      llmConfigured: mode === 'openai' && Boolean(process.env.OPENAI_API_KEY),
    }),
  );
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', async (req, res, next) => {
    try {
      // Browser cross-origin writes are rejected; scripts may use a valid cookie without Origin.
      const origin = req.get('origin');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
        const expected =
          process.env.APP_ORIGIN ||
          process.env.RENDER_EXTERNAL_URL ||
          `${req.protocol}://${req.get('host')}`;
        if (origin !== expected.replace(/\/$/, ''))
          throw new AppError(403, 'ORIGIN_REJECTED', 'Cross-origin requests are not allowed.');
      }
      let tenant = '';
      const raw = req.cookies.relay_session as string | undefined;
      if (raw) {
        const [id, expires, sig] = raw.split('.');
        const payload = `${id}.${expires}`;
        const expected = createHmac('sha256', secret).update(payload).digest('hex');
        if (
          id &&
          expires &&
          sig &&
          sig.length === expected.length &&
          /^[0-9a-f]+$/.test(sig) &&
          timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) &&
          Number(expires) > Date.now()
        )
          tenant = id;
      }
      if (!tenant) {
        tenant = randomUUID();
        const payload = `${tenant}.${Date.now() + 7 * 86400000}`;
        const value = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
        res.cookie('relay_session', value, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.COOKIE_SECURE === 'true',
          maxAge: 7 * 86400000,
          path: '/',
        });
      }
      await seed(db, tenant);
      res.locals.tenant = tenant;
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/bootstrap', async (_req, res) => {
    const t = res.locals.tenant;
    const orders = await db.query(
      'SELECT o.*,i.stock FROM orders o JOIN inventory i ON o.tenant=i.tenant AND o.sku=i.sku WHERE o.tenant=? ORDER BY o.id DESC',
      [t],
    );
    const conversations = await db.query(
      'SELECT * FROM conversations WHERE tenant=? ORDER BY created_at DESC',
      [t],
    );
    const resolutions = await db.query(
      'SELECT * FROM resolutions WHERE tenant=? ORDER BY created_at DESC',
      [t],
    );
    const tickets = await db.query(
      'SELECT * FROM tickets WHERE tenant=? ORDER BY created_at DESC',
      [t],
    );
    const [latest] = await db.query(
      'SELECT report FROM eval_runs WHERE tenant=? ORDER BY created_at DESC LIMIT 1',
      [t],
    );
    res.json({
      customer: { name: 'Alex Morgan', email: 'alex@example.test', label: 'Isolated demo account' },
      mode,
      model: mode === 'demo' ? 'deterministic-demo-v1' : process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      database: db.dialect,
      orders,
      conversations,
      resolutions,
      tickets,
      policies,
      latestEvaluation: latest ? JSON.parse(latest.report) : null,
    });
  });
  app.post('/api/conversations', async (req, res) => {
    const { title } = z
      .object({ title: z.string().max(80).default('New conversation') })
      .parse(req.body);
    const c = {
      id: randomUUID(),
      tenant: res.locals.tenant,
      title,
      created_at: new Date().toISOString(),
    };
    await db.query(
      'INSERT INTO conversations(id,tenant,title,created_at) VALUES(?,?,?,?)',
      Object.values(c),
    );
    res.status(201).json(c);
  });
  app.get('/api/conversations/:id', async (req, res) => {
    await ownedConversation(db, res.locals.tenant, String(req.params.id));
    const messages = await db.query(
      'SELECT * FROM messages WHERE tenant=? AND conversation=? ORDER BY created_at,id',
      [res.locals.tenant, req.params.id],
    );
    const proposals = await db.query(
      'SELECT id,status FROM proposals WHERE tenant=? AND conversation=?',
      [res.locals.tenant, req.params.id],
    );
    res.json({
      messages: messages.map((m) => {
        const metadata = JSON.parse(m.metadata);
        if (metadata.proposal) {
          const actual = proposals.find((p) => p.id === metadata.proposal.id);
          metadata.proposal.status = actual?.status || 'expired';
        }
        return { ...m, metadata };
      }),
    });
  });
  app.post('/api/conversations/:id/messages', async (req, res) => {
    const { content } = z
      .object({ content: z.string().trim().min(1).max(3000) })
      .strict()
      .parse(req.body);
    const tenant = res.locals.tenant,
      conversation = String(req.params.id);
    await ownedConversation(db, tenant, conversation);
    const key = `${tenant}:${conversation}`;
    if (busy.has(key))
      throw new AppError(409, 'TURN_IN_PROGRESS', 'Please wait for the current reply.');
    busy.add(key);
    try {
      const rows = await db.query(
        'SELECT role,content FROM messages WHERE tenant=? AND conversation=? ORDER BY created_at,id',
        [tenant, conversation],
      );
      const history = rows.map((r) => ({ role: r.role, content: r.content })) as Turn[];
      history.push({ role: 'user', content });
      const ctx: Context = { db, tenant, conversation, traces: [] };
      const result = await runAgent(ctx, history, { mode });
      const stamp = Date.now();
      const user = {
        id: randomUUID(),
        tenant,
        conversation,
        role: 'user',
        content,
        metadata: '{}',
        created_at: new Date(stamp).toISOString(),
      };
      const assistant = {
        id: randomUUID(),
        tenant,
        conversation,
        role: 'assistant',
        content: result.text,
        metadata: JSON.stringify({ ...result, traces: ctx.traces }),
        created_at: new Date(stamp + 1).toISOString(),
      };
      await db.transaction(async (tx) => {
        for (const m of [user, assistant])
          await tx.query(
            'INSERT INTO messages(id,tenant,conversation,role,content,metadata,created_at) VALUES(?,?,?,?,?,?,?)',
            Object.values(m),
          );
        if (!rows.length)
          await tx.query('UPDATE conversations SET title=? WHERE tenant=? AND id=?', [
            content.slice(0, 60),
            tenant,
            conversation,
          ]);
      });
      res.json({
        user: { ...user, metadata: {} },
        assistant: { ...assistant, metadata: JSON.parse(assistant.metadata) },
      });
    } finally {
      busy.delete(key);
    }
  });
  app.post('/api/proposals/:id/confirm', async (req, res) => {
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    const resolution = await confirmResolution(db, res.locals.tenant, String(req.params.id));
    const [p] = await db.query('SELECT conversation FROM proposals WHERE id=? AND tenant=?', [
      req.params.id,
      res.locals.tenant,
    ]);
    // The database transaction is the source of truth. The replayable confirmation is also visible in history.
    const id = `confirmation-${req.params.id}`;
    const content = `${resolution.action === 'exchange' ? 'Exchange' : 'Return/refund'} request ${resolution.id} created for ${resolution.order_id}. ${resolution.action === 'refund' ? 'No payment has been issued. Refund processing follows return and inspection.' : 'A replacement and prepaid return label request have been recorded. No carrier label has been purchased.'}`;
    await db.query(
      'INSERT INTO messages(id,tenant,conversation,role,content,metadata,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      [
        id,
        res.locals.tenant,
        p.conversation,
        'assistant',
        content,
        JSON.stringify({ confirmation: resolution }),
        new Date().toISOString(),
      ],
    );
    res.json(resolution);
  });
  app.post('/api/proposals/:id/cancel', async (req, res) => {
    const p = await db.query(
      "UPDATE proposals SET status='cancelled' WHERE id=? AND tenant=? AND status='pending' RETURNING id",
      [req.params.id, res.locals.tenant],
    );
    if (!p.length) throw new AppError(409, 'STALE_PROPOSAL', 'This proposal is no longer pending.');
    res.json({ cancelled: true });
  });
  app.post('/api/evaluations', async (_req, res) => {
    const t = res.locals.tenant;
    if (evalBusy.has(t))
      throw new AppError(409, 'EVAL_RUNNING', 'An evaluation is already running.');
    if (mode === 'openai')
      throw new AppError(
        400,
        'CLI_REQUIRED',
        'Run npm run eval -- --mode=openai locally to explicitly opt into paid model evaluation.',
      );
    evalBusy.add(t);
    try {
      res.json(await evaluate(db, t, mode));
    } finally {
      evalBusy.delete(t);
    }
  });
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get('/{*path}', (req, res) => {
      if (req.path.startsWith('/api/'))
        return res.status(404).json({ error: 'NOT_FOUND', message: 'API endpoint not found.' });
      res.sendFile(resolve(options.staticDir!, 'index.html'));
    });
  }
  app.use(
    (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status =
        error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 500;
      if (status === 500)
        console.error(
          JSON.stringify({ event: 'request_failed', type: error?.constructor?.name || 'Error' }),
        );
      res
        .status(status)
        .json({
          error:
            error instanceof AppError
              ? error.code
              : error instanceof z.ZodError
                ? 'INVALID_INPUT'
                : 'SERVER_ERROR',
          message:
            error instanceof AppError
              ? error.message
              : error instanceof z.ZodError
                ? 'Please check the request fields.'
                : 'The request could not be completed. Check server configuration and try again. No fallback model was used.',
        });
    },
  );
  return app;
}
