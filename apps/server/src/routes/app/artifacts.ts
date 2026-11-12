import {
  ARTIFACT_LIMITS,
  ARTIFACT_PAGE_MAX,
  type ArtifactDeps,
  type ArtifactView,
  addFileVersion,
  answerChoices,
  artifactDownload,
  artifactFile,
  attachmentDisposition,
  BLOCK_REPLY_CHARS,
  BLOCK_STATE_KEYS,
  countArtifacts,
  createArtifact,
  createFileArtifact,
  DRAW_OPTIONS,
  deleteArtifact,
  drawBlock,
  getArtifact,
  getBlockState,
  getChoices,
  getPoll,
  keepBlock,
  listArtifacts,
  listArtifactVersions,
  listDeletedArtifacts,
  purgeArtifactNow,
  replyToBlock,
  restoreArtifact,
  setBlockState,
  setFileSharing,
  updateArtifact,
  ValidationError,
  votePoll,
  withPersonFacts,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { rangedResponse } from "../../http/byte-range";
import { apiError, errorResponse } from "../../http/errors";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  MULTIPART_SLACK_BYTES,
  noContent,
  OrgParams,
  requireSession,
  security,
} from "./context";

const tags = ["Drive"];
const Kind = z.enum(["document", "table", "diff", "html", "diagram", "file", "block", "poll", "choices"]);
const Author = z.object({ type: z.enum(["agent", "person"]), id: z.string() });

/** A comma-separated list in a query string, each item read by `item` (at most 50). */
const csv = <T>(description: string, item: z.ZodType<T, string>) =>
  z
    .string()
    .max(4000)
    .optional()
    .transform((v) =>
      v
        ?.split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(50).optional())
    .openapi({ description, type: "string" });
const AuthorKey = z
  .string()
  .regex(/^(agent|person):[\w-]{1,100}$/)
  .transform((v) => {
    const [type, id] = v.split(":") as ["agent" | "person", string];
    return { type, id };
  });

const textContents = [
  z.object({ kind: z.literal("document"), markdown: z.string() }),
  z.object({ kind: z.literal("table"), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  z.object({ kind: z.literal("diff"), files: z.array(z.object({ path: z.string(), patch: z.string() })) }),
  z.object({ kind: z.literal("diagram"), mermaid: z.string() }),
  z.object({ kind: z.literal("html"), html: z.string() }),
] as const;

/** What people send to create or edit: never a `file` (those are uploads). */
const ContentInput = z.discriminatedUnion("kind", [...textContents]).openapi("ArtifactContentInput");

const FileContent = z
  .object({
    kind: z.literal("file"),
    name: z.string().openapi({ description: "Original file name." }),
    contentType: z.string(),
    size: z.number().openapi({ description: "Bytes." }),
    sha256: z.string(),
    text: z.string().optional().openapi({ description: "Small UTF-8 text files only (≤ 40k characters)." }),
  })
  .openapi("ArtifactFileContent", {
    description: "An uploaded file as is: metadata only; the bytes come from the download link.",
  });

const Content = z
  .discriminatedUnion("kind", [
    ...textContents,
    FileContent,
    z.object({
      kind: z.literal("block"),
      // Checked by the engine (`parseBlockSpec`); typed loosely here, since the spec's own type nests too deep for zod.
      spec: z.any().optional().openapi({
        type: "object",
        description: "The block's parts, data and formulas, drawn by the apps (ADR 0113). Either this or html.",
      }),
      html: z
        .string()
        .optional()
        .openapi({ description: "The agent's own page, which runs only when a person opens it. Either this or spec." }),
      subtitle: z.string().optional(),
    }),
    z.object({
      kind: z.literal("poll"),
      question: z.string(),
      options: z.array(z.string()),
      multiple: z.boolean(),
    }),
    z.object({
      kind: z.literal("choices"),
      questions: z.array(
        z.object({
          question: z.string(),
          options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
        }),
      ),
    }),
  ])
  .openapi("ArtifactContent");

/** A file upload (multipart): at most 50 MB. */
const fileField = z.any().openapi({ type: "string", format: "binary", description: "The file (≤ 50 MB)." });
const multipart = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "multipart/form-data": { schema } },
});

const Audience = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("workspace") }),
    z.object({
      kind: z.literal("channel"),
      name: z.string(),
      private: z.boolean(),
      outside: z.literal(true).optional().openapi({
        description: "I don't read the channel: the file was shared with me (ADR 0157), so it can't be opened.",
      }),
    }),
    z.object({
      kind: z.literal("dm"),
      with: Author.nullable().openapi({ description: "The other participant." }),
      gone: z.literal(true).optional().openapi({
        description: "The other side is an archived agent or a person who left: the DM can't be opened.",
      }),
      between: z.array(Author).optional().openapi({
        description: "I'm not in the DM, the file was shared with me (ADR 0157): its sides, and no `with`.",
      }),
    }),
  ])
  .openapi("ArtifactAudience", { description: "Who can see the file, from the conversation it came from." });

const Sharing = z
  .object({
    mode: z.enum(["conversation", "people", "everyone"]),
    userIds: z.array(z.string()).max(200),
    roleIds: z.array(z.string()).max(200),
  })
  .openapi("ArtifactSharing", {
    description:
      "Who sees it on top of its conversation (ADR 0157): nobody more, the people and roles listed (and administrators), or the whole workspace.",
  });

const Artifact = z
  .object({
    id: z.uuid(),
    kind: Kind,
    title: z.string(),
    version: z.number(),
    channelId: z.uuid().nullable(),
    threadId: z.uuid().nullable(),
    createdBy: Author,
    updatedBy: Author,
    createdAt: z.string(),
    updatedAt: z.string(),
    canEdit: z.boolean(),
    untrusted: z.boolean().openapi({
      description:
        "HTML and files: never rendered on the app's origin (sandboxed iframe on another origin, or download).",
    }),
    inDrive: z.boolean().openapi({ description: "False for a block or a poll, which live in their conversation." }),
    canDelete: z.boolean().openapi({ description: "I may move it to the trash (and restore it)." }),
    audience: Audience,
    sharing: Sharing,
    canShare: z.boolean().openapi({
      description: "I may change its sharing: it lives in a conversation not everyone reads, and I read it there.",
    }),
  })
  .openapi("Artifact");

const Poll = z
  .object({
    id: z.string(),
    closesAt: z.string(),
    closedAt: z.string().nullable(),
    people: z.number().openapi({ description: "How many people can answer." }),
    votes: z.array(z.object({ userId: z.string(), option: z.number() })),
  })
  .openapi("Poll");

const BlockState = z
  .object({
    id: z.string(),
    version: z.number(),
    state: z.record(z.string(), z.unknown()),
    changes: z.record(
      z.string(),
      z.object({
        by: z.string(),
        name: z.string(),
        at: z.string(),
        drawn: z.number().optional().openapi({ description: "Drawn by the server among this many options." }),
      }),
    ),
    rev: z.number().openapi({ description: "Goes up on every change: keep the newest." }),
  })
  .openapi("BlockState");

const Choices = z
  .object({
    id: z.string(),
    answer: z
      .object({
        userId: z.string(),
        picks: z.array(z.number()).openapi({
          description:
            "The option picked for each question, in order. One past the question's last option: a written answer (`others`).",
        }),
        messageId: z.string().nullable(),
        at: z.string(),
        others: z
          .array(z.string().nullable())
          .optional()
          .openapi({ description: "What was written for each question answered in words (null for a picked option)." }),
      })
      .nullable(),
  })
  .openapi("Choices");

const ArtifactDetail = Artifact.extend({
  shownVersion: z.number(),
  content: Content,
  versioned: z.boolean().openapi({
    description: "It keeps versions (a history, new versions): false for a snapshot such as a screenshot.",
  }),
}).openapi("ArtifactDetail");

const ArtifactParams = OrgParams.extend({ artifactId: z.uuid() });
const VersionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });

/**
 * The Drive: files people and agents make (documents, tables, diffs, HTML
 * pages, diagrams, uploaded files), visible like the channel they came
 * from. Content lives in the org's storage; downloads are short-lived
 * signed links.
 */
export function artifactRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  // Uploads: the bytes are counted as they arrive, so a request that states no length is held to the same size.
  const sizeGuard = bodyLimit({
    maxSize: ARTIFACT_LIMITS.fileBytes + MULTIPART_SLACK_BYTES,
    onError: (c) => {
      const maxMb = ARTIFACT_LIMITS.fileBytes / 1024 / 1024;
      return apiError(c, 413, "artifact.file_too_large", `The file is too large (max ${maxMb} MB)`, { maxMb });
    },
  });
  app.use("/organizations/:orgId/artifacts/files", sizeGuard);
  app.use("/organizations/:orgId/artifacts/:artifactId/files", sizeGuard);
  /** The `file` field of an upload, checked, as bytes. */
  const uploaded = async (value: unknown) => {
    if (!(value instanceof File))
      throw new ValidationError("send the file in the field file", "artifact.file_required");
    if (value.size > ARTIFACT_LIMITS.fileBytes) {
      const maxMb = ARTIFACT_LIMITS.fileBytes / 1024 / 1024;
      throw new ValidationError(`the file is too large (max ${maxMb} MB)`, "artifact.file_too_large", { maxMb });
    }
    return { name: value.name, contentType: value.type || null, bytes: new Uint8Array(await value.arrayBuffer()) };
  };
  const artifacts = (): ArtifactDeps => {
    const a = deps.extras?.artifacts;
    if (!a) throw new Error("artifacts are not configured on this server");
    return a;
  };
  const person = (userId: string) => ({ type: "person" as const, userId });
  /** One file with what the viewer may do with it and who can see it. */
  const withFacts = async <T extends ArtifactView>(userId: string, orgId: string, a: T) => {
    const [out] = await withPersonFacts(db, userId, orgId, [a]);
    if (!out) throw new Error("withPersonFacts returned nothing for one file");
    return out;
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/artifacts",
      tags,
      security,
      summary: "Files you can see, newest update first",
      request: {
        params: OrgParams,
        query: z.object({
          q: z.string().max(200).optional(),
          kind: Kind.optional(),
          kinds: csv("Comma-separated kinds: any of them.", Kind),
          channelId: z.uuid().optional(),
          channelIds: csv("Comma-separated channel or DM ids: in any of them.", z.uuid()),
          authorType: z.enum(["agent", "person"]).optional(),
          authorId: z.string().optional(),
          /** With `authorType`/`authorId`: made or changed by them (any version), not only made. */
          changed: z.literal("1").optional(),
          authors: csv(
            "Comma-separated `agent:<id>` or `person:<id>`: made or last changed by any of them.",
            AuthorKey,
          ),
          who: z.enum(["agents", "people"]).optional().openapi({ description: "Made by an agent or by a person." }),
          sort: z.enum(["recent", "name", "kind"]).optional(),
          cursor: z
            .string()
            .regex(/^\d{1,7}$/)
            .optional()
            .openapi({ description: "`nextCursor` of the page before." }),
          limit: z.coerce.number().int().min(1).max(ARTIFACT_PAGE_MAX).optional(),
        }),
      },
      responses: {
        200: json(
          z.object({
            artifacts: z.array(Artifact),
            nextCursor: z.string().nullable().openapi({ description: "Where the next page starts; null at the end." }),
            counts: z
              .record(z.string(), z.number().int())
              .optional()
              .openapi({ description: "First page only: how many files per kind for these filters, kinds left out." }),
          }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      const query = c.req.valid("query");
      const author = query.authorType && query.authorId ? { type: query.authorType, id: query.authorId } : undefined;
      const filters = {
        q: query.q,
        kind: query.kind,
        kinds: query.kinds,
        channelId: query.channelId,
        channelIds: query.channelIds,
        authors: query.authors,
        who: query.who,
        ...(query.changed ? { changedBy: author } : { author }),
      };
      const limit = query.limit ?? 100;
      const offset = Number(query.cursor ?? 0);
      const rows = await listArtifacts(db, person(userId), orgId, {
        ...filters,
        sort: query.sort,
        limit: limit + 1,
        offset,
      });
      const page = rows.slice(0, limit);
      return c.json(
        {
          artifacts: await withPersonFacts(db, userId, orgId, page),
          nextCursor: rows.length > limit ? String(offset + limit) : null,
          ...(query.cursor ? {} : { counts: await countArtifacts(db, person(userId), orgId, filters) }),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/artifacts",
      tags,
      security,
      summary: "Create a file (in the Drive, or in a channel you belong to)",
      request: {
        params: OrgParams,
        body: body(
          z.object({
            title: z.string().min(1).max(200),
            channelId: z.uuid().nullable().optional(),
            content: ContentInput,
          }),
        ),
      },
      responses: { 201: json(ArtifactDetail, "Created"), ...errors },
    }),
    async (c) => {
      const userId = c.get("user").id;
      const { orgId } = c.req.valid("param");
      const created = await createArtifact(artifacts(), person(userId), orgId, c.req.valid("json"));
      return c.json(await withFacts(userId, orgId, created), 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/artifacts/files",
      tags,
      security,
      summary: "Upload a file as is (any type, ≤ 50 MB) to the Drive, or to a channel you belong to",
      request: {
        params: OrgParams,
        body: multipart(
          z.object({
            file: fileField,
            title: z.string().max(200).optional().openapi({ description: "Default: the file name." }),
            channelId: z.uuid().optional(),
            threadId: z.uuid().optional(),
          }),
        ),
      },
      responses: { 201: json(ArtifactDetail, "Created"), 413: errorResponse("The file is too large"), ...errors },
    }),
    async (c) => {
      const form = c.req.valid("form");
      const file = await uploaded(form.file);
      const userId = c.get("user").id;
      const { orgId } = c.req.valid("param");
      const created = await createFileArtifact(artifacts(), person(userId), orgId, {
        ...file,
        title: form.title?.trim() || file.name,
        channelId: form.channelId ?? null,
        threadId: form.threadId ?? null,
      });
      return c.json(await withFacts(userId, orgId, created), 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/artifacts/{artifactId}/files",
      tags,
      security,
      summary: "Upload a new version of a file (≤ 50 MB)",
      request: {
        params: ArtifactParams,
        body: multipart(z.object({ file: fileField, note: z.string().max(500).optional() })),
      },
      responses: { 200: json(ArtifactDetail), 413: errorResponse("The file is too large"), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const form = c.req.valid("form");
      const file = await uploaded(form.file);
      const userId = c.get("user").id;
      const saved = await addFileVersion(artifacts(), person(userId), orgId, artifactId, {
        ...file,
        note: form.note ?? null,
      });
      return c.json(await withFacts(userId, orgId, saved), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/artifacts/{artifactId}",
      tags,
      security,
      summary: "A file at a version (default: latest), with content",
      request: { params: ArtifactParams, query: VersionQuery },
      responses: { 200: json(ArtifactDetail), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const { version } = c.req.valid("query");
      const userId = c.get("user").id;
      return c.json(
        await withFacts(userId, orgId, await getArtifact(artifacts(), person(userId), orgId, artifactId, version)),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/artifacts/{artifactId}/versions",
      tags,
      security,
      summary: "Versions, newest first, with who made each and why",
      request: { params: ArtifactParams },
      responses: {
        200: json(
          z.object({
            versions: z.array(
              z.object({ version: z.number(), author: Author, note: z.string().nullable(), createdAt: z.string() }),
            ),
          }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const versions = await listArtifactVersions(artifacts(), person(c.get("user").id), orgId, artifactId);
      return c.json({ versions }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/artifacts/{artifactId}/versions",
      tags,
      security,
      summary: "Save a new version (documents and tables; files: upload to …/files); a stale baseVersion is 409",
      request: {
        params: ArtifactParams,
        body: body(
          z.object({
            content: ContentInput,
            note: z.string().max(500).nullable().optional(),
            baseVersion: z.number().int().min(1),
            title: z.string().min(1).max(200).optional(),
          }),
        ),
      },
      responses: { 200: json(ArtifactDetail), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const userId = c.get("user").id;
      const saved = await updateArtifact(artifacts(), person(userId), orgId, artifactId, c.req.valid("json"));
      return c.json(await withFacts(userId, orgId, saved), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/artifacts/{artifactId}/download",
      tags,
      security,
      summary: "A short-lived download link (signed by the bucket, or served by us)",
      request: { params: ArtifactParams, query: VersionQuery },
      responses: { 200: json(z.object({ url: z.string(), expiresAt: z.string() })), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const { version } = c.req.valid("query");
      return c.json(await artifactDownload(artifacts(), c.get("user").id, orgId, artifactId, version), 200);
    },
  );

  // The bytes, always as an attachment (HTML and uploaded files are never rendered on our origin).
  app.get("/organizations/:orgId/artifacts/:artifactId/file", async (c) => {
    const version = c.req.query("version");
    const format = c.req.query("format");
    const file = await artifactFile(artifacts(), c.get("user").id, c.req.param("orgId"), c.req.param("artifactId"), {
      version: version ? Number(version) : undefined,
      format: format === "csv" || format === "patch" || format === "pdf" || format === "docx" ? format : undefined,
    });
    // In parts when asked (a video starts at once and jumps without the whole file first).
    return rangedResponse(file.body, c.req.header("range"), {
      "content-type": file.contentType,
      "content-disposition": attachmentDisposition(file.filename),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      // no-transform: no proxy rewrites the bytes (Cloudflare's email obfuscation edits text/html).
      "cache-control": "private, no-store, no-transform",
    });
  });

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/artifacts/{artifactId}/sharing",
      tags,
      security,
      summary: "Who sees a file on top of its conversation (Compartilhar); whoever reads it there may change it",
      request: {
        params: ArtifactParams,
        body: body(
          z.object({
            mode: z.enum(["conversation", "people", "everyone"]),
            userIds: z.array(z.string()).max(200).optional(),
            roleIds: z.array(z.string()).max(200).optional(),
          }),
        ),
      },
      responses: { 200: json(Artifact), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const userId = c.get("user").id;
      const saved = await setFileSharing(artifacts(), userId, orgId, artifactId, c.req.valid("json"));
      return c.json(await withFacts(userId, orgId, saved), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/artifacts/{artifactId}/keep",
      tags,
      security,
      summary: "Keep a block in the Drive (it lives only in its conversation until then)",
      request: { params: ArtifactParams },
      responses: { 200: json(Artifact), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const userId = c.get("user").id;
      return c.json(await withFacts(userId, orgId, await keepBlock(artifacts(), userId, orgId, artifactId)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/artifacts/{artifactId}/reply",
      tags,
      security,
      summary: "Send a block's answer to the agent that made it, as the person's own message",
      description: "The apps show this exact text beside the button, outside the block, before it goes.",
      request: {
        params: ArtifactParams,
        body: body(
          z.object({
            text: z.string().min(1).max(BLOCK_REPLY_CHARS),
            clientId: z.string().max(64).nullable().optional(),
          }),
        ),
      },
      responses: {
        201: json(z.object({ id: z.string() })),
        ...errors,
        429: errorResponse("Too many messages (`rate_limited`)"),
      },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const user = c.get("user");
      const limit = await deps.adapters.rateLimiter.consume(`post:${user.id}`, { limit: 30, windowMs: 10_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Slow down");
      const message = await replyToBlock(
        {
          ...artifacts(),
          pubsub: deps.adapters.pubsub,
          judge: deps.extras?.context?.judge,
          talker: deps.extras?.talker,
        },
        user.id,
        orgId,
        artifactId,
        c.req.valid("json"),
      );
      deps.wakeWorkers?.();
      return c.json({ id: message.id }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/blocks/{artifactId}/state",
      tags,
      security,
      summary: "What a live block shows, the same for everyone in its conversation (ADR 0113)",
      request: { params: ArtifactParams, query: z.object({ version: z.coerce.number().int().min(1) }) },
      responses: { 200: json(BlockState), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const { version } = c.req.valid("query");
      return c.json(await getBlockState(artifacts(), c.get("user").id, orgId, artifactId, version), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/blocks/{artifactId}/state",
      tags,
      security,
      summary: "Set values in a live block, for everyone who sees it",
      description: "Merged into the block's state; everyone in the conversation gets `block.state`.",
      request: {
        params: ArtifactParams,
        body: body(
          z.object({
            version: z.number().int().min(1),
            values: z.record(z.string().max(64), z.unknown()).refine((v) => Object.keys(v).length <= BLOCK_STATE_KEYS),
          }),
        ),
      },
      responses: { 200: json(BlockState), ...errors, 429: errorResponse("Too many changes (`rate_limited`)") },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const user = c.get("user");
      const limit = await deps.adapters.rateLimiter.consume(`block:${user.id}`, { limit: 60, windowMs: 10_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Slow down");
      return c.json(await setBlockState(artifacts(), user.id, orgId, artifactId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/blocks/{artifactId}/draw",
      tags,
      security,
      summary: "Draw one of the options at random for a live block, once, the same for everyone",
      request: {
        params: ArtifactParams,
        body: body(
          z.object({
            version: z.number().int().min(1),
            name: z.string().min(1).max(64),
            options: z
              .array(z.union([z.string().max(200), z.number()]))
              .min(2)
              .max(DRAW_OPTIONS),
          }),
        ),
      },
      responses: { 200: json(BlockState), ...errors, 429: errorResponse("Too many changes (`rate_limited`)") },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const user = c.get("user");
      const limit = await deps.adapters.rateLimiter.consume(`block:${user.id}`, { limit: 60, windowMs: 10_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Slow down");
      return c.json(await drawBlock(artifacts(), user.id, orgId, artifactId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/polls/{artifactId}",
      tags,
      security,
      summary: "A vote in a conversation: who marked what, and when it closes",
      request: { params: ArtifactParams },
      responses: { 200: json(Poll), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      return c.json(await getPoll(artifacts(), c.get("user").id, orgId, artifactId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/polls/{artifactId}/vote",
      tags,
      security,
      summary: "Mark options in a vote, replacing your last choice (empty takes it back)",
      request: {
        params: ArtifactParams,
        body: body(z.object({ options: z.array(z.number().int().min(0)).max(8) })),
      },
      responses: { 200: json(Poll), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      return c.json(await votePoll(artifacts(), c.get("user").id, orgId, artifactId, c.req.valid("json").options), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/choices/{artifactId}",
      tags,
      security,
      summary: "A choice card in a conversation: its answer, once someone picked (ADR 0124)",
      request: { params: ArtifactParams },
      responses: { 200: json(Choices), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      return c.json(await getChoices(artifacts(), c.get("user").id, orgId, artifactId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/choices/{artifactId}/answer",
      tags,
      security,
      summary:
        "Answer a choice card: one option per question, or a written answer, sent to its agent as the person's own message",
      description:
        'Once: the first answer in wins (409 `choices.answered` after that). A question answered in words ("Outra resposta") takes the pick one past its last option and the text at its place in `others`.',
      request: {
        params: ArtifactParams,
        body: body(
          z.object({
            picks: z.array(z.number().int().min(0)).min(1).max(ARTIFACT_LIMITS.choiceQuestions),
            others: z
              .array(z.string().max(ARTIFACT_LIMITS.choiceOtherChars).nullable())
              .max(ARTIFACT_LIMITS.choiceQuestions)
              .nullable()
              .optional(),
            clientId: z.string().max(64).nullable().optional(),
          }),
        ),
      },
      responses: {
        200: json(z.object({ choices: Choices, messageId: z.string() })),
        ...errors,
        429: errorResponse("Too many messages (`rate_limited`)"),
      },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      const user = c.get("user");
      const limit = await deps.adapters.rateLimiter.consume(`post:${user.id}`, { limit: 30, windowMs: 10_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Slow down");
      const out = await answerChoices(
        {
          ...artifacts(),
          pubsub: deps.adapters.pubsub,
          judge: deps.extras?.context?.judge,
          talker: deps.extras?.talker,
        },
        user.id,
        orgId,
        artifactId,
        c.req.valid("json"),
      );
      deps.wakeWorkers?.();
      return c.json({ choices: out.choices, messageId: out.message.id }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/artifacts/{artifactId}",
      tags,
      security,
      summary:
        "Delete a file (who created it, who asked the agent, the agent's owner, or an admin). Restorable for 30 days",
      request: { params: ArtifactParams },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      await deleteArtifact(artifacts(), c.get("user").id, orgId, artifactId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/artifacts/{artifactId}/restore",
      tags,
      security,
      summary: "Restore a deleted file (within 30 days)",
      request: { params: ArtifactParams },
      responses: { 200: json(z.object({ id: z.uuid(), title: z.string() }).passthrough()), ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      return c.json(await restoreArtifact(artifacts(), c.get("user").id, orgId, artifactId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/artifacts-trash",
      tags,
      security,
      summary: "Lixeira: files deleted in the last 30 days that I may restore",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            files: z.array(
              z.object({
                id: z.uuid(),
                title: z.string(),
                kind: z.string(),
                channelId: z.uuid().nullable(),
                createdBy: z.object({ type: z.enum(["person", "agent"]), id: z.string() }),
                deletedAt: z.string(),
                purgeAt: z.string().openapi({ description: "When its contents go for good." }),
              }),
            ),
          }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      return c.json({ files: await listDeletedArtifacts(db, c.get("user").id, orgId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/artifacts-trash/{artifactId}",
      tags,
      security,
      summary: "Delete a file in the trash for good, now (the same people who may restore it)",
      request: { params: ArtifactParams },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const { orgId, artifactId } = c.req.valid("param");
      await purgeArtifactNow(artifacts(), c.get("user").id, orgId, artifactId);
      return c.body(null, 204);
    },
  );

  return app;
}
