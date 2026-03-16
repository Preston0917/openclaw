import { randomUUID } from "node:crypto";
import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { ErrorCodes, errorShape } from "../../../src/gateway/protocol/index.js";
import { sendManychatText } from "./manychat-api.js";
import type { IdentityChannel } from "./store.js";
import { withPromoterCrmStore } from "./store.js";

const IDENTITY_CHANNELS = new Set<IdentityChannel>([
  "google",
  "manychat",
  "instagram",
  "imessage",
  "whatsapp",
  "email",
  "phone",
  "csv",
  "manual",
  "airtable",
]);

function normalizeWhitespace(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function maybeString(value: unknown): string | undefined {
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
}

function parseIdentityChannel(value: unknown): IdentityChannel | undefined {
  const normalized = maybeString(value);
  if (!normalized || normalized === "all") {
    return undefined;
  }
  return IDENTITY_CHANNELS.has(normalized as IdentityChannel)
    ? (normalized as IdentityChannel)
    : undefined;
}

function parseBoundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(Math.floor(value), max))
    : fallback;
}

function collapseWhitespace(value: string, maxLength = 120): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sendError(
  respond: GatewayRequestHandlerOptions["respond"],
  err: unknown,
  fallback = "Promoter CRM request failed.",
): void {
  const message = err instanceof Error ? err.message : fallback;
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}

function sendInvalidRequest(
  respond: GatewayRequestHandlerOptions["respond"],
  message: string,
): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function resolveStateDir(api: OpenClawPluginApi): string {
  return api.runtime.state.resolveStateDir(process.env);
}

export function registerPromoterCrmGatewayMethods(api: OpenClawPluginApi): void {
  api.registerGatewayMethod(
    "promoter-crm.inbox.list",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const result = await withPromoterCrmStore({ stateDir: resolveStateDir(api) }, (store) =>
          store.getRecentInbox({
            channel: parseIdentityChannel(params.channel),
            limit: parseBoundedInteger(params.limit, 1, 200, 100),
            onlyNeedsReply: params.onlyNeedsReply === true,
            sinceHours:
              typeof params.sinceHours === "number" && Number.isFinite(params.sinceHours)
                ? params.sinceHours
                : undefined,
          }),
        );
        respond(true, result);
      } catch (err) {
        sendError(respond, err, "Failed to load promoter CRM inbox.");
      }
    },
  );

  api.registerGatewayMethod(
    "promoter-crm.thread.get",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const conversationId = maybeString(params.conversationId);
        const contactId = maybeString(params.contactId);
        if (!conversationId && !contactId) {
          sendInvalidRequest(respond, "conversationId or contactId is required.");
          return;
        }
        const result = await withPromoterCrmStore({ stateDir: resolveStateDir(api) }, (store) =>
          store.getConversationThread({
            conversationId,
            contactId,
            channel: parseIdentityChannel(params.channel),
            limit: parseBoundedInteger(params.limit, 1, 200, 100),
          }),
        );
        respond(true, result);
      } catch (err) {
        sendError(respond, err, "Failed to load promoter CRM conversation thread.");
      }
    },
  );

  api.registerGatewayMethod(
    "promoter-crm.reply.log",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const text = normalizeWhitespace(params.text);
        if (!text) {
          sendInvalidRequest(respond, "Reply text is required.");
          return;
        }
        const conversationId = maybeString(params.conversationId);
        const contactId = maybeString(params.contactId);
        if (!conversationId && !contactId) {
          sendInvalidRequest(respond, "conversationId or contactId is required.");
          return;
        }

        const result = await withPromoterCrmStore({ stateDir: resolveStateDir(api) }, (store) => {
          const thread = store.getConversationThread({
            conversationId,
            contactId,
            channel: parseIdentityChannel(params.channel),
            limit: 1,
          });
          const conversation = thread.conversation as Record<string, unknown>;
          const contact = thread.contact as Record<string, unknown>;
          const resolvedConversationId =
            typeof conversation.conversationId === "string" ? conversation.conversationId : "";
          const resolvedContactId = typeof contact.contactId === "string" ? contact.contactId : "";
          const contactName =
            (typeof contact.displayName === "string" && contact.displayName.trim()) ||
            resolvedContactId;
          const occurredAt = new Date().toISOString();
          const interaction = store.logInteraction({
            contactId: resolvedContactId,
            conversationId: resolvedConversationId,
            channel:
              typeof conversation.channel === "string"
                ? (conversation.channel as IdentityChannel)
                : undefined,
            logicalChannel:
              typeof conversation.logicalChannel === "string"
                ? (conversation.logicalChannel as IdentityChannel)
                : undefined,
            transport:
              typeof conversation.transport === "string" ? conversation.transport : undefined,
            conversationRole:
              typeof conversation.conversationRole === "string"
                ? conversation.conversationRole
                : undefined,
            kind: "reply",
            direction: "outbound",
            actorRole: "user",
            authorshipMode: "manual_user",
            summary: `Manual outbound reply: ${collapseWhitespace(text)}`,
            occurredAt,
            messageStatus: "logged",
            content: text,
            metadata: {
              source: "control_ui_manual_reply",
              matchedChannel: conversation.matchedChannel,
              channelLabel: conversation.channelLabel,
              replyUrl: conversation.replyUrl,
              profileUrl: conversation.profileUrl,
            },
          });
          const followups = store.completeOpenFollowupTasks(resolvedContactId);
          return {
            ok: true,
            contactId: resolvedContactId,
            contactName,
            conversationId: resolvedConversationId,
            interactionId: interaction.interactionId,
            loggedAt: occurredAt,
            text,
            closedFollowupTasks: followups.updatedCount,
          };
        });
        respond(true, result);
      } catch (err) {
        sendError(respond, err, "Failed to log manual promoter CRM reply.");
      }
    },
  );

  api.registerGatewayMethod(
    "promoter-crm.reply.send",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const text = normalizeWhitespace(params.text);
        if (!text) {
          sendInvalidRequest(respond, "Reply text is required.");
          return;
        }

        const apiKey = process.env.MANYCHAT_API_KEY?.trim();
        if (!apiKey) {
          sendInvalidRequest(
            respond,
            "MANYCHAT_API_KEY is not configured for the OpenClaw gateway.",
          );
          return;
        }

        const conversationId = maybeString(params.conversationId);
        const contactId = maybeString(params.contactId);
        if (!conversationId && !contactId) {
          sendInvalidRequest(respond, "conversationId or contactId is required.");
          return;
        }

        const target = await withPromoterCrmStore({ stateDir: resolveStateDir(api) }, (store) =>
          store.resolveManychatReplyTarget({
            conversationId,
            contactId,
            channel: parseIdentityChannel(params.channel),
          }),
        );

        const providerResult = await sendManychatText({
          apiKey,
          subscriberId: Number(target.subscriberId),
          text,
          contentType: target.matchedChannel === "instagram" ? "instagram" : undefined,
          messageTag: maybeString(params.messageTag),
          otnTopicName: maybeString(params.otnTopicName),
        });

        const occurredAt = new Date().toISOString();
        const messageExternalId = `manychat-outbound-${randomUUID()}`;
        const interactionId = `manychat-outbound-interaction-${randomUUID()}`;

        const result = await withPromoterCrmStore({ stateDir: resolveStateDir(api) }, (store) => {
          store.logInteraction({
            interactionId,
            contactId: target.contactId,
            conversationId: target.conversationId,
            channel: "manychat",
            logicalChannel: target.matchedChannel,
            transport: "manychat",
            conversationRole: "crm",
            kind: "reply",
            direction: "outbound",
            actorRole: "user",
            authorshipMode: "assistant_send",
            summary: `ManyChat outbound reply: ${collapseWhitespace(text)}`,
            occurredAt,
            messageExternalId,
            messageStatus: "sent",
            content: text,
            metadata: {
              source: "control_ui_manychat_send",
              provider: "manychat",
              endpoint: providerResult.endpoint,
              responseStatus: providerResult.responseStatus,
              responseBody: providerResult.responseBody,
              requestBody: providerResult.requestBody,
              subscriberId: target.subscriberId,
              matchedChannel: target.matchedChannel,
              replyUrl: target.replyUrl,
              profileUrl: target.profileUrl,
              instagramProfileUrl: target.instagramProfileUrl,
            },
          });
          const followups = store.completeOpenFollowupTasks(target.contactId);
          return {
            ok: true,
            contactId: target.contactId,
            contactName: target.contactName,
            conversationId: target.conversationId,
            interactionId,
            messageExternalId,
            sentAt: occurredAt,
            text,
            matchedChannel: target.matchedChannel,
            replyUrl: target.replyUrl,
            profileUrl: target.profileUrl,
            instagramProfileUrl: target.instagramProfileUrl,
            closedFollowupTasks: followups.updatedCount,
            providerResult,
          };
        });
        respond(true, result);
      } catch (err) {
        sendError(respond, err, "Failed to send promoter CRM ManyChat reply.");
      }
    },
  );
}
