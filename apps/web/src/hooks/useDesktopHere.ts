import { type DesktopBuild, desktopCpu, desktopTargetOf } from "@agenteschat/client/lib/machines";
import { useEffect, useMemo, useState } from "react";

/**
 * The desktop build for the computer this page is open on: from the user agent at once, then from the browser's own
 * report of the chip where it gives one (a Windows on ARM says x64 in its user agent). Null on a phone or a tablet.
 */
export function useDesktopHere(): DesktopBuild | null {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const [cpu, setCpu] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void desktopCpu().then((value) => {
      if (live) setCpu(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => (agent ? desktopTargetOf(agent, cpu) : null), [agent, cpu]);
}
