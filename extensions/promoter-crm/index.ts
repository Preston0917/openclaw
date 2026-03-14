import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginService,
} from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
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
  createPromoterCrmRecordScoreTool,
  createPromoterCrmRefreshSegmentTool,
  createPromoterCrmStatusTool,
  createPromoterCrmUpsertCampaignTool,
  createPromoterCrmUpsertContactTool,
  createPromoterCrmUpsertEventTool,
  createPromoterCrmUpsertInviteTool,
  createPromoterCrmUpsertSegmentTool,
} from "./src/tools.js";

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
        .option("--since-hours <n>", "Only include conversations active within this many hours", Number)
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
