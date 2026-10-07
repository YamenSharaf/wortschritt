import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  apiTokenView,
  changePasswordBody,
  createTokenBody,
  loginBody,
  meResponse,
  registerBody,
  registrationStatus as registrationStatusDto,
} from "@mdb/shared";
import { clearFailures, clientIp, lockedFor, recordFailure } from "../auth/loginGuard";
import { dummyHash, verifyPassword } from "../auth/password";
import {
  authenticate,
  endOtherSessions,
  endSession,
  requireSession,
  startSession,
} from "../auth/session";
import { createToken, deleteToken, listTokens, MAX_TOKENS_PER_USER } from "../auth/tokens";
import { createUser, findUserById, findUserByUsername, setPassword } from "../auth/users";
import { registrationStatus } from "../services/registration";

const error = z.object({ error: z.string() });

/** Per-IP limit on password-checking routes (see also auth/loginGuard.ts). */
const passwordRateLimit = {
  max: 10,
  timeWindow: "1 minute",
  keyGenerator: clientIp,
};

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/auth/login",
    {
      config: { rateLimit: passwordRateLimit },
      schema: {
        tags: ["auth"],
        body: loginBody,
        response: { 200: z.object({ ok: z.literal(true) }), 401: error, 429: error },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;
      const wait = lockedFor(username);
      if (wait > 0) {
        reply.header("retry-after", wait);
        return reply.code(429).send({ error: "too many attempts, try again later" });
      }
      const user = findUserByUsername(username);
      // Always run a full hash check so unknown usernames take as long as
      // wrong passwords.
      const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
      if (!user || !ok || user.disabled) {
        recordFailure(username);
        req.log.warn({ username, ip: clientIp(req) }, "failed login");
        return reply.code(401).send({ error: "invalid username or password" });
      }
      clearFailures(username);
      startSession(reply, user.id);
      return { ok: true as const };
    },
  );

  r.post(
    "/api/auth/logout",
    { schema: { tags: ["auth"], response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (req, reply) => {
      endSession(req, reply);
      return { ok: true as const };
    },
  );

  r.get(
    "/api/auth/me",
    { schema: { tags: ["auth"], response: { 200: meResponse } } },
    async (req) => {
      const user = authenticate(req)?.user;
      return {
        authenticated: Boolean(user),
        user: user ? { username: user.username, role: user.role } : null,
      };
    },
  );

  // Public: whether the login page should offer "Create account".
  r.get(
    "/api/auth/registration",
    { schema: { tags: ["auth"], response: { 200: registrationStatusDto } } },
    async () => registrationStatus(),
  );

  // Self-registration, only while the admin has it open. Signs the new user in.
  r.post(
    "/api/auth/register",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 hour", keyGenerator: clientIp },
      },
      schema: {
        tags: ["auth"],
        body: registerBody,
        response: { 200: z.object({ ok: z.literal(true) }), 403: error, 409: error },
      },
    },
    async (req, reply) => {
      if (!registrationStatus().open) {
        return reply.code(403).send({ error: "registration is closed" });
      }
      const { username, password } = req.body;
      if (findUserByUsername(username)) {
        return reply.code(409).send({ error: "that username is taken" });
      }
      const user = await createUser(username, password);
      req.log.info({ username, ip: clientIp(req) }, "user registered");
      startSession(reply, user.id);
      return { ok: true as const };
    },
  );

  // Change your own password. Signs out your other sessions. Browser session
  // only: an API token can't change the password.
  r.post(
    "/api/auth/password",
    {
      preHandler: requireSession,
      config: { rateLimit: passwordRateLimit },
      schema: {
        tags: ["auth"],
        body: changePasswordBody,
        response: { 200: z.object({ ok: z.literal(true) }), 401: error, 403: error },
      },
    },
    async (req, reply) => {
      const user = findUserById(req.user!.id)!;
      if (!(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
        return reply.code(403).send({ error: "current password is incorrect" });
      }
      await setPassword(user.id, req.body.newPassword);
      endOtherSessions(user.id, req);
      return { ok: true as const };
    },
  );

  // --- personal API tokens (managed from a signed-in browser session) -------

  r.get(
    "/api/auth/tokens",
    {
      preHandler: requireSession,
      schema: { tags: ["auth"], response: { 200: z.array(apiTokenView) } },
    },
    async (req) => listTokens(req.user!.id),
  );

  r.post(
    "/api/auth/tokens",
    {
      preHandler: requireSession,
      schema: {
        tags: ["auth"],
        body: createTokenBody,
        response: {
          200: z.object({ token: z.string(), tokens: z.array(apiTokenView) }),
          400: error,
        },
      },
    },
    async (req, reply) => {
      const token = createToken(req.user!.id, req.body.name);
      if (!token) {
        return reply
          .code(400)
          .send({ error: `You can have at most ${MAX_TOKENS_PER_USER} tokens; delete one first.` });
      }
      req.log.info({ username: req.user!.username, name: req.body.name }, "API token created");
      return { token, tokens: listTokens(req.user!.id) };
    },
  );

  r.delete(
    "/api/auth/tokens/:id",
    {
      preHandler: requireSession,
      schema: {
        tags: ["auth"],
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: z.array(apiTokenView) },
      },
    },
    async (req) => {
      deleteToken(req.user!.id, req.params.id);
      return listTokens(req.user!.id);
    },
  );
}
