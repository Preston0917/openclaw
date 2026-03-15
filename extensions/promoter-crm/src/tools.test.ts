import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withPromoterCrmStore } from "./store.js";
import {
  createPromoterCrmGetConversationThreadTool,
  createPromoterCrmRecentInboxTool,
  createPromoterCrmSendManychatReplyTool,
} from "./tools.js";

const tempDirs: string[] = [];
let originalFetch: typeof globalThis.fetch;

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-promoter-crm-tools-test-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.MANYCHAT_API_KEY;
  vi.restoreAllMocks();
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
        identities: [
          {
            channel: "manychat",
            externalId: "1266546411",
            isPrimary: true,
            replyUrl: "https://app.manychat.com/fb3160512/chat/1266546411",
          },
          {
            channel: "instagram",
            handle: "@natalie_radin",
            profileUrl: "https://www.instagram.com/natalie_radin/",
          },
        ],
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
      sinceHours: 48,
    });
    const text = readTextContent(result);

    expect(text).toContain("Grounded promoter CRM inbox snapshot");
    expect(text).toContain(
      "Use only the contacts, channels, timestamps, and message previews returned below.",
    );
    expect(text).toContain("Natalie Radin | channel=manychat | needsReply=yes");
    expect(text).toContain('lastMessage="18 gaf"');
    expect(text).toContain("primaryIdentity=manychat:1266546411");
    expect(text).toContain("replyUrl=https://app.manychat.com/fb3160512/chat/1266546411");
    expect(text).toContain("profileUrl=https://www.instagram.com/natalie_radin/");
  });

  it("renders instagram inbox queries against ManyChat-backed conversations", async () => {
    const stateDir = await makeStateDir();
    withPromoterCrmStore({ stateDir }, (store) => {
      const amanda = store.upsertContact({
        displayName: "Amanda Bracaj",
        identities: [
          {
            channel: "manychat",
            externalId: "210781128",
            isPrimary: true,
            replyUrl: "https://app.manychat.com/fb3160512/chat/210781128",
          },
          {
            channel: "instagram",
            handle: "@amandairl_",
            profileUrl: "https://www.instagram.com/amandairl_/",
          },
        ],
      });
      store.logInteraction({
        contactId: amanda.contactId,
        channel: "manychat",
        kind: "reply",
        direction: "inbound",
        summary: "Inbound Instagram DM captured by ManyChat.",
        content: "I wanna come out tn",
        conversationExternalId: "https://app.manychat.com/fb3160512/chat/210781128",
        occurredAt: "2026-03-15T18:26:52.654Z",
      });
    });

    const tool = createPromoterCrmRecentInboxTool(createApi(stateDir));
    const result = await tool.execute?.("tool-ig-1", {
      channel: "instagram",
      limit: 10,
      onlyNeedsReply: true,
    });
    const text = readTextContent(result);

    expect(text).toContain("Amanda Bracaj | channel=instagram via manychat | needsReply=yes");
    expect(text).toContain('lastMessage="I wanna come out tn"');
    expect(text).toContain("primaryIdentity=instagram:amandairl_");
    expect(text).toContain("replyUrl=https://app.manychat.com/fb3160512/chat/210781128");
    expect(text).toContain("profileUrl=https://www.instagram.com/amandairl_/");
  });

  it("renders grounded conversation threads directly in tool content", async () => {
    const stateDir = await makeStateDir();
    const { contactId } = withPromoterCrmStore({ stateDir }, (store) => {
      const preston = store.upsertContact({
        displayName: "Preston Choi",
        city: "New York",
        identities: [
          {
            channel: "manychat",
            externalId: "1629294916",
            isPrimary: true,
            replyUrl: "https://app.manychat.com/fb3160512/chat/1629294916",
          },
          {
            channel: "instagram",
            handle: "@pressed_in",
            profileUrl: "https://www.instagram.com/pressed_in/",
          },
        ],
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
    expect(text).toContain(
      "Links: replyUrl=https://app.manychat.com/fb3160512/chat/1629294916 | profileUrl=https://www.instagram.com/pressed_in/",
    );
    expect(text).toContain('[2026-03-14T00:38:29.010Z] inbound "Yo bro what\'s up"');
    expect(text).toContain('[2026-03-14T01:07:20.200Z] inbound "You\'re actually a loser"');
    expect(text).toContain('[2026-03-14T01:07:20.200Z] reply "Second inbound DM."');
  });

  it("sends a ManyChat reply and logs the outbound message back into the CRM thread", async () => {
    const stateDir = await makeStateDir();
    const { contactId } = withPromoterCrmStore({ stateDir }, (store) => {
      const natalie = store.upsertContact({
        displayName: "Natalie Radin",
        identities: [
          {
            channel: "manychat",
            externalId: "1266546411",
            isPrimary: true,
            replyUrl: "https://app.manychat.com/fb3160512/chat/1266546411",
          },
          {
            channel: "instagram",
            handle: "@natalie_radin",
            profileUrl: "https://www.instagram.com/natalie_radin/",
          },
        ],
      });
      store.logInteraction({
        contactId: natalie.contactId,
        channel: "manychat",
        kind: "reply",
        direction: "inbound",
        summary: "Inbound DM from Natalie.",
        content: "18 gaf",
        conversationExternalId: "https://app.manychat.com/fb3160512/chat/1266546411",
        occurredAt: "2026-03-14T01:28:25.533Z",
      });
      return { contactId: natalie.contactId };
    });

    process.env.MANYCHAT_API_KEY = "3160512:test-token";
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "success" }), { status: 200 }),
    );

    const tool = createPromoterCrmSendManychatReplyTool(createApi(stateDir));
    const result = await tool.execute?.("tool-send-1", {
      contactId,
      text: "Pull up around 11:30 and I got you.",
      confirmSend: true,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.manychat.com/fb/sending/sendContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer 3160512:test-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          subscriber_id: 1266546411,
          data: {
            version: "v2",
            content: {
              messages: [{ type: "text", text: "Pull up around 11:30 and I got you." }],
              actions: [],
              quick_replies: [],
            },
          },
        }),
      }),
    );

    const text = readTextContent(result);
    expect(text).toContain("Sent ManyChat reply to Natalie Radin.");

    const thread = withPromoterCrmStore({ stateDir }, (store) =>
      store.getConversationThread({ contactId, channel: "manychat", limit: 10 }),
    );
    expect(thread.messages.some((message) => message.direction === "outbound")).toBe(true);
    expect(
      thread.messages.some((message) => message.content === "Pull up around 11:30 and I got you."),
    ).toBe(true);
  });
});
