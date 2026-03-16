import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginService,
} from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { registerPromoterCrmGatewayMethods } from "./src/gateway-methods.js";
import { createManychatWebhookHandler } from "./src/manychat-webhook.js";
import { PROMOTER_CRM_AGENT_GUIDANCE } from "./src/prompt-guidance.js";
import {
  type IdentityChannel,
  resolvePromoterCrmPaths,
  withPromoterCrmStore,
} from "./src/store.js";
import {
  createPromoterCrmFindContactsTool,
  createPromoterCrmGetContactTool,
  createPromoterCrmGetConversationThreadTool,
  createPromoterCrmGetVenueAttendanceTool,
  createPromoterCrmLogInteractionTool,
  createPromoterCrmRecentInboxTool,
  createPromoterCrmRankFollowupsTool,
  createPromoterCrmSendManychatReplyTool,
  createPromoterCrmRecordScoreTool,
  createPromoterCrmRefreshSegmentTool,
  createPromoterCrmStatusTool,
  createPromoterCrmUpsertCampaignTool,
  createPromoterCrmUpsertContactTool,
  createPromoterCrmUpsertEventTool,
  createPromoterCrmUpsertInviteTool,
  createPromoterCrmUpsertSegmentTool,
} from "./src/tools.js";

async function fetchBlueBubblesMessageQueryPage(params: {
  serverUrl: string;
  password: string;
  limit: number;
  offset: number;
  afterMs?: number;
}): Promise<{ data: unknown[]; metadata?: Record<string, unknown> }> {
  const baseUrl = params.serverUrl.trim().replace(/\/+$/, "");
  const url = new URL("/api/v1/message/query", `${baseUrl}/`);
  url.searchParams.set("password", params.password.trim());
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      after: Math.max(0, Math.floor(params.afterMs ?? 0)),
      limit: Math.max(1, Math.min(Math.floor(params.limit), 1_000)),
      offset: Math.max(0, Math.floor(params.offset)),
      sort: "ASC",
      with: ["attachments", "chats", "chat.participants", "handle", "sender"],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`BlueBubbles sync failed (${response.status}): ${text || "unknown error"}`);
  }
  const payload = (await response.json()) as { data?: unknown; metadata?: Record<string, unknown> };
  return {
    data: Array.isArray(payload.data) ? payload.data : [],
    metadata: payload.metadata,
  };
}

async function fetchBlueBubblesMessageQuery(params: {
  serverUrl: string;
  password: string;
  limit: number;
  afterMs?: number;
}): Promise<unknown> {
  const maxRecords = Math.max(1, Math.floor(params.limit));
  const all: unknown[] = [];
  let offset = 0;
  while (all.length < maxRecords) {
    const remaining = maxRecords - all.length;
    const page = await fetchBlueBubblesMessageQueryPage({
      ...params,
      limit: Math.min(remaining, 1_000),
      offset,
    });
    all.push(...page.data);
    if (page.data.length === 0 || page.data.length < Math.min(remaining, 1_000)) {
      break;
    }
    offset += page.data.length;
  }
  return {
    status: 200,
    message: "Success",
    data: all,
    metadata: { count: all.length, offset: 0, limit: maxRecords, total: all.length },
  };
}

async function fetchBlueBubblesChatQuery(params: {
  serverUrl: string;
  password: string;
  limit: number;
}): Promise<unknown> {
  const baseUrl = params.serverUrl.trim().replace(/\/+$/, "");
  const url = new URL("/api/v1/chat/query", `${baseUrl}/`);
  url.searchParams.set("password", params.password.trim());
  const all: unknown[] = [];
  const maxRecords = Math.max(1, Math.floor(params.limit));
  let offset = 0;
  while (all.length < maxRecords) {
    const remaining = maxRecords - all.length;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: Math.min(remaining, 500),
        offset,
        with: ["participants"],
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `BlueBubbles chat sync failed (${response.status}): ${text || "unknown error"}`,
      );
    }
    const payload = (await response.json()) as {
      data?: unknown;
      metadata?: Record<string, unknown>;
    };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    all.push(...rows);
    if (rows.length === 0 || rows.length < Math.min(remaining, 500)) {
      break;
    }
    offset += rows.length;
  }
  return {
    status: 200,
    message: "Success",
    data: all,
    metadata: { count: all.length, offset: 0, limit: maxRecords, total: all.length },
  };
}

function registerTools(api: OpenClawPluginApi): void {
  const tools: AnyAgentTool[] = [
    createPromoterCrmStatusTool(api),
    createPromoterCrmUpsertContactTool(api),
    createPromoterCrmFindContactsTool(api),
    createPromoterCrmRecordScoreTool(api),
    createPromoterCrmUpsertEventTool(api),
    createPromoterCrmUpsertCampaignTool(api),
    createPromoterCrmUpsertInviteTool(api),
    createPromoterCrmUpsertSegmentTool(api),
    createPromoterCrmRefreshSegmentTool(api),
    createPromoterCrmLogInteractionTool(api),
    createPromoterCrmGetContactTool(api),
    createPromoterCrmGetVenueAttendanceTool(api),
    createPromoterCrmRecentInboxTool(api),
    createPromoterCrmGetConversationThreadTool(api),
    createPromoterCrmRankFollowupsTool(api),
    createPromoterCrmSendManychatReplyTool(api),
  ];

  for (const tool of tools) {
    api.registerTool(tool, { optional: true });
  }
}

function createPromoterCrmService(api: OpenClawPluginApi): OpenClawPluginService {
  return {
    id: "promoter-crm-init",
    async start(ctx) {
      await withPromoterCrmStore({ stateDir: ctx.stateDir }, (store) => {
        const status = store.getStatus();
        api.logger.info("promoter-crm: schema ready", {
          dbPath: resolvePromoterCrmPaths(ctx.stateDir).dbPath,
          tableCounts: status.tableCounts,
        });
      });
    },
  };
}

function registerCli(api: OpenClawPluginApi): void {
  api.registerCli(
    ({ program, logger }) => {
      const crm = program.command("promoter-crm").description("Promoter CRM plugin commands");

      crm
        .command("init")
        .description("Initialize the promoter CRM database")
        .action(async () => {
          const stateDir = api.runtime.state.resolveStateDir(process.env);
          const paths = resolvePromoterCrmPaths(stateDir);
          await withPromoterCrmStore({ stateDir }, () => undefined);
          logger.info(`Initialized promoter CRM database at ${paths.dbPath}`);
        });

      crm
        .command("status")
        .description("Show promoter CRM database status")
        .action(async () => {
          const stateDir = api.runtime.state.resolveStateDir(process.env);
          const status = await withPromoterCrmStore({ stateDir }, (store) => store.getStatus());
          console.log(JSON.stringify(status, null, 2));
        });

      crm
        .command("import-csv")
        .description("Import contacts from a CSV file and record ingest audit rows")
        .argument("<csvPath>", "Path to the CSV file")
        .option("--initiated-by <id>", "Operator or process identifier for audit logging")
        .action(async (csvPath: string, options: { initiatedBy?: string }) => {
          const stateDir = api.runtime.state.resolveStateDir(process.env);
          const result = await withPromoterCrmStore({ stateDir }, (store) =>
            store.importContactsFromCsvFile({
              csvPath,
              initiatedBy: options.initiatedBy,
            }),
          );
          console.log(JSON.stringify(result, null, 2));
        });

      crm
        .command("sync-bluebubbles")
        .description("Fetch BlueBubbles messages and import them into the promoter CRM")
        .requiredOption(
          "--server-url <url>",
          "BlueBubbles server URL, such as http://127.0.0.1:1234",
        )
        .requiredOption("--password <password>", "BlueBubbles server password")
        .option("--limit <n>", "Maximum messages to fetch", Number)
        .option("--after-ms <n>", "Only fetch messages after this unix timestamp in ms", Number)
        .option("--initiated-by <id>", "Operator or process identifier for audit logging")
        .action(
          async (options: {
            serverUrl: string;
            password: string;
            limit?: number;
            afterMs?: number;
            initiatedBy?: string;
          }) => {
            const payload = await fetchBlueBubblesMessageQuery({
              serverUrl: options.serverUrl,
              password: options.password,
              limit: options.limit ?? 250,
              afterMs: options.afterMs,
            });
            const chatPayload = await fetchBlueBubblesChatQuery({
              serverUrl: options.serverUrl,
              password: options.password,
              limit: 5_000,
            });
            const stateDir = api.runtime.state.resolveStateDir(process.env);
            const result = await withPromoterCrmStore({ stateDir }, (store) =>
              store.importBlueBubblesPayload({
                payload,
                chatPayload,
                sourceLabel: options.serverUrl,
                initiatedBy: options.initiatedBy,
              }),
            );
            console.log(JSON.stringify(result, null, 2));
          },
        );

      crm
        .command("followup-queue")
        .description("Refresh and show the ranked promoter CRM follow-up queue")
        .option("--limit <n>", "Maximum tasks to return", Number)
        .option(
          "--min-days-since-last-interaction <n>",
          "Minimum stale days before follow-up tasks are created",
          Number,
        )
        .action(async (options: { limit?: number; minDaysSinceLastInteraction?: number }) => {
          const stateDir = api.runtime.state.resolveStateDir(process.env);
          const result = await withPromoterCrmStore({ stateDir }, (store) =>
            store.rankFollowups({
              limit: options.limit,
              minDaysSinceLastInteraction: options.minDaysSinceLastInteraction,
            }),
          );
          console.log(JSON.stringify(result, null, 2));
        });

      crm
        .command("recent-inbox")
        .description("Show the most recent CRM conversations and inbound messages")
        .option("--limit <n>", "Maximum conversations to return", Number)
        .option("--channel <channel>", "Optional channel filter, such as manychat or instagram")
        .option(
          "--since-hours <n>",
          "Only include conversations active within this many hours",
          Number,
        )
        .option(
          "--only-needs-reply",
          "Only return conversations where the latest message is inbound",
        )
        .action(
          async (options: {
            limit?: number;
            channel?: string;
            sinceHours?: number;
            onlyNeedsReply?: boolean;
          }) => {
            const stateDir = api.runtime.state.resolveStateDir(process.env);
            const result = await withPromoterCrmStore({ stateDir }, (store) =>
              store.getRecentInbox({
                limit: options.limit,
                channel: options.channel as IdentityChannel | undefined,
                sinceHours: options.sinceHours,
                onlyNeedsReply: options.onlyNeedsReply,
              }),
            );
            console.log(JSON.stringify(result, null, 2));
          },
        );

      crm
        .command("conversation-thread")
        .description("Show a normalized CRM conversation thread")
        .option("--conversation-id <id>", "Conversation id to inspect")
        .option("--contact-id <id>", "Fallback contact id to resolve the latest conversation")
        .option("--channel <channel>", "Optional channel filter when using --contact-id")
        .option("--limit <n>", "Maximum messages to return", Number)
        .action(
          async (options: {
            conversationId?: string;
            contactId?: string;
            channel?: string;
            limit?: number;
          }) => {
            const stateDir = api.runtime.state.resolveStateDir(process.env);
            const result = await withPromoterCrmStore({ stateDir }, (store) =>
              store.getConversationThread({
                conversationId: options.conversationId,
                contactId: options.contactId,
                channel: options.channel as IdentityChannel | undefined,
                limit: options.limit,
              }),
            );
            console.log(JSON.stringify(result, null, 2));
          },
        );

      crm
        .command("send-manychat-reply")
        .description("Send a ManyChat reply and log it into the normalized CRM thread")
        .option("--conversation-id <id>", "Conversation id to reply in")
        .option("--contact-id <id>", "Fallback contact id to resolve the latest ManyChat thread")
        .option(
          "--channel <channel>",
          "Optional logical channel, such as instagram when ManyChat is the transport",
        )
        .requiredOption("--text <text>", "Plain-text reply to send")
        .option("--message-tag <tag>", "Optional ManyChat message tag")
        .option("--otn-topic-name <name>", "Optional ManyChat One-Time Notification topic name")
        .requiredOption("--confirm-send", "Confirm that you explicitly want to send the message")
        .action(
          async (options: {
            conversationId?: string;
            contactId?: string;
            channel?: string;
            text: string;
            messageTag?: string;
            otnTopicName?: string;
            confirmSend?: boolean;
          }) => {
            const tool = createPromoterCrmSendManychatReplyTool(api);
            const result = await tool.execute?.("cli-send-manychat-reply", {
              conversationId: options.conversationId,
              contactId: options.contactId,
              channel: options.channel,
              text: options.text,
              messageTag: options.messageTag,
              otnTopicName: options.otnTopicName,
              confirmSend: options.confirmSend,
            });
            console.log(JSON.stringify(result?.details ?? result, null, 2));
          },
        );

      crm
        .command("import-manychat")
        .description("Import ManyChat full-contact JSON from a local file")
        .argument("<jsonPath>", "Path to the ManyChat JSON payload file")
        .option("--initiated-by <id>", "Operator or process identifier for audit logging")
        .action(async (jsonPath: string, options: { initiatedBy?: string }) => {
          const stateDir = api.runtime.state.resolveStateDir(process.env);
          const result = await withPromoterCrmStore({ stateDir }, (store) =>
            store.importManychatPayloadFile({
              jsonPath,
              initiatedBy: options.initiatedBy,
            }),
          );
          console.log(JSON.stringify(result, null, 2));
        });
    },
    { commands: ["promoter-crm"] },
  );
}

const plugin = {
  id: "promoter-crm",
  name: "Promoter CRM",
  description:
    "Chen-style promoter CRM foundation for contacts, identity resolution, events, invites, and outreach history.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    registerTools(api);
    registerPromoterCrmGatewayMethods(api);
    api.registerService(createPromoterCrmService(api));
    registerCli(api);
    api.registerHttpRoute({
      path: "/promoter-crm/webhooks/manychat",
      auth: "plugin",
      handler: createManychatWebhookHandler(api),
    });
    api.on("before_prompt_build", async () => ({
      prependSystemContext: PROMOTER_CRM_AGENT_GUIDANCE,
    }));
  },
};

export default plugin;
