import { afterEach, beforeEach, expect, test } from "bun:test";
import { OutboundAddressError } from "@agenteschat/adapters";
import { schema } from "@agenteschat/db";
import {
  allowPrivateOutbound,
  type ConnectorDeps,
  connectionHeaders,
  connectOverHttp,
  createWebToolSource,
  storeCustomConnection,
  type ToolContext,
  testStorage,
} from "../src";
import { type Fixture, setup } from "./fixtures";

// An address a workspace named is checked when it is saved and again as every request connects: a name that
// was public then and answers with an address on this server's network now gets no request at all.

const PUBLIC = "93.184.216.34";
const PRIVATE = "10.0.0.5";

let f: Fixture | undefined;
let plainFetches: string[];
const realFetch = globalThis.fetch;

beforeEach(() => {
  // A server started earlier in this process may have left the switch on.
  allowPrivateOutbound(false);
  plainFetches = [];
  // Nothing here may fall back to the unpinned fetch.
  globalThis.fetch = (async (input: string | URL | Request) => {
    plainFetches.push(String(input instanceof Request ? input.url : input));
    throw new TypeError("no network in tests");
  }) as unknown as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  const current = f;
  f = undefined;
  await current?.close();
});

/** A custom server signed in with OAuth whose access token is about to expire, so the next use refreshes it. */
async function expiringConnection() {
  f = await setup();
  const [client] = await f.db
    .insert(schema.oauthClients)
    .values({
      orgId: f.org.id,
      issuer: "https://auth.tickets.example.com",
      authorizationEndpoint: "https://auth.tickets.example.com/authorize",
      tokenEndpoint: "https://auth.tickets.example.com/token",
      clientId: "dcr-client-1",
      tokenAuthMethod: "none",
    })
    .returning();
  const base = { db: f.db, keyWrappers: [f.keyWrapper], publicUrl: "https://chat.example.com" };
  const saving: ConnectorDeps = {
    ...base,
    http: (async () => Response.json({})) as unknown as typeof fetch,
    resolveHost: async () => [PUBLIC],
  };
  const { connection } = await storeCustomConnection(saving, {
    orgId: f.org.id,
    actorId: f.owner.id,
    serverUrl: "https://tickets.example.com/mcp",
    label: "Tickets",
    authType: "oauth",
    secret: { accessToken: "at-1", refreshToken: "rt-1" },
    tokenExpiresAt: new Date(Date.now() + 5_000),
    oauthClientId: client?.id,
    resource: "https://tickets.example.com/mcp",
  });
  return { base, connection };
}

test("an MCP OAuth refresh never posts its tokens to a token endpoint that moved to a private address", async () => {
  const { base, connection } = await expiringConnection();
  const resolved: string[] = [];
  const later: ConnectorDeps = {
    ...base,
    resolveHost: async (host) => {
      resolved.push(host);
      return [PRIVATE];
    },
  };
  const refusal = await connectionHeaders(later, connection).then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(OutboundAddressError);
  expect(resolved).toEqual(["auth.tickets.example.com"]);
  expect(plainFetches).toEqual([]);
}, 30_000);

test("an MCP OAuth refresh never follows a redirect from the token endpoint", async () => {
  const { base, connection } = await expiringConnection();
  const posted: RequestInit[] = [];
  const http = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    posted.push(init);
    return Response.json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 });
  }) as unknown as typeof fetch;
  await connectionHeaders({ ...base, http, resolveHost: async () => [PUBLIC] }, connection);
  expect(posted).toHaveLength(1);
  expect(String(posted[0]?.body)).toContain("refresh_token=rt-1");
  expect(posted[0]?.redirect).toBe("error");
}, 30_000);

test("a workspace's own bucket: the bucket's host is checked too, not only the endpoint", async () => {
  f = await setup();
  const dns: Record<string, string[]> = { "s3.files.example.com": [PUBLIC], "inner.s3.files.example.com": [PRIVATE] };
  const resolved: string[] = [];
  const result = await testStorage(
    {
      ...f.storage,
      fetch: undefined,
      resolveHost: async (host) => {
        resolved.push(host);
        return dns[host] ?? [PUBLIC];
      },
    },
    f.owner.id,
    f.org.id,
    {
      endpoint: "https://s3.files.example.com",
      region: "us-east-1",
      bucket: "inner",
      prefix: null,
      pathStyle: false,
      accessKeyId: "AKIAFAKE",
      secretAccessKey: "fake-secret-not-real",
    },
  );
  expect(result.ok).toBe(false);
  expect(result.steps[0]).toMatchObject({ step: "write", ok: false });
  expect(resolved).toContain("inner.s3.files.example.com");
  expect(plainFetches).toEqual([]);
}, 30_000);

test("web_fetch connects only to the address it checked", async () => {
  // Public for the check before the request, private when the request itself resolves the name.
  const answers = [[PUBLIC], [PRIVATE]];
  const source = createWebToolSource({ resolveHost: async () => answers.shift() ?? [PRIVATE] });
  const ctx = { orgId: "o", agentId: "a", runId: "r" } as unknown as ToolContext;
  const tool = (await source.tools(ctx)).find((t) => t.name === "web_fetch");
  const out = await tool?.execute({ url: "https://moving.example.com/" }, ctx);
  expect(out?.isError).toBe(true);
  expect(answers).toEqual([]);
  expect(plainFetches).toEqual([]);
});

test("an MCP session is never opened to an address on this server's network", async () => {
  for (const serverUrl of ["https://127.0.0.1/mcp", "https://mcp.localhost/mcp", "http://tickets.example.com/mcp"]) {
    const opened = await connectOverHttp({ serverUrl }, { authorization: "Bearer tk_fake" }).then(
      (session) => session,
      () => null,
    );
    expect(opened).toBeNull();
  }
  expect(plainFetches).toEqual([]);
});
