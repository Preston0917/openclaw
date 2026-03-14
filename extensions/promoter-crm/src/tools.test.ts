import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it } from "vitest";
import { withPromoterCrmStore } from "./store.js";
import {
  createPromoterCrmGetConversationThreadTool,
  createPromoterCrmRecentInboxTool,
} from "./tools.js";

const tempDirs: string[] = [];

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-promoter-crm-tools-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function createApi(stateDir: string): OpenClawPluginApi {
  return {
    runtime: {
      state: {
        resolveStateDir: () => stateDir,
      },
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as unknown as OpenClawPluginApi;
}

function readTextContent(result: unknown): string {
  const record = result as { content?: Array<{ type?: string; text?: string }> } | undefined;
  return (record?.content ?? [])
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n");
}

describe("promoter CRM tools", () => {
  it("renders grounded recent inbox rows directly in tool content", async () => {
    const stateDir = await makeStateDir();
    withPromoterCrmStore({ stateDir }, (store) => {
      const natalie = store.upsertContact({
        displayName: "Natalie Radin",
        identities: [{ channel: "manychat", externalId: "1266546411", isPrimary: true }],
      });
      store.logInteraction({
        contactId: natalie.contactId,
        channel: "manychat",
        kind: "reply",
        direction: "inbound",
        summary: "Inbound DM from Natalie.",
        content: "18 gaf",
        conversationExternalId: "manychat-thread-1266546411",
        occurredAt: "2026-03-14T01:28:25.533Z",
      });
    });

    const tool = createPromoterCrmRecentInboxTool(createApi(stateDir));
    const result = await tool.execute?.("tool-1", {
      limit: 10,
      onlyNeedsReply: true,
      sinceHours: 24,
    });
    const text = readTextContent(result);

    expect(text).toContain("Grounded promoter CRM inbox snapshot");
    expect(text).toContain("Use only the contacts, channels, timestamps, and message previews returned below.");
    expect(text).toContain("Natalie Radin | channel=manychat | needsReply=yes");
    expect(text).toContain('lastMessage="18 gaf"');
    expect(text).toContain("primaryIdentity=manychat:1266546411");
  });

  it("renders grounded conversation threads directly in tool content", async () => {
    const stateDir = await makeStateDir();
    const { contactId } = withPromoterCrmStore({ stateDir }, (store) => {
      const preston = store.upsertContact({
        displayName: "Preston Choi",
        city: "New York",
        identities: [{ channel: "manychat", externalId: "1629294916", isPrimary: true }],
      });

      store.logInteraction({
        contactId: preston.contactId,
        channel: "manychat",
        kind: "reply",
        direction: "inbound",
        summary: "Inbound DM.",
        content: "Yo bro what's up",
        conversationExternalId: "manychat-thread-1629294916",
        occurredAt: "2026-03-14T00:38:29.010Z",
      });

      store.logInteraction({
        contactId: preston.contactId,
        channel: "manychat",
        kind: "reply",
        direction: "inbound",
        summary: "Second inbound DM.",
        content: "You're actually a loser",
        conversationExternalId: "manychat-thread-1629294916",
        occurredAt: "2026-03-14T01:07:20.200Z",
      });

      return { contactId: preston.contactId };
    });

    const tool = createPromoterCrmGetConversationThreadTool(createApi(stateDir));
    const result = await tool.execute?.("tool-2", {
      contactId,
      channel: "manychat",
      limit: 10,
    });
    const text = readTextContent(result);

    expect(text).toContain("Grounded promoter CRM conversation thread.");
    expect(text).toContain("Contact: Preston Choi | qualityTier=(none) | city=New York");
    expect(text).toContain("Conversation: channel=manychat | needsReply=yes");
    expect(text).toContain('[2026-03-14T00:38:29.010Z] inbound "Yo bro what\'s up"');
    expect(text).toContain('[2026-03-14T01:07:20.200Z] inbound "You\'re actually a loser"');
    expect(text).toContain('[2026-03-14T01:07:20.200Z] reply "Second inbound DM."');
  });
});
