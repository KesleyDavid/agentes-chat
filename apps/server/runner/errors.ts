import type { MachineErrorCode } from "@agenteschat/adapters/machine-protocol";

/** The runner's own version, sent in `hello` and at pairing. */
export const RUNNER_VERSION = "0.12.0";

/** A failure the runner reports to the server with a protocol error code. */
export class RunnerError extends Error {
  constructor(
    readonly code: MachineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

/** New work for an agent whose computer sessions still use its old network, `drainSeconds` at most. */
export class NetworkChangingError extends Error {
  constructor(readonly drainSeconds: number) {
    super("This agent’s network is changing. New work waits for its computer sessions to restart.");
    this.name = "NetworkChangingError";
  }
}

/** The Node error code (`ENOENT`, `EISDIR`…) of an fs failure, if any. */
export function errnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Turns any thrown value into the protocol's `{ code, message }`. */
export function toMachineError(err: unknown): { code: MachineErrorCode; message: string } {
  if (err instanceof RunnerError) return { code: err.code, message: err.message };
  const code = errnoCode(err);
  if (code === "ENOENT") return { code: "not_found", message: "No such file or folder" };
  if (code === "EISDIR") return { code: "bad_request", message: "That path is a folder" };
  if (code === "ENOTDIR") return { code: "bad_request", message: "A part of that path is not a folder" };
  if (code === "EACCES" || code === "EPERM") return { code: "internal", message: "Permission denied on this machine" };
  const message = err instanceof Error ? err.message : String(err);
  return { code: "internal", message: message.slice(0, 2000) || "Unexpected error" };
}
