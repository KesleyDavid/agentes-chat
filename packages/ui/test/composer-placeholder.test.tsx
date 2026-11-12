import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, render, screen } from "@testing-library/react";
import { Composer } from "../src/components/Composer";

afterEach(cleanup);

const box = () => (
  <Composer
    value=""
    onChange={() => {}}
    onSend={() => {}}
    label="Mensagem para #geral"
    placeholder="Mensagem para #geral · use @ para chamar um agente"
    sendLabel="Enviar"
  />
);

/** A box `width` px wide, its text 8px a character. */
function sized(width: number) {
  const pen = spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ font: "", measureText: (text: string) => ({ width: text.length * 8 }) }) as never,
  );
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  return () => {
    pen.mockRestore();
    if (was) Object.defineProperty(HTMLElement.prototype, "clientWidth", was);
  };
}

describe("the composer's placeholder", () => {
  test("whole when it fits on one line; in a narrow box (a phone, a task's panel), without the tip after its ·", () => {
    // 50 characters: 400px of text.
    const wide = sized(600);
    render(box());
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
      "Mensagem para #geral · use @ para chamar um agente",
    );
    cleanup();
    wide();
    const narrow = sized(300);
    render(box());
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("Mensagem para #geral");
    narrow();
  });
});
