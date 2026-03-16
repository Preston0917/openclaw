import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { mirrorBlueBubblesMessageToPromoterCrm } from "../../bluebubbles/src/crm-mirror.js";
import {
  buildMessagePlaceholder,
  normalizeWebhookMessage,
} from "../../bluebubbles/src/monitor-normalize.js";
import {
  extractHandleFromChatGuid,
  normalizeBlueBubblesHandle,
} from "../../bluebubbles/src/targets.js";
import type { IdentityChannel } from "./store.js";
import { withPromoterCrmStore } from "./store.js";

const DEFAULT_LOOKBACK_MS = 12 * 60 * 60 * 1_000;
const MIN_BACKFILL_WINDOW_MS = 2 * 60 * 60 * 1_000;
const MIN_SYNC_INTERVAL_MS = 4_000;
const MAX_SYNC_LIMIT = 250;

const syncState = new Map<
  string,
  {
    lastStartedAt: number;
    inFlight: Promise<{ imported: number; fetched: number; afterMs: number }> | null;
  }
>();

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shouldSyncImessageChannel(channel?: IdentityChannel): boolean {
  return !channel || channel === "imessage";
}

function isBlueBubblesSelfChatMessage(message: {
  senderId: string;
  senderIdExplicit: boolean;
  chatGuid?: string;
  chatIdentifier?: string;
  isGroup: boolean;
}): boolean {
  if (message.isGroup || !message.senderIdExplicit) {
    return false;
  }
  const chatHandle =
    (message.chatGuid ? extractHandleFromChatGuid(message.chatGuid) : null) ??
    normalizeBlueBubblesHandle(message.chatIdentifier ?? "");
  return Boolean(chatHandle) && chatHandle === message.senderId;
}

async function fetchBlueBubblesMessages(params: {
  serverUrl: string;
  password: string;
  afterMs: number;
  limit: number;
}): Promise<Array<Record<string, unknown>>> {
  const baseUrl = params.serverUrl.replace(/\/+$/, "");
  const url = new URL("/api/v1/message/query", `${baseUrl}/`);
  url.searchParams.set("password", params.password);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      after: Math.max(0, Math.floor(params.afterMs)),
      limit: Math.max(1, Math.min(params.limit, MAX_SYNC_LIMIT)),
      offset: 0,
      sort: "ASC",
      with: ["attachments", "chats", "chat.participants", "handle", "sender"],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`BlueBubbles CRM sync failed (${response.status}): ${body || "unknown error"}`);
  }
  const payload = (await response.json().catch(() => null)) as { data?: unknown } | null;
  return Array.isArray(payload?.data)
    ? payload.data.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function resolveLatestImessageTimestamp(api: OpenClawPluginApi): number {
  const stateDir = api.runtime.state.resolveStateDir(process.env);
  const inbox = withPromoterCrmStore({ stateDir }, (store) =>
    store.getRecentInbox({
      channel: "imessage",
      limit: 1,
    }),
  );
  const latest = inbox.conversations[0] as Record<string, unknown> | undefined;
  const raw =
    (typeof latest?.lastActivityAt === "string" && latest.lastActivityAt) ||
    (typeof latest?.lastMessageAt === "string" && latest.lastMessageAt) ||
    "";
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return Date.now() - DEFAULT_LOOKBACK_MS;
  }
  // Keep a real catch-up window so recent iMessages still backfill after
  // restarts or missed webhook/poller cycles.
  return Math.max(0, Math.min(parsed, Date.now()) - MIN_BACKFILL_WINDOW_MS);
}

export async function syncBlueBubblesIntoPromoterCrm(params: {
  api: OpenClawPluginApi;
  channel?: IdentityChannel;
}): Promise<{ imported: number; fetched: number; afterMs: number }> {
  if (!shouldSyncImessageChannel(params.channel)) {
    return { imported: 0, fetched: 0, afterMs: 0 };
  }

  const bb = params.api.config.channels?.bluebubbles;
  const enabled = bb?.enabled !== false;
  const serverUrl = trimString(bb?.serverUrl);
  const password = trimString(bb?.password);
  if (!enabled || !serverUrl || !password) {
    return { imported: 0, fetched: 0, afterMs: 0 };
  }

  const syncKey = `${serverUrl}|${password}`;
  const now = Date.now();
  const current = syncState.get(syncKey);
  if (current?.inFlight) {
    return await current.inFlight;
  }
  if (current && now - current.lastStartedAt < MIN_SYNC_INTERVAL_MS) {
    return { imported: 0, fetched: 0, afterMs: 0 };
  }

  const afterMs = resolveLatestImessageTimestamp(params.api);
  const task = (async () => {
    const messages = await fetchBlueBubblesMessages({
      serverUrl,
      password,
      afterMs,
      limit: MAX_SYNC_LIMIT,
    });
    let imported = 0;
    for (const record of messages) {
      const normalized = normalizeWebhookMessage({ type: "new-message", data: record });
      if (!normalized) {
        continue;
      }
      const rawBody = normalized.text.trim() || buildMessagePlaceholder(normalized);
      if (!rawBody) {
        continue;
      }
      const result = await mirrorBlueBubblesMessageToPromoterCrm({
        message: normalized,
        config: params.api.config,
        accountId: "default",
        isGroup: normalized.isGroup,
        isSelfChatMessage: isBlueBubblesSelfChatMessage({
          senderId: normalized.senderId,
          senderIdExplicit: normalized.senderIdExplicit,
          chatGuid: normalized.chatGuid,
          chatIdentifier: normalized.chatIdentifier,
          isGroup: normalized.isGroup,
        }),
        rawBody,
      });
      if (result.mirrored) {
        imported += 1;
      }
    }
    return { imported, fetched: messages.length, afterMs };
  })();

  syncState.set(syncKey, {
    lastStartedAt: now,
    inFlight: task,
  });

  try {
    return await task;
  } finally {
    syncState.set(syncKey, {
      lastStartedAt: Date.now(),
      inFlight: null,
    });
  }
}
