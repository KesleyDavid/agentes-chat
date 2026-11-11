import { expect, test } from "bun:test";
import postgres from "postgres";
import { createPostgresDatabaseDriver, readOnlySettings } from "../src";

test("a query goes out as one statement, with or without parameters", async () => {
  // Never connects: the queries built on it are read, not run.
  const lazy = postgres({ host: "127.0.0.1", port: 1 });
  const sent: { text: string; simple: boolean }[] = [];
  const connect = (() => ({
    begin: async (_mode: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        unsafe: (...args: Parameters<typeof lazy.unsafe>) => {
          const query = lazy.unsafe(...args) as unknown as { options: { simple: boolean } };
          sent.push({ text: args[0], simple: query.options.simple });
          return Object.assign(Promise.resolve([]), { values: async () => Object.assign([], { columns: [] }) });
        },
      }),
    end: async () => {},
  })) as unknown as typeof postgres;
  const client = await createPostgresDatabaseDriver({ connect }).open({
    host: "db.example.com",
    address: "93.184.216.34",
    port: 5432,
    database: "app",
    username: "reader",
    password: "x",
    sslmode: "require",
  });
  await client.readOnly({ statementTimeoutMs: 1000 }, async (run) => {
    await run("select 1; select 2");
    await run("select $1::int", [1]);
  });
  expect(sent.filter((s) => s.text.startsWith("select"))).toEqual([
    { text: "select 1; select 2", simple: false },
    { text: "select $1::int", simple: false },
  ]);
});

test("a read-only transaction reads string literals the standard way", () => {
  expect(readOnlySettings({ statementTimeoutMs: 1000 })).toContain("set local standard_conforming_strings = on");
});
