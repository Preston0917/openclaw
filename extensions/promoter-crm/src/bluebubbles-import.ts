import type {
  ContactIdentityInput,
  Direction,
  IdentityChannel,
  UpsertContactInput,
} from "./store.js";

export type BlueBubblesParsedMessage = {
  externalMessageId?: string;
  externalThreadId?: string;
  direction: Direction;
  status?: string;
  content: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

export type BlueBubblesContactDraft = {
  input: UpsertContactInput | null;
  externalThreadId?: string;
  externalContactId?: string;
  messages: BlueBubblesParsedMessage[];
  metadata: Record<string, unknown>;
  skipReason?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function normalizePhone(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return "";
  }
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `${hasPlus ? "+" : ""}${digits}` : "";
}

function normalizeHandle(value: string | undefined): string {
  return value?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}

function normalizeEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isPhoneLike(value: string): boolean {
  return /^\+?\d{7,}$/.test(value);
}

function isEmailLike(value: string): boolean {
  return value.includes("@");
}

function timestampToIso(value: unknown): string | undefined {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (!raw || raw <= 0) {
    return undefined;
  }
  const millis = raw > 1_000_000_000_000 ? raw : raw * 1_000;
  return new Date(millis).toISOString();
}

function extractArrayRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function resolveMessagesArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return extractArrayRecords(payload);
  }
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  return extractArrayRecords(root.data ?? root.messages ?? root.items);
}

function resolveParticipants(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const chats = extractArrayRecords(record.chats);
  const chat = chats[0] ?? asRecord(record.chat) ?? record;
  return extractArrayRecords(chat?.participants);
}

function isGroupChatRecord(record: Record<string, unknown>): boolean {
  const chats = extractArrayRecords(record.chats);
  const chat = chats[0] ?? asRecord(record.chat) ?? record;
  const participants = resolveParticipants(record);
  const chatGuid = asString(chat?.guid) || asString(record.chatGuid) || asString(record.guid);
  if (chatGuid.includes(";+;")) {
    return true;
  }
  if (chatGuid.includes(";-;")) {
    return false;
  }
  return participants.length > 1;
}

function resolveChatRecord(message: Record<string, unknown>): Record<string, unknown> | null {
  const chats = extractArrayRecords(message.chats);
  return chats[0] ?? asRecord(message.chat);
}

function resolveChatThreadId(message: Record<string, unknown>): string {
  const chat = resolveChatRecord(message);
  return (
    asString(message.chatGuid) ||
    asString(chat?.guid) ||
    asString(message.chatIdentifier) ||
    asString(chat?.chatIdentifier) ||
    asString(message.guid)
  );
}

function resolveAddress(message: Record<string, unknown>): string {
  const handle = asRecord(message.handle) ?? asRecord(message.sender);
  const chat = resolveChatRecord(message);
  const participants = extractArrayRecords(chat?.participants);
  return (
    asString(handle?.address) ||
    asString(handle?.id) ||
    asString(handle?.handle) ||
    asString(participants[0]?.address) ||
    asString(participants[0]?.id) ||
    asString(chat?.chatIdentifier)
  );
}

function resolveSenderName(message: Record<string, unknown>): string {
  const handle = asRecord(message.handle) ?? asRecord(message.sender);
  const chat = resolveChatRecord(message);
  const participants = extractArrayRecords(chat?.participants);
  return (
    asString(handle?.displayName) ||
    asString(handle?.name) ||
    asString(message.senderName) ||
    asString(participants[0]?.displayName) ||
    asString(participants[0]?.name) ||
    asString(chat?.displayName)
  );
}

function resolveMessageContent(message: Record<string, unknown>): {
  content: string;
  metadata: Record<string, unknown>;
} {
  const attachments = extractArrayRecords(message.attachments).map((entry) => ({
    guid: asString(entry.guid) || undefined,
    mimeType: asString(entry.mimeType || entry.mime_type) || undefined,
    transferName: asString(entry.transferName || entry.transfer_name) || undefined,
  }));
  const text = asString(message.text || message.body);
  if (text) {
    return { content: text, metadata: { attachments } };
  }
  if (attachments.length > 0) {
    return {
      content: "iMessage attachment",
      metadata: { attachments },
    };
  }
  return {
    content: "",
    metadata: { attachments },
  };
}

function pushIdentity(
  identities: ContactIdentityInput[],
  identity: Omit<ContactIdentityInput, "source" | "isPrimary" | "identityRole">,
) {
  const hasValue =
    Boolean(identity.externalId?.trim()) ||
    Boolean(identity.handle?.trim()) ||
    Boolean(identity.email?.trim()) ||
    Boolean(identity.phoneE164?.trim());
  if (!hasValue) {
    return;
  }
  identities.push({
    ...identity,
    source: "bluebubbles",
    identityRole: "lead",
    isPrimary: identities.length === 0,
  });
}

function buildContactInput(params: {
  address: string;
  displayName: string;
}): UpsertContactInput | null {
  const address = params.address.trim();
  if (!address) {
    return null;
  }
  const displayName = params.displayName.trim() || address;
  const identities: ContactIdentityInput[] = [];
  const normalizedPhone = normalizePhone(address);
  const normalizedEmail = normalizeEmail(address);

  pushIdentity(identities, {
    channel: "imessage",
    externalId: address,
    phoneE164: normalizedPhone || undefined,
    email: !normalizedPhone && isEmailLike(normalizedEmail) ? normalizedEmail : undefined,
    handle:
      !normalizedPhone && !isEmailLike(normalizedEmail)
        ? normalizeHandle(address) || address
        : undefined,
  });
  if (normalizedPhone && isPhoneLike(normalizedPhone)) {
    pushIdentity(identities, {
      channel: "phone",
      phoneE164: normalizedPhone,
    });
  }
  if (!normalizedPhone && isEmailLike(normalizedEmail)) {
    pushIdentity(identities, {
      channel: "email",
      email: normalizedEmail,
    });
  }

  return {
    displayName,
    identities,
  };
}

export function parseBlueBubblesMessageQueryPayload(payload: unknown): BlueBubblesContactDraft[] {
  const messages = resolveMessagesArray(payload);
  const grouped = new Map<
    string,
    {
      address: string;
      displayName: string;
      messages: BlueBubblesParsedMessage[];
      metadata: Record<string, unknown>;
    }
  >();

  for (const record of messages) {
    if (isGroupChatRecord(record)) {
      continue;
    }

    const externalThreadId = resolveChatThreadId(record);
    const address = resolveAddress(record);
    if (!externalThreadId || !address) {
      continue;
    }
    const content = resolveMessageContent(record);
    if (!content.content) {
      continue;
    }
    const direction: Direction = record.isFromMe === true ? "outbound" : "inbound";
    const occurredAt =
      timestampToIso(record.dateCreated) ||
      timestampToIso(record.dateDelivered) ||
      timestampToIso(record.dateRead);
    const displayName = resolveSenderName(record) || address;

    const entry = grouped.get(externalThreadId) ?? {
      address,
      displayName,
      messages: [],
      metadata: {
        source: "bluebubbles",
        externalThreadId,
      },
    };
    if (!entry.displayName || entry.displayName === entry.address) {
      entry.displayName = displayName;
    }
    entry.messages.push({
      externalMessageId: asString(record.guid) || undefined,
      externalThreadId,
      direction,
      status:
        direction === "outbound" ? (record.isDelivered === true ? "sent" : undefined) : "received",
      content: content.content,
      occurredAt,
      metadata: {
        ...content.metadata,
        bluebubbles_message: record,
      },
    });
    grouped.set(externalThreadId, entry);
  }

  return [...grouped.entries()].map(([externalThreadId, entry]) => ({
    input: buildContactInput({
      address: entry.address,
      displayName: entry.displayName,
    }),
    externalThreadId,
    externalContactId: entry.address,
    messages: entry.messages.sort((left, right) => {
      const leftTime = left.occurredAt ? Date.parse(left.occurredAt) : 0;
      const rightTime = right.occurredAt ? Date.parse(right.occurredAt) : 0;
      return leftTime - rightTime;
    }),
    metadata: {
      ...entry.metadata,
      address: entry.address,
      channel: "imessage" satisfies IdentityChannel,
    },
  }));
}

function resolveChatsArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return extractArrayRecords(payload);
  }
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  return extractArrayRecords(root.data ?? root.chats ?? root.items);
}

function resolveChatAddress(chat: Record<string, unknown>): string {
  const participants = resolveParticipants(chat);
  return (
    asString(participants[0]?.address) ||
    asString(participants[0]?.id) ||
    asString(chat.chatIdentifier) ||
    asString(chat.identifier)
  );
}

function resolveChatDisplayName(chat: Record<string, unknown>, address: string): string {
  const participants = resolveParticipants(chat);
  return (
    asString(chat.displayName) ||
    asString(participants[0]?.displayName) ||
    asString(participants[0]?.name) ||
    address
  );
}

export function parseBlueBubblesChatQueryPayload(payload: unknown): BlueBubblesContactDraft[] {
  const chats = resolveChatsArray(payload);
  const seen = new Set<string>();
  const drafts: BlueBubblesContactDraft[] = [];

  for (const chat of chats) {
    if (isGroupChatRecord(chat)) {
      continue;
    }
    const externalThreadId =
      asString(chat.guid) || asString(chat.chatGuid) || asString(chat.chatIdentifier);
    const address = resolveChatAddress(chat);
    if (!externalThreadId || !address) {
      continue;
    }
    const dedupeKey = `${externalThreadId}::${address}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    drafts.push({
      input: buildContactInput({
        address,
        displayName: resolveChatDisplayName(chat, address),
      }),
      externalThreadId,
      externalContactId: address,
      messages: [],
      metadata: {
        source: "bluebubbles",
        externalThreadId,
        address,
        channel: "imessage" satisfies IdentityChannel,
        bluebubbles_chat: chat,
      },
    });
  }

  return drafts;
}
