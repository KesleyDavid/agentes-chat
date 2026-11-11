import type { ConnectorCategory } from "./catalog";
import { canonicalResource } from "./oauth-mcp";

/**
 * One-click connectors: vendors' official remote MCP servers that speak MCP
 * OAuth with Dynamic Client Registration (no app of ours to register). Each
 * was checked (2026-10-15, and 2026-10-28 from GitLab on): the server
 * answers 401 with OAuth, its authorization server publishes a
 * `registration_endpoint` and PKCE S256.
 * They connect like any custom MCP server; after the OAuth, our suggested
 * classification (read tools free, writes approved, destructive ones need
 * approval) is applied at once, and admins can change it.
 *
 * A preset marked `soon` is one whose vendor doesn't accept the registration
 * yet (its redirect URI or client name, or registration itself is limited to
 * clients the vendor approved); it stays `soon` until the vendor does.
 * Calendly accepts only letters, digits, hyphens and spaces in the client
 * name: `ensureOAuthClient` registers it again without the dot.
 *
 * Left out as servers of their own: HubSpot (its authorization server has
 * no dynamic registration: it needs an app registered with HubSpot). Slack,
 * Zendesk, Box, Render, PagerDuty, Front, Pipedrive, Shopify and Microsoft 365
 * also need an app registered with them.
 *
 * A preset with a `composio` way (ADR 0107) also connects through Composio, on
 * Composio's own OAuth app only (`ComposioWay.auth`): a service with no server
 * that connects today (Google Drive, Slack, HubSpot…) and the `soon` ones
 * Composio signs in to. `connectorListing` picks one way per service.
 */
export interface McpPreset {
  id: string;
  /**
   * The brand, and in parentheses what a variant is ("Supabase (read-only)"), in English. It is a new connection's
   * name, so two presets never share one; the apps translate it by `id` and sign in "on" the brand alone.
   */
  label: string;
  description: string;
  category: ConnectorCategory;
  /** Icon name in the app's icon set (falls back to a generic plug). */
  icon: string;
  serverUrl: string;
  /**
   * Tools the server itself keeps read-only, suggested as read whatever their
   * name (Supabase's `execute_sql` with `read_only=true` runs as a read-only
   * Postgres user). Every other tool keeps our usual suggestion.
   */
  readTools?: readonly string[];
  /** The vendor hasn't approved agentes.chat yet: listed greyed out ("Em breve"), not connectable in one click. */
  soon?: true;
  /**
   * The Cloud offers OAuth only, no API key: the vendor's terms forbid an app asking its users for their token
   * (Intercom: "Never ask users for their Access Tokens", developers.intercom.com, Authentication). Self-hosted, a
   * workspace connects its own data, which is what those tokens are for, so the key stays.
   */
  cloudOAuthOnly?: true;
  /** How its server takes an API key in `Authorization` (Semrush: `Apikey <key>`); default `Bearer`. */
  keyScheme?: string;
  /**
   * The read-only tool that lists the accounts a sign-in reaches: its answer (JSON) keeps them at `list`, each one's
   * id made of the values at `id` and its name at `name` (dotted paths). Two connections are the same account when
   * they reach the same ones. Without `list` the answer is the one account (a Composio action, called with `args`).
   */
  account?: { tool: string; list?: string; id: readonly string[]; name: string; args?: Record<string, unknown> };
  /** The service through Composio (ADR 0107): the way it connects when no server of its own does. */
  composio?: ComposioWay;
}

/** A service through Composio (ADR 0107 §3). */
export interface ComposioWay {
  /** Composio's toolkit (`googledrive`); its actions start with it in capitals (`GOOGLEDRIVE_FIND_FILE`). */
  toolkit: string;
  /** The toolkit's pinned version: the schemas the model sees are the ones that run. */
  version: string;
  /**
   * Composio's own OAuth app, the only sign-in a way may take: plug-and-play, with no key for the person to paste and
   * no app of ours to register. A service Composio connects only with a key or an app of our own gets no way (product
   * decision: it would add to the Composio bill for what a connector of our own could do). `connectors-presets.test.ts`
   * checks every preset.
   */
  auth: "managed";
  /** The explicit actions agents get: never a meta tool, a raw query or a proxy. */
  actions: readonly string[];
  /** Actions that always ask a person, whatever their words say (they publish, spend or invite). */
  ask?: readonly string[];
  /** What the actions start with when it isn't the toolkit in capitals. */
  prefix?: string;
}

/** Where a Composio toolkit is "connected": an address nothing fetches, that only names the service. */
export const composioToolkitUrl = (toolkit: string) => `https://backend.composio.dev/api/v3.1/toolkits/${toolkit}`;

const COMPOSIO_TOOLKIT_URL = /^https:\/\/backend\.composio\.dev\/api\/v3\.1\/toolkits\/([a-z0-9_]+)\/?$/i;

/** The toolkit a Composio address names, else null. */
export const composioToolkitOf = (serverUrl: string | null | undefined) =>
  COMPOSIO_TOOLKIT_URL.exec(serverUrl ?? "")?.[1]?.toLowerCase() ?? null;

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "linear",
    category: "product",
    label: "Linear",
    description: "Linear issues, projects and cycles.",
    icon: "linear",
    serverUrl: "https://mcp.linear.app/mcp",
  },
  {
    id: "sentry",
    category: "dev",
    label: "Sentry",
    description: "Sentry errors, issues and releases.",
    icon: "sentry",
    serverUrl: "https://mcp.sentry.dev/mcp",
  },
  {
    id: "notion",
    category: "docs",
    label: "Notion",
    description: "Notion pages and databases.",
    icon: "notion",
    serverUrl: "https://mcp.notion.com/mcp",
  },
  {
    id: "drive",
    category: "docs",
    label: "Google Drive",
    description: "Google Drive files and folders: search, read, create and share.",
    icon: "drive",
    serverUrl: composioToolkitUrl("googledrive"),
    // One billed call names the account: its Google address.
    account: {
      tool: "GOOGLEDRIVE_GET_ABOUT",
      args: { fields: "user" },
      id: ["user.emailAddress"],
      name: "user.emailAddress",
    },
    composio: {
      toolkit: "googledrive",
      version: "20261022_00",
      auth: "managed",
      actions: [
        "GOOGLEDRIVE_FIND_FILE",
        "GOOGLEDRIVE_GET_FILE_METADATA",
        "GOOGLEDRIVE_DOWNLOAD_FILE",
        "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE",
        "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
        "GOOGLEDRIVE_CREATE_FOLDER",
        "GOOGLEDRIVE_MOVE_FILE",
        "GOOGLEDRIVE_CREATE_COMMENT",
        "GOOGLEDRIVE_CREATE_PERMISSION",
      ],
      ask: ["GOOGLEDRIVE_CREATE_PERMISSION"],
    },
  },
  {
    id: "google-docs",
    category: "docs",
    label: "Google Docs",
    description: "Google Docs documents, read and written as text.",
    icon: "google-docs",
    serverUrl: composioToolkitUrl("googledocs"),
    composio: {
      toolkit: "googledocs",
      version: "20261008_00",
      auth: "managed",
      actions: [
        "GOOGLEDOCS_SEARCH_DOCUMENTS",
        "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT",
        "GOOGLEDOCS_GET_DOCUMENT_BY_ID",
        "GOOGLEDOCS_CREATE_DOCUMENT",
        "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
        "GOOGLEDOCS_INSERT_TEXT_ACTION",
        "GOOGLEDOCS_REPLACE_ALL_TEXT",
        "GOOGLEDOCS_UPDATE_DOCUMENT_SECTION_MARKDOWN",
        "GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN",
        "GOOGLEDOCS_COPY_DOCUMENT",
        "GOOGLEDOCS_EXPORT_DOCUMENT_AS_PDF",
      ],
      ask: ["GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN"],
    },
  },
  {
    id: "google-sheets",
    category: "docs",
    label: "Google Sheets",
    description: "Google Sheets spreadsheets: read, add rows and update cells.",
    icon: "google-sheets",
    serverUrl: composioToolkitUrl("googlesheets"),
    composio: {
      toolkit: "googlesheets",
      version: "20261018_00",
      auth: "managed",
      actions: [
        "GOOGLESHEETS_SEARCH_SPREADSHEETS",
        "GOOGLESHEETS_GET_SPREADSHEET_INFO",
        "GOOGLESHEETS_GET_SHEET_NAMES",
        "GOOGLESHEETS_VALUES_GET",
        "GOOGLESHEETS_BATCH_GET",
        "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
        "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
        "GOOGLESHEETS_ADD_SHEET",
        "GOOGLESHEETS_VALUES_UPDATE",
        "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
        "GOOGLESHEETS_UPDATE_VALUES_BATCH",
        "GOOGLESHEETS_CLEAR_VALUES",
        "GOOGLESHEETS_DELETE_SHEET",
      ],
      ask: ["GOOGLESHEETS_CLEAR_VALUES"],
    },
  },
  {
    id: "onedrive",
    category: "docs",
    label: "OneDrive",
    description: "OneDrive files and folders (Microsoft 365).",
    icon: "onedrive",
    serverUrl: composioToolkitUrl("one_drive"),
    composio: {
      toolkit: "one_drive",
      version: "20261029_00",
      auth: "managed",
      actions: [
        "ONE_DRIVE_SEARCH_ITEMS",
        "ONE_DRIVE_ONEDRIVE_LIST_ITEMS",
        "ONE_DRIVE_ONEDRIVE_FIND_FILE",
        "ONE_DRIVE_ONEDRIVE_FIND_FOLDER",
        "ONE_DRIVE_GET_ITEM",
        "ONE_DRIVE_DOWNLOAD_FILE",
        "ONE_DRIVE_ONEDRIVE_CREATE_TEXT_FILE",
        "ONE_DRIVE_ONEDRIVE_CREATE_FOLDER",
        "ONE_DRIVE_MOVE_ITEM",
        "ONE_DRIVE_COPY_ITEM",
        "ONE_DRIVE_CREATE_LINK",
        "ONE_DRIVE_INVITE_USER_TO_ITEM",
        "ONE_DRIVE_DELETE_ITEM",
      ],
      ask: ["ONE_DRIVE_CREATE_LINK"],
    },
  },
  {
    id: "atlassian",
    category: "product",
    label: "Atlassian",
    description: "Jira issues and Confluence pages.",
    icon: "atlassian",
    serverUrl: "https://mcp.atlassian.com/v1/mcp",
  },
  {
    id: "google-calendar",
    category: "product",
    label: "Google Calendar",
    description: "Google Calendar events, schedules and free time.",
    icon: "google-calendar",
    serverUrl: composioToolkitUrl("googlecalendar"),
    composio: {
      toolkit: "googlecalendar",
      version: "20261010_00",
      auth: "managed",
      actions: [
        "GOOGLECALENDAR_LIST_CALENDARS",
        "GOOGLECALENDAR_EVENTS_LIST",
        "GOOGLECALENDAR_FIND_EVENT",
        "GOOGLECALENDAR_EVENTS_GET",
        "GOOGLECALENDAR_FIND_FREE_SLOTS",
        "GOOGLECALENDAR_CREATE_EVENT",
        "GOOGLECALENDAR_QUICK_ADD",
        "GOOGLECALENDAR_UPDATE_EVENT",
        "GOOGLECALENDAR_PATCH_EVENT",
        "GOOGLECALENDAR_DELETE_EVENT",
      ],
      ask: [
        "GOOGLECALENDAR_CREATE_EVENT",
        "GOOGLECALENDAR_QUICK_ADD",
        "GOOGLECALENDAR_UPDATE_EVENT",
        "GOOGLECALENDAR_PATCH_EVENT",
      ],
    },
  },
  {
    id: "slack",
    category: "product",
    label: "Slack",
    description: "Slack channels, messages and threads.",
    icon: "slack",
    serverUrl: composioToolkitUrl("slack"),
    composio: {
      toolkit: "slack",
      version: "20261023_00",
      auth: "managed",
      actions: [
        "SLACK_FIND_CHANNELS",
        "SLACK_FETCH_CONVERSATION_HISTORY",
        "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
        "SLACK_SEARCH_MESSAGES",
        "SLACK_FIND_USERS",
        "SLACK_FIND_USER_BY_EMAIL_ADDRESS",
        "SLACK_DOWNLOAD_SLACK_FILE",
        "SLACK_ADD_REACTION_TO_AN_ITEM",
        "SLACK_CREATE_A_REMINDER",
        "SLACK_CREATE_CHANNEL",
        "SLACK_SEND_MESSAGE",
        "SLACK_SCHEDULE_MESSAGE",
        "SLACK_UPDATES_A_SLACK_MESSAGE",
        "SLACK_DELETES_A_MESSAGE_FROM_A_CHAT",
        "SLACK_INVITE_USER_TO_CHANNEL",
      ],
      ask: ["SLACK_UPDATES_A_SLACK_MESSAGE"],
    },
  },
  {
    id: "microsoft-teams",
    category: "product",
    label: "Microsoft Teams",
    description: "Microsoft Teams teams, channels, chats and meetings.",
    icon: "microsoft-teams",
    serverUrl: composioToolkitUrl("microsoft_teams"),
    composio: {
      toolkit: "microsoft_teams",
      version: "20261029_00",
      auth: "managed",
      actions: [
        "MICROSOFT_TEAMS_TEAMS_LIST",
        "MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS",
        "MICROSOFT_TEAMS_TEAMS_LIST_CHANNEL_MESSAGES",
        "MICROSOFT_TEAMS_LIST_MESSAGE_REPLIES",
        "MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS",
        "MICROSOFT_TEAMS_LIST_USER_CHAT_MESSAGES",
        "MICROSOFT_TEAMS_SEARCH_MESSAGES",
        "MICROSOFT_TEAMS_LIST_USERS",
        "MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE",
        "MICROSOFT_TEAMS_TEAMS_POST_CHAT_MESSAGE",
        "MICROSOFT_TEAMS_POST_MESSAGE_REPLY",
        "MICROSOFT_TEAMS_CREATE_MEETING",
      ],
      ask: ["MICROSOFT_TEAMS_CREATE_MEETING"],
    },
  },
  {
    id: "asana",
    category: "product",
    label: "Asana",
    description: "Asana tasks, projects and teams.",
    icon: "asana",
    serverUrl: "https://mcp.asana.com/mcp",
    soon: true,
    composio: {
      toolkit: "asana",
      version: "20261013_00",
      auth: "managed",
      actions: [
        "ASANA_GET_MULTIPLE_WORKSPACES",
        "ASANA_GET_WORKSPACE_PROJECTS",
        "ASANA_GET_A_PROJECT",
        "ASANA_GET_SECTIONS_IN_PROJECT",
        "ASANA_GET_TASKS_FROM_A_PROJECT",
        "ASANA_SEARCH_TASKS_IN_WORKSPACE",
        "ASANA_GET_A_TASK",
        "ASANA_GET_STORIES_FOR_TASK",
        "ASANA_CREATE_A_TASK",
        "ASANA_UPDATE_A_TASK",
        "ASANA_CREATE_SUBTASK",
        "ASANA_CREATE_TASK_COMMENT",
        "ASANA_ADD_TASK_TO_SECTION",
        "ASANA_CREATE_A_PROJECT",
        "ASANA_DELETE_TASK",
      ],
    },
  },
  {
    id: "stripe",
    category: "payments",
    label: "Stripe",
    description: "Stripe customers, payments, subscriptions and invoices.",
    icon: "stripe",
    serverUrl: "https://mcp.stripe.com",
    // Stripe's sign-in offers only the `mcp` scope (no OpenID) and may reach several accounts (a live one and its
    // sandboxes). An OAuth session lists them with this tool, `{ accounts: [{ stripe_context, livemode, name }] }`,
    // not with the `get_stripe_account_info` Stripe's docs name. The mode is part of the id, so grants given for test
    // data never move to live money.
    account: {
      tool: "list_available_accounts_or_orgs",
      list: "accounts",
      id: ["stripe_context", "livemode"],
      name: "name",
    },
  },
  {
    id: "cloudflare-bindings",
    category: "dev",
    label: "Cloudflare (Workers)",
    description: "Workers, KV, R2 and D1 of the Cloudflare account.",
    icon: "cloudflare",
    serverUrl: "https://bindings.mcp.cloudflare.com/mcp",
  },
  {
    id: "cloudflare-observability",
    category: "dev",
    label: "Cloudflare (logs)",
    description: "Workers logs and metrics.",
    icon: "cloudflare",
    serverUrl: "https://observability.mcp.cloudflare.com/mcp",
  },
  {
    id: "supabase",
    category: "dev",
    label: "Supabase",
    description: "Supabase projects, database and functions.",
    icon: "supabase",
    serverUrl: "https://mcp.supabase.com/mcp",
  },
  {
    id: "supabase-readonly",
    category: "dev",
    label: "Supabase (read-only)",
    description: "Read-only queries on Supabase projects: SQL runs as a read-only Postgres user.",
    icon: "supabase",
    // Supabase enforces read_only on its side (SQL as a read-only Postgres user); `features` keeps only the
    // database, docs and debugging tools, so functions, storage, projects and account tools never show up.
    // Its OAuth screen still lists read + write scopes: Supabase requires all of them (documented).
    serverUrl: "https://mcp.supabase.com/mcp?read_only=true&features=database,docs,debugging",
    readTools: ["execute_sql"],
  },
  {
    id: "intercom",
    category: "support",
    label: "Intercom",
    description: "Intercom conversations and contacts.",
    icon: "intercom",
    serverUrl: "https://mcp.intercom.com/mcp",
    soon: true,
    cloudOAuthOnly: true,
    composio: {
      toolkit: "intercom",
      version: "20261010_00",
      auth: "managed",
      actions: [
        "INTERCOM_LIST_CONVERSATIONS",
        "INTERCOM_SEARCH_CONVERSATIONS",
        "INTERCOM_GET_CONVERSATION",
        "INTERCOM_LIST_CONTACTS",
        "INTERCOM_SEARCH_CONTACTS",
        "INTERCOM_GET_A_CONTACT",
        "INTERCOM_LIST_ALL_COMPANIES",
        "INTERCOM_LIST_ALL_ADMINS",
        "INTERCOM_CREATE_A_NOTE",
        "INTERCOM_ASSIGN_CONVERSATION",
        "INTERCOM_ATTACH_TAG_TO_CONVERSATION",
        "INTERCOM_UPDATE_A_CONTACT",
        "INTERCOM_CLOSE_CONVERSATION",
        "INTERCOM_REPLY_TO_CONVERSATION",
      ],
    },
  },
  {
    id: "intercom-eu",
    category: "support",
    label: "Intercom (EU)",
    description: "Intercom conversations and contacts, for Intercom workspaces hosted in the EU (app.eu.intercom.com).",
    icon: "intercom",
    serverUrl: "https://mcp.eu.intercom.com/mcp",
    soon: true,
    cloudOAuthOnly: true,
  },
  {
    id: "zendesk",
    category: "support",
    label: "Zendesk",
    description: "Zendesk tickets, comments, users and organizations.",
    icon: "zendesk",
    serverUrl: composioToolkitUrl("zendesk"),
    composio: {
      toolkit: "zendesk",
      version: "20260916_00",
      auth: "managed",
      actions: [
        "ZENDESK_SEARCH_ZENDESK",
        "ZENDESK_LIST_ZENDESK_TICKETS",
        "ZENDESK_GET_ZENDESK_TICKET_BY_ID",
        "ZENDESK_GET_TICKET_COMMENTS",
        "ZENDESK_SEARCH_ZENDESK_USERS",
        "ZENDESK_GET_USER",
        "ZENDESK_SEARCH_ZENDESK_ORGANIZATIONS",
        "ZENDESK_CREATE_ZENDESK_TICKET",
        "ZENDESK_UPDATE_ZENDESK_TICKET",
        "ZENDESK_REPLY_ZENDESK_TICKET",
      ],
      ask: ["ZENDESK_CREATE_ZENDESK_TICKET", "ZENDESK_UPDATE_ZENDESK_TICKET"],
    },
  },
  {
    id: "paypal",
    category: "payments",
    label: "PayPal",
    description: "PayPal orders, invoices and transactions.",
    icon: "paypal",
    serverUrl: "https://mcp.paypal.com/mcp",
  },
  {
    id: "square",
    category: "payments",
    label: "Square",
    description: "Square payments, orders and catalog.",
    icon: "square",
    serverUrl: "https://mcp.squareup.com/mcp",
    soon: true,
    composio: {
      toolkit: "square",
      version: "20260721_00",
      auth: "managed",
      actions: [
        "SQUARE_LIST_LOCATIONS",
        "SQUARE_LIST_PAYMENTS",
        "SQUARE_SEARCH_ORDERS",
        "SQUARE_RETRIEVE_ORDER",
        "SQUARE_LIST_CUSTOMERS",
        "SQUARE_SEARCH_CUSTOMERS",
        "SQUARE_RETRIEVE_CUSTOMER",
        "SQUARE_SEARCH_CATALOG_OBJECTS",
        "SQUARE_LIST_INVOICES",
        "SQUARE_GET_INVOICE",
        "SQUARE_CREATE_CUSTOMER",
        "SQUARE_UPDATE_CUSTOMER",
        "SQUARE_UPSERT_CATALOG_OBJECT",
        "SQUARE_CANCEL_PAYMENT",
        "SQUARE_CREATE_REFUND",
      ],
      ask: ["SQUARE_UPSERT_CATALOG_OBJECT", "SQUARE_CANCEL_PAYMENT"],
    },
  },
  {
    id: "webflow",
    category: "marketing",
    label: "Webflow",
    description: "Webflow sites, pages and CMS.",
    icon: "webflow",
    serverUrl: "https://mcp.webflow.com/mcp",
  },
  {
    id: "zapier",
    category: "automation",
    label: "Zapier",
    description: "The actions you enabled in Zapier MCP.",
    icon: "zapier",
    serverUrl: "https://mcp.zapier.com/api/mcp/mcp",
  },
  {
    id: "canva",
    category: "marketing",
    label: "Canva",
    description: "Canva designs and templates.",
    icon: "canva",
    serverUrl: "https://mcp.canva.com/mcp",
  },
  {
    id: "gitlab",
    category: "dev",
    label: "GitLab",
    description: "GitLab.com projects, merge requests, issues and pipelines.",
    icon: "gitlab",
    serverUrl: "https://gitlab.com/api/v4/mcp",
  },
  {
    id: "neon",
    category: "dev",
    label: "Neon",
    description: "Neon Postgres projects, branches and queries.",
    icon: "neon",
    serverUrl: "https://mcp.neon.tech/mcp",
  },
  {
    id: "prisma",
    category: "dev",
    label: "Prisma",
    description: "Prisma Postgres databases, backups and queries.",
    icon: "prisma",
    serverUrl: "https://mcp.prisma.io/mcp",
  },
  {
    id: "netlify",
    category: "dev",
    label: "Netlify",
    description: "Netlify sites, deploys and settings.",
    icon: "netlify",
    serverUrl: "https://netlify-mcp.netlify.app/mcp",
  },
  {
    id: "vercel",
    category: "dev",
    label: "Vercel",
    description: "Vercel projects, deployments and logs.",
    icon: "vercel",
    serverUrl: "https://mcp.vercel.com",
    soon: true,
  },
  {
    id: "railway",
    category: "dev",
    label: "Railway",
    description: "Railway projects, services, deploys and logs.",
    icon: "railway",
    serverUrl: "https://mcp.railway.com",
  },
  {
    id: "datadog",
    category: "dev",
    label: "Datadog",
    description: "Datadog logs, metrics, monitors and incidents (US1 site).",
    icon: "datadog",
    serverUrl: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
  },
  {
    id: "grafana",
    category: "dev",
    label: "Grafana",
    description: "Grafana Cloud dashboards, metrics, logs and alerts.",
    icon: "grafana",
    serverUrl: "https://mcp.grafana.com/mcp",
  },
  {
    id: "postman",
    category: "dev",
    label: "Postman",
    description: "Postman workspaces, collections and APIs.",
    icon: "postman",
    serverUrl: "https://mcp.postman.com/mcp",
  },
  {
    id: "jam",
    category: "dev",
    label: "Jam",
    description: "Jam bug reports: recordings, console logs and network requests.",
    icon: "jam",
    serverUrl: "https://mcp.jam.dev/mcp",
  },
  {
    id: "resend",
    category: "dev",
    label: "Resend",
    description: "Resend emails, domains and audiences.",
    icon: "resend",
    serverUrl: "https://mcp.resend.com/mcp",
  },
  {
    id: "expo",
    category: "dev",
    label: "Expo",
    description: "Expo projects, builds, updates and app store submissions.",
    icon: "expo",
    serverUrl: "https://mcp.expo.dev/mcp",
  },
  {
    id: "monday",
    category: "product",
    label: "monday.com",
    description: "monday.com boards, items and updates.",
    icon: "monday",
    serverUrl: "https://mcp.monday.com/mcp",
  },
  {
    id: "clickup",
    category: "product",
    label: "ClickUp",
    description: "ClickUp tasks, lists and docs.",
    icon: "clickup",
    serverUrl: "https://mcp.clickup.com/mcp",
  },
  {
    id: "todoist",
    category: "product",
    label: "Todoist",
    description: "Todoist tasks and projects.",
    icon: "todoist",
    serverUrl: "https://ai.todoist.net/mcp",
  },
  {
    id: "figma",
    category: "product",
    label: "Figma",
    description: "Figma designs, components and variables.",
    icon: "figma",
    serverUrl: "https://mcp.figma.com/mcp",
    soon: true,
    composio: {
      toolkit: "figma",
      version: "20261010_00",
      auth: "managed",
      actions: [
        "FIGMA_GET_PROJECTS_IN_A_TEAM",
        "FIGMA_GET_FILES_IN_A_PROJECT",
        "FIGMA_GET_FILE_METADATA",
        "FIGMA_GET_FILE_NODES",
        "FIGMA_GET_FILE_COMPONENTS",
        "FIGMA_GET_FILE_STYLES",
        "FIGMA_GET_LOCAL_VARIABLES",
        "FIGMA_RENDER_IMAGES_OF_FILE_NODES",
        "FIGMA_GET_COMMENTS_IN_A_FILE",
        "FIGMA_ADD_A_COMMENT_TO_A_FILE",
        "FIGMA_DELETE_A_COMMENT",
      ],
    },
  },
  {
    id: "airtable",
    category: "docs",
    label: "Airtable",
    description: "Airtable bases, tables and records.",
    icon: "airtable",
    serverUrl: "https://mcp.airtable.com/mcp",
  },
  {
    id: "dropbox",
    category: "docs",
    label: "Dropbox",
    description: "Dropbox files and folders.",
    icon: "dropbox",
    serverUrl: "https://mcp.dropbox.com/mcp",
    soon: true,
    composio: {
      toolkit: "dropbox",
      version: "20261001_00",
      auth: "managed",
      actions: [
        "DROPBOX_LIST_FILES_IN_FOLDER",
        "DROPBOX_SEARCH_FILE_OR_FOLDER",
        "DROPBOX_GET_METADATA",
        "DROPBOX_READ_FILE",
        "DROPBOX_LIST_SHARED_LINKS",
        "DROPBOX_CREATE_FOLDER",
        "DROPBOX_MOVE_FILE_OR_FOLDER",
        "DROPBOX_COPY_FILE_OR_FOLDER",
        "DROPBOX_CREATE_SHARED_LINK",
        "DROPBOX_DELETE_FILE",
      ],
      ask: ["DROPBOX_CREATE_SHARED_LINK"],
    },
  },
  {
    id: "miro",
    category: "docs",
    label: "Miro",
    description: "Miro boards: read them and add content.",
    icon: "miro",
    serverUrl: "https://mcp.miro.com/",
  },
  {
    id: "gamma",
    category: "docs",
    label: "Gamma",
    description: "Gamma presentations, documents and sites.",
    icon: "gamma",
    serverUrl: "https://mcp.gamma.app/mcp",
    soon: true,
  },
  {
    id: "granola",
    category: "docs",
    label: "Granola",
    description: "Granola meeting notes and transcripts.",
    icon: "granola",
    serverUrl: "https://mcp.granola.ai/mcp",
  },
  {
    id: "fireflies",
    category: "docs",
    label: "Fireflies",
    description: "Fireflies meeting transcripts and summaries.",
    icon: "fireflies",
    serverUrl: "https://api.fireflies.ai/mcp",
  },
  {
    id: "mercadopago",
    category: "payments",
    label: "Mercado Pago",
    description: "Mercado Pago payments, documentation and integration checks.",
    icon: "mercadopago",
    serverUrl: "https://mcp.mercadopago.com/mcp",
    soon: true,
  },
  {
    id: "revenuecat",
    category: "payments",
    label: "RevenueCat",
    description: "RevenueCat in-app subscriptions, products, offerings and revenue.",
    icon: "revenuecat",
    serverUrl: "https://mcp.revenuecat.ai/mcp",
    soon: true,
  },
  {
    id: "superwall",
    category: "payments",
    label: "Superwall",
    description: "Superwall paywalls, campaigns and experiments.",
    icon: "superwall",
    serverUrl: "https://mcp.superwall.com/mcp",
  },
  {
    id: "paddle",
    category: "payments",
    label: "Paddle",
    description: "Paddle customers, subscriptions, transactions and products.",
    icon: "paddle",
    serverUrl: "https://mcp.paddle.com/mcp",
  },
  {
    id: "abacatepay",
    category: "payments",
    label: "AbacatePay",
    description: "AbacatePay Pix charges, customers and withdrawals.",
    icon: "abacatepay",
    serverUrl: "https://mcp.abacatepay.com/mcp",
  },
  {
    id: "hubspot",
    category: "sales",
    label: "HubSpot",
    description: "HubSpot contacts, companies, deals, notes and tasks.",
    icon: "hubspot",
    serverUrl: composioToolkitUrl("hubspot"),
    composio: {
      toolkit: "hubspot",
      version: "20261029_00",
      auth: "managed",
      actions: [
        "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
        "HUBSPOT_LIST_CONTACTS",
        "HUBSPOT_READ_CONTACT",
        "HUBSPOT_SEARCH_COMPANIES",
        "HUBSPOT_GET_COMPANY",
        "HUBSPOT_SEARCH_DEALS",
        "HUBSPOT_GET_DEAL",
        "HUBSPOT_CREATE_CONTACT",
        "HUBSPOT_UPDATE_CONTACT",
        "HUBSPOT_CREATE_COMPANY",
        "HUBSPOT_UPDATE_COMPANY",
        "HUBSPOT_CREATE_DEAL",
        "HUBSPOT_UPDATE_DEAL",
        "HUBSPOT_CREATE_NOTE",
        "HUBSPOT_CREATE_TASK",
        "HUBSPOT_ARCHIVE_CONTACT",
      ],
      ask: ["HUBSPOT_ARCHIVE_CONTACT"],
    },
  },
  {
    id: "salesforce",
    category: "sales",
    label: "Salesforce",
    description: "Salesforce accounts, contacts, leads and opportunities.",
    icon: "salesforce",
    serverUrl: composioToolkitUrl("salesforce"),
    composio: {
      toolkit: "salesforce",
      version: "20261029_00",
      auth: "managed",
      actions: [
        "SALESFORCE_SEARCH_ACCOUNTS",
        "SALESFORCE_GET_ACCOUNT",
        "SALESFORCE_SEARCH_CONTACTS",
        "SALESFORCE_GET_CONTACT",
        "SALESFORCE_SEARCH_LEADS",
        "SALESFORCE_GET_LEAD",
        "SALESFORCE_SEARCH_OPPORTUNITIES",
        "SALESFORCE_GET_OPPORTUNITY",
        "SALESFORCE_CREATE_ACCOUNT",
        "SALESFORCE_UPDATE_ACCOUNT",
        "SALESFORCE_CREATE_CONTACT",
        "SALESFORCE_UPDATE_CONTACT",
        "SALESFORCE_CREATE_LEAD",
        "SALESFORCE_UPDATE_LEAD",
        "SALESFORCE_CREATE_OPPORTUNITY",
        "SALESFORCE_UPDATE_OPPORTUNITY",
        "SALESFORCE_CREATE_TASK",
        "SALESFORCE_CREATE_NOTE",
      ],
    },
  },
  {
    id: "attio",
    category: "sales",
    label: "Attio",
    description: "Attio CRM records, lists and notes.",
    icon: "attio",
    serverUrl: "https://mcp.attio.com/mcp",
  },
  {
    id: "close",
    category: "sales",
    label: "Close",
    description: "Close CRM leads, opportunities and activities.",
    icon: "close",
    serverUrl: "https://mcp.close.com/mcp",
  },
  {
    id: "calendly",
    category: "sales",
    label: "Calendly",
    description: "Calendly events, event types and availability.",
    icon: "calendly",
    serverUrl: "https://mcp.calendly.com",
  },
  {
    id: "posthog",
    category: "data",
    label: "PostHog",
    description: "PostHog insights, feature flags, experiments and errors.",
    icon: "posthog",
    serverUrl: "https://mcp.posthog.com/mcp",
  },
  {
    id: "mixpanel",
    category: "data",
    label: "Mixpanel",
    description: "Mixpanel events, reports and funnels.",
    icon: "mixpanel",
    serverUrl: "https://mcp.mixpanel.com/mcp",
  },
  {
    id: "amplitude",
    category: "data",
    label: "Amplitude",
    description: "Amplitude charts, dashboards and experiments.",
    icon: "amplitude",
    serverUrl: "https://mcp.amplitude.com/mcp",
  },
  {
    id: "himetrica",
    category: "data",
    label: "Himetrica",
    description: "Himetrica visitors, funnels, revenue and search traffic.",
    icon: "himetrica",
    serverUrl: "https://app.himetrica.com/api/v1/mcp",
  },
  {
    id: "meta-ads",
    category: "marketing",
    label: "Meta Ads",
    description: "Meta (Facebook and Instagram) ad campaigns and results.",
    icon: "meta",
    serverUrl: "https://mcp.facebook.com/ads",
    soon: true,
  },
  {
    id: "klaviyo",
    category: "marketing",
    label: "Klaviyo",
    description: "Klaviyo campaigns, flows, lists and profiles.",
    icon: "klaviyo",
    serverUrl: "https://mcp.klaviyo.com/mcp",
  },
  {
    id: "millionsend",
    category: "marketing",
    label: "MillionSend",
    description: "MillionSend email campaigns, lists and contacts.",
    icon: "millionsend",
    serverUrl: "https://api.millionsend.com/mcp",
  },
  {
    id: "semrush",
    category: "marketing",
    label: "Semrush",
    description: "Semrush keyword, domain and backlink data.",
    icon: "semrush",
    serverUrl: "https://mcp.semrush.com/v2/mcp",
    soon: true,
    keyScheme: "Apikey",
  },
  {
    id: "ahrefs",
    category: "marketing",
    label: "Ahrefs",
    description: "Ahrefs keyword, backlink and site data.",
    icon: "ahrefs",
    serverUrl: "https://api.ahrefs.com/mcp/mcp",
  },
  {
    id: "wix",
    category: "marketing",
    label: "Wix",
    description: "Wix sites, CMS, stores and bookings.",
    icon: "wix",
    serverUrl: "https://mcp.wix.com/mcp",
  },
  {
    id: "sanity",
    category: "marketing",
    label: "Sanity",
    description: "Sanity content, schemas and releases.",
    icon: "sanity",
    serverUrl: "https://mcp.sanity.io",
  },
  {
    id: "contentful",
    category: "marketing",
    label: "Contentful",
    description: "Contentful entries, content types and assets.",
    icon: "contentful",
    serverUrl: "https://mcp.contentful.com/mcp",
  },
  {
    id: "jotform",
    category: "marketing",
    label: "Jotform",
    description: "Jotform forms and submissions.",
    icon: "jotform",
    serverUrl: "https://mcp.jotform.com/",
  },
  {
    id: "tally",
    category: "marketing",
    label: "Tally",
    description: "Tally forms and responses.",
    icon: "tally",
    serverUrl: "https://api.tally.so/mcp",
  },
  {
    id: "instagram",
    category: "social",
    label: "Instagram",
    description: "Instagram business and creator accounts: posts, stories, insights and direct messages.",
    icon: "instagram",
    serverUrl: composioToolkitUrl("instagram"),
    account: {
      tool: "INSTAGRAM_GET_USER_INFO",
      args: { ig_user_id: "me", fields: "id,username" },
      id: ["id"],
      name: "username",
    },
    // Composio's app lacks Meta's comment-management permission (docs.composio.dev/toolkits/instagram, 2026-11-10):
    // its comment actions, reading included, would fail, so none is listed.
    composio: {
      toolkit: "instagram",
      version: "20261101_00",
      auth: "managed",
      actions: [
        "INSTAGRAM_GET_USER_INFO",
        "INSTAGRAM_GET_USER_INSIGHTS",
        "INSTAGRAM_GET_IG_USER_MEDIA",
        "INSTAGRAM_GET_IG_MEDIA",
        "INSTAGRAM_GET_IG_MEDIA_INSIGHTS",
        "INSTAGRAM_GET_IG_USER_STORIES",
        "INSTAGRAM_LIST_ALL_CONVERSATIONS",
        "INSTAGRAM_LIST_ALL_MESSAGES",
        "INSTAGRAM_POST_IG_USER_MEDIA",
        "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
        "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
        "INSTAGRAM_SEND_TEXT_MESSAGE",
      ],
    },
  },
  {
    id: "facebook",
    category: "social",
    label: "Facebook",
    description: "Facebook Pages: posts, photos, videos, comments and insights.",
    icon: "facebook",
    serverUrl: composioToolkitUrl("facebook"),
    account: { tool: "FACEBOOK_GET_CURRENT_USER", args: { fields: "id,name" }, id: ["id"], name: "name" },
    composio: {
      toolkit: "facebook",
      version: "20261103_00",
      auth: "managed",
      actions: [
        "FACEBOOK_LIST_MANAGED_PAGES",
        "FACEBOOK_GET_PAGE_DETAILS",
        "FACEBOOK_GET_PAGE_POSTS",
        "FACEBOOK_GET_POST",
        "FACEBOOK_GET_SCHEDULED_POSTS",
        "FACEBOOK_GET_COMMENTS",
        "FACEBOOK_GET_PAGE_INSIGHTS",
        "FACEBOOK_GET_POST_INSIGHTS",
        "FACEBOOK_GET_PAGE_PHOTOS",
        "FACEBOOK_GET_PAGE_VIDEOS",
        "FACEBOOK_CREATE_POST",
        "FACEBOOK_CREATE_PHOTO_POST",
        "FACEBOOK_CREATE_MULTI_PHOTO_POST",
        "FACEBOOK_CREATE_VIDEO_POST",
        "FACEBOOK_UPDATE_POST",
        "FACEBOOK_DELETE_POST",
        "FACEBOOK_CREATE_COMMENT",
        "FACEBOOK_DELETE_COMMENT",
      ],
    },
  },
  {
    id: "linkedin",
    category: "social",
    label: "LinkedIn",
    description: "LinkedIn posts, videos and comments as the member who signs in.",
    icon: "linkedin",
    serverUrl: composioToolkitUrl("linkedin"),
    account: { tool: "LINKEDIN_WHO_AM_I", id: ["email"], name: "name" },
    // Composio's app asks for the member's own scopes (openid, profile, email, w_member_social): it posts as that
    // member. Company pages need r_organization_admin, which LinkedIn refuses beside w_member_social, and reading posts
    // or reactions needs r_member_social, which the app lacks. Its rate limits are shared (HTTP 429), so the set is small.
    composio: {
      toolkit: "linkedin",
      version: "20261101_00",
      auth: "managed",
      actions: [
        "LINKEDIN_GET_MY_INFO",
        "LINKEDIN_CREATE_LINKED_IN_POST",
        "LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE",
        "LINKEDIN_UPLOAD_VIDEO",
        "LINKEDIN_GET_VIDEOS",
        "LINKEDIN_CREATE_VIDEO_POST",
        "LINKEDIN_CREATE_COMMENT_ON_POST",
        "LINKEDIN_DELETE_POST",
      ],
    },
  },
  {
    id: "youtube",
    category: "social",
    label: "YouTube",
    description: "YouTube channel videos, comments, playlists and analytics.",
    icon: "youtube",
    serverUrl: composioToolkitUrl("youtube"),
    account: {
      tool: "YOUTUBE_LIST_CHANNELS",
      args: { mine: true, part: "snippet" },
      list: "items",
      id: ["id"],
      name: "snippet.title",
    },
    // Every account spends the daily quota of Composio's one Google project: a list costs 1 unit, a write 50. Search
    // (100 a call) and caption downloads (200) stay out, and so do uploads, which take a file Composio already holds.
    composio: {
      toolkit: "youtube",
      version: "20261101_00",
      auth: "managed",
      actions: [
        "YOUTUBE_LIST_CHANNELS",
        "YOUTUBE_LIST_CHANNEL_VIDEOS",
        "YOUTUBE_GET_VIDEO_DETAILS_BATCH",
        "YOUTUBE_QUERY_ANALYTICS",
        "YOUTUBE_LIST_COMMENT_THREADS2",
        "YOUTUBE_LIST_COMMENTS",
        "YOUTUBE_LIST_USER_PLAYLISTS",
        "YOUTUBE_LIST_PLAYLIST_ITEMS",
        "YOUTUBE_UPDATE_VIDEO",
        "YOUTUBE_UPDATE_THUMBNAIL",
        "YOUTUBE_POST_COMMENT",
        "YOUTUBE_CREATE_COMMENT_REPLY",
        "YOUTUBE_SET_COMMENT_MODERATION_STATUS",
        "YOUTUBE_DELETE_COMMENT",
        "YOUTUBE_CREATE_PLAYLIST",
        "YOUTUBE_ADD_VIDEO_TO_PLAYLIST",
      ],
      // Rejecting a comment hides it and may ban its author.
      ask: ["YOUTUBE_SET_COMMENT_MODERATION_STATUS"],
    },
  },
  {
    id: "pinterest",
    category: "social",
    label: "Pinterest",
    description: "Pinterest pins, boards and analytics.",
    icon: "pinterest",
    serverUrl: composioToolkitUrl("pinterest"),
    account: { tool: "PINTEREST_GET_PROFILE", id: ["username"], name: "username" },
    composio: {
      toolkit: "pinterest",
      version: "20261101_00",
      auth: "managed",
      actions: [
        "PINTEREST_GET_PROFILE",
        "PINTEREST_LIST_BOARDS",
        "PINTEREST_GET_BOARD",
        "PINTEREST_LIST_BOARD_SECTIONS",
        "PINTEREST_LIST_PINS",
        "PINTEREST_GET_PIN",
        "PINTEREST_SEARCH_OWN_CONTENT",
        "PINTEREST_GET_ACCOUNT_ANALYTICS",
        "PINTEREST_GET_PIN_ANALYTICS",
        "PINTEREST_GET_TOP_PINS",
        "PINTEREST_GET_KEYWORD_TRENDS",
        "PINTEREST_CREATE_PIN",
        "PINTEREST_UPDATE_PIN",
        "PINTEREST_SAVE_PIN",
        "PINTEREST_CREATE_BOARD",
        "PINTEREST_UPDATE_BOARD",
        "PINTEREST_CREATE_BOARD_SECTION",
        "PINTEREST_DELETE_PIN",
        "PINTEREST_DELETE_BOARD",
      ],
      // Made public, a secret board shows every pin on it.
      ask: ["PINTEREST_UPDATE_BOARD"],
    },
  },
  {
    id: "reddit",
    category: "social",
    label: "Reddit",
    description: "Reddit posts, comments and communities.",
    icon: "reddit",
    serverUrl: composioToolkitUrl("reddit"),
    // Composio's app asks Reddit for identity, read, vote, submit, flair and edit: no inbox, subscriptions, wiki or
    // moderation, so their actions stay out. No action names the account. Votes stay out too: Reddit allows only the
    // ones a person casts one by one.
    composio: {
      toolkit: "reddit",
      version: "20261105_00",
      auth: "managed",
      actions: [
        "REDDIT_SEARCH_ACROSS_SUBREDDITS",
        "REDDIT_RETRIEVE_REDDIT_POST",
        "REDDIT_RETRIEVE_POST_COMMENTS",
        "REDDIT_RETRIEVE_SPECIFIC_COMMENT",
        "REDDIT_GET_SUBREDDITS_SEARCH",
        "REDDIT_GET_SUBREDDIT_METADATA",
        "REDDIT_GET_SUBREDDIT_RULES",
        "REDDIT_LIST_SUBREDDIT_POST_FLAIRS",
        "REDDIT_GET_REDDIT_USER_ABOUT",
        "REDDIT_CREATE_REDDIT_POST",
        "REDDIT_POST_REDDIT_COMMENT",
        "REDDIT_EDIT_REDDIT_COMMENT_OR_POST",
        "REDDIT_DELETE_REDDIT_POST",
        "REDDIT_DELETE_REDDIT_COMMENT",
      ],
    },
  },
  {
    id: "whatsapp",
    category: "social",
    label: "WhatsApp",
    description: "WhatsApp Business messages and templates.",
    icon: "whatsapp",
    serverUrl: composioToolkitUrl("whatsapp"),
    account: {
      tool: "WHATSAPP_GET_BUSINESS_ACCOUNT_DETAILS",
      args: { fields: "id,name" },
      id: ["id"],
      name: "name",
    },
    // A WhatsApp Business account, whose id Composio's page asks for at sign-in. The Cloud API hands what customers
    // write only to a webhook, so no action reads it: agents send, and read templates and delivery history. Account
    // and phone number setup stays out.
    composio: {
      toolkit: "whatsapp",
      version: "20261105_00",
      auth: "managed",
      actions: [
        "WHATSAPP_GET_PHONE_NUMBERS",
        "WHATSAPP_GET_BUSINESS_PROFILE",
        "WHATSAPP_GET_MESSAGE_TEMPLATES",
        "WHATSAPP_GET_TEMPLATE_STATUS",
        "WHATSAPP_GET_MESSAGE_HISTORY",
        "WHATSAPP_CREATE_MESSAGE_TEMPLATE",
        "WHATSAPP_SEND_MESSAGE",
        "WHATSAPP_SEND_TEMPLATE_MESSAGE",
        "WHATSAPP_SEND_MEDIA",
        "WHATSAPP_SEND_INTERACTIVE_BUTTONS",
        "WHATSAPP_SEND_INTERACTIVE_LIST",
        "WHATSAPP_SEND_LOCATION",
      ],
    },
  },
];

export const mcpPreset = (id: string) => MCP_PRESETS.find((p) => p.id === id) ?? null;

/** The preset a connection came from, by either of its addresses (its server's or its Composio toolkit's), if any. */
export function presetForServer(serverUrl: string | null | undefined) {
  if (!serverUrl) return null;
  const toolkit = composioToolkitOf(serverUrl);
  if (toolkit) return MCP_PRESETS.find((p) => p.composio?.toolkit === toolkit) ?? null;
  const url = canonicalResource(serverUrl);
  return MCP_PRESETS.find((p) => canonicalResource(p.serverUrl) === url) ?? null;
}

const actionPrefix = (way: Pick<ComposioWay, "toolkit" | "prefix">) => `${way.prefix ?? way.toolkit.toUpperCase()}_`;

/** A Composio action's tool name: the action without its toolkit's prefix, in lower case (`find_file`). */
export const composioToolName = (way: Pick<ComposioWay, "toolkit" | "prefix">, action: string) =>
  action.slice(actionPrefix(way).length).toLowerCase();

/** The action of a way a tool name runs (`find_file` → `GOOGLEDRIVE_FIND_FILE`), only one the way lists. */
export function composioAction(way: ComposioWay, name: string): string | null {
  const action = `${actionPrefix(way)}${name.toUpperCase()}`;
  return way.actions.includes(action) ? action : null;
}

/**
 * A server's address without what may be its secret: a path or a query can be the only credential of a server that
 * asks for no sign-in. An address the catalog publishes (a preset's, a Composio toolkit's) stays whole.
 */
export const serverUrlShown = (serverUrl: string) =>
  presetForServer(serverUrl) || composioToolkitOf(serverUrl) || !URL.canParse(serverUrl)
    ? serverUrl
    : new URL(serverUrl).origin;
