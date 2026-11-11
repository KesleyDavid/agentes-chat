import { expect, test } from "bun:test";
import { findOnScreen, LOOKUP_MS, parseIosFlow, pointOf, runIosFlow } from "../../runner/ios-flow";
import { HelperGone, HelperSlow, type IosScreen, recoveringScreen, type WdaNode } from "../../runner/wda";

const SCREEN = { width: 390, height: 844 };
const el = (over: Partial<WdaNode> & { y: number }, children?: WdaNode[]): WdaNode => ({
  type: "Button",
  rect: { x: 20, y: over.y, width: 350, height: 44 },
  isVisible: "1",
  ...over,
  ...(children ? { children } : {}),
});
const LOGIN: WdaNode = {
  type: "Application",
  label: "Acme",
  rect: { x: 0, y: 0, ...SCREEN },
  children: [
    el({ type: "Cell", label: "Sign in", y: 100 }, [el({ type: "StaticText", label: "Sign in", y: 110 })]),
    el({ type: "TextField", rawIdentifier: "email", name: "email", placeholderValue: "Email", y: 200 }),
    el({ label: "Hidden", y: 300, isVisible: "0" }),
    el({ label: "Below", y: 2000 }),
  ],
};

/** A screen that answers the trees in turn (the last one stays) and records every call. */
function fakeScreen(trees: WdaNode[]) {
  const calls: unknown[][] = [];
  let i = 0;
  const shots = [Buffer.from("A"), Buffer.from("B"), Buffer.from("B")];
  let s = 0;
  const screen: IosScreen = {
    screenshot: async () => shots[Math.min(s++, shots.length - 1)] as Buffer,
    windowSize: async () => SCREEN,
    source: async () => trees[Math.min(i++, trees.length - 1)] as WdaNode,
    tap: async (x, y) => void calls.push(["tap", x, y]),
    swipe: async (...a) => void calls.push(["swipe", ...a]),
    keys: async (t) => void calls.push(["keys", t]),
    button: async (n) => void calls.push(["button", n]),
    lock: async () => void calls.push(["lock"]),
    launch: async (a) => void calls.push(["launch", a]),
    terminate: async (a) => void calls.push(["terminate", a]),
  };
  return { screen, calls };
}

/** A run on a clock that moves only when the flow waits. */
function clock() {
  let now = 1_000_000;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    deadline: now + 600_000,
  };
}

test("Maestro's YAML: the header's appId and env, then the commands; one document is commands only", () => {
  expect(parseIosFlow("appId: com.acme.app\nenv:\n  USER: sam\n---\n- launchApp\n- tapOn: Sign in\n")).toEqual({
    appId: "com.acme.app",
    env: { USER: "sam" },
    commands: ["launchApp", { tapOn: "Sign in" }],
  });
  expect(parseIosFlow("- launchApp: com.acme.app\n").commands).toEqual([{ launchApp: "com.acme.app" }]);
  // Two commands after a leading `---` are still one list, not a header and its commands.
  expect(parseIosFlow("---\n- launchApp: com.acme.app\n- tapOn: Sign in\n").commands).toEqual([
    { launchApp: "com.acme.app" },
    { tapOn: "Sign in" },
  ]);
  expect(() => parseIosFlow("appId: x\n")).toThrow("no commands");
  expect(() => parseIosFlow("- tapOn: [unclosed\n")).toThrow("valid YAML");
});

test("finding on the screen: the whole text as a pattern in any case, ids, the innermost match, only what shows", () => {
  expect(findOnScreen(LOGIN, { text: "sign in" }, SCREEN).map((n) => n.type)).toEqual(["StaticText"]);
  expect(findOnScreen(LOGIN, { text: "Sign.*" }, SCREEN)).toHaveLength(1);
  expect(findOnScreen(LOGIN, { text: "Sign" }, SCREEN)).toHaveLength(0);
  expect(findOnScreen(LOGIN, { text: "Email" }, SCREEN).map((n) => n.rawIdentifier)).toEqual(["email"]);
  expect(findOnScreen(LOGIN, { id: "email" }, SCREEN)).toHaveLength(1);
  // Not drawn, or off the screen; the app itself never counts.
  expect(findOnScreen(LOGIN, { text: "Hidden" }, SCREEN)).toHaveLength(0);
  expect(findOnScreen(LOGIN, { text: "Below" }, SCREEN)).toHaveLength(0);
  expect(findOnScreen(LOGIN, { text: "Acme" }, SCREEN)).toHaveLength(0);
  // A pattern that isn't a valid expression matches as written.
  expect(
    findOnScreen({ ...LOGIN, children: [el({ label: "Price (USD", y: 10 })] }, { text: "Price (USD" }, SCREEN),
  ).toHaveLength(1);
  expect(pointOf("50%, 25%", SCREEN)).toEqual({ x: 195, y: 211 });
  expect(pointOf("120,300", SCREEN)).toEqual({ x: 120, y: 300 });
  expect(() => pointOf("middle", SCREEN)).toThrow();
});

test("a sign-in flow: launch, taps by text, id and point, typing, asserts, scrolling, keys, screenshots", async () => {
  const SIGNED_IN: WdaNode = { ...LOGIN, children: [el({ type: "StaticText", label: "Welcome, Sam", y: 120 })] };
  const SCROLLED: WdaNode = {
    ...SIGNED_IN,
    children: [...(SIGNED_IN.children ?? []), el({ label: "Settings", y: 700 })],
  };
  // Sign in shows, then the welcome screen (twice before scrolling), then Settings scrolled into view.
  const f = fakeScreen([LOGIN, LOGIN, LOGIN, LOGIN, SIGNED_IN, SIGNED_IN, SIGNED_IN, SCROLLED]);
  const saved: string[] = [];
  const c = clock();
  const flow = `appId: com.acme.app
env:
  EMAIL: sam@example.com
---
- launchApp
- assertVisible: "Sign in"
- tapOn:
    id: email
- inputText: \${EMAIL}
- eraseText: 2
- tapOn: "SIGN IN"
- assertVisible: "Welcome, .*"
- assertNotVisible: "Sign in"
- scrollUntilVisible:
    element: "Settings"
- tapOn:
    point: "50%, 50%"
- swipe:
    start: 90%, 50%
    end: 10%, 50%
    duration: 300
- pressKey: Enter
- back
- waitForAnimationToEnd
- takeScreenshot: after sign-in
- stopApp
`;
  const r = await runIosFlow(flow, f.screen, {
    env: { EMAIL: "rui@example.com" },
    signal: new AbortController().signal,
    ...c,
    save: async (name) => {
      saved.push(name);
      return `.agentes/phone/${name}.png`;
    },
  });
  expect(r.passed).toBe(true);
  expect(r.screenshots).toEqual([".agentes/phone/after-sign-in.png"]);
  expect(f.calls).toEqual([
    ["terminate", "com.acme.app"],
    ["launch", "com.acme.app"],
    ["tap", 195, 222],
    // The request's variables win over the flow's own.
    ["keys", "rui@example.com"],
    ["keys", "\b\b"],
    ["tap", 195, 132],
    // DOWN: the finger goes up.
    ["swipe", 195, 844 * 0.7, 195, 844 * 0.3, 400],
    ["tap", 195, 422],
    ["swipe", 351, 422, 39, 422, 300],
    ["keys", "\n"],
    ["swipe", 2, 422, 234, 422, 250],
    ["terminate", "com.acme.app"],
  ]);
  expect(r.output.split("\n").at(-1)).toBe("Flow passed (16 steps)");
});

test("a step that fails stops the flow and says why; optional ones don't; anything else isn't run", async () => {
  const run = async (flow: string) => {
    const f = fakeScreen([LOGIN]);
    return {
      ...(await runIosFlow(flow, f.screen, {
        env: {},
        signal: new AbortController().signal,
        ...clock(),
        save: async (n) => n,
      })),
      calls: f.calls,
    };
  };
  const missing = await run("appId: com.acme.app\n---\n- tapOn: Checkout\n- launchApp\n");
  expect(missing.passed).toBe(false);
  expect(missing.output).toBe('FAILED  tapOn Checkout: "Checkout" isn\'t on the screen');
  expect(missing.calls).toEqual([]);
  const optional = await run("appId: com.acme.app\n---\n- tapOn:\n    text: Checkout\n    optional: true\n- stopApp\n");
  expect(optional.passed).toBe(true);
  expect(optional.output).toContain('SKIPPED tapOn: "Checkout" isn\'t on the screen (optional)');
  const other = await run("appId: com.acme.app\n---\n- runScript: login.js\n");
  expect(other.output).toStartWith(
    "FAILED  runScript login.js: runScript isn't supported on a real iPhone. These are: launchApp,",
  );
  const wiped = await run("appId: com.acme.app\n---\n- launchApp:\n    clearState: true\n");
  expect(wiped.output).toContain("clearState and clearKeychain don't work on a real iPhone");
  const key = await run("- pressKey: Tab\n");
  expect(key.output).toContain("the Tab key isn't on an iPhone");
  expect(LOOKUP_MS).toBe(10_000);
});

test("a slow look at a busy screen is asked again; a helper that died is started again once a flow", async () => {
  const { screen, calls } = fakeScreen([LOGIN]);
  let slow = 2;
  const busy: IosScreen = {
    ...screen,
    source: async () => {
      if (slow-- > 0) throw new HelperSlow("The test helper didn't answer: The operation timed out.");
      return screen.source();
    },
  };
  const c = clock();
  const run = { env: {}, signal: new AbortController().signal, ...c, save: async () => "" };
  expect((await runIosFlow("- tapOn: Sign in\n", busy, run)).passed).toBe(true);
  expect(calls).toEqual([["tap", 195, 132]]);
  // Each step reaches the helper running now: a dead one is replaced once, a second death ends the flow.
  const fate = [true, false, true];
  const dying: IosScreen = {
    ...screen,
    tap: async (x, y) => {
      if (fate.shift()) throw new HelperGone("The test helper didn't answer: ECONNREFUSED");
      return screen.tap(x, y);
    },
  };
  const once = await runIosFlow(
    '- tapOn: { point: "50%, 50%" }\n- tapOn: { point: "50%, 50%" }\n',
    recoveringScreen(async () => dying),
    run,
  );
  expect(once.output.split("\n")).toEqual([
    "OK      tapOn",
    "FAILED  tapOn: The test helper didn't answer: ECONNREFUSED",
  ]);
});
