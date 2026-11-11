import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { countQueries, eq, schema, sql } from "@agenteschat/db";
import { runMigration } from "@agenteschat/db/testing";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  acceptCustomSuggestion,
  accountFrom,
  ConflictError,
  type CustomDeps,
  completeOAuth,
  connectCustomServer,
  connectionHeaders,
  connectorGrantValidator,
  createConnectorToolSource,
  createToolGateway,
  DIRECTORY_MAX_TOOLS,
  getAgentAccess,
  listAudit,
  listCustomServers,
  type McpConnect,
  mcpPreset,
  mcpSessionOver,
  postPersonMessage,
  presentTools,
  refreshCustomServer,
  renameConnection,
  revokeConnection,
  saveCustomTools,
  setAgentAccess,
  setAgentScopes,
  storeCustomConnection,
  suggestFor,
  syncCustomTools,
  type ToolDefinition,
  ValidationError,
  wrapExternal,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  // Some tests don't set up a database: close each one once.
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const SERVER = "https://tickets.example.com/mcp";

/** An in-process MCP server with a read-only tool and a write tool; `extra` adds one on demand. */
function ticketsMcp() {
  const state = { extra: false, calls: [] as string[], headers: [] as Record<string, string>[] };
  const build = () => {
    const server = new McpServer({ name: "tickets", version: "1" });
    server.registerTool(
      "list_tickets",
      { description: "List open tickets", inputSchema: {}, annotations: { readOnlyHint: true } },
      async () => {
        state.calls.push("list_tickets");
        return { content: [{ type: "text", text: "#1 login broken" }] };
      },
    );
    server.registerTool(
      "close_ticket",
      { description: "Close a ticket", inputSchema: { id: z.number() } },
      async (args) => {
        state.calls.push(`close_ticket ${args.id}`);
        return { content: [{ type: "text", text: `closed #${args.id}` }] };
      },
    );
    if (state.extra) {
      server.registerTool("reopen_ticket", { description: "Reopen", inputSchema: { id: z.number() } }, async () => ({
        content: [{ type: "text", text: "reopened" }],
      }));
    }
    return server;
  };
  const connect: McpConnect = async (_connection, headers) => {
    state.headers.push(headers);
    const [client, server] = InMemoryTransport.createLinkedPair();
    await build().connect(server);
    return mcpSessionOver(client);
  };
  return { connect, state };
}

/**
 * Fake HTTP for MCP-native OAuth: the MCP endpoint answers 401 pointing at its
 * protected-resource metadata; the authorization server has RFC 8414 metadata,
 * dynamic registration (`register` answers it instead, `registration: false`
 * leaves it out) and a token endpoint that checks PKCE and `resource`.
 */
function oauthServer(
  options: {
    metadata?: boolean;
    tokenHost?: string;
    registration?: boolean;
    register?: (body: { client_name: string; token_endpoint_auth_method: string }) => Response;
    /** The protected resource's `scopes_supported` (default `tickets`; empty leaves it out). */
    scopes?: string[];
    /** The authorization server's `scopes_supported` and `token_endpoint_auth_methods_supported`. */
    serverScopes?: string[];
    authMethods?: string[];
    /** Each refresh token works once, and a refresh gives a new one, good for an hour. */
    rotate?: boolean;
  } = {},
) {
  const seen = {
    registrations: 0,
    names: [] as string[],
    authMethods: [] as string[],
    registeredScopes: [] as (string | undefined)[],
    tokenForms: [] as URLSearchParams[],
    tokenAuth: [] as (string | null)[],
    challenge: "",
    refreshToken: "",
  };
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.toString() === SERVER && method === "POST") {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            options.metadata === false
              ? 'Bearer realm="x"'
              : 'Bearer resource_metadata="https://tickets.example.com/.well-known/oauth-protected-resource/mcp"',
        },
      });
    }
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      if (options.metadata === false) return new Response("nope", { status: 404 });
      const scopes = options.scopes ?? ["tickets"];
      return Response.json({
        resource: SERVER,
        authorization_servers: ["https://auth.example.com"],
        ...(scopes.length > 0 ? { scopes_supported: scopes } : {}),
      });
    }
    if (url.toString() === "https://auth.example.com/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: `https://${options.tokenHost ?? "auth.example.com"}/token`,
        ...(options.registration === false ? {} : { registration_endpoint: "https://auth.example.com/register" }),
        code_challenge_methods_supported: ["S256"],
        ...(options.serverScopes ? { scopes_supported: options.serverScopes } : {}),
        ...(options.authMethods ? { token_endpoint_auth_methods_supported: options.authMethods } : {}),
      });
    }
    if (url.toString() === "https://auth.example.com/register") {
      seen.registrations++;
      const body = JSON.parse(String(init?.body)) as {
        client_name: string;
        redirect_uris: string[];
        token_endpoint_auth_method: string;
        scope?: string;
      };
      seen.names.push(body.client_name);
      seen.authMethods.push(body.token_endpoint_auth_method);
      seen.registeredScopes.push(body.scope);
      expect(body.redirect_uris).toEqual(["https://chat.example.com/api/app/connectors/oauth/callback"]);
      return options.register?.(body) ?? Response.json({ client_id: "dcr-client-1" }, { status: 201 });
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(String(init?.body));
      seen.tokenForms.push(form);
      seen.tokenAuth.push(new Headers(init?.headers).get("authorization"));
      if (form.get("grant_type") === "authorization_code") {
        const ok =
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") === seen.challenge;
        if (!ok || form.get("resource") !== SERVER) return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const n = seen.tokenForms.length;
      if (!options.rotate) return Response.json({ access_token: `at-${n}`, refresh_token: "rt", expires_in: 30 });
      const refresh = form.get("grant_type") === "refresh_token";
      if (refresh && form.get("refresh_token") !== seen.refreshToken) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      seen.refreshToken = `rt-${n}`;
      return Response.json({
        access_token: `at-${n}`,
        refresh_token: seen.refreshToken,
        expires_in: refresh ? 3600 : 30,
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { http, seen };
}

const publicDns = async (host: string) => (host.endsWith("example.com") ? ["93.184.216.34"] : ["10.0.0.9"]);

const STRIPE = "https://mcp.stripe.com";

/**
 * Stripe's MCP server as far as accounts go: an OAuth session lists the accounts its sign-in reaches, here the key's
 * (`rk_<account>_…`, live mode). `reach` says which account a key reaches; `down` makes the listing fail.
 */
function stripeMcp() {
  const state = {
    calls: [] as { tool: string; key: string }[],
    reach: {
      acme: { stripe_context: "acct_acme", livemode: true, name: "Acme" },
      loja: { stripe_context: "acct_loja", livemode: true, name: "Loja B" },
    } as Record<string, { stripe_context: string; livemode: boolean; name: string }>,
    down: false,
  };
  const connect: McpConnect = async (_connection, headers) => {
    const key = (headers.authorization ?? "").replace(/^Bearer /, "");
    const account = state.reach[key.split("_")[1] ?? ""];
    const server = new McpServer({ name: "stripe", version: "1" });
    server.registerTool(
      "list_available_accounts_or_orgs",
      {
        description: "Lists all Stripe accounts in this session",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () =>
        state.down
          ? { content: [{ type: "text", text: "Service unavailable" }], isError: true }
          : { content: [{ type: "text", text: JSON.stringify({ accounts: account ? [account] : [] }) }] },
    );
    server.registerTool(
      "list_customers",
      { description: "List customers", inputSchema: {}, annotations: { readOnlyHint: true } },
      async () => {
        state.calls.push({ tool: "list_customers", key });
        return { content: [{ type: "text", text: `customers of ${account?.stripe_context}` }] };
      },
    );
    const [client, transport] = InMemoryTransport.createLinkedPair();
    await server.connect(transport);
    return mcpSessionOver(client);
  };
  return { connect, state };
}

async function connectStripe(deps: CustomDeps, apiKey: string, connectionId?: string) {
  const res = await connectCustomServer(deps, f.owner.id, f.org.id, {
    serverUrl: STRIPE,
    apiKey,
    label: "Stripe",
    ...(connectionId ? { connectionId } : {}),
  });
  if (res.status !== "connected") throw new Error(`expected connected, got ${res.status}`);
  return res;
}

/** A run of the fixture's agent, for the gateway. */
async function runContext(fx: Fixture) {
  const msg = await postPersonMessage({ db: fx.db, pubsub: fx.pubsub }, fx.owner.id, fx.org.id, fx.general.id, {
    body: "x",
  });
  const [run] = await fx.db
    .insert(schema.agentRuns)
    .values({
      orgId: fx.org.id,
      agentId: fx.agent.id,
      channelId: fx.general.id,
      threadRootId: msg.id,
      triggerMessageId: msg.id,
      trigger: "mention",
      hop: 1,
    })
    .returning();
  return {
    db: fx.db,
    orgId: fx.org.id,
    agentId: fx.agent.id,
    runId: run?.id ?? "",
    channelId: fx.general.id,
    threadRootId: msg.id,
    triggerMessageId: msg.id,
  };
}

function depsOf(fx: Fixture, extra: Partial<CustomDeps> = {}): CustomDeps {
  return {
    db: fx.db,
    keyWrappers: [fx.keyWrapper],
    publicUrl: "https://chat.example.com",
    resolveHost: publicDns,
    ...extra,
  };
}

/** Connects SERVER over the fake's OAuth: the authorize URL it went through and the connection. */
async function signIn(deps: CustomDeps, auth: ReturnType<typeof oauthServer>) {
  const started = await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER });
  if (started.status !== "oauth") throw new Error(`expected oauth, got ${started.status}`);
  const url = new URL(started.authorizeUrl);
  auth.seen.challenge = url.searchParams.get("code_challenge") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const { connection } = await completeOAuth(deps, { id: f.owner.id }, { state, code: "code-1" });
  return { url, connection };
}

describe("custom MCP servers", () => {
  test("Supabase (read-only): its execute_sql is suggested as read; other tools keep our usual suggestion", async () => {
    expect(suggestFor({ name: "execute_sql" }, ["execute_sql"])).toBe("read");
    // An ambiguous name: the judge decides when listing; by the rules alone, ask first.
    expect(suggestFor({ name: "execute_sql" })).toBe("approval");
    expect(suggestFor({ name: "apply_migration" }, ["execute_sql"])).toBe("write");
    expect(suggestFor({ name: "delete_branch" }, ["execute_sql"])).toBe("approval");
  });

  test("an address's path and query go only to who manages connectors: members and the audit log get its origin", async () => {
    f = await setup();
    const member = await addMember(f.db, f.org.id, "member", "reader");
    const deps = depsOf(f, {
      resolveHost: async () => ["93.184.216.34"],
      // It answers without asking for a sign-in: the address is all it takes to call it.
      http: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connect: async () => {
        throw new Error("offline in tests");
      },
    });
    const address = "https://mcp.example.com/api/s/fake-path-token/mcp?key=fake-query-token";
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: address, label: "Tools" });
    if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
    expect(started.server.serverUrl).toBe(address);
    expect((await listCustomServers(f.db, f.owner.id, f.org.id))[0]?.serverUrl).toBe(address);

    const seen = await listCustomServers(f.db, member.id, f.org.id);
    expect(seen.map((s) => [s.label, s.serverUrl])).toEqual([["Tools", "https://mcp.example.com"]]);
    expect(JSON.stringify(seen)).not.toContain("fake-");
    const audit = await f.db.select().from(schema.auditLog);
    expect(audit.some((row) => row.action === "connector.custom_connected")).toBe(true);
    expect(JSON.stringify(audit.map((row) => row.details))).not.toContain("fake-");

    // A row stored with the whole address is listed with its origin.
    await f.db
      .update(schema.auditLog)
      .set({ details: { serverUrl: address, label: "Tools" } })
      .where(eq(schema.auditLog.action, "connector.custom_connected"));
    const listed = (await listAudit(f.db, f.owner.id, f.org.id)).rows.find(
      (row) => row.action === "connector.custom_connected",
    );
    expect(listed?.details.serverUrl).toBe("https://mcp.example.com");

    // An address the catalog publishes carries no secret, and the apps match it to its entry: it stays whole.
    const linear = mcpPreset("linear")?.serverUrl ?? "";
    await storeCustomConnection(deps, {
      orgId: f.org.id,
      actorId: f.owner.id,
      serverUrl: linear,
      label: "Linear",
      authType: "none",
      secret: null,
    });
    expect((await listCustomServers(f.db, member.id, f.org.id)).map((s) => s.serverUrl)).toEqual([
      "https://mcp.example.com",
      linear,
    ]);
  });

  test("a preset's connection keeps its URL (query and all) and our usual suggestions", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect, resolveHost: async () => ["93.184.216.34"] });
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: "https://mcp.supabase.com/mcp?read_only=true&features=database,docs,debugging",
      apiKey: "sbp_secret_12345",
      label: "Supabase",
    });
    if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
    expect(started.server.serverUrl).toBe(
      "https://mcp.supabase.com/mcp?read_only=true&features=database,docs,debugging",
    );
    expect(started.server.tools.map((t) => [t.name, t.suggestedAccess])).toEqual([
      ["close_ticket", "approval"],
      ["list_tickets", "read"],
    ]);
    // Its tools count under the preset's id (ADR 0103).
    await acceptCustomSuggestion(deps, f.owner.id, f.org.id, started.server.id);
    const ctx = {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: "",
      channelId: f.general.id,
      threadRootId: "",
      triggerMessageId: "",
    };
    const tools = await createConnectorToolSource({ ...deps, connect: mcp.connect }).tools(ctx);
    expect(tools.map((t) => t.connector)).toEqual([
      { key: "supabase-readonly", via: "mcp", tool: "close_ticket" },
      { key: "supabase-readonly", via: "mcp", tool: "list_tickets" },
    ]);
  });

  test("API key: tools come in unclassified and hidden; classified ones reach the agent with our scopes", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect });
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_secret_12345",
      label: "Tickets",
    });
    if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
    const server = started.server;
    expect(server).toMatchObject({ label: "Tickets", authType: "api_key", reviewedAt: null });
    expect(server.tools.map((t) => [t.name, t.access, t.readOnlyHint])).toEqual([
      ["close_ticket", null, null],
      ["list_tickets", null, true],
    ]);
    expect(JSON.stringify(await f.db.select().from(schema.connectorConnections))).not.toContain("tk_secret_12345");
    // A new server is every agent's, whole: its tools reach them once classified (below).
    expect(
      (await f.db.select().from(schema.agentScopes))
        .filter((g) => g.connectionId === server.id)
        .map((g) => [g.agentId, g.scope]),
    ).toEqual([[f.agent.id, "connector:*"]]);

    const source = createConnectorToolSource({ ...deps, connect: mcp.connect });
    const gateway = createToolGateway({ sources: [source] });
    // Steps and approvals need a real run.
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "x",
    });
    const [run] = await f.db
      .insert(schema.agentRuns)
      .values({
        orgId: f.org.id,
        agentId: f.agent.id,
        channelId: f.general.id,
        threadRootId: msg.id,
        triggerMessageId: msg.id,
        trigger: "mention",
        hop: 1,
      })
      .returning();
    const ctx = {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run?.id ?? "",
      channelId: f.general.id,
      threadRootId: msg.id,
      triggerMessageId: msg.id,
    };
    expect(await source.tools(ctx)).toEqual([]); // nothing classified yet
    // Not even `all` shows unclassified tools.
    const none = { all: false, connectors: {}, scopes: [], tools: { allow: [], deny: [] } };
    await setAgentAccess(f.db, f.owner.id, f.org.id, f.agent.id, { ...none, all: true });
    expect(await gateway.list(ctx)).toEqual([]);
    await setAgentAccess(f.db, f.owner.id, f.org.id, f.agent.id, none);

    await saveCustomTools(deps, f.owner.id, f.org.id, server.id, {
      label: "Suporte",
      tools: [
        { name: "list_tickets", access: "read", label: "Listar chamados" },
        { name: "close_ticket", access: "approval", label: "Fechar chamado" },
      ],
    });
    // The icon the server gave is its calls' logo in the chat.
    const icon = `/api/app/connector-icons/${f.org.id}/${server.id}/0123456789abcdef.png`;
    await f.db.update(schema.connectorConnections).set({ icon }).where(eq(schema.connectorConnections.id, server.id));
    const offered = await source.tools(ctx);
    expect(offered.map((t) => [t.name, t.scope, t.sensitive, t.serviceIcon])).toEqual([
      ["tickets_close_ticket", `custom:${server.id}:write`, true, icon],
      ["tickets_list_tickets", `custom:${server.id}:read`, false, icon],
    ]);
    // Keyed by the server's hostname alone, never the label (ADR 0103). The count keeps none of its tool names.
    expect(offered.map((t) => t.connector)).toEqual([
      { key: "tickets.example.com", via: "mcp", tool: "close_ticket" },
      { key: "tickets.example.com", via: "mcp", tool: "list_tickets" },
    ]);
    // The agent sees them only with grants.
    expect(await gateway.list(ctx)).toEqual([]);
    await setAgentScopes(
      f.db,
      f.owner.id,
      f.org.id,
      f.agent.id,
      [
        { connectionId: server.id, scope: `custom:${server.id}:read` },
        { connectionId: server.id, scope: `custom:${server.id}:write` },
      ],
      connectorGrantValidator,
    );
    expect((await gateway.list(ctx)).map((t) => t.name).sort()).toEqual([
      "tickets_close_ticket",
      "tickets_list_tickets",
    ]);
    const read = await gateway.invoke(ctx, { toolUseId: "t1", name: "tickets_list_tickets", input: {} });
    expect(read).toMatchObject({
      type: "result",
      output: { content: wrapExternal("tickets_list_tickets", "#1 login broken") },
    });
    const write = await gateway.invoke(ctx, {
      toolUseId: "t2",
      name: "tickets_close_ticket",
      input: { id: 1, why: "The checks passed and the change was reviewed: this action finishes what was asked." },
    });
    expect(write.type).toBe("approval");
    if (write.type === "approval") expect(write.approval.title).toBe("Suporte: Fechar chamado");
    expect(mcp.state.calls).toEqual(["list_tickets"]);
    expect(mcp.state.headers.at(-1)).toEqual({ authorization: "Bearer tk_secret_12345" });

    // Unknown scopes for this server are refused.
    await expect(
      setAgentScopes(
        f.db,
        f.owner.id,
        f.org.id,
        f.agent.id,
        [{ connectionId: server.id, scope: "custom:other:read" }],
        connectorGrantValidator,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // A new tool on the server comes back unclassified and stays hidden.
    mcp.state.extra = true;
    const refreshed = await refreshCustomServer(deps, f.owner.id, f.org.id, server.id);
    expect(refreshed.tools.find((t) => t.name === "reopen_ticket")?.access).toBeNull();

    // Turned off: never offered, not waiting for review, and the suggestion doesn't turn it back on.
    const off = await saveCustomTools(deps, f.owner.id, f.org.id, server.id, {
      label: "Suporte",
      tools: [{ name: "close_ticket", access: "off", label: "Fechar chamado" }],
    });
    expect(off.tools.find((t) => t.name === "close_ticket")?.access).toBe("off");
    expect((await source.tools(ctx)).map((t) => t.name)).toEqual(["tickets_list_tickets"]);
    const accepted = await acceptCustomSuggestion(deps, f.owner.id, f.org.id, server.id);
    expect(accepted.server.tools.find((t) => t.name === "close_ticket")?.access).toBe("off");
    expect(accepted.server.tools.find((t) => t.name === "reopen_ticket")?.access).not.toBeNull();
  });

  test("Semrush's key goes as `Authorization: Apikey <key>`, to its v2 server (other keys stay Bearer)", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect, resolveHost: async () => ["93.184.216.34"] });
    const serverUrl = mcpPreset("semrush")?.serverUrl ?? "";
    expect(serverUrl).toBe("https://mcp.semrush.com/v2/mcp");
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl,
      apiKey: "fake_semrush_key",
      label: "Semrush",
    });
    expect(started.status).toBe("connected");
    expect(mcp.state.headers.at(-1)).toEqual({ authorization: "Apikey fake_semrush_key" });
  });

  test("on the Cloud a `cloudOAuthOnly` server refuses a key; a self-hosted server takes it", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const serverUrl = mcpPreset("intercom")?.serverUrl ?? "";
    const input = { serverUrl, apiKey: "fake_intercom_key", label: "Intercom" };
    const cloud = depsOf(f, {
      connect: mcp.connect,
      publicUrl: "https://agentes.chat",
      resolveHost: async () => ["93.184.216.34"],
    });
    await expect(connectCustomServer(cloud, f.owner.id, f.org.id, input)).rejects.toMatchObject({
      code: "connector.oauth_only",
    });
    const self = depsOf(f, { connect: mcp.connect, resolveHost: async () => ["93.184.216.34"] });
    expect((await connectCustomServer(self, f.owner.id, f.org.id, input)).status).toBe("connected");
  });

  test("Reconectar: a new key in place, the same id, name, tools and grants; at another address it's refused", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect });
    const first = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_old_12345",
      label: "Tickets",
    });
    if (first.status !== "connected") throw new Error(`expected connected, got ${first.status}`);
    expect(first.outcome).toBe("connected");
    const id = first.server.id;
    await saveCustomTools(deps, f.owner.id, f.org.id, id, {
      label: "Suporte",
      tools: [{ name: "list_tickets", access: "read", label: "Listar chamados" }],
    });
    await setAgentScopes(
      f.db,
      f.owner.id,
      f.org.id,
      f.agent.id,
      [{ connectionId: id, scope: `custom:${id}:read` }],
      connectorGrantValidator,
    );

    const again = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_new_12345",
      label: "Tickets",
      connectionId: id,
    });
    if (again.status !== "connected") throw new Error(`expected connected, got ${again.status}`);
    expect(again.outcome).toBe("reconnected");
    expect(again.server.id).toBe(id);
    expect(again.server.label).toBe("Suporte");
    expect(again.server.tools.find((t) => t.name === "list_tickets")?.access).toBe("read");
    expect(await f.db.select().from(schema.connectorConnections)).toHaveLength(1);
    const grants = await f.db.select().from(schema.agentScopes);
    expect(grants.filter((g) => g.connectionId === id).map((g) => g.scope)).toEqual([`custom:${id}:read`]);
    expect(mcp.state.headers.at(-1)).toEqual({ authorization: "Bearer tk_new_12345" });

    await expect(
      connectCustomServer(deps, f.owner.id, f.org.id, {
        serverUrl: "https://other.example.com/mcp",
        apiKey: "tk_other_12345",
        connectionId: id,
      }),
    ).rejects.toMatchObject({ code: "connector.other_server" });
  });

  test("Adicionar outra conta: the same address is a second account, 'Tickets 2', its own tools, every agent's too", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect });
    const first = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_first_12345",
      label: "Tickets",
    });
    if (first.status !== "connected") throw new Error(`expected connected, got ${first.status}`);
    const second = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_second_12345",
      label: "Tickets",
    });
    if (second.status !== "connected") throw new Error(`expected connected, got ${second.status}`);
    expect(second.outcome).toBe("connected");
    expect(second.server.id).not.toBe(first.server.id);
    const rows = await f.db.select().from(schema.connectorConnections);
    expect(Object.fromEntries(rows.map((r) => [r.label, r.toolPrefix]))).toEqual({
      Tickets: "tickets",
      "Tickets 2": "tickets_2",
    });
    // Each account is every agent's; the first keeps its grant and its key.
    const grants = await f.db.select().from(schema.agentScopes);
    for (const id of [first.server.id, second.server.id]) {
      expect(grants.filter((g) => g.connectionId === id).map((g) => g.scope)).toEqual(["connector:*"]);
    }
    const firstRow = rows.find((r) => r.id === first.server.id);
    if (!firstRow) throw new Error("first account gone");
    expect(await connectionHeaders(deps, firstRow)).toEqual({ authorization: "Bearer tk_first_12345" });
  });

  test("two connects of one server at once: two accounts, each with its own names, both every agent's", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect });
    const results = await Promise.all(
      ["tk_first_12345", "tk_second_12345"].map((apiKey) =>
        connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER, apiKey, label: "Tickets" }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(["connected", "connected"]);
    const rows = await f.db.select().from(schema.connectorConnections);
    expect(rows.map((r) => r.toolPrefix).sort()).toEqual(["tickets", "tickets_2"]);
    const grants = await f.db.select().from(schema.agentScopes);
    const granted = new Set(grants.filter((g) => g.scope === "connector:*").map((g) => g.connectionId));
    expect(granted.size).toBe(2);
  });

  test("another account at its address typed another way is one too; its tools follow the server, not a rename", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect });
    const first = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_first_12345",
      label: "Tickets",
    });
    if (first.status !== "connected") throw new Error(`expected connected, got ${first.status}`);
    await renameConnection(f.db, f.owner.id, f.org.id, first.server.id, "Acme Tickets");
    // The apps send the first account's name as the service's.
    const second = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: `${SERVER}/`,
      apiKey: "tk_second_12345",
      label: "Acme Tickets",
    });
    if (second.status !== "connected") throw new Error(`expected connected, got ${second.status}`);
    const rows = await f.db.select().from(schema.connectorConnections);
    expect(rows.find((r) => r.id === second.server.id)?.toolPrefix).toBe("tickets_2");
    expect((await f.db.select().from(schema.agentScopes)).some((g) => g.connectionId === second.server.id)).toBe(true);
    const again = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: `${SERVER}/`,
      apiKey: "tk_first_67890",
      connectionId: first.server.id,
    });
    expect(again).toMatchObject({ status: "connected", outcome: "reconnected" });
  });

  test("a one-click server standing in for a catalog connector this server doesn't offer takes its id", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const linear = (oauthApps: Record<string, { clientId: string; clientSecret: string }>, apiKey: string) =>
      connectCustomServer(
        depsOf(f, { connect: mcp.connect, resolveHost: async () => ["93.184.216.34"], oauthApps }),
        f.owner.id,
        f.org.id,
        { serverUrl: "https://mcp.linear.app/mcp", apiKey, label: "Linear" },
      );
    const prefixOf = async (started: Awaited<ReturnType<typeof linear>>) => {
      if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
      const rows = await f.db.select().from(schema.connectorConnections);
      return rows.find((r) => r.id === started.server.id)?.toolPrefix;
    };
    const first = await linear({}, "lin_first_12345");
    expect(await prefixOf(first)).toBe("linear");
    if (first.status === "connected") await revokeConnection(f.db, f.owner.id, f.org.id, first.server.id);
    // With Linear's OAuth app our Linear connector is offered: its name stays free for it.
    expect(await prefixOf(await linear({ linear: { clientId: "x", clientSecret: "y" } }, "lin_second_12345"))).toBe(
      "linear_2",
    );
  });

  test("Stripe's account listing: what one sign-in reaches is one account, a sandbox too; partly unnamed says nothing", () => {
    const spec = mcpPreset("stripe")?.account;
    if (!spec) throw new Error("Stripe names no account tool");
    const answer = (accounts: unknown[]) => ({ content: JSON.stringify({ accounts }), isError: false });
    expect(
      accountFrom(
        spec,
        answer([
          { stripe_context: "acct_sbx", livemode: false, name: "Acme Sandbox" },
          { stripe_context: "acct_acme", livemode: true, name: "Acme" },
        ]),
      ),
    ).toEqual({ id: "acct_acme:true,acct_sbx:false", name: "Acme, Acme Sandbox" });
    expect(accountFrom(spec, answer([{ stripe_context: "acct_acme", name: "Acme" }]))).toBeNull();
    expect(accountFrom(spec, answer([]))).toBeNull();
    expect(accountFrom(spec, { content: "Service unavailable", isError: true })).toBeNull();
  });

  test("Reconectar when Stripe can't say which account: refused, nothing changes; a listing of another account names nothing", async () => {
    f = await setup();
    const stripe = stripeMcp();
    const deps = depsOf(f, { connect: stripe.connect, resolveHost: async () => ["93.184.216.34"] });
    const acme = await connectStripe(deps, "rk_acme_1111");
    const row = async () => {
      const found = (await f.db.select().from(schema.connectorConnections)).find((r) => r.id === acme.server.id);
      if (!found) throw new Error("Acme gone");
      return found;
    };
    stripe.state.down = true;
    await expect(connectStripe(deps, "rk_loja_2222", acme.server.id)).rejects.toMatchObject({
      code: "connector.account_unknown",
    });
    expect(await connectionHeaders(deps, await row())).toEqual({ authorization: "Bearer rk_acme_1111" });
    stripe.state.down = false;
    // Its sign-in reaches another account now (changed at Stripe): that one's name isn't this account's.
    stripe.state.reach.acme = { stripe_context: "acct_other", livemode: true, name: "Outra" };
    await refreshCustomServer(deps, f.owner.id, f.org.id, acme.server.id);
    expect(await row()).toMatchObject({ accountId: "acct_acme:true", accountLabel: "Acme" });
  });

  test("two Stripe accounts: told apart by the account, same account again is that one, Reconectar keeps its account", async () => {
    f = await setup();
    const stripe = stripeMcp();
    const deps = depsOf(f, { connect: stripe.connect, resolveHost: async () => ["93.184.216.34"] });
    const acme = await connectStripe(deps, "rk_acme_1111");
    expect([acme.outcome, acme.server.label, acme.server.accountLabel]).toEqual(["connected", "Stripe (Acme)", "Acme"]);
    const loja = await connectStripe(deps, "rk_loja_2222");
    expect([loja.outcome, loja.server.label]).toEqual(["connected", "Stripe (Loja B)"]);
    expect((await f.db.select().from(schema.connectorConnections)).map((r) => r.toolPrefix).sort()).toEqual([
      "stripe",
      "stripe_2",
    ]);

    // The same account again ("Adicionar outra conta" landing on it): no new row, its sign-in refreshed.
    const again = await connectStripe(deps, "rk_acme_3333");
    expect([again.outcome, again.server.id]).toEqual(["same_account", acme.server.id]);
    expect(await f.db.select().from(schema.connectorConnections)).toHaveLength(2);
    const row = (await f.db.select().from(schema.connectorConnections)).find((r) => r.id === acme.server.id);
    if (!row) throw new Error("Acme gone");
    expect(await connectionHeaders(deps, row)).toEqual({ authorization: "Bearer rk_acme_3333" });

    // Reconectar signing in to the other account: refused, nothing changes (its grants were for Acme).
    await expect(connectStripe(deps, "rk_loja_4444", acme.server.id)).rejects.toMatchObject({
      code: "connector.other_account",
    });
    const kept = (await f.db.select().from(schema.connectorConnections)).find((r) => r.id === acme.server.id);
    if (!kept) throw new Error("Acme gone");
    expect([kept.accountId, kept.label]).toEqual(["acct_acme:true", "Stripe (Acme)"]);
    expect(await connectionHeaders(deps, kept)).toEqual({ authorization: "Bearer rk_acme_3333" });
    const back = await connectStripe(deps, "rk_acme_5555", acme.server.id);
    expect([back.outcome, back.server.id]).toEqual(["reconnected", acme.server.id]);
  });

  test("the same account connected twice at once is one connection", async () => {
    f = await setup();
    const stripe = stripeMcp();
    const deps = depsOf(f, { connect: stripe.connect, resolveHost: async () => ["93.184.216.34"] });
    const results = await Promise.all([connectStripe(deps, "rk_acme_1111"), connectStripe(deps, "rk_acme_2222")]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["connected", "same_account"]);
    expect(await f.db.select().from(schema.connectorConnections)).toHaveLength(1);
  });

  test("an account connected before its provider was asked is asked then: the same account isn't connected twice", async () => {
    f = await setup();
    const stripe = stripeMcp();
    const deps = depsOf(f, { connect: stripe.connect, resolveHost: async () => ["93.184.216.34"] });
    const old = await connectStripe(deps, "rk_acme_1111");
    await f.db
      .update(schema.connectorConnections)
      .set({ label: "Stripe", accountId: null, accountLabel: null })
      .where(eq(schema.connectorConnections.id, old.server.id));
    const again = await connectStripe(deps, "rk_acme_2222");
    expect([again.outcome, again.server.id, again.server.label]).toEqual(["same_account", old.server.id, "Stripe"]);
    expect(await f.db.select().from(schema.connectorConnections)).toHaveLength(1);
  });

  test("tool names never collide: each account its own, every agent's until narrowed; levels per account", async () => {
    f = await setup();
    const stripe = stripeMcp();
    const deps = depsOf(f, { connect: stripe.connect, resolveHost: async () => ["93.184.216.34"] });
    const acme = await connectStripe(deps, "rk_acme_1111");
    const loja = await connectStripe(deps, "rk_loja_2222");
    for (const s of [acme, loja]) await acceptCustomSuggestion(deps, f.owner.id, f.org.id, s.server.id);
    const source = createConnectorToolSource(deps);
    const gateway = createToolGateway({ sources: [source] });
    const ctx = await runContext(f);
    const listed = (await source.tools(ctx)).map((t) => [t.name, t.description.split("]")[0]]);
    expect(listed).toContainEqual(["stripe_list_customers", "[Stripe (Acme)"]);
    expect(listed).toContainEqual(["stripe_2_list_customers", "[Stripe (Loja B)"]);
    expect(new Set(listed.map(([name]) => name)).size).toBe(listed.length);
    // Each account is every agent's.
    expect((await gateway.list(ctx)).map((t) => t.name)).toEqual([
      "stripe_2_list_available_accounts_or_orgs",
      "stripe_2_list_customers",
      "stripe_list_available_accounts_or_orgs",
      "stripe_list_customers",
    ]);
    const tree = await getAgentAccess(f.db, f.owner.id, f.org.id, f.agent.id);
    expect(tree.connectors.map((c) => [c.label, c.state])).toEqual([
      ["Stripe (Acme)", "granted"],
      ["Stripe (Loja B)", "granted"],
    ]);

    const only = { all: false, connectors: { [loja.server.id]: true }, scopes: [], tools: { allow: [], deny: [] } };
    await setAgentAccess(f.db, f.owner.id, f.org.id, f.agent.id, only);
    expect((await gateway.list(ctx)).map((t) => t.name)).toEqual([
      "stripe_2_list_available_accounts_or_orgs",
      "stripe_2_list_customers",
    ]);
    const call = await gateway.invoke(ctx, { toolUseId: "t1", name: "stripe_2_list_customers", input: {} });
    expect(call).toMatchObject({ type: "result" });
    expect(stripe.state.calls.at(-1)).toEqual({ tool: "list_customers", key: "rk_loja_2222" });
  });

  test("renaming keeps the tool names: a denied tool stays denied; names are unique in the workspace", async () => {
    f = await setup();
    const stripe = stripeMcp();
    const deps = depsOf(f, { connect: stripe.connect, resolveHost: async () => ["93.184.216.34"] });
    const acme = await connectStripe(deps, "rk_acme_1111");
    const loja = await connectStripe(deps, "rk_loja_2222");
    await acceptCustomSuggestion(deps, f.owner.id, f.org.id, acme.server.id);
    await setAgentAccess(f.db, f.owner.id, f.org.id, f.agent.id, {
      all: false,
      connectors: { [acme.server.id]: true },
      scopes: [],
      tools: { allow: [], deny: [{ connectionId: acme.server.id, name: "stripe_list_customers" }] },
    });
    const source = createConnectorToolSource(deps);
    const gateway = createToolGateway({ sources: [source] });
    const ctx = await runContext(f);
    expect((await gateway.list(ctx)).map((t) => t.name)).toEqual(["stripe_list_available_accounts_or_orgs"]);

    const renamed = await renameConnection(f.db, f.owner.id, f.org.id, acme.server.id, "  Loja Acme ");
    expect(renamed.label).toBe("Loja Acme");
    expect((await source.tools(ctx)).filter((t) => t.connectionId === acme.server.id).map((t) => t.name)).toEqual([
      "stripe_list_available_accounts_or_orgs",
      "stripe_list_customers",
    ]);
    expect((await gateway.list(ctx)).map((t) => t.name)).toEqual(["stripe_list_available_accounts_or_orgs"]);
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "connector.renamed"));
    expect(audit.map((a) => a.details)).toEqual([{ from: "Stripe (Acme)", to: "Loja Acme", label: "Loja Acme" }]);

    await expect(renameConnection(f.db, f.owner.id, f.org.id, loja.server.id, "loja acme")).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(renameConnection(f.db, f.owner.id, f.org.id, loja.server.id, "   ")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("two big accounts of one server: two directories with their own names", () => {
    const big = (prefix: string, connectionId: string, label: string): ToolDefinition[] =>
      Array.from({ length: DIRECTORY_MAX_TOOLS + 1 }, (_, i) => ({
        name: `${prefix}_tool_${i}`,
        description: `[${label}] tool ${i}`,
        inputSchema: { type: "object" },
        scope: `custom:${connectionId}:read`,
        connectionId,
        connectorLabel: label,
        toolPrefix: prefix,
        execute: async () => ({ content: "" }),
      }));
    const shown = presentTools([...big("stripe", "c1", "Stripe (Acme)"), ...big("stripe_2", "c2", "Stripe (Loja B)")]);
    expect(shown.map((t) => t.name)).toEqual([
      "stripe_find_tools",
      "stripe_use_tool",
      "stripe_2_find_tools",
      "stripe_2_use_tool",
    ]);
  });

  test("a server the previous version connects while this one deploys: no tool_prefix, its tools as it named them", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf(f, { connect: mcp.connect });
    // The previous version's insert names no tool_prefix.
    const old = "0193eeee-0000-4000-8000-0000000000a1";
    await f.db.execute(sql`insert into connector_connections (id, org_id, connector, label, server_url, auth_type)
      values (${old}, ${f.org.id}, ${`custom:${old}`}, 'Tickets', ${SERVER}, 'none')`);
    const [row] = await f.db.select().from(schema.connectorConnections).where(eq(schema.connectorConnections.id, old));
    if (!row) throw new Error("no connection");
    await syncCustomTools(deps, row);
    await acceptCustomSuggestion(deps, f.owner.id, f.org.id, old);
    const second = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_second_12345",
      label: "Tickets",
    });
    if (second.status !== "connected") throw new Error(`expected connected, got ${second.status}`);
    await acceptCustomSuggestion(deps, f.owner.id, f.org.id, second.server.id);
    const names = (await createConnectorToolSource(deps).tools(await runContext(f))).map((t) => t.name);
    expect(names.sort()).toEqual([
      "tickets_2_close_ticket",
      "tickets_2_list_tickets",
      "tickets_close_ticket",
      "tickets_list_tickets",
    ]);
  });

  test("the migration: today's names kept; duplicates in a workspace numbered, their tool grants with them", async () => {
    f = await setup();
    await f.db.execute(sql`drop index connector_connections_tool_prefix`);
    await f.db.execute(sql`drop function connector_connections_fill_tool_prefix cascade`);
    await f.db.execute(sql`alter table connector_connections drop column tool_prefix, drop column account_id`);
    await f.db.execute(sql`alter table oauth_states drop column connection_id`);
    const id = (n: number) => `0193eeee-0000-4000-8000-00000000000${n}`;
    const [tickets, tickets2, named, github, gone, drive, drives] = [id(1), id(2), id(3), id(4), id(5), id(6), id(7)];
    const insert = (row: string, connector: string, label: string, at: string, revoked = false) =>
      f.db.execute(sql`insert into connector_connections (id, org_id, connector, label, server_url, auth_type, created_at, revoked_at)
        values (${row}, ${f.org.id}, ${connector}, ${label}, 'https://tickets.example.com/mcp', 'none', ${at}, ${revoked ? at : null})`);
    await insert(tickets, `custom:${tickets}`, "Tickets", "2026-10-01T00:00:00Z");
    await insert(tickets2, `custom:${tickets2}`, "tickets!", "2026-10-02T00:00:00Z");
    // A server named like a catalog connector, older than it: the catalog connector keeps `github`.
    await insert(named, `custom:${named}`, "GitHub", "2026-10-03T00:00:00Z");
    await insert(github, "github", "GitHub", "2026-10-04T00:00:00Z");
    await insert(gone, `custom:${gone}`, "Tickets", "2026-09-01T00:00:00Z", true);
    // The same name with different tool names: the name alone is numbered.
    await insert(drive, "drive", "Google Drive", "2026-10-05T00:00:00Z");
    await insert(drives, `custom:${drives}`, "google drive", "2026-10-06T00:00:00Z");
    const grant = (connectionId: string, scope: string) => ({
      orgId: f.org.id,
      agentId: f.agent.id,
      connectionId,
      scope,
    });
    await f.db
      .insert(schema.agentScopes)
      .values([
        grant(tickets2, "deny:tickets_close_ticket"),
        grant(tickets2, "tool:tickets_list_tickets"),
        grant(tickets, "deny:tickets_close_ticket"),
        grant(named, "deny:github_merge"),
      ]);
    await runMigration(f.db, "connector_accounts");
    const rows = await f.db.select().from(schema.connectorConnections);
    expect(Object.fromEntries(rows.map((r) => [r.id, [r.toolPrefix, r.label]]))).toEqual({
      [tickets]: ["tickets", "Tickets"],
      [tickets2]: ["tickets_2", "tickets!"],
      [named]: ["github_2", "GitHub 2"],
      [github]: ["github", "GitHub"],
      [gone]: ["tickets", "Tickets"],
      [drive]: ["drive", "Google Drive"],
      [drives]: ["google_drive", "google drive 2"],
    });
    const scopes = await f.db.select().from(schema.agentScopes).where(eq(schema.agentScopes.agentId, f.agent.id));
    expect(
      scopes
        .filter((g) => g.connectionId && g.connectionId !== github)
        .map((g) => `${g.connectionId} ${g.scope}`)
        .sort(),
    ).toEqual(
      [
        `${tickets} deny:tickets_close_ticket`,
        `${tickets2} deny:tickets_2_close_ticket`,
        `${tickets2} tool:tickets_2_list_tickets`,
        `${named} deny:github_2_merge`,
      ].sort(),
    );
    await runMigration(f.db, "connector_accounts_not_null");
    // The previous version, still serving during the deploy, inserts without a prefix: it gets today's name, numbered.
    const late = id(8);
    await insert(late, `custom:${late}`, "Tickets", "2026-10-07T00:00:00Z");
    const [filled] = await f.db
      .select({ toolPrefix: schema.connectorConnections.toolPrefix })
      .from(schema.connectorConnections)
      .where(eq(schema.connectorConnections.id, late));
    expect(filled?.toolPrefix).toBe("tickets_3");
  });

  test("MCP-native OAuth: discovery, dynamic registration, PKCE S256 + resource, token refresh", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const auth = oauthServer();
    const deps = depsOf(f, { connect: mcp.connect, http: auth.http });
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER, returnTo: "/settings" });
    if (started.status !== "oauth") throw new Error(`expected oauth, got ${started.status}`);
    const url = new URL(started.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "dcr-client-1",
      response_type: "code",
      code_challenge_method: "S256",
      resource: SERVER,
      scope: "tickets",
      redirect_uri: "https://chat.example.com/api/app/connectors/oauth/callback",
    });
    auth.seen.challenge = url.searchParams.get("code_challenge") ?? "";
    const { connection, returnTo } = await completeOAuth(
      deps,
      { id: f.owner.id },
      {
        state: url.searchParams.get("state") ?? "",
        code: "code-1",
      },
    );
    expect(returnTo).toBe("/settings");
    expect(connection.connector.startsWith("custom:")).toBe(true);
    expect(connection.authType).toBe("oauth");
    // The registered client is reused for the next server of the same issuer.
    await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER });
    expect(auth.seen.registrations).toBe(1);
    expect(auth.seen.names).toEqual(["agentes.chat"]);
    expect(auth.seen.authMethods).toEqual(["none"]);
    // The token is about to expire: refreshed at the issuer's token endpoint.
    const headers = await connectionHeaders(deps, connection);
    expect(headers).toEqual({ authorization: "Bearer at-2" });
    expect(auth.seen.tokenForms.at(-1)?.get("grant_type")).toBe("refresh_token");
    expect(auth.seen.tokenForms.at(-1)?.get("client_id")).toBe("dcr-client-1");
    // The resource goes with every token request (MCP authorization spec), the refresh too.
    expect(auth.seen.tokenForms.at(-1)?.get("resource")).toBe(SERVER);
    // Every connection to that server gone: the server may have dropped the client ("Unrecognized
    // client_id"), so the next connect registers again and replaces the row in place.
    await revokeConnection(f.db, f.owner.id, f.org.id, connection.id);
    await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER });
    expect(auth.seen.registrations).toBe(2);
    expect(await f.db.select().from(schema.oauthClients)).toHaveLength(1);
  });

  test("offline_access goes with the scopes asked for when the authorization server lists it (Vercel asks only openid), never alone", async () => {
    f = await setup();
    const vercel = oauthServer({ scopes: ["openid"], serverScopes: ["openid", "email", "profile", "offline_access"] });
    const started = await connectCustomServer(depsOf(f, { http: vercel.http }), f.owner.id, f.org.id, {
      serverUrl: SERVER,
    });
    if (started.status !== "oauth") throw new Error(`expected oauth, got ${started.status}`);
    expect(new URL(started.authorizeUrl).searchParams.get("scope")).toBe("openid offline_access");
    expect(vercel.seen.registeredScopes).toEqual(["openid offline_access"]);
    // Nothing listed to ask for: the server's defaults apply, which offline_access alone would replace.
    const defaults = oauthServer({ scopes: [], serverScopes: ["openid", "offline_access"] });
    const again = await connectCustomServer(depsOf(f, { http: defaults.http }), f.owner.id, f.org.id, {
      serverUrl: SERVER,
    });
    if (again.status !== "oauth") throw new Error(`expected oauth, got ${again.status}`);
    expect(new URL(again.authorizeUrl).searchParams.has("scope")).toBe(false);
    expect(defaults.seen.registeredScopes).toEqual([undefined]);
  });

  test("a client registered without offline_access and still in use gets it on the next authorization", async () => {
    f = await setup();
    const before = oauthServer({ scopes: ["openid"] });
    await signIn(depsOf(f, { connect: ticketsMcp().connect, http: before.http }), before);
    expect(before.seen.registeredScopes).toEqual(["openid"]);
    // The authorization server lists offline_access now; the connection above still uses the client.
    const now = oauthServer({ scopes: ["openid"], serverScopes: ["openid", "offline_access"] });
    const started = await connectCustomServer(depsOf(f, { http: now.http }), f.owner.id, f.org.id, {
      serverUrl: SERVER,
    });
    if (started.status !== "oauth") throw new Error(`expected oauth, got ${started.status}`);
    expect(now.seen.registrations).toBe(0);
    expect(new URL(started.authorizeUrl).searchParams.get("scope")).toBe("openid offline_access");
  });

  test("the token endpoint's method: a public client with PKCE when it takes one, else the secret it gave, in the form or by Basic", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const secret = "fake/client+secret=";
    // By Basic, each part form-encoded first (RFC 6749 §2.3.1).
    const basic = `Basic ${Buffer.from("dcr-client-1:fake%2Fclient%2Bsecret%3D").toString("base64")}`;
    // `answered`: the method its answer names (null: none named).
    const withSecret = (body: { token_endpoint_auth_method: string }, answered?: string | null) =>
      Response.json(
        {
          client_id: "dcr-client-1",
          client_secret: secret,
          ...(answered === null ? {} : { token_endpoint_auth_method: answered ?? body.token_endpoint_auth_method }),
        },
        { status: 201 },
      );
    const cases: {
      methods?: string[];
      answered?: string | null;
      asked: string;
      form: (string | null)[];
      header: string | null;
    }[] = [
      // "none" listed: no secret is sent, even one it gave.
      { methods: ["client_secret_basic", "none"], asked: "none", form: ["dcr-client-1", null], header: null },
      {
        methods: ["client_secret_basic", "client_secret_post"],
        asked: "client_secret_post",
        form: ["dcr-client-1", secret],
        header: null,
      },
      {
        methods: ["private_key_jwt", "client_secret_basic"],
        asked: "client_secret_basic",
        form: [null, null],
        header: basic,
      },
      // It registered another method than the one asked (RFC 7591): its answer wins.
      { answered: "client_secret_basic", asked: "none", form: [null, null], header: basic },
      // A secret for "none" with no method named still goes, in the form.
      { answered: null, asked: "none", form: ["dcr-client-1", secret], header: null },
    ];
    for (const c of cases) {
      const auth = oauthServer({ authMethods: c.methods, register: (body) => withSecret(body, c.answered) });
      const deps = depsOf(f, { connect: mcp.connect, http: auth.http });
      const { connection } = await signIn(deps, auth);
      // The token is about to expire: refreshed the same way.
      await connectionHeaders(deps, connection);
      expect(auth.seen.authMethods).toEqual([c.asked]);
      expect(
        auth.seen.tokenForms.map((x) => [x.get("grant_type"), x.get("client_id"), x.get("client_secret")]),
      ).toEqual([
        ["authorization_code", ...c.form],
        ["refresh_token", ...c.form],
      ]);
      expect(auth.seen.tokenAuth).toEqual([c.header, c.header]);
      await revokeConnection(f.db, f.owner.id, f.org.id, connection.id);
    }
    expect(JSON.stringify(await f.db.select().from(schema.oauthClients))).not.toContain(secret);
  });

  test("two calls that need a refresh at once spend the refresh token once (servers rotate it), with no transaction open while it answers", async () => {
    f = await setup();
    const auth = oauthServer({ rotate: true });
    // Whether another query could run while the provider answered a refresh (native mode's PGlite holds every query
    // while a transaction is open).
    const others: boolean[] = [];
    const http = (async (input: string | URL, init?: RequestInit) => {
      if (new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token") {
        const query = f.db.select({ id: schema.organizations.id }).from(schema.organizations);
        others.push(await Promise.race([query.then(() => true), Bun.sleep(1000).then(() => false)]));
      }
      return auth.http(input, init);
    }) as typeof fetch;
    const deps = depsOf(f, { connect: ticketsMcp().connect, http });
    const { connection } = await signIn(deps, auth);
    // Both hold the connection as it was: its token about to expire. One refreshes, and the other waits for that
    // refresh without a query of its own.
    const both = await Promise.all([1, 2].map(() => countQueries(() => connectionHeaders(deps, connection))));
    expect(both.map((x) => x.result)).toEqual([{ authorization: "Bearer at-2" }, { authorization: "Bearer at-2" }]);
    expect(both.filter((x) => x.queries === 0)).toHaveLength(1);
    expect(auth.seen.tokenForms.map((x) => x.get("grant_type"))).toEqual(["authorization_code", "refresh_token"]);
    expect(others).toEqual([true]);
    // The next refresh uses the token the last one gave.
    const later = depsOf(f, { http: auth.http, now: () => new Date(Date.now() + 3600_000) });
    expect(await connectionHeaders(later, connection)).toEqual({ authorization: "Bearer at-3" });
    expect(auth.seen.tokenForms.at(-1)?.get("refresh_token")).toBe("rt-2");
  });

  test("a refresh another process holds is waited for, not run again; one whose process died is taken over", async () => {
    f = await setup();
    const auth = oauthServer({ rotate: true });
    const deps = depsOf(f, { connect: ticketsMcp().connect, http: auth.http });
    const { connection } = await signIn(deps, auth);
    const leased = (until: ReturnType<typeof sql>) =>
      f.db
        .update(schema.connectorConnections)
        .set({ refreshingUntil: until })
        .where(eq(schema.connectorConnections.id, connection.id));
    // Its process died during the refresh: the lease ends, and this call refreshes.
    await leased(sql`now() + interval '1 second'`);
    const takeover = connectionHeaders(deps, connection);
    await Bun.sleep(200);
    expect(auth.seen.tokenForms).toHaveLength(1);
    expect(await takeover).toEqual({ authorization: "Bearer at-2" });
    expect(auth.seen.tokenForms.at(-1)?.get("refresh_token")).toBe("rt-1");
    // Another process holds the refresh (the token is about to expire again): this call waits, and takes the tokens
    // that land in the row meanwhile, written here as a reconnect writes them.
    await leased(sql`now() + interval '30 seconds'`);
    const later = depsOf(f, { http: auth.http, now: () => new Date(Date.now() + 3600_000) });
    const waiting = connectionHeaders(later, connection);
    await Bun.sleep(200);
    await storeCustomConnection(deps, {
      orgId: f.org.id,
      actorId: f.owner.id,
      serverUrl: SERVER,
      label: "Tickets",
      authType: "oauth",
      secret: { accessToken: "at-elsewhere", refreshToken: "rt-elsewhere" },
      tokenExpiresAt: new Date(Date.now() + 7200_000),
      oauthClientId: connection.oauthClientId,
      connectionId: connection.id,
    });
    expect(await waiting).toEqual({ authorization: "Bearer at-elsewhere" });
    expect(auth.seen.tokenForms).toHaveLength(2);
  });

  test("a name it won't take (Calendly: letters, digits, hyphens and spaces) is sent once more without the dot", async () => {
    f = await setup();
    const auth = oauthServer({
      register: (body) =>
        /^[a-z0-9 -]+$/i.test(body.client_name)
          ? Response.json({ client_id: "calendly-client" }, { status: 201 })
          : Response.json(
              {
                error: "invalid_client_metadata",
                errors: { name: ["may only contain alphanumeric characters, hyphens, and spaces."] },
              },
              { status: 400 },
            ),
    });
    const deps = depsOf(f, { connect: ticketsMcp().connect, http: auth.http });
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER });
    if (started.status !== "oauth") throw new Error(`expected oauth, got ${started.status}`);
    expect(new URL(started.authorizeUrl).searchParams.get("client_id")).toBe("calendly-client");
    expect(auth.seen.names).toEqual(["agentes.chat", "agentes chat"]);
  });

  test("OAuth that only lets in apps it approved says so in its own words, not 'no OAuth' (an outage doesn't); a key still connects", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const long = "x".repeat(300);
    const refusals: [() => Response, string | undefined][] = [
      // Asana, Square, Intercom, Mercado Pago, Semrush, Gamma: our redirect URI isn't on their list.
      [
        () =>
          Response.json(
            { error: "invalid_redirect_uri", error_description: "redirect_uri not allowed" },
            { status: 400 },
          ),
        "invalid_redirect_uri: redirect_uri not allowed",
      ],
      // Dropbox: trusted partners only.
      [
        () =>
          Response.json(
            {
              error: "registration_not_supported",
              error_description: "Only pre-registered\nMCP trusted partners are allowed.",
            },
            { status: 403 },
          ),
        "registration_not_supported: Only pre-registered MCP trusted partners are allowed.",
      ],
      // RevenueCat.
      [
        () =>
          Response.json(
            { error: "invalid_client", error_description: "The client is not registered." },
            { status: 400 },
          ),
        "invalid_client: The client is not registered.",
      ],
      // Meta Ads.
      [
        () =>
          Response.json(
            {
              error: "invalid_client_metadata",
              error_description: "Dynamic registration is not available for this client.",
            },
            { status: 400 },
          ),
        "invalid_client_metadata: Dynamic registration is not available for this client.",
      ],
      // Its two fields only, cut short: nothing else it sends back comes along.
      [
        () =>
          Response.json(
            { error: "invalid_client_metadata", error_description: long, client_secret: "fake-client-secret" },
            { status: 400 },
          ),
        `invalid_client_metadata: ${long.slice(0, 174)}…`,
      ],
      // Figma: no words of its own.
      [() => new Response("Forbidden", { status: 403 }), undefined],
    ];
    for (const [register, detail] of refusals) {
      const auth = oauthServer({ register });
      const deps = depsOf(f, { connect: mcp.connect, http: auth.http });
      const started = await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER });
      expect(started).toEqual({ status: "needs_key", reason: "not_approved", ...(detail ? { detail } : {}) });
      // Nothing about the name: asked once.
      expect(auth.seen.names).toEqual(["agentes.chat"]);
    }
    // An outage at registration isn't a refusal: just a key, never "only apps it approved".
    const outages = [
      () => new Response("", { status: 503 }),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const register of outages) {
      const auth = oauthServer({ register });
      const deps = depsOf(f, { connect: mcp.connect, http: auth.http });
      expect(await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER })).toEqual({
        status: "needs_key",
      });
      expect(auth.seen.names).toEqual(["agentes.chat"]);
    }
    // No registration offered (an app registered with it, as HubSpot asks): not approved either.
    const closed = depsOf(f, { connect: mcp.connect, http: oauthServer({ registration: false }).http });
    expect(await connectCustomServer(closed, f.owner.id, f.org.id, { serverUrl: SERVER })).toEqual({
      status: "needs_key",
      reason: "not_approved",
    });
    const keyed = await connectCustomServer(closed, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_live_12345",
    });
    expect(keyed.status).toBe("connected");
    expect(await f.db.select().from(schema.oauthClients)).toHaveLength(0);
  });

  test("without OAuth metadata the server needs a key; private addresses are refused", async () => {
    f = await setup();
    const deps = depsOf(f, { connect: ticketsMcp().connect, http: oauthServer({ metadata: false }).http });
    expect(await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: SERVER })).toEqual({
      status: "needs_key",
    });
    for (const serverUrl of [
      "http://tickets.example.com/mcp",
      "https://169.254.169.254/mcp",
      "https://intranet.corp/mcp",
    ]) {
      await expect(connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    // An authorization server that points its token endpoint inside the network is refused too.
    const sneaky = depsOf(f, { connect: ticketsMcp().connect, http: oauthServer({ tokenHost: "auth.internal" }).http });
    await expect(connectCustomServer(sneaky, f.owner.id, f.org.id, { serverUrl: SERVER })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
