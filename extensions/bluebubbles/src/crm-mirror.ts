import type { OpenClawConfig } from "openclaw/plugin-sdk/bluebubbles";
import { type Direction, withPromoterCrmStore } from "../../promoter-crm/src/store.js";
import { buildMessagePlaceholder, type NormalizedWebhookMessage } from "./monitor-normalize.js";
import { getBlueBubblesRuntime } from "./runtime.js";
import { extractHandleFromChatGuid, isAllowedBlueBubblesSender } from "./targets.js";

function trimOrUndefined(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveOccurredAt(timestamp?: number): string | undefined {
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  const raw = Number(timestamp);
  const millis = raw > 1_000_000_000_000 ? raw : raw * 1_000;
  return new Date(millis).toISOString();
}

function resolveExternalThreadId(message: NormalizedWebhookMessage): string | null {
  return (
    trimOrUndefined(message.chatGuid) ??
    trimOrUndefined(message.chatIdentifier) ??
    (typeof message.chatId === "number" && Number.isFinite(message.chatId)
      ? String(message.chatId)
      : null)
  );
}

function resolveContactAddress(message: NormalizedWebhookMessage): string {
  return (
    trimOrUndefined(extractHandleFromChatGuid(message.chatGuid)) ??
    trimOrUndefined(message.senderId) ??
    trimOrUndefined(message.chatIdentifier) ??
    ""
  );
}

type MirrorParams = {
  message: NormalizedWebhookMessage;
  config: OpenClawConfig;
  accountId: string;
  isGroup: boolean;
  isSelfChatMessage: boolean;
  rawBody: string;
};

export async function mirrorBlueBubblesMessageToPromoterCrm(
  params: MirrorParams,
): Promise<{ mirrored: boolean; skippedReason?: string }> {
  if (params.isGroup) {
    return { mirrored: false, skippedReason: "group-chat" };
  }
  if (params.isSelfChatMessage) {
    return { mirrored: false, skippedReason: "self-chat" };
  }

  const senderAddress = resolveContactAddress(params.message);
  const externalThreadId = resolveExternalThreadId(params.message);
  if (!senderAddress || !externalThreadId) {
    return { mirrored: false, skippedReason: "missing-address-or-thread" };
  }

  const allowFrom = Array.isArray(params.config.channels?.bluebubbles?.allowFrom)
    ? params.config.channels?.bluebubbles?.allowFrom
    : [];
  const isOwnerControlMessage =
    params.message.fromMe !== true &&
    isAllowedBlueBubblesSender({
      allowFrom,
      sender: params.message.senderId,
      chatId: params.message.chatId ?? undefined,
      chatGuid: params.message.chatGuid ?? undefined,
      chatIdentifier: params.message.chatIdentifier ?? undefined,
    });
  if (isOwnerControlMessage) {
    return { mirrored: false, skippedReason: "owner-control-lane" };
  }

  const content = params.rawBody || buildMessagePlaceholder(params.message);
  if (!content.trim()) {
    return { mirrored: false, skippedReason: "empty-content" };
  }

  const stateDir = getBlueBubblesRuntime().state.resolveStateDir(process.env);
  const occurredAt = resolveOccurredAt(params.message.timestamp);
  const direction: Direction = params.message.fromMe ? "outbound" : "inbound";
  withPromoterCrmStore({ stateDir }, (store) =>
    store.logBlueBubblesLiveMessage({
      accountId: params.accountId,
      senderAddress,
      senderDisplayName: trimOrUndefined(params.message.senderName),
      externalThreadId,
      externalMessageId: trimOrUndefined(params.message.messageId),
      direction,
      occurredAt,
      status: direction === "outbound" ? "sent" : "received",
      content,
      createdBy: "bluebubbles-live",
      metadata: {
        senderId: params.message.senderId,
        senderName: params.message.senderName,
        chatGuid: params.message.chatGuid,
        chatIdentifier: params.message.chatIdentifier,
        chatId: params.message.chatId,
        chatName: params.message.chatName,
        fromMe: params.message.fromMe === true,
        attachments: params.message.attachments ?? [],
        participants: params.message.participants ?? [],
        replyToId: params.message.replyToId,
        replyToBody: params.message.replyToBody,
        replyToSender: params.message.replyToSender,
      },
    }),
  );

  return { mirrored: true };
}
