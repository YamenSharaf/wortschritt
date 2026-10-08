import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { clientIp } from "../auth/loginGuard";
import { looksLikeAccessToken, publicOrigin, resourceMetadataUrl, resourceUrl, userFromAccessToken } from "../auth/oauth";
import { authenticate } from "../auth/session";
import { createMcpServer } from "../mcp/server";

/**
 * An OAuth access token (MCP connectors that sign in) or a personal API token
 * (connectors configured with a header). Not the session cookie: requiring
 * the header keeps cross-site requests riding on it out. The 401 points
 * clients to the OAuth metadata, which starts the sign-in flow.
 */
const requireToken: preHandlerHookHandler = async (req, reply) => {
  const origin = publicOrigin(req);
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  // An OAuth token counts only if it was issued for MCP (not the app's API).
  const isOAuth = Boolean(m && looksLikeAccessToken(m[1]!));
  const oauthUser = isOAuth ? userFromAccessToken(m![1]!, resourceUrl(origin)) : null;
  const auth = isOAuth ? (oauthUser ? { user: oauthUser, via: "token" as const } : null) : authenticate(req);
  if (!auth || auth.via !== "token") {
    const invalid = req.headers.authorization ? ', error="invalid_token"' : "";
    return reply
      .code(401)
      .header("www-authenticate", `Bearer resource_metadata="${resourceMetadataUrl(origin)}"${invalid}`)
      .send({ error: "sign in via OAuth, or send an API token: Authorization: Bearer mdb_…" });
  }
  req.user = auth.user;
  req.authVia = auth.via;
};

/**
 * MCP over Streamable HTTP, stateless: every POST gets a fresh server bound to
 * the token's user, so there's no session state to keep or leak between users.
 */
export async function mcpRoutes(app: FastifyInstance) {
  app.post(
    "/mcp",
    {
      preHandler: requireToken,
      schema: { hide: true },
      config: { rateLimit: { max: 300, timeWindow: "1 minute", keyGenerator: clientIp } },
    },
    async (req, reply) => {
      const server = createMcpServer(req.user!);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      reply.hijack();
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    },
  );

  // Stateless: no server-initiated stream (GET) and no session to end (DELETE).
  for (const method of ["GET", "DELETE"] as const) {
    app.route({
      method,
      url: "/mcp",
      schema: { hide: true },
      handler: async (_req, reply) =>
        reply.code(405).header("allow", "POST").send({ error: "method not allowed" }),
    });
  }
}
