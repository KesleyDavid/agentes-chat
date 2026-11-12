import { expect, test } from "bun:test";
import { builtCss, declarations, topLevel } from "./built-css";

test("what ships gives the emoji popover one scroll, the menu's two lines one length, and the composer's placeholder one line ending in …", async () => {
  const css = await builtCss();
  const last = (sheet: string, selector: string, property: string) =>
    declarations(sheet, selector)
      .filter(([p]) => p === property)
      .at(-1)?.[1];
  const shipped = topLevel(css);

  // Held to a menu's 280px, the picker gives up height through its grid alone, the one that scrolls.
  expect(last(shipped, ".ac-menu", "max-height")).toBe("280px");
  expect(last(shipped, ".ac-emoji", "min-height")).toBe("0");
  expect(last(shipped, ".ac-emoji__search", "flex")).toBe("none");
  expect(last(shipped, ".ac-emoji__tabs", "flex")).toBe("none");
  // Never sideways, up and down only: the minifier joins overflow-x and overflow-y into one shorthand.
  expect(last(shipped, ".ac-emoji__scroll", "overflow")).toBe("hidden auto");

  // The line under the reactions stops 8px in from each side, where a separator does.
  expect(last(shipped, ".ac-menu__separator", "margin")).toBe("4px var(--menu-item-px)");
  expect(last(shipped, ":root", "--menu-item-px")).toBe("8px");
  expect(last(shipped, ".ac-menu__reactions", "border-bottom")).toBeUndefined();
  expect(last(shipped, ".ac-menu__reactions", "background")).toContain("calc(100% - 16px) 1px no-repeat");

  // At every width (a task's side panel is narrow too). Chrome ends a textarea's placeholder in "…" only when the
  // textarea has the ellipsis too.
  expect(last(shipped, ".ac-composer textarea::placeholder", "white-space")).toBe("nowrap");
  expect(last(shipped, ".ac-composer textarea::placeholder", "text-overflow")).toBe("ellipsis");
  expect(last(shipped, ".ac-composer textarea:placeholder-shown", "text-overflow")).toBe("ellipsis");
});
