import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { clientIp } from "../auth/loginGuard";
import { authenticate } from "../auth/session";
import { createMcpServer } from "../mcp/server";

/** API tokens only: a browser session has no business here, and requiring the
 *  header keeps cross-site requests riding on the cookie out. */
const requireToken: preHandlerHookHandler = async (req, reply) => {
  const auth = authenticate(req);
  if (!auth || auth.via !== "token") {
    return reply
      .code(401)
      .header("www-authenticate", 'Bearer realm="mit-dem-baby"')
      .send({ error: "send an API token: Authorization: Bearer mdb_…" });
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
