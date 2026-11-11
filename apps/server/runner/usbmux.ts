import type { EventEmitter } from "node:events";
import net from "node:net";
import { RunnerError } from "./errors";
import { xmlEscape, xmlUnescape } from "./xml";

/**
 * A TCP port on a real iPhone, reached over its cable through macOS's usbmuxd (what libimobiledevice's `iproxy` does):
 * each message is a 16-byte header (length, version 1, type 8 for a plist, tag; little-endian) and an XML plist.
 * `Connect` turns the socket into a raw pipe to the phone's port.
 */

export const USBMUXD_SOCKET = "/var/run/usbmuxd";

type Plist = string | number | boolean | Buffer | Date | Plist[] | { [key: string]: Plist };

export function plistXml(value: Record<string, string | number>): string {
  const items = Object.entries(value).map(([k, v]) =>
    typeof v === "number"
      ? `<key>${xmlEscape(k)}</key><integer>${v}</integer>`
      : `<key>${xmlEscape(k)}</key><string>${xmlEscape(v)}</string>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${items.join("")}</dict></plist>\n`;
}

/** An XML plist's value (what usbmuxd answers); throws on anything that isn't one. */
export function parsePlist(xml: string): Plist {
  const tokens = [...xml.matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g)];
  let i = 0;
  const skip = () => {
    while (i < tokens.length && tokens[i]?.[4] !== undefined && !tokens[i]?.[4]?.trim()) i++;
  };
  const text = (tag: string) => {
    let out = "";
    while (i < tokens.length && tokens[i]?.[4] !== undefined) out += tokens[i++]?.[4];
    if (tokens[i]?.[1] !== "/" || tokens[i]?.[2] !== tag) throw new Error(`plist: </${tag}> expected`);
    i++;
    return xmlUnescape(out);
  };
  const value = (): Plist => {
    skip();
    const t = tokens[i++];
    if (!t || t[1] === "/" || t[4] !== undefined) throw new Error("plist: a value expected");
    const tag = t[2] as string;
    const empty = t[3] === "/";
    switch (tag) {
      case "true":
      case "false":
        if (!empty) text(tag);
        return tag === "true";
      case "string":
        return empty ? "" : text(tag);
      case "integer":
      case "real":
        return Number(text(tag));
      case "date":
        return new Date(text(tag));
      case "data":
        return Buffer.from(empty ? "" : text(tag).replace(/\s+/g, ""), "base64");
      case "array": {
        const out: Plist[] = [];
        if (empty) return out;
        for (;;) {
          skip();
          if (tokens[i]?.[1] === "/" && tokens[i]?.[2] === "array") {
            i++;
            return out;
          }
          out.push(value());
        }
      }
      case "dict": {
        const out: Record<string, Plist> = {};
        if (empty) return out;
        for (;;) {
          skip();
          const k = tokens[i++];
          if (k?.[1] === "/" && k[2] === "dict") return out;
          if (k?.[2] !== "key") throw new Error("plist: <key> expected");
          out[text("key")] = value();
        }
      }
      default:
        throw new Error(`plist: <${tag}> not read`);
    }
  };
  while (i < tokens.length && tokens[i]?.[2] !== "plist") i++;
  i++;
  return value();
}

export function usbmuxFrame(message: Record<string, string | number>, tag: number): Buffer {
  const body = Buffer.from(
    plistXml({ ClientVersionString: "agentes", ProgName: "agentes", kLibUSBMuxVersion: 3, ...message }),
  );
  const head = Buffer.alloc(16);
  head.writeUInt32LE(16 + body.length, 0);
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(8, 8);
  head.writeUInt32LE(tag, 12);
  return Buffer.concat([head, body]);
}

/** Sends one message on a fresh socket and reads one answer; the socket stays open (a `Connect` keeps it). */
function ask(socketPath: string, message: Record<string, string | number>, timeoutMs = 5000) {
  return new Promise<{ reply: Record<string, Plist>; socket: net.Socket }>((resolve, reject) => {
    const socket = net.connect(socketPath);
    let got = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error("usbmuxd didn't answer")), timeoutMs);
    const done = (err: Error | null, reply?: Record<string, Plist>) => {
      clearTimeout(timer);
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      if (err || !reply) {
        socket.destroy();
        reject(err);
      } else resolve({ reply, socket });
    };
    socket.on("error", (err) => done(err));
    socket.on("connect", () => socket.write(usbmuxFrame(message, 1)));
    socket.on("data", (chunk: Buffer) => {
      got = Buffer.concat([got, chunk]);
      if (got.length < 16) return;
      const length = got.readUInt32LE(0);
      if (got.length < length) return;
      const rest = got.subarray(length);
      try {
        const reply = parsePlist(got.subarray(16, length).toString("utf8"));
        if (rest.length > 0) socket.unshift(rest);
        done(null, typeof reply === "object" && !Array.isArray(reply) ? (reply as Record<string, Plist>) : {});
      } catch (err) {
        done(err as Error);
      }
    });
  });
}

/** usbmuxd's spelling of a UDID and devicectl's, alike. */
export const udidKey = (udid: string) => udid.replace(/-/g, "").toUpperCase();

/** The phones plugged in (not over Wi-Fi): usbmuxd's number by UDID (dashes dropped, upper case). */
export async function usbmuxPlugged(socketPath = USBMUXD_SOCKET): Promise<Map<string, number>> {
  const { reply, socket } = await ask(socketPath, { MessageType: "ListDevices" });
  socket.destroy();
  const out = new Map<string, number>();
  for (const d of Array.isArray(reply.DeviceList) ? reply.DeviceList : []) {
    const props = (d as Record<string, Plist>).Properties as Record<string, Plist> | undefined;
    if (props?.ConnectionType !== "USB" || typeof props.SerialNumber !== "string") continue;
    if (typeof props.DeviceID === "number") out.set(udidKey(props.SerialNumber), props.DeviceID);
  }
  return out;
}

/** usbmuxd's number for the phone with this UDID, plugged in (not over Wi-Fi); null when it isn't. */
export async function usbmuxDeviceId(udid: string, socketPath = USBMUXD_SOCKET): Promise<number | null> {
  return (await usbmuxPlugged(socketPath)).get(udidKey(udid)) ?? null;
}

/** A raw socket to `port` on the phone (`Connect` with the port in network byte order). */
export async function usbmuxConnect(deviceId: number, port: number, socketPath = USBMUXD_SOCKET) {
  const { reply, socket } = await ask(socketPath, {
    MessageType: "Connect",
    DeviceID: deviceId,
    PortNumber: ((port & 0xff) << 8) | (port >> 8),
  });
  if (reply.Number !== 0) {
    socket.destroy();
    throw new RunnerError(
      "internal",
      `The iPhone refused the connection to port ${port} (usbmuxd ${String(reply.Number)})`,
    );
  }
  return socket;
}

/** A port on this Mac's loopback that reaches `port` on the phone, one usbmux connection per client. */
export async function usbmuxForward(udid: string, port: number, socketPath = USBMUXD_SOCKET) {
  const deviceId = await usbmuxDeviceId(udid, socketPath);
  if (deviceId === null) throw new RunnerError("phone_missing", "The iPhone isn't plugged into this Mac.");
  const open = new Set<net.Socket>();
  const server = net.createServer((client) => {
    open.add(client);
    client.on("close", () => open.delete(client));
    client.pause();
    usbmuxConnect(deviceId, port, socketPath).then(
      (phone) => {
        client.pipe(phone).pipe(client);
        client.resume();
        const close = () => {
          client.destroy();
          phone.destroy();
        };
        client.on("error", close).on("close", close);
        phone.on("error", close).on("close", close);
      },
      () => client.destroy(),
    );
  });
  await new Promise<void>((resolve, reject) => {
    (server as unknown as EventEmitter).once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => {
      server.close();
      for (const c of open) c.destroy();
    },
  };
}
