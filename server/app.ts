import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Store } from './db.js';
import { sessions, publicSession, SESSION_COOKIE, type Session } from './sessions.js';
import { AppError, confirmResolution, ownedConversation, type Context } from './tools.js';
import { runAgent, type Turn } from './agent.js';
import {
  getConversationState,
  lockConversation,
  readState,
  writeState,
} from './conversation-state.js';
import { policies } from './policy.js';
import { evaluate } from './evaluation.js';

export function createApp(
  db: Store,
  options: { mode?: string; secret?: string; staticDir?: string } = {},
) {
  const app = express();
  const sessionStore = sessions(db, options.secret || process.env.SESSION_SECRET);
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
  app.get('/api/health', async (_req, res) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const metadata = {
      mode,
      database: db.dialect,
      model: mode === 'demo' ? 'deterministic-demo-v1' : process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      llmConfigured: mode === 'openai' && Boolean(process.env.OPENAI_API_KEY),
      revision: process.env.RENDER_GIT_COMMIT || null,
      conversationStateVersion: 1,
      sessionVersion: 2,
      sessionStorage: 'database',
    };
    try {
      await Promise.race([
        db.query('SELECT 1 AS ready'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('readiness timeout')), 2000);
        }),
      ]);
      res.json({ ok: true, ...metadata });
    } catch {
      res.status(503).json({ ok: false, ...metadata });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  function assertOrigin(req: express.Request) {
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
      const expected =
        process.env.APP_ORIGIN ||
        process.env.RENDER_EXTERNAL_URL ||
        `${req.protocol}://${req.get('host')}`;
      if (origin !== expected.replace(/\/$/, ''))
        throw new AppError(403, 'ORIGIN_REJECTED', 'Cross-origin requests are not allowed.');
    }
  }
  function issueSession(res: express.Response, session: Session) {
    if (!session.cookie) return;
    res.cookie(SESSION_COOKIE, session.cookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.RENDER === 'true' || process.env.COOKIE_SECURE === 'true',
      maxAge: Math.max(0, Date.parse(session.expiresAt) - Date.now()),
      path: '/',
    });
  }
  app.post('/api/evaluation-fixtures', async (req, res) => {
    assertOrigin(req);
    z.object({}).strict().parse(req.body);
    const session = await sessionStore.create(`evaluation-${randomUUID()}`);
    issueSession(res, session);
    res.status(201).json({ fixture: true });
  });
  app.use('/api', async (req, res, next) => {
    try {
      assertOrigin(req);
      const session = await sessionStore.resolve(req.cookies[SESSION_COOKIE]);
      issueSession(res, session);
      res.locals.session = session;
      res.locals.tenant = session.tenant;
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/session', (_req, res) => res.json(publicSession(res.locals.session)));
  app.post('/api/session/logout', async (req, res) => {
    z.object({}).strict().parse(req.body);
    await sessionStore.revoke(res.locals.session);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });
  app.delete('/api/evaluation-fixtures/current', async (_req, res) => {
    const tenant = res.locals.tenant as string;
    if (!tenant.startsWith('evaluation-'))
      throw new AppError(
        403,
        'NOT_EVALUATION_FIXTURE',
        'Only disposable evaluation accounts can be cleaned up.',
      );
    await db.transaction(async (tx) => {
      for (const table of [
        'sessions',
        'conversation_states',
        'messages',
        'proposals',
        'resolutions',
        'tickets',
        'conversations',
        'inventory',
        'orders',
        'eval_runs',
      ])
        await tx.query(`DELETE FROM ${table} WHERE tenant=?`, [tenant]);
      await tx.query('DELETE FROM tenants WHERE id=?', [tenant]);
    });
    res.clearCookie('relay_session', { path: '/' });
    res.status(204).end();
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
      session: publicSession(res.locals.session),
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
    const state = await getConversationState(db, {
      tenant: res.locals.tenant,
      conversation: String(req.params.id),
    });
    res.json({
      state,
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
    const tenant = res.locals.tenant;
    await db.transaction(async (tx) => {
      const [pointer] = await tx.query(
        'SELECT conversation FROM proposals WHERE id=? AND tenant=?',
        [req.params.id, tenant],
      );
      if (!pointer) throw new AppError(404, 'NOT_FOUND', 'Proposal not found.');
      const key = { tenant, conversation: pointer.conversation };
      await lockConversation(tx, db, key);
      const state = await readState(tx, key);
      if (state?.processing)
        throw new AppError(
          409,
          'TURN_IN_PROGRESS',
          'Wait for the current reply before cancelling.',
        );
      const p = await tx.query(
        "UPDATE proposals SET status='cancelled' WHERE id=? AND tenant=? AND status='pending' RETURNING id",
        [req.params.id, tenant],
      );
      if (!p.length)
        throw new AppError(409, 'STALE_PROPOSAL', 'This proposal is no longer pending.');
      if (state?.pendingProposal?.id === req.params.id) {
        state.pendingProposal = null;
        state.stage = 'cancelled';
        state.intent = null;
        state.missingSlots = [];
        await writeState(tx, key, state);
      }
    });
    res.json({ cancelled: true });
  });
  app.post('/api/evaluations', async (_req, res) => {
    const t = res.locals.tenant;
    if (evalBusy.has(t))
      throw new AppError(409, 'EVAL_RUNNING', 'An evaluation is already running.');
    evalBusy.add(t);
    try {
      // The UI explicitly runs the offline suite, even when chat uses a live model.
      // Paid model evaluations remain an explicit CLI operation.
      res.json(await evaluate(db, t, 'demo'));
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
      res.status(status).json({
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
