import { Database as SQLite } from "bun:sqlite";
import fs, { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type QueryOptions, type Results, type Transaction } from "@electric-sql/pglite";
import { NodeFS } from "@electric-sql/pglite/nodefs";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";

/**
 * The database built into the server (native mode, ADR 0060 §2): PGlite, Postgres compiled to
 * WebAssembly (the engine the tests run on), with pgvector, keeping its files in one folder.
 */

/** The PGlite this build runs (pinned exactly in package.json) and the Postgres major of the files it writes. */
export const PGLITE_VERSION = "0.5.8";
export const PG_MAJOR = 18;

/** `pglite:///absolute/folder`: the folder, as written (no percent-encoding); on Windows `pglite:///C:\folder`. */
const PGLITE_URL = /^pglite:\/\/(\/.*)$/;
/** A Windows folder after the URL's third slash (`/C:\…`, `/C:/…`). */
const WINDOWS_DRIVE = /^\/[A-Za-z]:[\\/]/;

/** Next to the database's own files: the PGlite and the Postgres major that wrote them. */
export const FOLDER_FILE = "agentes.json";

export interface FolderVersion {
  pglite: string;
  pgMajor: number;
}

/** The folder of a `pglite:///…` database URL; null for any other URL. */
export function pgliteFolder(url: string): string | null {
  const path = PGLITE_URL.exec(url)?.[1];
  if (!path) return null;
  return WINDOWS_DRIVE.test(path) ? path.slice(1) : path;
}

/** The database URL of a folder (an absolute path): `pglite:///home/…`, or `pglite:///C:\Users\…` on Windows. */
export const pgliteUrl = (folder: string) => `pglite://${folder.startsWith("/") ? "" : "/"}${folder}`;

/** The folder holds another Postgres major's files: it opens only after a dump and a restore. */
export class PgMajorMismatchError extends Error {
  constructor(
    readonly folder: string,
    readonly folderMajor: number,
  ) {
    super(
      `The database in ${folder} was written by Postgres ${folderMajor}, and this version runs Postgres ${PG_MAJOR}: it needs a dump with the previous version and a restore with this one.`,
    );
    this.name = "PgMajorMismatchError";
  }
}

/** What wrote the files in `folder`: its `agentes.json`, else Postgres's own `PG_VERSION`; null for a new folder. */
export function folderVersion(folder: string): FolderVersion | null {
  try {
    const v = JSON.parse(readFileSync(join(folder, FOLDER_FILE), "utf8")) as Partial<FolderVersion>;
    if (typeof v.pgMajor === "number") return { pglite: String(v.pglite ?? ""), pgMajor: v.pgMajor };
  } catch {
    // not there, or not ours: Postgres's own file says the major
  }
  try {
    const major = Number.parseInt(readFileSync(join(folder, "PG_VERSION"), "utf8"), 10);
    if (Number.isInteger(major)) return { pglite: "", pgMajor: major };
  } catch {
    // a new folder
  }
  return null;
}

/** Whether `folder` holds no database yet (missing, or empty). */
export function isEmptyFolder(folder: string): boolean {
  try {
    return readdirSync(folder).length === 0;
  } catch {
    return !existsSync(folder);
  }
}

function recordFolder(folder: string) {
  const current = folderVersion(folder);
  if (current?.pglite === PGLITE_VERSION && current.pgMajor === PG_MAJOR) return;
  const file = join(folder, FOLDER_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ pglite: PGLITE_VERSION, pgMajor: PG_MAJOR })}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** Another process has the folder's database open: two Postgres engines writing one folder corrupt it. */
export class DatabaseInUseError extends Error {
  constructor(readonly folder: string) {
    super(`The database in ${folder} is open in another program. Stop that one first.`);
    this.name = "DatabaseInUseError";
  }
}

/** The file beside a database folder whose lock says a process has that database open. */
export const folderLockFile = (folder: string) => `${folder}.lock`;

/**
 * Every lock this process holds. Bun closes a SQLite handle the garbage collector reclaims, and the system
 * drops its lock with it: a database dropped without being closed would let another process open its folder.
 */
const heldLocks = new Set<SQLite>();

/**
 * Locks `folder` for this process until the returned function runs, or the process ends however it ends:
 * the lock is the system's own file lock, which SQLite takes on an empty file for an open write transaction.
 * The file sits beside the folder, never in it: Postgres opens every file of its folder when it recovers, and
 * closing any descriptor of a file drops this process's lock on it.
 */
function lockFolder(folder: string): () => void {
  const lock = new SQLite(folderLockFile(folder), { create: true });
  try {
    // Nothing is ever written: a journal on disk would only be a file a crash leaves behind.
    lock.exec("PRAGMA journal_mode = MEMORY");
    lock.exec("BEGIN IMMEDIATE");
  } catch (error) {
    lock.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") throw new DatabaseInUseError(folder);
    throw error;
  }
  heldLocks.add(lock);
  return () => {
    heldLocks.delete(lock);
    lock.close();
  };
}

/**
 * PGlite starts Postgres with fsync off (`-F`), and its Node filesystem has no fsync, so a commit reached the
 * system's cache with no promise of reaching the disk: a power cut could lose it or leave the folder unopenable.
 * Here Postgres syncs, through fsync() (PGlite's fdatasync does nothing), and each sync reaches the disk.
 */
const DURABLE_START = [...PGlite.defaultStartParams.filter((p) => p !== "-F"), "-c", "wal_sync_method=fsync"];

type EmscriptenOptions = Parameters<NodeFS["init"]>[1];
type PostgresModule = Parameters<NonNullable<EmscriptenOptions["preRun"]>[number]>[0];

interface NodeStream {
  nfd?: number;
  node: unknown;
}

/** What a system says when it can't sync a folder: the answers Postgres lets pass for one (`fsync_fname_ext`), and EPERM. */
const FOLDER_SYNC_REFUSED = new Set(["EISDIR", "EPERM", "EACCES", "EBADF", "EINVAL"]);
const refused = (error: unknown) => FOLDER_SYNC_REFUSED.has((error as { code?: string } | null)?.code ?? "");

/**
 * Syncs a folder's list of files, after Postgres created or renamed one in it. Windows can't open a folder to read it
 * (`openSync(folder, "r")` fails there), so it skips; a system that refuses is let through, as Postgres does. Thrown,
 * either one became an error inside Postgres's fsync, which aborted the database ("Aborted()") as soon as an existing
 * folder was opened on Windows. `io`: the filesystem calls (tests replace them).
 */
export function syncFolder(
  path: string,
  platform: string = process.platform,
  io: Pick<typeof fs, "openSync" | "fsyncSync" | "closeSync"> = fs,
): void {
  if (platform === "win32") return;
  let fd: number;
  try {
    fd = io.openSync(path, "r");
  } catch (error) {
    if (refused(error)) return;
    throw error;
  }
  try {
    io.fsyncSync(fd);
  } catch (error) {
    if (!refused(error)) throw error;
  } finally {
    io.closeSync(fd);
  }
}

class DurableNodeFS extends NodeFS {
  override async init(pg: PGlite, opts: EmscriptenOptions) {
    const { emscriptenOpts } = await super.init(pg, opts);
    const addSync = (mod: PostgresModule) => {
      const nodefs = mod.FS.filesystems.NODEFS as unknown as {
        stream_ops: { fsync?: (stream: NodeStream) => number };
        realPath(node: unknown): string;
        tryFSOperation<T>(run: () => T): T;
      };
      nodefs.stream_ops.fsync = (stream) =>
        nodefs.tryFSOperation(() => {
          if (stream.nfd !== undefined) {
            fs.fsyncSync(stream.nfd);
            return 0;
          }
          // A folder (Postgres syncs one after creating or renaming a file in it).
          syncFolder(nodefs.realPath(stream.node));
          return 0;
        });
    };
    return { emscriptenOpts: { ...emscriptenOpts, preRun: [...(emscriptenOpts.preRun ?? []), addSync] } };
  }
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * The database of one folder. PGlite answers within the same turn of the event loop, and hands its next
 * waiter the turn at once, so queries queued together (a page's requests, a migration, a busy worker) would
 * hold timers and sockets back until they all end: each query and transaction starts a turn after the one
 * before it, and so does each query inside a transaction. Closing it lets another process open the folder.
 */
class FolderPGlite extends PGlite {
  #last: Promise<unknown> = Promise.resolve();
  #started = false;

  constructor(
    folder: string,
    private readonly unlock: () => void,
  ) {
    super({ fs: new DurableNodeFS(folder), extensions: { vector }, startParams: DURABLE_START });
    this.waitReady.then(
      () => {
        this.#started = true;
      },
      () => undefined,
    );
  }

  #inTurn<T>(work: () => Promise<T>): Promise<T> {
    // While PGlite starts, its own queries (its types) and any made meanwhile run as they come: queued,
    // an early one would wait for a start that waits for the queries behind it. PGlite holds them all
    // until it has started.
    if (!this.#started) return work();
    const run = this.#last.then(nextTurn).then(work);
    this.#last = run.catch(() => undefined);
    return run;
  }

  override query<T>(query: string, params?: unknown[], options?: QueryOptions): Promise<Results<T>> {
    return this.#inTurn(() => super.query<T>(query, params, options));
  }

  override exec(query: string, options?: QueryOptions): Promise<Results[]> {
    return this.#inTurn(() => super.exec(query, options));
  }

  override transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    // The transaction's other members (rollback, closed) stay its own, through the prototype.
    return this.#inTurn(() =>
      super.transaction((tx) =>
        callback(
          Object.create(tx, {
            query: {
              value: <R>(q: string, p?: unknown[], o?: QueryOptions) => nextTurn().then(() => tx.query<R>(q, p, o)),
            },
            exec: { value: (q: string, o?: QueryOptions) => nextTurn().then(() => tx.exec(q, o)) },
          }) as Transaction,
        ),
      ),
    );
  }

  override async close() {
    try {
      await super.close();
    } finally {
      this.unlock();
    }
  }
}

/**
 * Opens the database in `folder`, creating it when the folder is new. Throws `PgMajorMismatchError`
 * before touching anything when the folder holds another Postgres major's files, and `DatabaseInUseError`
 * when another process has it open. `ready` resolves once PGlite has started and the folder records what
 * wrote it.
 */
export function openPglite(folder: string): { pg: PGlite; ready: Promise<void> } {
  const found = folderVersion(folder);
  if (found && found.pgMajor !== PG_MAJOR) throw new PgMajorMismatchError(folder, found.pgMajor);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const unlock = lockFolder(folder);
  try {
    const pg = new FolderPGlite(folder, unlock);
    return { pg, ready: pg.waitReady.then(() => recordFolder(folder)) };
  } catch (error) {
    unlock();
    throw error;
  }
}

/**
 * The whole database as plain SQL, with INSERTs instead of COPY: `restorePglite` and `psql` both run it,
 * so it also moves the data to a Postgres server (the Docker install's). No owners or grants, which name
 * roles that only exist where the dump was made.
 */
export async function dumpPglite(folder: string): Promise<string> {
  const { pg, ready } = openPglite(folder);
  try {
    await ready;
    const file = await pgDump({ pg, args: ["--rows-per-insert=100", "--no-owner", "--no-privileges"] });
    return await file.text();
  } finally {
    await pg.close();
  }
}

/** Runs a dump (`dumpPglite`, or `pg_dump --inserts` of a Postgres server) into a new database in `folder`. */
export async function restorePglite(folder: string, dump: string): Promise<void> {
  if (!isEmptyFolder(folder)) throw new Error(`${folder} already holds a database`);
  const { pg, ready } = openPglite(folder);
  try {
    await ready;
    // The \restrict and \unrestrict lines a Postgres server's pg_dump writes are psql's, not SQL.
    await pg.exec(dump.replace(/^\\(?:un)?restrict [A-Za-z0-9]+$/gm, ""));
  } finally {
    await pg.close();
  }
}
