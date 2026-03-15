import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type {
  CrmChannelFilter,
  CrmConversationThread,
  CrmInboxTab,
  CrmInboxItem,
} from "../controllers/crm.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";

type CrmProps = {
  inboxLoading: boolean;
  inboxError: string | null;
  inboxRefreshedAt: string | null;
  inboxItems: CrmInboxItem[];
  threadLoading: boolean;
  threadError: string | null;
  thread: CrmConversationThread | null;
  selectedConversationId: string | null;
  channelFilter: CrmChannelFilter;
  inboxTab: CrmInboxTab;
  searchQuery: string;
  composerText: string;
  sendBusy: boolean;
  logBusy: boolean;
  actionMessage: string | null;
  actionError: string | null;
  onRefresh: () => void;
  onSelectConversation: (conversationId: string) => void;
  onChannelFilterChange: (next: CrmChannelFilter) => void;
  onInboxTabChange: (next: CrmInboxTab) => void;
  onSearchQueryChange: (next: string) => void;
  onComposerTextChange: (next: string) => void;
  onSendReply: () => void;
  onLogReply: () => void;
  onDraftInChat: () => void;
};

function formatAbsoluteTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatRelativeTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatRelativeTimestamp(date.getTime());
}

function stringifyValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function looksNumericLabel(value: string): boolean {
  const trimmed = value.trim();
  return /^\d{6,}$/.test(trimmed);
}

function extractInstagramHandleFromUrl(value: string): string | null {
  const match = value.match(/instagram\.com\/([^/?#]+)/i);
  return match?.[1] ? `@${match[1]}` : null;
}

function formatLeadTitle(input: {
  contactName?: string | null;
  profileUrl?: string | null;
}): string {
  const contactName = stringifyValue(input.contactName).trim();
  if (contactName && !looksNumericLabel(contactName)) {
    return contactName;
  }
  const handle = extractInstagramHandleFromUrl(stringifyValue(input.profileUrl));
  if (handle) {
    return handle;
  }
  return contactName || "Unknown lead";
}

function formatLeadSecondary(input: {
  contactName?: string | null;
  profileUrl?: string | null;
  channelLabel?: string | null;
}): string | null {
  const contactName = stringifyValue(input.contactName).trim();
  if (contactName && looksNumericLabel(contactName)) {
    return `${stringifyValue(input.channelLabel) || "lead"} · id ${contactName}`;
  }
  const handle = extractInstagramHandleFromUrl(stringifyValue(input.profileUrl));
  if (handle && handle !== contactName) {
    return `${stringifyValue(input.channelLabel) || "lead"} · ${handle}`;
  }
  return stringifyValue(input.channelLabel) || null;
}

function leadInitials(label: string): string {
  const cleaned = label.replace(/^@/, "").trim();
  if (!cleaned) {
    return "?";
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function formatMessageBody(message: Record<string, unknown>): string {
  const preview = stringifyValue(message.preview);
  if (preview) {
    return preview;
  }
  const content = stringifyValue(message.content);
  return content || "(no content)";
}

function renderInboxItem(
  item: CrmInboxItem,
  selectedConversationId: string | null,
  onSelectConversation: (conversationId: string) => void,
) {
  const displayTitle = formatLeadTitle({
    contactName: item.contactName,
    profileUrl: item.profileUrl,
  });
  const displaySecondary = formatLeadSecondary({
    contactName: item.contactName,
    profileUrl: item.profileUrl,
    channelLabel: item.channelLabel,
  });
  const preview = item.lastMessage?.preview ?? "No messages yet.";
  const relative = formatRelativeTime(item.lastActivityAt ?? item.lastMessage?.sentAt);
  const when = formatAbsoluteTime(item.lastActivityAt ?? item.lastMessage?.sentAt);
  const taskCount = Array.isArray(item.openFollowupTasks) ? item.openFollowupTasks.length : 0;
  return html`
    <button
      type="button"
      class="list-item list-item-clickable crm-inbox-item ${selectedConversationId === item.conversationId
        ? "list-item-selected"
        : ""}"
      @click=${() => onSelectConversation(item.conversationId)}
    >
      <div class="crm-inbox-item__avatar">${leadInitials(displayTitle)}</div>
      <div class="list-main">
        <div class="crm-inbox-item__title-row">
          <div class="list-title">${displayTitle}</div>
          ${item.needsReply ? html`<span class="crm-pill crm-pill--urgent">Needs reply</span>` : nothing}
        </div>
        ${displaySecondary ? html`<div class="list-sub">${displaySecondary}</div>` : nothing}
        <div class="crm-inbox-item__preview">${preview}</div>
        ${
          Array.isArray(item.tags) && item.tags.length > 0
            ? html`
                <div class="crm-chip-row">
                  ${item.tags.slice(0, 4).map((tag) => html`<span class="chip">${tag}</span>`)}
                  ${taskCount > 0 ? html`<span class="chip">tasks ${taskCount}</span>` : nothing}
                </div>
              `
            : taskCount > 0
              ? html`<div class="crm-chip-row"><span class="chip">tasks ${taskCount}</span></div>`
              : nothing
        }
      </div>
      <div class="list-meta">
        <div>${relative}</div>
        <div class="mono">${when}</div>
      </div>
    </button>
  `;
}

function renderThreadHeader(thread: CrmConversationThread) {
  const contact = thread.contact as Record<string, unknown>;
  const conversation = thread.conversation as Record<string, unknown>;
  const latestScore = thread.latestScore as Record<string, unknown> | null;
  const title = formatLeadTitle({
    contactName: stringifyValue(contact.displayName) || stringifyValue(contact.contactId),
    profileUrl: stringifyValue(conversation.profileUrl),
  });
  const secondary = formatLeadSecondary({
    contactName: stringifyValue(contact.displayName) || stringifyValue(contact.contactId),
    profileUrl: stringifyValue(conversation.profileUrl),
    channelLabel: stringifyValue(conversation.channelLabel) || stringifyValue(conversation.channel),
  });
  const qualityTier = stringifyValue(contact.qualityTier) || "—";
  const score =
    latestScore && typeof latestScore.overall_score === "number"
      ? latestScore.overall_score.toFixed(1)
      : "—";
  const replyUrl = stringifyValue(conversation.replyUrl);
  const profileUrl = stringifyValue(conversation.profileUrl);
  return html`
    <div class="crm-thread__header">
      <div class="crm-thread__identity">
        <div class="crm-thread__avatar">${leadInitials(title)}</div>
        <div>
          <div class="card-title">${title}</div>
          <div class="card-sub">
            ${secondary ?? "lead"}
            · quality ${qualityTier}
            · score ${score}
          </div>
          <div class="crm-thread__meta-line">Updated ${formatRelativeTime(conversation.lastActivityAt)}</div>
        </div>
      </div>
      <div class="crm-thread__header-links">
        ${
          replyUrl
            ? html`
                <a
                  class="session-link"
                  href=${replyUrl}
                  target=${EXTERNAL_LINK_TARGET}
                  rel=${buildExternalLinkRel()}
                >Open reply link</a>
              `
            : nothing
        }
        ${
          profileUrl
            ? html`
                <a
                  class="session-link"
                  href=${profileUrl}
                  target=${EXTERNAL_LINK_TARGET}
                  rel=${buildExternalLinkRel()}
                >Open profile</a>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderMessage(message: Record<string, unknown>) {
  const direction = stringifyValue(message.direction);
  const preview = formatMessageBody(message);
  const sentAt = formatAbsoluteTime(message.sentAt);
  const attachmentUrls = Array.isArray(message.attachmentUrls)
    ? message.attachmentUrls.filter((entry): entry is string => typeof entry === "string")
    : [];
  return html`
    <div class="crm-message-row crm-message-row--${direction === "outbound" ? "outbound" : "inbound"}">
      <div class="crm-message crm-message--${direction === "outbound" ? "outbound" : "inbound"}">
        <div class="crm-message__meta">
          <span>${direction === "outbound" ? "You" : "Lead"}</span>
          <span>${sentAt}</span>
        </div>
        <div class="crm-message__body">${preview}</div>
        ${
          attachmentUrls.length > 0
            ? html`
                <div class="crm-message__attachments">
                  ${attachmentUrls.map(
                    (url) => html`
                      <a
                        class="session-link"
                        href=${url}
                        target=${EXTERNAL_LINK_TARGET}
                        rel=${buildExternalLinkRel()}
                      >Attachment</a>
                    `,
                  )}
                </div>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

export function renderCrm(props: CrmProps) {
  const needle = props.searchQuery.trim().toLowerCase();
  const allItems = props.inboxItems.filter((item) => {
    if (!needle) {
      return true;
    }
    const haystack = [item.contactName, item.channelLabel, item.channel, item.lastMessage?.preview]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
  const visibleItems =
    props.inboxTab === "needs-replies" ? allItems.filter((item) => item.needsReply) : allItems;
  const needsReplyCount = props.inboxItems.filter((item) => item.needsReply).length;
  const allCount = props.inboxItems.length;
  const conversation = props.thread?.conversation as Record<string, unknown> | undefined;
  const canSend = stringifyValue(conversation?.channel) === "manychat";
  const needsReply = conversation?.needsReply === true;
  const followupTasks = Array.isArray(props.thread?.followupTasks)
    ? props.thread.followupTasks
    : [];

  return html`
    <section class="crm-layout">
      <div class="card crm-panel">
        <div class="crm-panel__header">
          <div>
            <div class="card-title">Lead Inbox</div>
            <div class="card-sub">Click a lead to open the live thread and reply in place.</div>
          </div>
          <button class="btn" ?disabled=${props.inboxLoading} @click=${props.onRefresh}>
            ${props.inboxLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div class="crm-tabs">
          <button
            class="crm-tab ${props.inboxTab === "needs-replies" ? "crm-tab--active" : ""}"
            @click=${() => props.onInboxTabChange("needs-replies")}
          >
            Needs replies
            <span class="crm-tab__count">${needsReplyCount}</span>
          </button>
          <button
            class="crm-tab ${props.inboxTab === "all" ? "crm-tab--active" : ""}"
            @click=${() => props.onInboxTabChange("all")}
          >
            All conversations
            <span class="crm-tab__count">${allCount}</span>
          </button>
        </div>

        <div class="crm-toolbar">
          <label class="field crm-toolbar__search">
            <span>Search leads</span>
            <input
              .value=${props.searchQuery}
              @input=${(event: Event) =>
                props.onSearchQueryChange((event.target as HTMLInputElement).value)}
              placeholder="Amanda, table, Friday..."
            />
          </label>
          <label class="field crm-toolbar__channel">
            <span>Channel</span>
            <select
              .value=${props.channelFilter}
              @change=${(event: Event) =>
                props.onChannelFilterChange((event.target as HTMLSelectElement).value as CrmChannelFilter)}
            >
              <option value="instagram">Instagram</option>
              <option value="manychat">ManyChat</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="imessage">iMessage</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>

        ${
          props.inboxRefreshedAt
            ? html`<div class="muted crm-panel__meta">Updated ${formatRelativeTime(props.inboxRefreshedAt)}</div>`
            : nothing
        }
        ${props.inboxError ? html`<div class="callout danger">${props.inboxError}</div>` : nothing}

        <div class="list crm-inbox-list">
          ${
            visibleItems.length === 0
              ? html`<div class="muted">No conversations match this filter.</div>`
              : visibleItems.map((item) =>
                  renderInboxItem(item, props.selectedConversationId, props.onSelectConversation),
                )
          }
        </div>
      </div>

      <div class="card crm-panel crm-panel--thread">
        ${
          props.thread
            ? html`
                ${renderThreadHeader(props.thread)}

                <div class="crm-thread__status-row">
                  ${needsReply ? html`<span class="crm-pill crm-pill--urgent">Awaiting reply</span>` : html`<span class="crm-pill">Replied</span>`}
                  ${
                    followupTasks.length > 0
                      ? html`<span class="crm-pill">Open tasks ${followupTasks.length}</span>`
                      : nothing
                  }
                </div>

                ${props.actionMessage ? html`<div class="callout">${props.actionMessage}</div>` : nothing}
                ${props.actionError ? html`<div class="callout danger">${props.actionError}</div>` : nothing}
                ${props.threadError ? html`<div class="callout danger">${props.threadError}</div>` : nothing}

                <div class="crm-thread crm-chat__messages">
                  ${
                    props.threadLoading
                      ? html`<div class="muted">Loading thread…</div>`
                      : props.thread.messages.map((message) =>
                          renderMessage(message as Record<string, unknown>),
                        )
                  }
                </div>

                <div class="crm-composer">
                  <textarea
                    class="crm-composer__input"
                    rows="3"
                    .value=${props.composerText}
                    @input=${(event: Event) =>
                      props.onComposerTextChange((event.target as HTMLTextAreaElement).value)}
                    placeholder="Message this lead..."
                  ></textarea>
                  <div class="crm-composer__actions">
                    <button
                      class="btn btn--primary"
                      ?disabled=${!canSend || !props.composerText.trim() || props.sendBusy}
                      @click=${props.onSendReply}
                    >
                      ${props.sendBusy ? "Sending…" : "Send"}
                    </button>
                    <button class="btn" @click=${props.onDraftInChat}>Draft in Chat</button>
                    <button
                      class="btn crm-composer__secondary"
                      ?disabled=${!props.composerText.trim() || props.logBusy}
                      @click=${props.onLogReply}
                    >
                      ${props.logBusy ? "Logging…" : "Record manual"}
                    </button>
                  </div>
                  <div class="crm-composer__hint">
                    Send replies here for full tracking. Record manual is just a fallback when you answered outside OpenClaw.
                  </div>
                  ${
                    !canSend
                      ? html`
                          <div class="crm-composer__hint">
                            Direct send is only enabled for ManyChat-backed threads right now. The same ledger can back WhatsApp and iMessage later.
                          </div>
                        `
                      : nothing
                  }
                </div>
              `
            : html`
                <div class="crm-empty-state">
                  <div class="card-title">Conversation Thread</div>
                  <div class="card-sub">Pick a lead from the inbox to view the thread and reply.</div>
                </div>
              `
        }
      </div>
    </section>
  `;
}
