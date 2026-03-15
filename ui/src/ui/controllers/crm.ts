import type { GatewayBrowserClient } from "../gateway.ts";

export type CrmChannelFilter = "all" | "instagram" | "manychat" | "imessage" | "whatsapp";

export type CrmInboxItem = {
  conversationId: string;
  contactId: string;
  contactName: string;
  channel: string;
  matchedChannel?: string;
  channelLabel?: string;
  lastActivityAt?: string;
  needsReply?: boolean;
  lastMessage?: {
    preview?: string;
    contentType?: string;
    sentAt?: string;
  } | null;
  replyUrl?: string | null;
  profileUrl?: string | null;
  tags?: string[];
  openFollowupTasks?: Array<Record<string, unknown>>;
};

export type CrmInboxSnapshot = {
  refreshedAt: string;
  conversations: CrmInboxItem[];
};

export type CrmConversationThread = {
  contact: Record<string, unknown>;
  identities: Array<Record<string, unknown>>;
  tags: string[];
  latestScore: Record<string, unknown> | null;
  conversation: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  interactions: Array<Record<string, unknown>>;
  followupTasks: Array<Record<string, unknown>>;
};

export type CrmReplyActionResult = {
  ok: boolean;
  contactId: string;
  contactName: string;
  conversationId: string;
  interactionId: string;
  text: string;
  sentAt?: string;
  loggedAt?: string;
  closedFollowupTasks?: number;
};

export type CrmState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  crmInboxLoading: boolean;
  crmInboxError: string | null;
  crmInboxRefreshedAt: string | null;
  crmInboxItems: CrmInboxItem[];
  crmThreadLoading: boolean;
  crmThreadError: string | null;
  crmThread: CrmConversationThread | null;
  crmSelectedConversationId: string | null;
  crmChannelFilter: CrmChannelFilter;
  crmNeedsReplyOnly: boolean;
  crmSearchQuery: string;
  crmComposerText: string;
  crmSendBusy: boolean;
  crmLogBusy: boolean;
  crmActionMessage: string | null;
  crmActionError: string | null;
};

function effectiveChannel(channel: CrmChannelFilter): string | undefined {
  return channel === "all" ? undefined : channel;
}

function describeUiError(err: unknown): string {
  return err instanceof Error && err.message.trim() ? err.message : String(err);
}

function resolveSelectedConversationId(
  items: CrmInboxItem[],
  current: string | null,
  preferred?: string | null,
): string | null {
  const requested = preferred ?? current;
  if (requested && items.some((item) => item.conversationId === requested)) {
    return requested;
  }
  return items[0]?.conversationId ?? null;
}

export async function loadCrmInbox(
  state: CrmState,
  opts?: { selectConversationId?: string | null; reloadThread?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.crmInboxLoading = true;
  state.crmInboxError = null;
  try {
    const result = await state.client.request<CrmInboxSnapshot>("promoter-crm.inbox.list", {
      channel: effectiveChannel(state.crmChannelFilter),
      onlyNeedsReply: state.crmNeedsReplyOnly,
      limit: 100,
    });
    const items = Array.isArray(result?.conversations) ? result.conversations : [];
    state.crmInboxItems = items;
    state.crmInboxRefreshedAt =
      typeof result?.refreshedAt === "string" ? result.refreshedAt : new Date().toISOString();
    state.crmSelectedConversationId = resolveSelectedConversationId(
      items,
      state.crmSelectedConversationId,
      opts?.selectConversationId,
    );
    if (opts?.reloadThread === false) {
      return;
    }
    await loadCrmThread(state, { conversationId: state.crmSelectedConversationId });
  } catch (err) {
    state.crmInboxError = describeUiError(err);
  } finally {
    state.crmInboxLoading = false;
  }
}

export async function loadCrmThread(
  state: CrmState,
  opts?: { conversationId?: string | null; contactId?: string | null },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const conversationId = opts?.conversationId ?? state.crmSelectedConversationId;
  const contactId = opts?.contactId ?? null;
  if (!conversationId && !contactId) {
    state.crmSelectedConversationId = null;
    state.crmThread = null;
    state.crmThreadError = null;
    return;
  }
  state.crmThreadLoading = true;
  state.crmThreadError = null;
  try {
    const thread = await state.client.request<CrmConversationThread>("promoter-crm.thread.get", {
      conversationId: conversationId ?? undefined,
      contactId: contactId ?? undefined,
      channel: effectiveChannel(state.crmChannelFilter),
      limit: 100,
    });
    state.crmThread = thread;
    const resolvedConversationId =
      thread?.conversation &&
      typeof thread.conversation === "object" &&
      typeof thread.conversation.conversationId === "string"
        ? thread.conversation.conversationId
        : conversationId;
    state.crmSelectedConversationId = resolvedConversationId ?? null;
  } catch (err) {
    state.crmThreadError = describeUiError(err);
  } finally {
    state.crmThreadLoading = false;
  }
}

async function runReplyAction(
  state: CrmState,
  method: "promoter-crm.reply.send" | "promoter-crm.reply.log",
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const text = state.crmComposerText.trim();
  if (!text || !state.crmSelectedConversationId) {
    return;
  }

  if (method === "promoter-crm.reply.send") {
    state.crmSendBusy = true;
  } else {
    state.crmLogBusy = true;
  }
  state.crmActionError = null;

  try {
    const result = await state.client.request<CrmReplyActionResult>(method, {
      conversationId: state.crmSelectedConversationId,
      channel: effectiveChannel(state.crmChannelFilter),
      text,
    });
    state.crmComposerText = "";
    state.crmActionMessage =
      method === "promoter-crm.reply.send"
        ? `Sent reply to ${result.contactName}.`
        : `Logged manual reply for ${result.contactName}.`;
    await loadCrmInbox(state, { selectConversationId: result.conversationId });
  } catch (err) {
    state.crmActionError = describeUiError(err);
  } finally {
    if (method === "promoter-crm.reply.send") {
      state.crmSendBusy = false;
    } else {
      state.crmLogBusy = false;
    }
  }
}

export async function sendCrmReply(state: CrmState): Promise<void> {
  await runReplyAction(state, "promoter-crm.reply.send");
}

export async function logCrmManualReply(state: CrmState): Promise<void> {
  await runReplyAction(state, "promoter-crm.reply.log");
}
