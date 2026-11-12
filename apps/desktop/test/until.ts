import { expect } from "bun:test";
import { act } from "react";

/**
 * Waits up to `ms` for `ready`, letting React render every 20 ms. Shared CI runners render far slower than a laptop,
 * so the bound is time, not a count of tries. `performance.now()`, not `Date.now()`: tests move the clock with
 * `setSystemTime`, which would end the wait at once.
 */
export async function until(ready: () => unknown, ms = 10_000) {
  const end = performance.now() + ms;
  while (!ready() && performance.now() < end) await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(Boolean(ready())).toBe(true);
}
