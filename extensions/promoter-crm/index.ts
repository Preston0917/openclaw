import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginService,
} from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { PROMOTER_CRM_AGENT_GUIDANCE } from "./src/prompt-guidance.js";
import { resolvePromoterCrmPaths, withPromoterCrmStore } from "./src/store.js";
import {
  createPromoterCrmFindContactsTool,
  createPromoterCrmGetContactTool,
  createPromoterCrmGetVenueAttendanceTool,
  createPromoterCrmLogInteractionTool,
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
    api.on("before_prompt_build", async () => ({
      prependSystemContext: PROMOTER_CRM_AGENT_GUIDANCE,
    }));
  },
};

export default plugin;
