import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, ne } from "drizzle-orm";
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import { db, schema } from "../db/client";
import { isProd } from "../env";
import { apiResourceUrl, looksLikeAccessToken, publicOrigin, userFromAccessToken } from "./oauth";
import { looksLikeApiToken, userFromToken } from "./tokens";
import type { AuthUser } from "./users";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth` for authenticated requests. */
    user: AuthUser | null;
    /** How the request authenticated (set alongside `user`). */
    authVia: "session" | "token" | null;
  }
}

const COOKIE_NAME = "mdb_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

const now = () => Math.floor(Date.now() / 1000);

/** Sessions are stored by token hash, never the token itself. */
function sessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenFrom(req: FastifyRequest): string | null {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

export function startSession(reply: FastifyReply, userId: number): void {
  const token = randomBytes(32).toString("base64url");
  db.insert(schema.sessions)
    .values({ id: sessionId(token), userId, expiresAt: now() + SESSION_TTL_S })
    .run();
  db.update(schema.users)
    .set({ lastLoginAt: now() })
    .where(eq(schema.users.id, userId))
    .run();
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    signed: true,
    maxAge: SESSION_TTL_S,
  });
}

/** The user behind the request's session cookie, if it's valid and active. */
export function getSessionUser(req: FastifyRequest): AuthUser | null {
  const token = tokenFrom(req);
  if (!token) return null;
  const row = db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      disabled: schema.users.disabled,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.id, sessionId(token)),
        gt(schema.sessions.expiresAt, now()),
      ),
    )
    .get();
  if (!row || row.disabled) return null;
  return { id: row.id, username: row.username, role: row.role };
}

export function endSession(req: FastifyRequest, reply: FastifyReply): void {
  const token = tokenFrom(req);
  if (token) {
    db.delete(schema.sessions)
      .where(eq(schema.sessions.id, sessionId(token)))
      .run();
  }
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

/** Sign a user out everywhere except (optionally) the current request. */
export function endOtherSessions(userId: number, req?: FastifyRequest): void {
  const token = req ? tokenFrom(req) : null;
  db.delete(schema.sessions)
    .where(
      token
        ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, sessionId(token)))
        : eq(schema.sessions.userId, userId),
    )
    .run();
}

export function pruneExpiredSessions(): void {
  db.delete(schema.sessions).where(lte(schema.sessions.expiresAt, now())).run();
}

/**
 * The user behind a request: an `Authorization: Bearer mdb_…` API token if
 * the header is present (no fallback to the cookie when it's invalid), else
 * the session cookie.
 */
export function authenticate(
  req: FastifyRequest,
): { user: AuthUser; via: "session" | "token" } | null {
  const header = req.headers.authorization;
  if (header !== undefined) {
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const token = m?.[1];
    // An API token, or an OAuth access token issued for the REST API (the
    // native app's "app" scope; MCP tokens don't work here).
    const user = !token
      ? null
      : looksLikeApiToken(token)
        ? userFromToken(token)
        : looksLikeAccessToken(token)
          ? userFromAccessToken(token, apiResourceUrl(publicOrigin(req)))
          : null;
    return user ? { user, via: "token" } : null;
  }
  const user = getSessionUser(req);
  return user ? { user, via: "session" } : null;
}

/** preHandler that 401s unauthenticated requests and sets `req.user`. */
export const requireAuth: preHandlerHookHandler = async (req, reply) => {
  const auth = authenticate(req);
  if (!auth) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
  req.user = auth.user;
  req.authVia = auth.via;
};

/** Like requireAuth, but only for a signed-in browser session — for actions an
 *  API token must not be able to do itself (managing tokens, the password). */
export const requireSession: preHandlerHookHandler = async (req, reply) => {
  const auth = authenticate(req);
  if (!auth) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
  if (auth.via !== "session") {
    return reply.code(403).send({ error: "sign in to the app to do this" });
  }
  req.user = auth.user;
  req.authVia = auth.via;
};

/** preHandler for admin-only routes: 401 without auth, 403 for non-admins. */
export const requireAdmin: preHandlerHookHandler = async (req, reply) => {
  const auth = authenticate(req);
  if (!auth) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
  if (auth.user.role !== "admin") {
    return reply.code(403).send({ error: "admin only" });
  }
  req.user = auth.user;
  req.authVia = auth.via;
};
