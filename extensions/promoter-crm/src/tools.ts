import { randomUUID } from "node:crypto";
import { Static, Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { sendManychatText } from "./manychat-api.js";
import {
  type PromoterCrmStore,
  type AttendanceResult,
  type CampaignStatus,
  type ContactPreferenceCategory,
  type ContactPreferenceMode,
  type ContactQualityTier,
  type Direction,
  type EventStatus,
  type IdentityChannel,
  type InteractionKind,
  type InviteStatus,
  type GetConversationThreadInput,
  type RecentInboxInput,
  type RankFollowupsInput,
  type RsvpStatus,
  withPromoterCrmStore,
} from "./store.js";

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    description,
  });
}

const IDENTITY_CHANNELS = [
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
] as const satisfies readonly IdentityChannel[];
const CONTACT_QUALITY_TIERS = [
  "prospect",
  "warm",
  "regular",
  "vip",
  "table",
] as const satisfies readonly ContactQualityTier[];
const PREFERENCE_CATEGORIES = [
  "venue",
  "music",
  "borough",
  "vibe",
] as const satisfies readonly ContactPreferenceCategory[];
const PREFERENCE_MODES = ["prefer", "avoid"] as const satisfies readonly ContactPreferenceMode[];
const EVENT_STATUSES = [
  "planned",
  "live",
  "completed",
  "canceled",
] as const satisfies readonly EventStatus[];
const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
] as const satisfies readonly CampaignStatus[];
const INVITE_STATUSES = [
  "draft",
  "invited",
  "confirmed",
  "tentative",
  "declined",
] as const satisfies readonly InviteStatus[];
const RSVP_STATUSES = [
  "unknown",
  "pending",
  "yes",
  "no",
  "maybe",
] as const satisfies readonly RsvpStatus[];
const ATTENDANCE_RESULTS = [
  "unknown",
  "attended",
  "flaked",
  "late",
] as const satisfies readonly AttendanceResult[];
const INTERACTION_KINDS = [
  "outreach",
  "reply",
  "note",
  "attendance",
  "follow_up",
  "summary",
  "campaign",
] as const satisfies readonly InteractionKind[];
const DIRECTIONS = ["inbound", "outbound"] as const satisfies readonly Direction[];

const IdentitySchema = Type.Object(
  {
    channel: stringEnum(IDENTITY_CHANNELS, "Identity channel or import source."),
    externalId: Type.Optional(Type.String({ description: "Stable channel-specific id." })),
    handle: Type.Optional(Type.String({ description: "Handle, such as an Instagram username." })),
    email: Type.Optional(Type.String({ description: "Email address for identity resolution." })),
    phoneE164: Type.Optional(
      Type.String({ description: "Phone number in E.164 or near-E.164 format." }),
    ),
    profileUrl: Type.Optional(
      Type.String({ description: "Channel profile or deep-link URL for this identity." }),
    ),
    replyUrl: Type.Optional(
      Type.String({ description: "Best known reply/chat URL for this identity." }),
    ),
    avatarUrl: Type.Optional(
      Type.String({ description: "Avatar or profile image URL for this identity." }),
    ),
    source: Type.Optional(Type.String({ description: "Original import source label." })),
    isPrimary: Type.Optional(Type.Boolean({ description: "Mark as the primary identity." })),
    confidence: Type.Optional(
      Type.Number({
        description: "Identity match confidence from 0 to 1.",
        minimum: 0,
        maximum: 1,
      }),
    ),
  },
  { additionalProperties: false },
);

const PreferenceSchema = Type.Object(
  {
    category: stringEnum(PREFERENCE_CATEGORIES, "Preference category."),
    preference: stringEnum(PREFERENCE_MODES, "Whether the contact prefers or avoids this value."),
    value: Type.String({ description: "Preference value, such as house, Brooklyn, or rooftop." }),
  },
  { additionalProperties: false },
);

const UpsertContactSchema = Type.Object(
  {
    contactId: Type.Optional(Type.String({ description: "Existing contact id to update." })),
    displayName: Type.Optional(Type.String({ description: "Preferred display name." })),
    firstName: Type.Optional(Type.String({ description: "First name." })),
    lastName: Type.Optional(Type.String({ description: "Last name." })),
    city: Type.Optional(Type.String({ description: "Home city or primary city." })),
    birthday: Type.Optional(Type.String({ description: "Birthday in ISO date form." })),
    qualityTier: Type.Optional(stringEnum(CONTACT_QUALITY_TIERS, "Manual quality tier override.")),
    manualScoreOverride: Type.Optional(
      Type.Number({ description: "Manual score override, usually 0 to 100." }),
    ),
    identities: Type.Optional(Type.Array(IdentitySchema)),
    tags: Type.Optional(Type.Array(Type.String({ description: "Contact tag." }))),
    preferences: Type.Optional(Type.Array(PreferenceSchema)),
    note: Type.Optional(Type.String({ description: "Promoter note to append." })),
    createdBy: Type.Optional(Type.String({ description: "Who added the note or update." })),
  },
  { additionalProperties: false },
);

const FindContactsSchema = Type.Object(
  {
    query: Type.Optional(
      Type.String({ description: "Free-text search across names and identities." }),
    ),
    tag: Type.Optional(Type.String({ description: "Filter by a tag." })),
    city: Type.Optional(Type.String({ description: "Filter by city." })),
    qualityTier: Type.Optional(stringEnum(CONTACT_QUALITY_TIERS, "Filter by quality tier.")),
    segmentId: Type.Optional(Type.String({ description: "Filter by a materialized segment id." })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const RecordScoreSchema = Type.Object(
  {
    contactId: Type.String({ description: "Contact id to score." }),
    responsivenessScore: Type.Optional(Type.Number()),
    attendanceLikelihoodScore: Type.Optional(Type.Number()),
    socialValueScore: Type.Optional(Type.Number()),
    spendPotentialScore: Type.Optional(Type.Number()),
    reliabilityScore: Type.Optional(Type.Number()),
    promoterFitScore: Type.Optional(Type.Number()),
    overallScore: Type.Optional(Type.Number()),
    rationale: Type.Optional(Type.String({ description: "Why this score was assigned." })),
  },
  { additionalProperties: false },
);

const VenueSchema = Type.Object(
  {
    venueId: Type.Optional(Type.String({ description: "Existing venue id." })),
    name: Type.String({ description: "Venue name." }),
    city: Type.Optional(Type.String({ description: "Venue city." })),
    neighborhood: Type.Optional(Type.String({ description: "Venue neighborhood or borough." })),
    audienceType: Type.Optional(Type.String({ description: "Audience type." })),
    vibe: Type.Optional(Type.String({ description: "Venue vibe." })),
  },
  { additionalProperties: false },
);

const UpsertEventSchema = Type.Object(
  {
    eventId: Type.Optional(Type.String({ description: "Existing event id." })),
    name: Type.String({ description: "Event name." }),
    venue: VenueSchema,
    startsAt: Type.String({ description: "Event start timestamp in ISO format." }),
    endsAt: Type.Optional(Type.String({ description: "Event end timestamp in ISO format." })),
    theme: Type.Optional(Type.String({ description: "Event theme." })),
    targetCrowd: Type.Optional(Type.String({ description: "Target crowd description." })),
    status: Type.Optional(stringEnum(EVENT_STATUSES, "Event lifecycle status.")),
  },
  { additionalProperties: false },
);

const UpsertCampaignSchema = Type.Object(
  {
    campaignId: Type.Optional(Type.String({ description: "Existing campaign id." })),
    eventId: Type.Optional(
      Type.String({ description: "Optional event id to attach the campaign to." }),
    ),
    displayName: Type.String({ description: "Campaign display name." }),
    objective: Type.Optional(
      Type.String({ description: "Campaign goal, such as table push or reactivation." }),
    ),
    audienceSegment: Type.Optional(Type.String({ description: "Audience segment id or label." })),
    status: Type.Optional(stringEnum(CAMPAIGN_STATUSES, "Campaign lifecycle status.")),
  },
  { additionalProperties: false },
);

const UpsertInviteSchema = Type.Object(
  {
    inviteId: Type.Optional(Type.String({ description: "Existing invite id." })),
    contactId: Type.String({ description: "Contact id." }),
    eventId: Type.String({ description: "Event id." }),
    campaignId: Type.Optional(Type.String({ description: "Optional campaign id." })),
    inviteStatus: Type.Optional(stringEnum(INVITE_STATUSES, "Invite workflow status.")),
    rsvpStatus: Type.Optional(stringEnum(RSVP_STATUSES, "RSVP status.")),
    attendanceResult: Type.Optional(
      stringEnum(ATTENDANCE_RESULTS, "Observed attendance result after the event."),
    ),
    spendAmount: Type.Optional(Type.Number({ description: "Observed spend or table amount." })),
    broughtGuestCount: Type.Optional(Type.Number({ minimum: 0 })),
    tableOutcome: Type.Optional(
      Type.String({ description: "Outcome of the table or spend flow." }),
    ),
    contributionSummary: Type.Optional(
      Type.String({ description: "Notes about ratio, energy, spenders, or connector value." }),
    ),
    note: Type.Optional(Type.String({ description: "Invite-specific note." })),
  },
  { additionalProperties: false },
);

const SegmentDefinitionSchema = Type.Object(
  {
    city: Type.Optional(Type.String({ description: "Require contacts in this city." })),
    qualityTier: Type.Optional(
      stringEnum(CONTACT_QUALITY_TIERS, "Require this contact quality tier."),
    ),
    tagsAny: Type.Optional(
      Type.Array(Type.String({ description: "Match if any of these tags are present." })),
    ),
    tagsAll: Type.Optional(
      Type.Array(Type.String({ description: "Match only if all of these tags are present." })),
    ),
    minOverallScore: Type.Optional(Type.Number({ description: "Minimum latest overall score." })),
    maxOverallScore: Type.Optional(Type.Number({ description: "Maximum latest overall score." })),
    minDaysSinceLastInteraction: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Require this many or more days since the latest interaction.",
      }),
    ),
    maxDaysSinceLastInteraction: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Require this many or fewer days since the latest interaction.",
      }),
    ),
    birthdayWithinDays: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Require the contact's next birthday to fall within this many days.",
      }),
    ),
  },
  { additionalProperties: false },
);

const UpsertSegmentSchema = Type.Object(
  {
    segmentId: Type.Optional(Type.String({ description: "Existing segment id." })),
    displayName: Type.String({ description: "Saved segment name." }),
    definition: Type.Optional(SegmentDefinitionSchema),
  },
  { additionalProperties: false },
);

const RefreshSegmentSchema = Type.Object(
  {
    segmentId: Type.String({ description: "Segment id to recompute and materialize." }),
  },
  { additionalProperties: false },
);

const LogInteractionSchema = Type.Object(
  {
    interactionId: Type.Optional(Type.String({ description: "Existing interaction id." })),
    contactId: Type.String({ description: "Contact id." }),
    eventId: Type.Optional(Type.String({ description: "Optional event id." })),
    campaignId: Type.Optional(Type.String({ description: "Optional campaign id." })),
    channel: Type.Optional(stringEnum(IDENTITY_CHANNELS, "Messaging or source channel.")),
    kind: stringEnum(INTERACTION_KINDS, "Interaction kind."),
    direction: Type.Optional(stringEnum(DIRECTIONS, "Inbound or outbound.")),
    sentiment: Type.Optional(Type.String({ description: "Sentiment label." })),
    summary: Type.String({ description: "Human-readable summary of the interaction." }),
    outcome: Type.Optional(Type.String({ description: "Observed outcome." })),
    bestNextAction: Type.Optional(Type.String({ description: "Suggested next step." })),
    intentTags: Type.Optional(Type.Array(Type.String({ description: "Intent tag." }))),
    occurredAt: Type.Optional(Type.String({ description: "When this occurred, in ISO format." })),
    conversationExternalId: Type.Optional(Type.String({ description: "External thread id." })),
    messageExternalId: Type.Optional(Type.String({ description: "External message id." })),
    messageStatus: Type.Optional(Type.String({ description: "Provider message status." })),
    content: Type.Optional(
      Type.String({ description: "Optional raw or summarized message content." }),
    ),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const GetContactSchema = Type.Object(
  {
    contactId: Type.String({ description: "Contact id to fetch." }),
  },
  { additionalProperties: false },
);

const GetVenueAttendanceSchema = Type.Object(
  {
    venueId: Type.String({ description: "Venue id to inspect." }),
    attendanceResult: Type.Optional(
      stringEnum(ATTENDANCE_RESULTS, "Optional attendance filter, such as attended or flaked."),
    ),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);

const RecentInboxSchema = Type.Object(
  {
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    channel: Type.Optional(stringEnum(IDENTITY_CHANNELS, "Optional channel filter.")),
    sinceHours: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 24 * 30,
        description: "Only include conversations active within this many hours.",
      }),
    ),
    onlyNeedsReply: Type.Optional(
      Type.Boolean({
        description: "If true, only return conversations where the latest message is inbound.",
      }),
    ),
  },
  { additionalProperties: false },
);

const GetConversationThreadSchema = Type.Object(
  {
    conversationId: Type.Optional(Type.String({ description: "Conversation id to inspect." })),
    contactId: Type.Optional(
      Type.String({
        description: "Fallback contact id when you want the latest thread for a contact.",
      }),
    ),
    channel: Type.Optional(
      stringEnum(IDENTITY_CHANNELS, "Optional channel when resolving a contact's thread."),
    ),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

const RankFollowupsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    minDaysSinceLastInteraction: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 365,
        description: "Minimum stale days before a contact becomes a follow-up candidate.",
      }),
    ),
  },
  { additionalProperties: false },
);

const SendManychatReplySchema = Type.Object(
  {
    conversationId: Type.Optional(
      Type.String({ description: "ManyChat conversation id to reply in." }),
    ),
    contactId: Type.Optional(
      Type.String({
        description:
          "Fallback contact id when replying to the latest ManyChat thread for a contact.",
      }),
    ),
    channel: Type.Optional(
      stringEnum(
        IDENTITY_CHANNELS,
        "Optional logical channel for the thread, such as instagram when ManyChat is the transport.",
      ),
    ),
    text: Type.String({ description: "Plain-text reply to send through ManyChat." }),
    confirmSend: Type.Optional(
      Type.Boolean({
        description: "Must be true only when the user explicitly told you to send this reply.",
      }),
    ),
    messageTag: Type.Optional(
      Type.String({
        description: "Optional ManyChat message tag for sends outside the normal response window.",
      }),
    ),
    otnTopicName: Type.Optional(
      Type.String({
        description: "Optional ManyChat One-Time Notification topic name.",
      }),
    ),
  },
  { additionalProperties: false },
);

function executeWithStore<T>(api: OpenClawPluginApi, fn: (store: PromoterCrmStore) => T): T {
  const stateDir = api.runtime.state.resolveStateDir(process.env);
  return withPromoterCrmStore({ stateDir }, fn);
}

type ToolResultRecord = Record<string, unknown>;

function readRecord(value: unknown): ToolResultRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ToolResultRecord;
}

function readText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => readText(entry)).filter(Boolean);
}

function collapseWhitespace(value: unknown, maxLength = 160): string {
  const text = readText(value).replace(/\s+/g, " ").trim();
  if (!text) {
    return "(none)";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function quotePreview(value: unknown, maxLength = 160): string {
  const preview = collapseWhitespace(value, maxLength);
  return preview === "(none)" ? preview : `"${preview}"`;
}

function formatIso(value: unknown): string {
  const text = readText(value);
  return text || "unknown";
}

function formatIdentity(value: unknown): string {
  const record = readRecord(value);
  if (!record) {
    return "(none)";
  }
  const channel = readText(record.channel) || "unknown";
  const specific =
    readText(record.handle) ||
    readText(record.externalId) ||
    readText(record.external_id) ||
    readText(record.email) ||
    readText(record.phoneE164) ||
    readText(record.phone_e164);
  return specific ? `${channel}:${specific}` : channel;
}

function formatUrlFact(label: string, value: unknown): string {
  const text = readText(value);
  return text ? `${label}=${text}` : `${label}=(none)`;
}

export function renderPromoterCrmRecentInboxGroundingText(result: {
  refreshedAt: string;
  conversations: Array<Record<string, unknown>>;
}): string {
  const lines = [
    `Grounded promoter CRM inbox snapshot at ${result.refreshedAt}.`,
    "Use only the contacts, channels, timestamps, and message previews returned below. If a fact is missing, say so and call promoter_crm_recent_inbox again instead of guessing.",
    `Returned conversations: ${result.conversations.length}.`,
  ];

  if (result.conversations.length === 0) {
    lines.push("No CRM conversations matched this query.");
    return lines.join("\n");
  }

  result.conversations.forEach((conversation, index) => {
    const counts = readRecord(conversation.counts);
    const lastMessage = readRecord(conversation.lastMessage);
    const tags = readTextArray(conversation.tags);
    const followups = Array.isArray(conversation.openFollowupTasks)
      ? conversation.openFollowupTasks.length
      : 0;
    const channelLabel =
      readText(conversation.channelLabel) ||
      readText(conversation.matchedChannel) ||
      readText(conversation.channel) ||
      "unknown";

    lines.push(
      `${index + 1}. ${collapseWhitespace(conversation.contactName, 80)} | channel=${channelLabel} | needsReply=${conversation.needsReply === true ? "yes" : "no"} | lastActivityAt=${formatIso(conversation.lastActivityAt)}`,
    );
    lines.push(
      `   lastMessage=${quotePreview(lastMessage?.preview ?? lastMessage?.content)} | total=${readNumber(counts?.totalMessages) ?? 0} inbound=${readNumber(counts?.inboundMessages) ?? 0} outbound=${readNumber(counts?.outboundMessages) ?? 0}`,
    );
    lines.push(
      `   primaryIdentity=${formatIdentity(conversation.primaryIdentity)} | tags=${tags.length > 0 ? tags.join(", ") : "(none)"} | openFollowups=${followups}`,
    );
    lines.push(
      `   ${formatUrlFact("replyUrl", conversation.replyUrl)} | ${formatUrlFact("profileUrl", conversation.profileUrl)}`,
    );
  });

  return lines.join("\n");
}

export function renderPromoterCrmConversationThreadGroundingText(result: {
  contact: Record<string, unknown>;
  identities: Array<Record<string, unknown>>;
  tags: string[];
  latestScore: Record<string, unknown> | null;
  conversation: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  interactions: Array<Record<string, unknown>>;
  followupTasks: Array<Record<string, unknown>>;
}): string {
  const contact = readRecord(result.contact) ?? {};
  const conversation = readRecord(result.conversation) ?? {};
  const latestScore = readRecord(result.latestScore);

  const lines = [
    "Grounded promoter CRM conversation thread.",
    "Use only the contact, channel, timestamps, message previews, and interaction notes returned below. If a fact is missing, say so and call promoter_crm_get_conversation_thread again instead of guessing.",
    `Contact: ${collapseWhitespace(contact.displayName ?? contact.contactId, 80)} | qualityTier=${readText(contact.qualityTier) || "(none)"} | city=${readText(contact.city) || "(none)"}`,
    `Conversation: channel=${readText(conversation.channelLabel) || readText(conversation.matchedChannel) || readText(conversation.channel) || "unknown"} | needsReply=${conversation.needsReply === true ? "yes" : "no"} | lastActivityAt=${formatIso(conversation.lastActivityAt)} | totalMessages=${readNumber(readRecord(conversation.counts)?.totalMessages) ?? 0}`,
    `Tags: ${result.tags.length > 0 ? result.tags.join(", ") : "(none)"} | identities=${result.identities.length > 0 ? result.identities.map((identity) => formatIdentity(identity)).join(", ") : "(none)"}`,
    `Links: ${formatUrlFact("replyUrl", conversation.replyUrl)} | ${formatUrlFact("profileUrl", conversation.profileUrl)}`,
    `Latest score: ${latestScore ? String(readNumber(latestScore.overallScore ?? latestScore.overall_score) ?? "(none)") : "(none)"}`,
    "Messages:",
  ];

  if (result.messages.length === 0) {
    lines.push("- none");
  } else {
    result.messages.forEach((message, index) => {
      lines.push(
        `${index + 1}. [${formatIso(message.sentAt ?? message.sent_at)}] ${readText(message.direction) || "unknown"} ${quotePreview(message.preview ?? message.content, 200)}`,
      );
    });
  }

  lines.push("Interactions:");
  if (result.interactions.length === 0) {
    lines.push("- none");
  } else {
    result.interactions.forEach((interaction, index) => {
      lines.push(
        `${index + 1}. [${formatIso(interaction.occurredAt ?? interaction.occurred_at)}] ${readText(interaction.kind) || "interaction"} ${quotePreview(interaction.summary, 180)}`,
      );
    });
  }

  lines.push(`Open follow-up tasks: ${result.followupTasks.length}`);
  return lines.join("\n");
}

type UpsertContactParams = Static<typeof UpsertContactSchema>;
type FindContactsParams = Static<typeof FindContactsSchema>;
type RecordScoreParams = Static<typeof RecordScoreSchema>;
type UpsertEventParams = Static<typeof UpsertEventSchema>;
type UpsertCampaignParams = Static<typeof UpsertCampaignSchema>;
type UpsertInviteParams = Static<typeof UpsertInviteSchema>;
type UpsertSegmentParams = Static<typeof UpsertSegmentSchema>;
type RefreshSegmentParams = Static<typeof RefreshSegmentSchema>;
type LogInteractionParams = Static<typeof LogInteractionSchema>;
type GetContactParams = Static<typeof GetContactSchema>;
type GetVenueAttendanceParams = Static<typeof GetVenueAttendanceSchema>;
type SendManychatReplyParams = Static<typeof SendManychatReplySchema>;

export function createPromoterCrmStatusTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_status",
    label: "Promoter CRM Status",
    description: "Show promoter CRM database status and normalized entity counts.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      const status = executeWithStore(api, (store) => store.getStatus());
      return {
        content: [
          {
            type: "text",
            text: `Promoter CRM is ready at ${status.dbPath}.`,
          },
        ],
        details: status,
      };
    },
  };
}

export function createPromoterCrmUpsertContactTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_upsert_contact",
    label: "Promoter CRM Upsert Contact",
    description:
      "Create or update a contact with identity resolution, normalized tags, preferences, and notes.",
    parameters: UpsertContactSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.upsertContact(params as UpsertContactParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Saved contact ${result.displayName} (${result.contactId}).`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmFindContactsTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_find_contacts",
    label: "Promoter CRM Find Contacts",
    description:
      "Search contacts by name, identity, city, tag, segment, or quality tier with latest score context.",
    parameters: FindContactsSchema,
    execute: async (_toolCallId, params) => {
      const matches = executeWithStore(api, (store) =>
        store.findContacts(params as FindContactsParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Found ${matches.length} promoter CRM contact matches.`,
          },
        ],
        details: { matches },
      };
    },
  };
}

export function createPromoterCrmUpsertCampaignTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_upsert_campaign",
    label: "Promoter CRM Upsert Campaign",
    description: "Create or update an outreach campaign tied to an event or segment goal.",
    parameters: UpsertCampaignSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.upsertCampaign(params as UpsertCampaignParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Saved campaign ${result.displayName} (${result.campaignId}).`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmRecordScoreTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_record_score",
    label: "Promoter CRM Record Score",
    description: "Persist a contact score snapshot for prioritization and segmentation workflows.",
    parameters: RecordScoreSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.recordScore(params as RecordScoreParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Recorded score ${result.overallScore.toFixed(2)} for ${String((params as RecordScoreParams).contactId)}.`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmUpsertEventTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_upsert_event",
    label: "Promoter CRM Upsert Event",
    description: "Create or update an event and its venue using the normalized CRM schema.",
    parameters: UpsertEventSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.upsertEvent(params as UpsertEventParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Saved event ${result.displayName} (${result.eventId}).`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmUpsertInviteTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_upsert_invite",
    label: "Promoter CRM Upsert Invite",
    description: "Track invite, RSVP, attendance, and spend outcomes for a contact and event.",
    parameters: UpsertInviteSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.upsertInvite(params as UpsertInviteParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Saved invite ${result.inviteId}.`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmUpsertSegmentTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_upsert_segment",
    label: "Promoter CRM Upsert Segment",
    description: "Create or update a saved audience segment definition over normalized CRM facts.",
    parameters: UpsertSegmentSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.upsertSegment(params as UpsertSegmentParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Saved segment ${result.displayName} (${result.segmentId}).`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmRefreshSegmentTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_refresh_segment",
    label: "Promoter CRM Refresh Segment",
    description:
      "Recompute and materialize segment membership from contact facts, scores, tags, and activity.",
    parameters: RefreshSegmentSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.refreshSegment(params as RefreshSegmentParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Refreshed segment ${result.displayName} with ${result.membershipCount} member(s).`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmLogInteractionTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_log_interaction",
    label: "Promoter CRM Log Interaction",
    description:
      "Record outreach, replies, summaries, and unified conversation history for promoter workflows.",
    parameters: LogInteractionSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.logInteraction(params as LogInteractionParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Saved interaction ${result.interactionId}.`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmGetContactTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_get_contact",
    label: "Promoter CRM Get Contact",
    description:
      "Fetch a unified contact view with identities, tags, preferences, scores, invites, messages, and interactions.",
    parameters: GetContactSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.getContact((params as GetContactParams).contactId),
      );
      return {
        content: [
          {
            type: "text",
            text: `Loaded promoter CRM contact ${(result.contact as { displayName?: string }).displayName ?? (params as GetContactParams).contactId}.`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmGetVenueAttendanceTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_get_venue_attendance",
    label: "Promoter CRM Get Venue Attendance",
    description:
      "Show who attended, flaked, or was invited at a venue across its events using the normalized attendance path.",
    parameters: GetVenueAttendanceSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.getVenueAttendance(params as GetVenueAttendanceParams),
      );
      return {
        content: [
          {
            type: "text",
            text: `Loaded ${result.attendees.length} venue attendance record(s) for ${String((result.venue as { display_name?: string }).display_name ?? (params as GetVenueAttendanceParams).venueId)}.`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmRecentInboxTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_recent_inbox",
    label: "Promoter CRM Recent Inbox",
    description:
      "List the most recent CRM conversations with last-message context, reply pressure, tags, and open follow-ups. Use only returned rows as grounded CRM facts.",
    parameters: RecentInboxSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.getRecentInbox(params as RecentInboxInput),
      );
      const groundingText = renderPromoterCrmRecentInboxGroundingText(result);
      return {
        content: [
          {
            type: "text",
            text: groundingText,
          },
        ],
        details: {
          ...result,
          groundingText,
        },
      };
    },
  };
}

export function createPromoterCrmGetConversationThreadTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_get_conversation_thread",
    label: "Promoter CRM Get Conversation Thread",
    description:
      "Fetch a normalized conversation thread with contact context, message history, follow-up tasks, and interaction notes. Use only returned rows as grounded CRM facts.",
    parameters: GetConversationThreadSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.getConversationThread(params as GetConversationThreadInput),
      );
      const groundingText = renderPromoterCrmConversationThreadGroundingText(result);
      return {
        content: [
          {
            type: "text",
            text: groundingText,
          },
        ],
        details: {
          ...result,
          groundingText,
        },
      };
    },
  };
}

export function createPromoterCrmRankFollowupsTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_rank_followups",
    label: "Promoter CRM Rank Followups",
    description:
      "Refresh and rank the follow-up queue using score, invite state, and recency of interaction.",
    parameters: RankFollowupsSchema,
    execute: async (_toolCallId, params) => {
      const result = executeWithStore(api, (store) =>
        store.rankFollowups(params as RankFollowupsInput),
      );
      return {
        content: [
          {
            type: "text",
            text: `Ranked ${result.taskCount} promoter CRM follow-up task(s).`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createPromoterCrmSendManychatReplyTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "promoter_crm_send_manychat_reply",
    label: "Promoter CRM Send ManyChat Reply",
    description:
      "Send a ManyChat reply into the normalized CRM thread and log the outbound message. Use this only when the user explicitly asked you to send the reply.",
    parameters: SendManychatReplySchema,
    execute: async (_toolCallId, params) => {
      const typed = params as SendManychatReplyParams;
      if (typed.confirmSend !== true) {
        throw new Error(
          "Refusing to send ManyChat reply without confirmSend=true after explicit user approval.",
        );
      }

      const apiKey = process.env.MANYCHAT_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("MANYCHAT_API_KEY is not configured for the OpenClaw gateway.");
      }

      const target = executeWithStore(api, (store) =>
        store.resolveManychatReplyTarget({
          conversationId: typed.conversationId,
          contactId: typed.contactId,
          channel: typed.channel,
        }),
      );

      const providerResult = await sendManychatText({
        apiKey,
        subscriberId: Number(target.subscriberId),
        text: typed.text,
        contentType: target.matchedChannel === "instagram" ? "instagram" : undefined,
        messageTag: typed.messageTag,
        otnTopicName: typed.otnTopicName,
      });

      const occurredAt = new Date().toISOString();
      const messageExternalId = `manychat-outbound-${randomUUID()}`;
      const interactionId = `manychat-outbound-interaction-${randomUUID()}`;
      const summaryPreview = collapseWhitespace(typed.text, 120);

      executeWithStore(api, (store) =>
        {
          const interaction = store.logInteraction({
            interactionId,
            contactId: target.contactId,
            conversationId: target.conversationId,
            channel: "manychat",
            kind: "reply",
            direction: "outbound",
            summary: `ManyChat outbound reply: ${summaryPreview}`,
            occurredAt,
            messageExternalId,
            messageStatus: "sent",
            content: typed.text,
            metadata: {
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
          store.completeOpenFollowupTasks(target.contactId);
          return interaction;
        },
      );

      return {
        content: [
          {
            type: "text",
            text: `Sent ManyChat reply to ${target.contactName}.`,
          },
        ],
        details: {
          contactId: target.contactId,
          contactName: target.contactName,
          conversationId: target.conversationId,
          subscriberId: target.subscriberId,
          matchedChannel: target.matchedChannel,
          replyUrl: target.replyUrl,
          profileUrl: target.profileUrl,
          instagramProfileUrl: target.instagramProfileUrl,
          sentAt: occurredAt,
          text: typed.text,
          providerResult,
          interactionId,
          messageExternalId,
        },
      };
    },
  };
}
