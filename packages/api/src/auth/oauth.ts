import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { APP_NAME, type OAuthGrantView, type OAuthRequestView } from "@mdb/shared";
import { guardedFetch } from "../assistant/egress";
import { db, schema } from "../db/client";
import { env } from "../env";
import type { AuthUser } from "./users";

/**
 * OAuth 2.1 for MCP clients, the app being both authorization server and
 * resource server (the MCP spec's authorization profile):
 * - discovery: protected-resource and authorization-server metadata;
 * - clients: Dynamic Client Registration, or a Client ID Metadata Document
 *   (the client_id is an https URL, fetched through the egress guard);
 * - authorization code + PKCE (S256 only), exact redirect_uri match;
 * - two resources, one scope each: "mcp" (resource <origin>/mcp, the MCP
 *   endpoint) and "app" (resource <origin>/api, the REST API, for the
 *   native app). A token only works on the resource it was issued for;
 * - access tokens last 1 h; refresh tokens (30 days, sliding) rotate on
 *   every use. Codes and tokens are stored as SHA-256 only.
 */

export const SCOPE = "mcp";
/** The native app's scope: the REST API. */
export const APP_SCOPE = "app";
const CODE_TTL_S = 10 * 60;
export const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const CIMD_TTL_S = 24 * 60 * 60;
const ACCESS_PREFIX = "mdbo_at_";
const REFRESH_PREFIX = "mdbo_rt_";

const now = () => Math.floor(Date.now() / 1000);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const random = () => randomBytes(32).toString("base64url");

export class OAuthError extends Error {
  constructor(
    public code: string,
    description: string,
    public status = 400,
  ) {
    super(description);
  }
}

// --- origin and metadata -----------------------------------------------------

/** The public origin: PUBLIC_URL, else the request's (proxy) headers. */
export function publicOrigin(req: FastifyRequest): string {
  if (env.PUBLIC_URL) return new URL(env.PUBLIC_URL).origin;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  const proto = first(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const host = first(req.headers["x-forwarded-host"]) ?? req.headers.host ?? "localhost";
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

export const resourceUrl = (origin: string) => `${origin}/mcp`;
export const apiResourceUrl = (origin: string) => `${origin}/api`;
export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/mcp`;

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: APP_NAME,
  };
}

/** The REST API as a protected resource (for the native app). */
export function apiProtectedResourceMetadata(origin: string) {
  return {
    resource: apiResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [APP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: APP_NAME,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [SCOPE, APP_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

// --- clients -----------------------------------------------------------------

type Client = typeof schema.oauthClients.$inferSelect;

/**
 * A native app's private-use URI scheme (RFC 8252 §7.1): reverse-DNS, so it
 * contains a dot (e.g. "eu.yamen.wortschritt:/oauth/callback").
 */
const PRIVATE_SCHEME = /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:$/;

/**
 * https anywhere, http on loopback (CLI clients), or a native app's
 * private-use scheme; no fragments.
 */
function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 500) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (PRIVATE_SCHEME.test(url.protocol)) return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function cleanName(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : fallback;
}

function cleanUri(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;

/** RFC 7591 registration. Returns the registration response. */
export function registerClient(body: unknown) {
  const meta = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(validRedirectUri)) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "redirect_uris must be 1-10 https URLs (or http on localhost, or a reverse-DNS app scheme), without fragments",
    );
  }
  const grantTypes = (meta.grant_types as unknown[] | undefined) ?? ["authorization_code"];
  const responseTypes = (meta.response_types as unknown[] | undefined) ?? ["code"];
  if (
    !Array.isArray(grantTypes) ||
    !grantTypes.every((g) => g === "authorization_code" || g === "refresh_token") ||
    !Array.isArray(responseTypes) ||
    !responseTypes.every((r) => r === "code")
  ) {
    throw new OAuthError("invalid_client_metadata", "only the authorization_code and refresh_token grants are supported");
  }
  // RFC 7591's default is client_secret_basic.
  const method = (meta.token_endpoint_auth_method as string | undefined) ?? "client_secret_basic";
  if (!AUTH_METHODS.includes(method as (typeof AUTH_METHODS)[number])) {
    throw new OAuthError("invalid_client_metadata", `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(", ")}`);
  }
  const clientId = `mdbc_${random()}`;
  const secret = method === "none" ? null : `mdbs_${random()}`;
  const name = cleanName(meta.client_name, "Unnamed app");
  const clientUri = cleanUri(meta.client_uri);
  db.insert(schema.oauthClients)
    .values({
      clientId,
      clientName: name,
      clientUri,
      redirectUris: uris as string[],
      secretHash: secret ? hash(secret) : null,
    })
    .run();
  return {
    client_id: clientId,
    client_id_issued_at: now(),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name,
    ...(clientUri ? { client_uri: clientUri } : {}),
    redirect_uris: uris as string[],
    grant_types: grantTypes as string[],
    response_types: ["code"],
    token_endpoint_auth_method: method,
  };
}

const isMetadataUrl = (clientId: string) => clientId.startsWith("https://");

/** Fetch and cache a Client ID Metadata Document (the client_id is its URL). */
async function fetchClientMetadata(clientId: string): Promise<Client> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new OAuthError("invalid_client", "client_id is not a valid URL");
  }
  if (url.pathname === "/" || url.hash) {
    throw new OAuthError("invalid_client", "a metadata document client_id needs a path and no fragment");
  }
  let doc: Record<string, unknown>;
  try {
    const res = await guardedFetch(clientId, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > 64 * 1024) throw new Error("too large");
    const text = await res.text();
    if (text.length > 64 * 1024) throw new Error("too large");
    doc = JSON.parse(text);
  } catch (e) {
    throw new OAuthError("invalid_client", `couldn't load the client's metadata document (${(e as Error).message})`);
  }
  if (doc.client_id !== clientId) {
    throw new OAuthError("invalid_client", "the metadata document's client_id doesn't match its URL");
  }
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every(validRedirectUri)) {
    throw new OAuthError("invalid_client", "the metadata document has no valid redirect_uris");
  }
  const method = doc.token_endpoint_auth_method ?? "none";
  if (method !== "none") {
    throw new OAuthError("invalid_client", "metadata-document clients must use token_endpoint_auth_method none");
  }
  const row = {
    clientId,
    clientName: cleanName(doc.client_name, url.host),
    clientUri: cleanUri(doc.client_uri),
    redirectUris: uris as string[],
    secretHash: null,
    metadataDocument: true,
    fetchedAt: now(),
  };
  db.insert(schema.oauthClients)
    .values(row)
    .onConflictDoUpdate({ target: schema.oauthClients.clientId, set: row })
    .run();
  return getClient(clientId)!;
}

function getClient(clientId: string): Client | undefined {
  return db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId)).get();
}

async function resolveClient(clientId: string | undefined): Promise<Client> {
  if (!clientId) throw new OAuthError("invalid_request", "client_id is missing");
  if (isMetadataUrl(clientId)) {
    const cached = getClient(clientId);
    if (cached?.fetchedAt && now() - cached.fetchedAt < CIMD_TTL_S) return cached;
    return fetchClientMetadata(clientId);
  }
  const client = getClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "unknown client_id; register the client again");
  return client;
}

// --- authorization -----------------------------------------------------------

export type AuthorizeParams = Record<string, string>;

type ValidRequest = {
  client: Client;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  resource: string;
  scope: string;
};

/**
 * Check an authorization request. Problems with the client or redirect_uri
 * are shown to the user (`OAuthError`); anything else goes back to the client
 * as a redirect (`{ redirect }`), as RFC 6749 §4.1.2.1 requires.
 */
export async function checkAuthorizeRequest(
  p: AuthorizeParams,
  origin: string,
): Promise<{ ok: true; request: ValidRequest } | { ok: false; redirect: string }> {
  const client = await resolveClient(p.client_id);
  let redirectUri = p.redirect_uri;
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri isn't registered for this client");
  }
  const back = (error: string, description: string) => ({
    ok: false as const,
    redirect: redirectWith(redirectUri, { error, error_description: description, state: p.state, iss: origin }),
  });
  if (p.response_type !== "code") return back("unsupported_response_type", "response_type must be code");
  if (!p.code_challenge || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_challenge)) {
    return back("invalid_request", "a PKCE code_challenge is required");
  }
  if (p.code_challenge_method !== "S256") return back("invalid_request", "code_challenge_method must be S256");
  // One scope per grant: "mcp" (the default) or "app"; the resource follows it.
  const scopes = (p.scope ?? "").split(" ").filter(Boolean);
  const wanted = p.resource?.replace(/\/$/, "");
  const scope = scopes[0] ?? (wanted === apiResourceUrl(origin) ? APP_SCOPE : SCOPE);
  if (scopes.length > 1 || (scope !== SCOPE && scope !== APP_SCOPE)) {
    return back("invalid_scope", `the scope is "${SCOPE}" or "${APP_SCOPE}"`);
  }
  const resource = scope === APP_SCOPE ? apiResourceUrl(origin) : resourceUrl(origin);
  if (wanted && wanted !== resource) {
    return back("invalid_target", `resource must be ${resource}`);
  }
  return {
    ok: true,
    request: { client, redirectUri, state: p.state, codeChallenge: p.code_challenge, resource, scope },
  };
}

function redirectWith(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

export function consentView(request: ValidRequest, user: AuthUser): OAuthRequestView {
  return {
    client: {
      name: request.client.clientName,
      uri: request.client.clientUri,
      redirectHost: new URL(request.redirectUri).host,
    },
    username: user.username,
  };
}

/** Allow → a one-time code; deny → access_denied. Returns where to send the browser. */
export function decide(request: ValidRequest, user: AuthUser, approve: boolean, origin: string): string {
  if (!approve) {
    return redirectWith(request.redirectUri, {
      error: "access_denied",
      error_description: "the user denied access",
      state: request.state,
      iss: origin,
    });
  }
  const code = random();
  db.insert(schema.oauthCodes)
    .values({
      codeHash: hash(code),
      clientId: request.client.clientId,
      userId: user.id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      resource: request.resource,
      scope: request.scope,
      expiresAt: now() + CODE_TTL_S,
    })
    .run();
  return redirectWith(request.redirectUri, { code, state: request.state, iss: origin });
}

// --- token endpoint ----------------------------------------------------------

function sameSecret(given: string, storedHash: string): boolean {
  const a = Buffer.from(hash(given), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Client authentication: client_secret_basic, client_secret_post, or none. */
export function authenticateClient(body: Record<string, string>, authorization: string | undefined): Client {
  let clientId = body.client_id;
  let secret = body.client_secret;
  const basic = authorization && /^Basic\s+(\S+)$/i.exec(authorization);
  if (basic) {
    const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) throw new OAuthError("invalid_client", "malformed Basic credentials", 401);
    clientId = decodeURIComponent(decoded.slice(0, i));
    secret = decodeURIComponent(decoded.slice(i + 1));
  }
  const client = clientId ? getClient(clientId) : undefined;
  if (!client) throw new OAuthError("invalid_client", "unknown client", 401);
  if (client.secretHash && !(secret && sameSecret(secret, client.secretHash))) {
    throw new OAuthError("invalid_client", "client authentication failed", 401);
  }
  return client;
}

function issue(grantId: number, scope: string) {
  const access = ACCESS_PREFIX + random();
  const refresh = REFRESH_PREFIX + random();
  db.update(schema.oauthGrants)
    .set({
      accessHash: hash(access),
      accessExpiresAt: now() + ACCESS_TTL_S,
      refreshHash: hash(refresh),
      refreshExpiresAt: now() + REFRESH_TTL_S,
    })
    .where(eq(schema.oauthGrants.id, grantId))
    .run();
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope,
  };
}

export function exchangeCode(client: Client, body: Record<string, string>) {
  const { code, code_verifier: verifier, redirect_uri: redirectUri, resource } = body;
  if (!code || !verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
  const row = db.select().from(schema.oauthCodes).where(eq(schema.oauthCodes.codeHash, hash(code))).get();
  // Single use, whatever happens next.
  if (row) db.delete(schema.oauthCodes).where(eq(schema.oauthCodes.codeHash, row.codeHash)).run();
  if (!row || row.expiresAt < now() || row.clientId !== client.clientId) {
    throw new OAuthError("invalid_grant", "the code is invalid, expired or already used");
  }
  if ((redirectUri ?? row.redirectUri) !== row.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request");
  }
  if (createHash("sha256").update(verifier).digest("base64url") !== row.codeChallenge) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }
  if (resource && resource.replace(/\/$/, "") !== row.resource) {
    throw new OAuthError("invalid_target", `resource must be ${row.resource}`);
  }
  const res = db
    .insert(schema.oauthGrants)
    .values({
      userId: row.userId,
      clientId: client.clientId,
      scope: row.scope,
      resource: row.resource,
      // Placeholders, replaced by issue() right away.
      accessHash: `pending-a-${random()}`,
      accessExpiresAt: 0,
      refreshHash: `pending-r-${random()}`,
      refreshExpiresAt: 0,
    })
    .run();
  return issue(Number(res.lastInsertRowid), row.scope);
}

export function refresh(client: Client, body: Record<string, string>) {
  const token = body.refresh_token;
  if (!token) throw new OAuthError("invalid_request", "refresh_token is required");
  const grant = db
    .select({
      id: schema.oauthGrants.id,
      clientId: schema.oauthGrants.clientId,
      scope: schema.oauthGrants.scope,
      exp: schema.oauthGrants.refreshExpiresAt,
      disabled: schema.users.disabled,
    })
    .from(schema.oauthGrants)
    .innerJoin(schema.users, eq(schema.users.id, schema.oauthGrants.userId))
    .where(eq(schema.oauthGrants.refreshHash, hash(token)))
    .get();
  if (!grant || grant.clientId !== client.clientId || grant.exp < now() || grant.disabled) {
    throw new OAuthError("invalid_grant", "the refresh token is invalid or expired");
  }
  return issue(grant.id, grant.scope);
}

/** RFC 7009: revoke the grant behind an access or refresh token. Always "succeeds". */
export function revoke(client: Client, token: string | undefined): void {
  if (!token) return;
  const h = hash(token);
  db.delete(schema.oauthGrants)
    .where(
      and(
        eq(schema.oauthGrants.clientId, client.clientId),
        or(eq(schema.oauthGrants.accessHash, h), eq(schema.oauthGrants.refreshHash, h)),
      ),
    )
    .run();
}

// --- resource server ---------------------------------------------------------

export const looksLikeAccessToken = (s: string) => s.startsWith(ACCESS_PREFIX);

/** The active user behind an access token for this resource (URL), or null. */
export function userFromAccessToken(token: string, resource: string): AuthUser | null {
  const row = db
    .select({
      grantId: schema.oauthGrants.id,
      exp: schema.oauthGrants.accessExpiresAt,
      resource: schema.oauthGrants.resource,
      lastUsedAt: schema.oauthGrants.lastUsedAt,
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      disabled: schema.users.disabled,
    })
    .from(schema.oauthGrants)
    .innerJoin(schema.users, eq(schema.users.id, schema.oauthGrants.userId))
    .where(eq(schema.oauthGrants.accessHash, hash(token)))
    .get();
  if (!row || row.exp < now() || row.disabled || row.resource !== resource) return null;
  if (!row.lastUsedAt || now() - row.lastUsedAt > 60) {
    db.update(schema.oauthGrants).set({ lastUsedAt: now() }).where(eq(schema.oauthGrants.id, row.grantId)).run();
  }
  return { id: row.id, username: row.username, role: row.role };
}

// --- connected apps (Settings) -------------------------------------------------

export function listGrants(userId: number): OAuthGrantView[] {
  return db
    .select({
      id: schema.oauthGrants.id,
      clientName: schema.oauthClients.clientName,
      clientUri: schema.oauthClients.clientUri,
      createdAt: schema.oauthGrants.createdAt,
      lastUsedAt: schema.oauthGrants.lastUsedAt,
    })
    .from(schema.oauthGrants)
    .innerJoin(schema.oauthClients, eq(schema.oauthClients.clientId, schema.oauthGrants.clientId))
    .where(eq(schema.oauthGrants.userId, userId))
    .orderBy(schema.oauthGrants.id)
    .all();
}

export function deleteGrant(userId: number, id: number): void {
  db.delete(schema.oauthGrants)
    .where(and(eq(schema.oauthGrants.id, id), eq(schema.oauthGrants.userId, userId)))
    .run();
}

/** Expired codes and grants; registered clients unused for 30 days. */
export function pruneOAuth(): void {
  db.delete(schema.oauthCodes).where(lte(schema.oauthCodes.expiresAt, now())).run();
  db.delete(schema.oauthGrants).where(lte(schema.oauthGrants.refreshExpiresAt, now())).run();
  db.delete(schema.oauthClients)
    .where(
      and(
        lt(schema.oauthClients.createdAt, now() - REFRESH_TTL_S),
        sql`NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = ${schema.oauthClients.clientId})`,
      ),
    )
    .run();
}
