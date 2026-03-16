import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withPromoterCrmStore } from "../../promoter-crm/src/store.js";
import { mirrorBlueBubblesMessageToPromoterCrm } from "./crm-mirror.js";
import type { NormalizedWebhookMessage } from "./monitor-normalize.js";
import { setBlueBubblesRuntime, clearBlueBubblesRuntime } from "./runtime.js";

const tempDirs: string[] = [];

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bb-crm-mirror-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  clearBlueBubblesRuntime();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function installRuntime(stateDir: string) {
  setBlueBubblesRuntime({
    state: {
      resolveStateDir() {
        return stateDir;
      },
    },
  } as never);
}

function makeMessage(override: Partial<NormalizedWebhookMessage> = {}): NormalizedWebhookMessage {
  return {
    text: "Hello there",
    senderId: "+15551234567",
    senderIdExplicit: true,
    senderName: "Yana",
    messageId: "msg-1",
    timestamp: Date.UTC(2026, 2, 16, 13, 0, 0),
    isGroup: false,
    chatGuid: "iMessage;-;+15551234567",
    fromMe: false,
    attachments: [],
    ...override,
  };
}

describe("BlueBubbles CRM mirror", () => {
  it("mirrors non-owner iMessages into the promoter CRM", async () => {
    const stateDir = await makeStateDir();
    installRuntime(stateDir);

    const result = await mirrorBlueBubblesMessageToPromoterCrm({
      message: makeMessage(),
      config: {
        channels: {
          bluebubbles: {
            allowFrom: ["+12014462530", "prestonb0917@gmail.com"],
          },
        },
      } as never,
      accountId: "default",
      isGroup: false,
      isSelfChatMessage: false,
      rawBody: "Hello there",
    });

    expect(result.mirrored).toBe(true);

    const inbox = withPromoterCrmStore({ stateDir }, (store) =>
      store.getRecentInbox({ channel: "imessage", limit: 5 }),
    );
    const thread = withPromoterCrmStore({ stateDir }, (store) =>
      store.getConversationThread({
        contactId: (inbox.conversations[0] as any).contactId,
        channel: "imessage",
        limit: 5,
      }),
    );

    expect(inbox.conversations).toHaveLength(1);
    expect((inbox.conversations[0] as any).contactName).toBe("Yana");
    expect((thread.messages[0] as any).content).toBe("Hello there");
  });

  it("skips owner control-lane iMessages", async () => {
    const stateDir = await makeStateDir();
    installRuntime(stateDir);

    const result = await mirrorBlueBubblesMessageToPromoterCrm({
      message: makeMessage({
        senderId: "+12014462530",
        senderName: "Preston",
        chatGuid: "iMessage;-;+12014462530",
      }),
      config: {
        channels: {
          bluebubbles: {
            allowFrom: ["+12014462530", "prestonb0917@gmail.com"],
          },
        },
      } as never,
      accountId: "default",
      isGroup: false,
      isSelfChatMessage: false,
      rawBody: "check status",
    });

    expect(result).toEqual({ mirrored: false, skippedReason: "owner-control-lane" });

    const inbox = withPromoterCrmStore({ stateDir }, (store) =>
      store.getRecentInbox({ channel: "imessage", limit: 5 }),
    );
    expect(inbox.conversations).toHaveLength(0);
  });

  it("mirrors outbound manual iMessages to CRM while skipping self-chat", async () => {
    const stateDir = await makeStateDir();
    installRuntime(stateDir);

    const mirrored = await mirrorBlueBubblesMessageToPromoterCrm({
      message: makeMessage({
        fromMe: true,
        senderId: "+15551234567",
        senderName: "Marc",
        chatGuid: "iMessage;-;+15551234567",
        messageId: "msg-2",
      }),
      config: { channels: { bluebubbles: { allowFrom: ["+12014462530"] } } } as never,
      accountId: "default",
      isGroup: false,
      isSelfChatMessage: false,
      rawBody: "pull up around 11",
    });

    const skipped = await mirrorBlueBubblesMessageToPromoterCrm({
      message: makeMessage({
        fromMe: true,
        senderId: "+12014462530",
        senderName: "Preston",
        chatGuid: "iMessage;-;+12014462530",
        messageId: "msg-3",
      }),
      config: { channels: { bluebubbles: { allowFrom: ["+12014462530"] } } } as never,
      accountId: "default",
      isGroup: false,
      isSelfChatMessage: true,
      rawBody: "status?",
    });

    expect(mirrored.mirrored).toBe(true);
    expect(skipped).toEqual({ mirrored: false, skippedReason: "self-chat" });

    const inbox = withPromoterCrmStore({ stateDir }, (store) =>
      store.getRecentInbox({ channel: "imessage", limit: 5 }),
    );
    const thread = withPromoterCrmStore({ stateDir }, (store) =>
      store.getConversationThread({
        contactId: (inbox.conversations[0] as any).contactId,
        channel: "imessage",
        limit: 5,
      }),
    );
    expect(inbox.conversations).toHaveLength(1);
    expect((thread.messages[0] as any).direction).toBe("outbound");
    expect((thread.messages[0] as any).content).toBe("pull up around 11");
  });
});
