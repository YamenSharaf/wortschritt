import { timingSafeEqual } from "node:crypto";
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import { env, isProd } from "../env";

const COOKIE_NAME = "mdb_session";
const COOKIE_VALUE = "ok";

/** Constant-time password comparison to avoid timing leaks. */
export function verifyPassword(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.APP_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function startSession(reply: FastifyReply): void {
  reply.setCookie(COOKIE_NAME, COOKIE_VALUE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    signed: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function isAuthenticated(req: FastifyRequest): boolean {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value === COOKIE_VALUE;
}

/** preHandler that 401s unauthenticated requests. */
export const requireAuth: preHandlerHookHandler = async (req, reply) => {
  if (!isAuthenticated(req)) {
    reply.code(401).send({ error: "unauthenticated" });
  }
};
