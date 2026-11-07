import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { seed, type Store } from './db.js';

export const SESSION_COOKIE = 'relay_session';
const DAY = 86400000;
const IDLE_MS = 7 * DAY,
  ABSOLUTE_MS = 30 * DAY,
  RENEW_MS = DAY;
export type Session = {
  tenant: string;
  tokenHash: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  cookie?: string;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Opaque bearer token in HttpOnly cookie; only its hash is persisted. */
export function sessions(db: Store, legacySecret?: string, clock = () => Date.now()) {
  async function create(tenant: string = randomUUID()): Promise<Session> {
    await seed(db, tenant);
    const token = randomBytes(32).toString('base64url'),
      now = clock();
    const session = {
      tenant,
      tokenHash: hash(token),
      expiresAt: new Date(now + IDLE_MS).toISOString(),
      absoluteExpiresAt: new Date(now + ABSOLUTE_MS).toISOString(),
      cookie: `v2.${token}`,
    };
    await db.query(
      'INSERT INTO sessions(token_hash,tenant,created_at,last_seen_at,expires_at,absolute_expires_at,revoked_at) VALUES(?,?,?,?,?,?,?)',
      [
        session.tokenHash,
        tenant,
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        session.expiresAt,
        session.absoluteExpiresAt,
        null,
      ],
    );
    return session;
  }
  function legacyTenant(cookie?: string): string | null {
    if (!cookie || !legacySecret) return null;
    const parts = cookie.split('.');
    if (parts.length !== 3) return null;
    const [tenant, expires, signature] = parts;
    if (
      !/^(?:evaluation-)?[a-f\d-]{36}$/i.test(tenant) ||
      !/^\d{13}$/.test(expires) ||
      !/^[a-f\d]{64}$/.test(signature) ||
      Number(expires) <= clock()
    )
      return null;
    const expected = createHmac('sha256', legacySecret).update(`${tenant}.${expires}`).digest();
    return timingSafeEqual(Buffer.from(signature, 'hex'), expected) ? tenant : null;
  }
  async function resolve(value?: unknown): Promise<Session> {
    const cookie = typeof value === 'string' ? value : undefined;
    const token = cookie?.match(/^v2\.([A-Za-z0-9_-]{43})$/)?.[1];
    const now = clock(),
      stamp = new Date(now).toISOString();
    if (token) {
      const tokenHash = hash(token);
      const [row] = await db.query(
        'SELECT s.* FROM sessions s JOIN tenants t ON t.id=s.tenant WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.absolute_expires_at>?',
        [tokenHash, stamp, stamp],
      );
      if (row) {
        const current: Session = {
          tenant: row.tenant,
          tokenHash,
          expiresAt: row.expires_at,
          absoluteExpiresAt: row.absolute_expires_at,
        };
        if (now - Date.parse(row.last_seen_at) >= RENEW_MS) {
          const expiresAt = new Date(
            Math.min(now + IDLE_MS, Date.parse(row.absolute_expires_at)),
          ).toISOString();
          // A concurrent logout must win over renewal.
          const renewed = await db.query(
            'UPDATE sessions SET last_seen_at=?,expires_at=? WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND absolute_expires_at>? RETURNING token_hash',
            [stamp, expiresAt, tokenHash, stamp, stamp],
          );
          if (!renewed.length) return create();
          current.expiresAt = expiresAt;
          current.cookie = cookie;
        }
        return current;
      }
    }
    // Never silently reset an account on a database error: query failures propagate.
    // A verified v1 cookie can exchange for a v2 token without exposing the old signing key.
    return create(legacyTenant(cookie) || undefined);
  }
  async function revoke(session: Session) {
    await db.query(
      'UPDATE sessions SET revoked_at=? WHERE token_hash=? AND tenant=? AND revoked_at IS NULL',
      [new Date(clock()).toISOString(), session.tokenHash, session.tenant],
    );
  }
  return { create, resolve, revoke };
}
export function publicSession(session: Session) {
  return {
    version: 2,
    storage: 'database',
    anonymous: true,
    expiresAt: session.expiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    rolling: true,
  };
}
