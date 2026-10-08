import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { oauthDecisionBody, oauthGrantView, oauthRequestView } from "@mdb/shared";
import { clientIp } from "../auth/loginGuard";
import {
  authenticateClient,
  apiProtectedResourceMetadata,
  authorizationServerMetadata,
  checkAuthorizeRequest,
  consentView,
  decide,
  deleteGrant,
  exchangeCode,
  listGrants,
  OAuthError,
  protectedResourceMetadata,
  publicOrigin,
  refresh,
  registerClient,
  revoke,
} from "../auth/oauth";
import { requireSession } from "../auth/session";

/** OAuth errors as RFC 6749 JSON (never cached). */
function sendError(reply: FastifyReply, e: unknown) {
  if (!(e instanceof OAuthError)) throw e;
  return reply
    .code(e.status)
    .header("cache-control", "no-store")
    .send({ error: e.code, error_description: e.message });
}

/**
 * OAuth for MCP connectors. The endpoints a client calls itself (metadata,
 * register, token, revoke) are public and allow any origin — they carry no
 * cookies. The consent step runs in the web app (`/oauth/authorize` is a SPA
 * page) and uses the signed-in session via the /api/oauth routes.
 */
export async function oauthRoutes(app: FastifyInstance) {
  // The token and revocation endpoints take form posts (RFC 6749).
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const publicPaths = new Set([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource/api",
    "/.well-known/oauth-authorization-server",
    "/oauth/register",
    "/oauth/token",
    "/oauth/revoke",
  ]);
  app.addHook("onRequest", async (req, reply) => {
    if (!publicPaths.has(req.url.split("?")[0]!)) return;
    reply.header("access-control-allow-origin", "*");
    if (req.method === "OPTIONS") {
      return reply
        .header("access-control-allow-methods", "GET, POST, OPTIONS")
        .header("access-control-allow-headers", "authorization, content-type, mcp-protocol-version")
        .code(204)
        .send();
    }
  });
  app.options("/.well-known/*", { schema: { hide: true } }, async () => undefined);
  app.options("/oauth/*", { schema: { hide: true } }, async () => undefined);

  // --- discovery ---------------------------------------------------------------
  for (const url of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    app.get(url, { schema: { hide: true } }, async (req) => protectedResourceMetadata(publicOrigin(req)));
  }
  app.get("/.well-known/oauth-protected-resource/api", { schema: { hide: true } }, async (req) =>
    apiProtectedResourceMetadata(publicOrigin(req)),
  );
  app.get("/.well-known/oauth-authorization-server", { schema: { hide: true } }, async (req) =>
    authorizationServerMetadata(publicOrigin(req)),
  );

  // --- client endpoints ---------------------------------------------------------
  app.post(
    "/oauth/register",
    {
      schema: { hide: true },
      config: { rateLimit: { max: 20, timeWindow: "1 hour", keyGenerator: clientIp } },
    },
    async (req, reply) => {
      try {
        return reply.code(201).header("cache-control", "no-store").send(registerClient(req.body));
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/oauth/token",
    {
      schema: { hide: true },
      config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: clientIp } },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, string>;
      try {
        const client = authenticateClient(body, req.headers.authorization);
        let tokens;
        if (body.grant_type === "authorization_code") tokens = exchangeCode(client, body);
        else if (body.grant_type === "refresh_token") tokens = refresh(client, body);
        else throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
        return reply.header("cache-control", "no-store").header("pragma", "no-cache").send(tokens);
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post(
    "/oauth/revoke",
    {
      schema: { hide: true },
      config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: clientIp } },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, string>;
      try {
        revoke(authenticateClient(body, req.headers.authorization), body.token);
        return reply.code(200).send({});
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  // --- consent (signed-in web app) -------------------------------------------------
  const r = app.withTypeProvider<ZodTypeProvider>();
  const failure = z.object({ error: z.string() });

  r.get(
    "/api/oauth/authorize",
    {
      preHandler: requireSession,
      schema: {
        tags: ["oauth"],
        querystring: z.record(z.string(), z.string()),
        response: {
          200: z.union([oauthRequestView, z.object({ redirect: z.string() })]),
          400: failure,
        },
      },
    },
    async (req, reply) => {
      try {
        const checked = await checkAuthorizeRequest(req.query, publicOrigin(req));
        return checked.ok ? consentView(checked.request, req.user!) : { redirect: checked.redirect };
      } catch (e) {
        if (e instanceof OAuthError) return reply.code(400).send({ error: e.message });
        throw e;
      }
    },
  );

  r.post(
    "/api/oauth/authorize",
    {
      preHandler: requireSession,
      schema: {
        tags: ["oauth"],
        body: oauthDecisionBody,
        response: { 200: z.object({ redirect: z.string() }), 400: failure },
      },
    },
    async (req, reply) => {
      const origin = publicOrigin(req);
      try {
        const checked = await checkAuthorizeRequest(req.body.params, origin);
        if (!checked.ok) return { redirect: checked.redirect };
        const redirect = decide(checked.request, req.user!, req.body.approve, origin);
        req.log.info(
          { client: checked.request.client.clientName, by: req.user!.username, approved: req.body.approve },
          "oauth decision",
        );
        return { redirect };
      } catch (e) {
        if (e instanceof OAuthError) return reply.code(400).send({ error: e.message });
        throw e;
      }
    },
  );

  r.get(
    "/api/oauth/grants",
    {
      preHandler: requireSession,
      schema: { tags: ["oauth"], response: { 200: z.array(oauthGrantView) } },
    },
    async (req) => listGrants(req.user!.id),
  );

  r.delete(
    "/api/oauth/grants/:id",
    {
      preHandler: requireSession,
      schema: {
        tags: ["oauth"],
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.array(oauthGrantView) },
      },
    },
    async (req) => {
      deleteGrant(req.user!.id, req.params.id);
      return listGrants(req.user!.id);
    },
  );
}
