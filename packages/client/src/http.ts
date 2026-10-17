/**
 * The bits of fetch the client uses, typed structurally so neither the DOM nor
 * React Native typings are needed: the browser's fetch and expo/fetch both fit.
 */
export type RequestInitLike = {
  method?: string;
  headers?: Record<string, string>;
  /** JSON text, or raw bytes (a File or Blob) sent with their own content type. */
  body?: string | object;
  signal?: unknown;
  keepalive?: boolean;
};

export type ByteReader = { read(): Promise<{ done: boolean; value?: Uint8Array }> };

export type ResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<any>;
  body: { getReader(): ByteReader } | null;
};

export type FetchLike = (url: string, init: RequestInitLike) => Promise<ResponseLike>;

export type ClientOptions = {
  /** The server's origin, e.g. "https://wort.example.com"; "" for same-origin. */
  baseUrl?: string;
  /**
   * Does the request. The web wraps window.fetch to send its session cookie;
   * the app passes expo/fetch.
   */
  fetch: FetchLike;
  /** Extra headers on every request, e.g. a bearer token in the app. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /**
   * A request got 401: try to fix it (the app refreshes its token) and say
   * whether to send it again. Each request is retried at most once.
   */
  onUnauthorized?: () => Promise<boolean>;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The error a non-2xx answer becomes; 401 is always "unauthenticated". */
export async function errorFrom(res: ResponseLike): Promise<ApiError> {
  if (res.status === 401) return new ApiError(401, "unauthenticated");
  let message = res.statusText;
  try {
    message = (await res.json()).error ?? message;
  } catch {
    /* ignore */
  }
  return new ApiError(res.status, message);
}

export type Http = {
  /** An absolute URL for a server path (for media: covers, clips, EPUBs). */
  url(path: string): string;
  /** A JSON request; resolves with the parsed body (undefined for 204). */
  req<T>(path: string, init?: RequestInitLike): Promise<T>;
  /** The raw response for a request that streams (SSE); throws on non-2xx. */
  stream(path: string, init: RequestInitLike): Promise<ResponseLike>;
};

export function createHttp(o: ClientOptions): Http {
  const base = (o.baseUrl ?? "").replace(/\/+$/, "");
  const url = (path: string) => base + path;
  const send = async (path: string, init: RequestInitLike = {}, retry = true): Promise<ResponseLike> => {
    // Only advertise a JSON body when we actually send one — Fastify rejects an
    // empty body sent with content-type: application/json (e.g. DELETE requests).
    const headers: Record<string, string> = {
      ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
      ...(o.headers ? await o.headers() : {}),
      ...(init.headers ?? {}),
    };
    const res = await o.fetch(url(path), { ...init, headers });
    if (res.status === 401 && retry && o.onUnauthorized && (await o.onUnauthorized())) {
      return send(path, init, false);
    }
    return res;
  };
  return {
    url,
    async req<T>(path: string, init?: RequestInitLike): Promise<T> {
      const res = await send(path, init);
      if (!res.ok) throw await errorFrom(res);
      if (res.status === 204) return undefined as T;
      return res.json() as Promise<T>;
    },
    async stream(path, init) {
      const res = await send(path, init);
      if (!res.ok || !res.body) throw await errorFrom(res);
      return res;
    },
  };
}
