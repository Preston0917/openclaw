import type {
  ContactIdentityInput,
  ContactPreferenceInput,
  ContactQualityTier,
  Direction,
  UpsertContactInput,
} from "./store.js";

type ManychatFieldMap = Record<string, unknown>;

export type ManychatParsedMessage = {
  externalMessageId?: string;
  externalThreadId?: string;
  direction: Direction;
  status?: string;
  content: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

export type ManychatContactDraft = {
  input: UpsertContactInput | null;
  externalContactId?: string;
  externalThreadId?: string;
  messages: ManychatParsedMessage[];
  metadata: Record<string, unknown>;
  skipReason?: string;
};

const PHONE_KEYS = ["phone", "phone_e164", "mobile", "mobile_phone", "phone_number", "sms_phone"];
const EMAIL_KEYS = ["email", "email_address", "mail"];
const INSTAGRAM_KEYS = [
  "instagram",
  "instagram_handle",
  "instagram_username",
  "ig_username",
  "ig",
  "ig_handle",
];
const INSTAGRAM_ID_KEYS = ["ig_id", "instagram_id"];
const WHATSAPP_PHONE_KEYS = ["whatsapp", "whatsapp_phone", "wa_phone"];
const WHATSAPP_ID_KEYS = ["whatsapp_id", "wa_id"];
const CITY_KEYS = ["city", "borough", "location", "home_city"];
const BIRTHDAY_KEYS = ["birthday", "birth_date", "birthdate", "dob"];
const QUALITY_TIER_KEYS = ["quality_tier", "qualitytier", "tier"];
const NOTE_KEYS = ["promoter_notes", "promoter_note", "note", "notes"];

const PREFERENCE_FIELDS: Array<{
  category: ContactPreferenceInput["category"];
  preference: ContactPreferenceInput["preference"];
  keys: string[];
}> = [
  {
    category: "music",
    preference: "prefer",
    keys: ["preferred_music", "favorite_music", "music_preferences"],
  },
  {
    category: "music",
    preference: "avoid",
    keys: ["avoid_music", "disliked_music"],
  },
  {
    category: "venue",
    preference: "prefer",
    keys: ["preferred_venue", "favorite_venue", "preferred_venues"],
  },
  {
    category: "venue",
    preference: "avoid",
    keys: ["avoid_venue", "avoid_venues"],
  },
  {
    category: "borough",
    preference: "prefer",
    keys: ["preferred_borough", "favorite_borough", "borough_preferences"],
  },
  {
    category: "borough",
    preference: "avoid",
    keys: ["avoid_borough", "avoid_boroughs"],
  },
  {
    category: "vibe",
    preference: "prefer",
    keys: ["preferred_vibe", "favorite_vibe", "vibe_preferences"],
  },
  {
    category: "vibe",
    preference: "avoid",
    keys: ["avoid_vibe", "avoid_vibes"],
  },
];

function normalizeWhitespace(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeHandle(value: string | undefined): string {
  return normalizeWhitespace(value).replace(/^@+/, "");
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function unwrapCustomFieldValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  if ("value" in record) {
    return record.value;
  }
  return value;
}

function readCustomFields(value: unknown): ManychatFieldMap {
  const record = asRecord(value);
  if (record) {
    return Object.fromEntries(
      Object.entries(record)
        .map(([key, entry]) => [normalizeKey(key), unwrapCustomFieldValue(entry)])
        .filter((entry) => entry[0]),
    );
  }

  if (!Array.isArray(value)) {
    return {};
  }

  const fields: ManychatFieldMap = {};
  for (const entry of value) {
    const item = asRecord(entry);
    if (!item) {
      continue;
    }
    const key =
      normalizeKey(asString(item.key)) ||
      normalizeKey(asString(item.name)) ||
      normalizeKey(asString(item.label));
    if (!key) {
      continue;
    }
    fields[key] = unwrapCustomFieldValue(item);
  }
  return fields;
}

function firstString(
  record: Record<string, unknown> | null,
  keys: string[],
  customFields?: ManychatFieldMap,
): string {
  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    const directValue = record ? asString(record[normalizedKey] ?? record[key]) : "";
    if (directValue) {
      return directValue;
    }
    const customValue = customFields ? asString(customFields[normalizedKey]) : "";
    if (customValue) {
      return customValue;
    }
  }
  return "";
}

function splitMultiValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean);
  }
  const raw = asString(value);
  if (!raw) {
    return [];
  }
  return raw
    .split(/[;,|]/)
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
}

function parseQualityTier(value: string): ContactQualityTier | undefined {
  const normalized = normalizeWhitespace(value).toLowerCase();
  switch (normalized) {
    case "prospect":
    case "warm":
    case "regular":
    case "vip":
    case "table":
      return normalized;
    default:
      return undefined;
  }
}

function pushIdentity(
  identities: ContactIdentityInput[],
  identity: Omit<ContactIdentityInput, "source" | "isPrimary">,
): void {
  const hasValue = Boolean(
    normalizeWhitespace(identity.externalId) ||
    normalizeWhitespace(identity.handle) ||
    normalizeWhitespace(identity.email) ||
    normalizeWhitespace(identity.phoneE164),
  );
  if (!hasValue) {
    return;
  }
  identities.push({
    ...identity,
    source: "manychat",
    isPrimary: identities.length === 0,
  });
}

function pushPreferenceValues(
  preferences: ContactPreferenceInput[],
  category: ContactPreferenceInput["category"],
  preference: ContactPreferenceInput["preference"],
  rawValue: unknown,
): void {
  const values = splitMultiValue(rawValue);
  for (const value of values) {
    preferences.push({ category, preference, value });
  }
}

function buildInstagramProfileUrl(handle: string | undefined): string | undefined {
  const normalizedHandle = normalizeHandle(handle);
  return normalizedHandle ? `https://www.instagram.com/${normalizedHandle}/` : undefined;
}

function looksLikeManychatContact(record: Record<string, unknown> | null): boolean {
  if (!record) {
    return false;
  }
  const customFields = readCustomFields(record.custom_fields);
  return Boolean(
    asString(record.id) ||
    asString(record.contact_id) ||
    asString(record.subscriber_id) ||
    asString(record.name) ||
    asString(record.first_name) ||
    asString(record.last_input_text) ||
    Object.keys(customFields).length > 0,
  );
}

function resolveContactRecord(root: Record<string, unknown>): Record<string, unknown> | null {
  if (looksLikeManychatContact(root)) {
    return root;
  }

  const nestedPaths = [
    ["contact"],
    ["subscriber"],
    ["full_contact_data"],
    ["fullContactData"],
    ["payload", "contact"],
    ["data", "contact"],
    ["data", "subscriber"],
    ["event", "contact"],
  ];

  for (const path of nestedPaths) {
    let current: unknown = root;
    for (const segment of path) {
      const record = asRecord(current);
      current = record?.[segment];
    }
    const resolved = asRecord(current);
    if (looksLikeManychatContact(resolved)) {
      return resolved;
    }
  }

  return null;
}

function resolveThreadExternalId(
  root: Record<string, unknown>,
  contact: Record<string, unknown>,
  externalContactId: string,
): string | undefined {
  const liveChatUrl =
    firstString(contact, ["live_chat_url"]) || firstString(root, ["live_chat_url"]);
  if (liveChatUrl) {
    return liveChatUrl;
  }

  const explicitId =
    firstString(contact, ["conversation_id", "thread_id", "chat_id"]) ||
    firstString(root, ["conversation_id", "thread_id", "chat_id"]);
  if (explicitId) {
    return explicitId;
  }

  if (externalContactId) {
    return `manychat-contact:${externalContactId}`;
  }

  return undefined;
}

function collectMessageRecords(
  root: Record<string, unknown>,
  contact: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  const seenSources = new Set<unknown>();
  const arraySources = [
    root.messages,
    contact.messages,
    asRecord(root.conversation)?.messages,
    asRecord(root.event)?.messages,
  ];
  for (const source of arraySources) {
    if (!Array.isArray(source) || seenSources.has(source)) {
      continue;
    }
    seenSources.add(source);
    for (const entry of source) {
      const record = asRecord(entry);
      if (record) {
        candidates.push(record);
      }
    }
  }

  const seenRecords = new Set<unknown>();
  const singleSources = [root.message, contact.message, root.last_message, root.event];
  for (const source of singleSources) {
    if (seenRecords.has(source)) {
      continue;
    }
    seenRecords.add(source);
    const record = asRecord(source);
    if (!record) {
      continue;
    }
    if (asString(record.text) || asString(record.message) || asString(record.content)) {
      candidates.push(record);
    }
  }

  return candidates;
}

function parseDirection(value: unknown, fallback: Direction = "inbound"): Direction {
  const normalized = asString(value).toLowerCase();
  if (
    normalized === "inbound" ||
    normalized === "incoming" ||
    normalized === "subscriber" ||
    normalized === "contact" ||
    normalized === "user"
  ) {
    return "inbound";
  }
  if (
    normalized === "outbound" ||
    normalized === "outgoing" ||
    normalized === "bot" ||
    normalized === "agent" ||
    normalized === "automation"
  ) {
    return "outbound";
  }
  return fallback;
}

function parseMessageRecord(params: {
  record: Record<string, unknown>;
  defaultThreadExternalId?: string;
  fallbackOccurredAt?: string;
  defaultDirection?: Direction;
}): ManychatParsedMessage | null {
  const content =
    asString(params.record.text) ||
    asString(params.record.message) ||
    asString(params.record.content) ||
    asString(params.record.body) ||
    asString(params.record.last_input_text);
  if (!content) {
    return null;
  }

  const externalMessageId =
    asString(params.record.id) ||
    asString(params.record.message_id) ||
    asString(params.record.external_id) ||
    undefined;
  const externalThreadId =
    asString(params.record.thread_id) ||
    asString(params.record.conversation_id) ||
    asString(params.record.chat_id) ||
    params.defaultThreadExternalId;
  const occurredAt =
    asString(params.record.created_at) ||
    asString(params.record.sent_at) ||
    asString(params.record.occurred_at) ||
    asString(params.record.timestamp) ||
    asString(params.record.updated_at) ||
    params.fallbackOccurredAt;
  const status =
    asString(params.record.status) || asString(params.record.delivery_status) || undefined;

  return {
    externalMessageId,
    externalThreadId,
    direction: parseDirection(params.record.direction, params.defaultDirection),
    status,
    content,
    occurredAt,
    metadata: params.record,
  };
}

export function parseManychatPayload(payload: unknown): ManychatContactDraft {
  const root = asRecord(payload);
  if (!root) {
    return {
      input: null,
      messages: [],
      metadata: {},
      skipReason: "ManyChat payload must be a JSON object.",
    };
  }

  const contact = resolveContactRecord(root);
  if (!contact) {
    return {
      input: null,
      messages: [],
      metadata: root,
      skipReason: "ManyChat payload did not include a recognizable contact object.",
    };
  }

  const customFields = readCustomFields(contact.custom_fields ?? root.custom_fields);
  const externalContactId =
    asString(contact.id) ||
    asString(contact.contact_id) ||
    asString(contact.subscriber_id) ||
    asString(root.id) ||
    asString(root.contact_id);

  const displayName =
    asString(contact.name) ||
    [asString(contact.first_name), asString(contact.last_name)].filter(Boolean).join(" ");
  const firstName = asString(contact.first_name);
  const lastName = asString(contact.last_name);
  const city = firstString(contact, CITY_KEYS, customFields);
  const birthday = firstString(contact, BIRTHDAY_KEYS, customFields);
  const qualityTier = parseQualityTier(firstString(contact, QUALITY_TIER_KEYS, customFields));
  const note = firstString(contact, NOTE_KEYS, customFields);
  const tags = splitMultiValue(customFields.tags ?? customFields.tag ?? customFields.labels);
  const liveChatUrl =
    firstString(contact, ["live_chat_url"]) || firstString(root, ["live_chat_url"]);
  const instagramHandle = firstString(contact, INSTAGRAM_KEYS, customFields);
  const instagramProfileUrl = buildInstagramProfileUrl(instagramHandle);
  const profilePic =
    asString(contact.profile_pic) || asString(root.profile_pic) || undefined;

  const identities: ContactIdentityInput[] = [];
  pushIdentity(identities, {
    channel: "manychat",
    externalId: externalContactId,
    profileUrl: liveChatUrl || undefined,
    replyUrl: liveChatUrl || undefined,
    avatarUrl: profilePic,
  });
  pushIdentity(identities, {
    channel: "phone",
    phoneE164: firstString(contact, PHONE_KEYS, customFields),
  });
  pushIdentity(identities, {
    channel: "email",
    email: firstString(contact, EMAIL_KEYS, customFields),
  });
  pushIdentity(identities, {
    channel: "instagram",
    externalId: firstString(contact, INSTAGRAM_ID_KEYS, customFields),
    handle: instagramHandle,
    profileUrl: instagramProfileUrl,
    avatarUrl: profilePic,
  });
  pushIdentity(identities, {
    channel: "whatsapp",
    externalId: firstString(contact, WHATSAPP_ID_KEYS, customFields),
    phoneE164: firstString(contact, WHATSAPP_PHONE_KEYS, customFields),
  });

  const preferences: ContactPreferenceInput[] = [];
  for (const field of PREFERENCE_FIELDS) {
    for (const key of field.keys) {
      const value = customFields[normalizeKey(key)];
      if (value !== undefined) {
        pushPreferenceValues(preferences, field.category, field.preference, value);
      }
    }
  }

  if (!displayName && identities.length === 0) {
    return {
      input: null,
      externalContactId: externalContactId || undefined,
      messages: [],
      metadata: {
        contact,
        custom_fields: customFields,
      },
      skipReason: "ManyChat payload did not contain a usable contact name or identity.",
    };
  }

  const externalThreadId = resolveThreadExternalId(root, contact, externalContactId);
  const fallbackOccurredAt =
    asString(contact.last_interaction) ||
    asString(contact.last_seen) ||
    asString(root.last_interaction) ||
    asString(root.last_seen) ||
    undefined;
  const messages = collectMessageRecords(root, contact)
    .map((record) =>
      parseMessageRecord({
        record,
        defaultThreadExternalId: externalThreadId,
        fallbackOccurredAt,
        defaultDirection: "inbound",
      }),
    )
    .filter((entry): entry is ManychatParsedMessage => entry !== null);

  if (messages.length === 0) {
    const lastInputText = asString(contact.last_input_text) || asString(root.last_input_text);
    if (lastInputText) {
      messages.push({
        direction: "inbound",
        content: lastInputText,
        occurredAt: fallbackOccurredAt,
        externalThreadId,
        metadata: {
          source: "last_input_text",
        },
      });
    }
  }

  const input: UpsertContactInput = {
    displayName,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    city: city || undefined,
    birthday: birthday || undefined,
    qualityTier,
    identities,
    tags: tags.length > 0 ? tags : undefined,
    preferences: preferences.length > 0 ? preferences : undefined,
    note: note || undefined,
  };

  return {
    input,
    externalContactId: externalContactId || undefined,
    externalThreadId,
    messages,
    metadata: {
      manychat_contact_id: externalContactId || undefined,
      page_id: asString(contact.page_id) || asString(root.page_id) || undefined,
      status: asString(contact.status) || asString(root.status) || undefined,
      subscribed_at: asString(contact.subscribed) || asString(root.subscribed) || undefined,
      last_growth_tool:
        asString(contact.last_growth_tool) || asString(root.last_growth_tool) || undefined,
      live_chat_url: liveChatUrl || undefined,
      instagram_username: instagramHandle || undefined,
      instagram_profile_url: instagramProfileUrl,
      profile_pic: profilePic,
      contact,
      custom_fields: customFields,
    },
  };
}
