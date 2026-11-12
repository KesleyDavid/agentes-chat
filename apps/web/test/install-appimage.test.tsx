import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { DesktopRelease } from "@agenteschat/client";
import { cleanup, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { appImageCommand, InstallSteps } from "@/components/install/guide";
import { createI18n } from "@/i18n";

afterEach(() => cleanup());

const DEB = "https://app.example.com/api/desktop/download/0.7.1/agentes_0.7.1_amd64.deb";
const APP_IMAGE = "https://app.example.com/api/desktop/download/0.7.1/agentes_0.7.1_amd64.AppImage";
const release = (over: Partial<DesktopRelease> = {}): DesktopRelease => ({
  version: "0.7.1",
  url: DEB,
  sha256: "a".repeat(64),
  publishedAt: "2026-11-11T12:00:00Z",
  ...over,
});

const steps = (system: "linux" | "mac", r: DesktopRelease) =>
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <InstallSteps build={{ system, arm: false }} release={r} />
    </I18nextProvider>,
  ).container;

describe("the download page on Linux: the AppImage for a distribution that takes no deb", () => {
  test("under the deb's steps: who it is for, its download and the line that runs it", () => {
    const el = steps("linux", release({ appImage: { url: APP_IMAGE, sha256: "b".repeat(64) } }));
    const block = el.querySelector(".ist__stuck");
    expect(block?.querySelector(".ist__line")?.textContent).toBe(
      "On Arch, Fedora or another system that doesn't take a .deb?",
    );
    const link = block?.querySelector("a");
    expect(link?.textContent).toBe("Download the AppImage");
    expect(link?.getAttribute("href")).toBe(APP_IMAGE);
    expect(block?.textContent).toContain("chmod +x ./agentes_0.7.1_amd64.AppImage && ./agentes_0.7.1_amd64.AppImage");
    // The deb's own steps stay as they were.
    expect(el.textContent).toContain("sudo apt install ./agentes_0.7.1_amd64.deb");
  });

  test("a release without an AppImage, and a Mac, show none", () => {
    expect(steps("linux", release()).querySelector(".ist__stuck")).toBeNull();
    const mac = steps("mac", release({ appImage: { url: APP_IMAGE, sha256: "b".repeat(64) } }));
    expect(mac.textContent).not.toContain("AppImage");
  });

  test("the line names the file the link downloads", () => {
    expect(appImageCommand(`${APP_IMAGE}?x=1`)).toBe(
      "chmod +x ./agentes_0.7.1_amd64.AppImage && ./agentes_0.7.1_amd64.AppImage",
    );
  });
});
