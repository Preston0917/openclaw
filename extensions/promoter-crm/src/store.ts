import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  buildBlueBubblesContactInput,
  parseBlueBubblesChatQueryPayload,
  parseBlueBubblesMessageQueryPayload,
} from "./bluebubbles-import.js";
import { mapCsvRowToContactInput, parseCsvRows } from "./csv-import.js";
import { parseManychatPayload } from "./manychat-import.js";
import { ensurePromoterCrmSchema, PROMOTER_CRM_TABLES } from "./schema.js";
import { requireNodeSqlite } from "./sqlite.js";

export type IdentityChannel =
  | "google"
  | "manychat"
  | "instagram"
  | "imessage"
  | "whatsapp"
  | "email"
  | "phone"
  | "csv"
  | "manual"
  | "airtable";

export type ContactPreferenceCategory = "venue" | "music" | "borough" | "vibe";
export type ContactPreferenceMode = "prefer" | "avoid";
export type ContactQualityTier = "prospect" | "warm" | "regular" | "vip" | "table";
export type IdentityRole = "owner" | "lead" | "friend" | "venue" | "unknown";
export type EventStatus = "planned" | "live" | "completed" | "canceled";
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type InviteStatus = "draft" | "invited" | "confirmed" | "tentative" | "declined";
export type RsvpStatus = "unknown" | "pending" | "yes" | "no" | "maybe";
export type AttendanceResult = "unknown" | "attended" | "flaked" | "late";
export type ConversationRole = "crm" | "control" | "personal" | "ops";
export type ConversationTransport = "manychat" | "bluebubbles" | "manual" | "other";
export type IngestSource =
  | "manual"
  | "google_contacts"
  | "manychat"
  | "csv"
  | "instagram"
  | "imessage"
  | "whatsapp"
  | "other";
export type InteractionKind =
  | "outreach"
  | "reply"
  | "note"
  | "attendance"
  | "follow_up"
  | "summary"
  | "campaign";
export type Direction = "inbound" | "outbound";
export type MessageActorRole = "user" | "contact" | "assistant" | "system";
export type MessageAuthorshipMode =
  | "manual_user"
  | "assistant_send"
  | "assistant_draft"
  | "assistant_chat"
  | "connector_import";
export type FollowupTaskStatus = "open" | "done" | "dismissed";

export type ContactIdentityInput = {
  channel: IdentityChannel;
  externalId?: string;
  handle?: string;
  email?: string;
  phoneE164?: string;
  profileUrl?: string;
  replyUrl?: string;
  avatarUrl?: string;
  identityRole?: IdentityRole;
  source?: string;
  isPrimary?: boolean;
  confidence?: number;
};

export type ContactPreferenceInput = {
  category: ContactPreferenceCategory;
  preference: ContactPreferenceMode;
  value: string;
};

export type UpsertContactInput = {
  contactId?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  birthday?: string;
  qualityTier?: ContactQualityTier;
  manualScoreOverride?: number;
  identities?: ContactIdentityInput[];
  tags?: string[];
  preferences?: ContactPreferenceInput[];
  note?: string;
  createdBy?: string;
};

export type RecordScoreInput = {
  contactId: string;
  responsivenessScore?: number;
  attendanceLikelihoodScore?: number;
  socialValueScore?: number;
  spendPotentialScore?: number;
  reliabilityScore?: number;
  promoterFitScore?: number;
  overallScore?: number;
  rationale?: string;
};

export type UpsertVenueInput = {
  venueId?: string;
  name: string;
  city?: string;
  neighborhood?: string;
  audienceType?: string;
  vibe?: string;
};

export type UpsertEventInput = {
  eventId?: string;
  name: string;
  venue: UpsertVenueInput;
  startsAt: string;
  endsAt?: string;
  theme?: string;
  targetCrowd?: string;
  status?: EventStatus;
};

export type UpsertCampaignInput = {
  campaignId?: string;
  eventId?: string;
  displayName: string;
  objective?: string;
  audienceSegment?: string;
  status?: CampaignStatus;
};

export type UpsertInviteInput = {
  inviteId?: string;
  contactId: string;
  eventId: string;
  campaignId?: string;
  inviteStatus?: InviteStatus;
  rsvpStatus?: RsvpStatus;
  attendanceResult?: AttendanceResult;
  spendAmount?: number;
  broughtGuestCount?: number;
  tableOutcome?: string;
  contributionSummary?: string;
  note?: string;
};

export type LogInteractionInput = {
  interactionId?: string;
  contactId: string;
  conversationId?: string;
  eventId?: string;
  campaignId?: string;
  channel?: IdentityChannel;
  logicalChannel?: IdentityChannel;
  transport?: ConversationTransport;
  conversationRole?: ConversationRole;
  kind: InteractionKind;
  direction?: Direction;
  actorRole?: MessageActorRole;
  authorshipMode?: MessageAuthorshipMode;
  sentiment?: string;
  summary: string;
  outcome?: string;
  bestNextAction?: string;
  intentTags?: string[];
  occurredAt?: string;
  conversationExternalId?: string;
  messageExternalId?: string;
  messageStatus?: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

export type SegmentDefinition = {
  city?: string;
  qualityTier?: ContactQualityTier;
  tagsAny?: string[];
  tagsAll?: string[];
  minOverallScore?: number;
  maxOverallScore?: number;
  minDaysSinceLastInteraction?: number;
  maxDaysSinceLastInteraction?: number;
  birthdayWithinDays?: number;
};

export type UpsertSegmentInput = {
  segmentId?: string;
  displayName: string;
  definition?: SegmentDefinition;
};

export type RefreshSegmentInput = {
  segmentId: string;
};

export type GetVenueAttendanceInput = {
  venueId: string;
  attendanceResult?: AttendanceResult;
  limit?: number;
};

export type RecentInboxInput = {
  limit?: number;
  channel?: IdentityChannel;
  sinceHours?: number;
  onlyNeedsReply?: boolean;
};

export type GetConversationThreadInput = {
  conversationId?: string;
  contactId?: string;
  channel?: IdentityChannel;
  limit?: number;
};

export type ImportCsvInput = {
  csvText: string;
  fileName?: string;
  sourceLabel?: string;
  initiatedBy?: string;
};

export type ImportManychatInput = {
  payload: unknown;
  fileName?: string;
  sourceLabel?: string;
  initiatedBy?: string;
};

export type ImportBlueBubblesInput = {
  payload: unknown;
  chatPayload?: unknown;
  fileName?: string;
  sourceLabel?: string;
  initiatedBy?: string;
};

export type RankFollowupsInput = {
  limit?: number;
  minDaysSinceLastInteraction?: number;
};

export type ResolveManychatReplyTargetInput = {
  conversationId?: string;
  contactId?: string;
  channel?: IdentityChannel;
};

export type ResolveConversationReplyTargetInput = ResolveManychatReplyTargetInput;

export type ResolvedConversationReplyTarget = {
  contactId: string;
  contactName: string;
  conversationId: string;
  externalThreadId: string | null;
  matchedChannel: IdentityChannel;
  replyUrl: string | null;
  profileUrl: string | null;
  instagramProfileUrl: string | null;
  transport: "manychat" | "bluebubbles";
  subscriberId?: string;
  bluebubblesTarget?: string;
  bluebubblesSenderAddress?: string;
};

type IdentitySelector = {
  channel?: IdentityChannel;
  value: string;
};

type StoreOptions = {
  stateDir: string;
};

type ContactRow = {
  contact_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  birthday: string | null;
  quality_tier: ContactQualityTier | null;
  manual_score_override: number | null;
  created_at: string;
  updated_at: string;
};

type LatestScoreRow = {
  score_id: string;
  overall_score: number;
  responsiveness_score: number | null;
  attendance_likelihood_score: number | null;
  social_value_score: number | null;
  spend_potential_score: number | null;
  reliability_score: number | null;
  promoter_fit_score: number | null;
  rationale: string | null;
  created_at: string;
};

type SegmentRow = {
  segment_id: string;
  display_name: string;
  definition_json: string | null;
  created_at: string;
  updated_at: string;
};

type SegmentCandidateRow = {
  contact_id: string;
  display_name: string;
  city: string | null;
  birthday: string | null;
  quality_tier: ContactQualityTier | null;
  latest_score: number | null;
  last_interaction_at: string | null;
};

type SearchContactsInput = {
  query?: string;
  tag?: string;
  city?: string;
  qualityTier?: ContactQualityTier;
  segmentId?: string;
  limit?: number;
};

type IngestItemAction = "created" | "updated" | "merged" | "skipped" | "failed";

type FollowupCandidateRow = {
  contact_id: string;
  display_name: string;
  quality_tier: ContactQualityTier | null;
  manual_score_override: number | null;
  latest_score: number | null;
  last_interaction_at: string | null;
  last_best_next_action: string | null;
};

type InboxConversationRow = {
  conversation_id: string;
  contact_id: string;
  contact_name: string;
  quality_tier: ContactQualityTier | null;
  latest_score: number | null;
  channel: IdentityChannel;
  logical_channel: IdentityChannel | null;
  transport: ConversationTransport | null;
  conversation_role: ConversationRole | null;
  external_thread_id: string | null;
  conversation_status: "active" | "archived";
  started_at: string;
  last_message_at: string;
  last_message_id: string | null;
  last_message_direction: Direction | null;
  last_message_status: string | null;
  last_message_content: string | null;
  last_message_sent_at: string | null;
  last_inbound_message_id: string | null;
  last_inbound_content: string | null;
  last_inbound_at: string | null;
  last_outbound_message_id: string | null;
  last_outbound_content: string | null;
  last_outbound_at: string | null;
  total_message_count: number;
  inbound_message_count: number;
  outbound_message_count: number;
};

type ConversationMessageRow = {
  message_id: string;
  external_message_id: string | null;
  direction: Direction;
  actor_role: MessageActorRole | null;
  authorship_mode: MessageAuthorshipMode | null;
  status: string | null;
  content: string | null;
  sent_at: string;
  metadata_json: string | null;
  created_at: string;
};

function normalizeWhitespace(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeLower(value: string | undefined): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeTag(value: string): string {
  return normalizeLower(value).replace(/\s+/g, " ");
}

function normalizePhone(value: string | undefined): string {
  const raw = normalizeWhitespace(value);
  if (!raw) {
    return "";
  }
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `${hasPlus ? "+" : ""}${digits}` : "";
}

function normalizeHandle(value: string | undefined): string {
  return normalizeLower(value).replace(/^@+/, "");
}

function normalizeEmail(value: string | undefined): string {
  return normalizeLower(value);
}

function isNormalizedEmail(value: string): boolean {
  return Boolean(value) && value.includes("@");
}

function isNormalizedPhone(value: string): boolean {
  return Boolean(value) && /^\+?\d{7,}$/.test(value);
}

function normalizeIdentityValue(identity: ContactIdentityInput): string {
  return (
    normalizeLower(identity.externalId) ||
    normalizeEmail(identity.email) ||
    normalizePhone(identity.phoneE164) ||
    normalizeHandle(identity.handle)
  );
}

function buildStableImportId(prefix: string, parts: Array<string | null | undefined>): string {
  const hash = createHash("sha256");
  hash.update(prefix);
  for (const part of parts) {
    hash.update("\u001f");
    hash.update(part ?? "");
  }
  return `${prefix}-${hash.digest("hex").slice(0, 24)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function maybeString(value: string | undefined): string | null {
  const trimmed = normalizeWhitespace(value);
  return trimmed ? trimmed : null;
}

function parseIdentitySelector(value: string): IdentitySelector {
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex <= 0) {
    return { value: trimmed };
  }

  const maybeChannel = trimmed.slice(0, separatorIndex).trim();
  const selectorValue = trimmed.slice(separatorIndex + 1).trim();
  const channel = readIdentityChannel(maybeChannel);
  if (!channel || !selectorValue) {
    return { value: trimmed };
  }
  return { channel, value: selectorValue };
}

function maybeUrl(value: string | undefined): string | null {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) {
    return null;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function maybeNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function maybeNonNegativeInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readMetadataText(
  record: Record<string, unknown> | null,
  keys: string[],
): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return undefined;
}

function extractUrls(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const matches = value.match(/https?:\/\/[^\s"'<>]+/g);
  return matches ? [...new Set(matches)] : [];
}

function presentMessageContent(content: string | null | undefined): {
  contentType: "empty" | "text" | "link" | "attachment";
  preview: string | null;
  attachmentUrls: string[];
} {
  const normalized = maybeString(content ?? undefined);
  if (!normalized) {
    return {
      contentType: "empty",
      preview: null,
      attachmentUrls: [],
    };
  }

  const urls = extractUrls(normalized);
  const isStandaloneUrl = urls.length === 1 && normalized === urls[0];
  if (isStandaloneUrl) {
    const url = urls[0]!;
    const isInstagramAttachment =
      url.includes("lookaside.fbsbx.com/ig_messaging_cdn") || url.includes("instagram.com");
    return {
      contentType: isInstagramAttachment ? "attachment" : "link",
      preview: isInstagramAttachment ? "Instagram media attachment" : url,
      attachmentUrls: urls,
    };
  }

  return {
    contentType: "text",
    preview: normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized,
    attachmentUrls: [],
  };
}

function buildInstagramProfileUrl(handle: string | undefined): string | null {
  const normalizedHandle = normalizeHandle(handle);
  return normalizedHandle ? `https://www.instagram.com/${normalizedHandle}/` : null;
}

function readIdentityChannel(value: unknown): IdentityChannel | null {
  if (typeof value !== "string") {
    return null;
  }
  return value as IdentityChannel;
}

function readIdentityUrl(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

function chooseConversationIdentity(
  identities: Array<Record<string, unknown>>,
  channel: IdentityChannel,
): Record<string, unknown> | null {
  const matches = identities.filter(
    (identity) => readIdentityChannel(identity.channel) === channel,
  );
  return matches[0] ?? identities[0] ?? null;
}

function choosePreferredIdentityUrl(
  identities: Array<Record<string, unknown>>,
  channel: IdentityChannel,
  key: "reply_url" | "profile_url",
): string | null {
  const matchingIdentity = chooseConversationIdentity(identities, channel);
  const matchingValue = matchingIdentity ? readIdentityUrl(matchingIdentity, key) : null;
  if (matchingValue) {
    return matchingValue;
  }

  for (const identity of identities) {
    const value = readIdentityUrl(identity, key);
    if (value) {
      return value;
    }
  }
  return null;
}

function chooseChannelIdentityUrl(
  identities: Array<Record<string, unknown>>,
  channel: IdentityChannel,
  key: "reply_url" | "profile_url",
): string | null {
  const identity = identities.find((entry) => readIdentityChannel(entry.channel) === channel);
  return identity ? readIdentityUrl(identity, key) : null;
}

function contactHasIdentityChannel(
  identities: Array<Record<string, unknown>>,
  channel: IdentityChannel,
): boolean {
  return identities.some((entry) => readIdentityChannel(entry.channel) === channel);
}

function inferConversationLogicalChannel(params: {
  identities: Array<Record<string, unknown>>;
  transportChannel: IdentityChannel;
  requestedChannel?: IdentityChannel;
  storedLogicalChannel?: IdentityChannel | null;
}): IdentityChannel {
  const stored = params.storedLogicalChannel
    ? readIdentityChannel(params.storedLogicalChannel)
    : null;
  if (stored) {
    return stored;
  }
  const requested = params.requestedChannel ? readIdentityChannel(params.requestedChannel) : null;
  if (requested) {
    return requested;
  }
  if (
    params.transportChannel === "manychat" &&
    contactHasIdentityChannel(params.identities, "instagram")
  ) {
    return "instagram";
  }
  return params.transportChannel;
}

function resolveConversationTransport(
  transportChannel: IdentityChannel,
  storedTransport?: ConversationTransport | string | null,
): ConversationTransport {
  const normalized = typeof storedTransport === "string" ? storedTransport.trim() : "";
  if (
    normalized === "manychat" ||
    normalized === "bluebubbles" ||
    normalized === "manual" ||
    normalized === "other"
  ) {
    return normalized;
  }
  if (transportChannel === "manychat") {
    return "manychat";
  }
  if (transportChannel === "imessage") {
    return "bluebubbles";
  }
  return "other";
}

function describeConversationChannelContext(
  identities: Array<Record<string, unknown>>,
  transportChannel: IdentityChannel,
  requestedChannel?: IdentityChannel,
  storedLogicalChannel?: IdentityChannel | null,
  storedTransport?: ConversationTransport | string | null,
): {
  matchedChannel: IdentityChannel;
  logicalChannel: IdentityChannel;
  transport: ConversationTransport;
  channelLabel: string;
  primaryIdentity: Record<string, unknown> | null;
  replyUrl: string | null;
  profileUrl: string | null;
} {
  const requested = requestedChannel ? readIdentityChannel(requestedChannel) : null;
  const transport = readIdentityChannel(transportChannel);
  const logicalChannel = inferConversationLogicalChannel({
    identities,
    transportChannel: transport,
    requestedChannel,
    storedLogicalChannel,
  });
  const resolvedTransport = resolveConversationTransport(transport, storedTransport);

  if (logicalChannel === "instagram" && resolvedTransport === "manychat") {
    return {
      matchedChannel: requested ?? logicalChannel,
      logicalChannel,
      transport: resolvedTransport,
      channelLabel: "instagram via manychat",
      primaryIdentity: chooseConversationIdentity(identities, "instagram"),
      replyUrl:
        chooseChannelIdentityUrl(identities, "manychat", "reply_url") ??
        choosePreferredIdentityUrl(identities, "manychat", "reply_url"),
      profileUrl:
        chooseChannelIdentityUrl(identities, "instagram", "profile_url") ??
        chooseChannelIdentityUrl(identities, "instagram", "reply_url") ??
        choosePreferredIdentityUrl(identities, "manychat", "profile_url"),
    };
  }

  const preferredChannel = requested ?? logicalChannel;
  const channelLabel =
    logicalChannel === "imessage" && resolvedTransport === "bluebubbles"
      ? "imessage"
      : logicalChannel === transport
        ? logicalChannel
        : `${logicalChannel} via ${resolvedTransport}`;
  return {
    matchedChannel: preferredChannel,
    logicalChannel,
    transport: resolvedTransport,
    channelLabel,
    primaryIdentity: chooseConversationIdentity(identities, preferredChannel),
    replyUrl: choosePreferredIdentityUrl(identities, transport, "reply_url"),
    profileUrl: choosePreferredIdentityUrl(identities, preferredChannel, "profile_url"),
  };
}

function normalizeSegmentDefinition(input: SegmentDefinition | undefined): SegmentDefinition {
  const definition: SegmentDefinition = {};
  const city = maybeString(input?.city);
  const tagsAny = [...new Set((input?.tagsAny ?? []).map(normalizeTag).filter(Boolean))];
  const tagsAll = [...new Set((input?.tagsAll ?? []).map(normalizeTag).filter(Boolean))];
  const minOverallScore = maybeNumber(input?.minOverallScore);
  const maxOverallScore = maybeNumber(input?.maxOverallScore);
  const minDaysSinceLastInteraction = maybeNonNegativeInteger(input?.minDaysSinceLastInteraction);
  const maxDaysSinceLastInteraction = maybeNonNegativeInteger(input?.maxDaysSinceLastInteraction);
  const birthdayWithinDays = maybeNonNegativeInteger(input?.birthdayWithinDays);

  if (city) {
    definition.city = city;
  }
  if (input?.qualityTier) {
    definition.qualityTier = input.qualityTier;
  }
  if (tagsAny.length > 0) {
    definition.tagsAny = tagsAny;
  }
  if (tagsAll.length > 0) {
    definition.tagsAll = tagsAll;
  }
  if (minOverallScore !== null) {
    definition.minOverallScore = minOverallScore;
  }
  if (maxOverallScore !== null) {
    definition.maxOverallScore = maxOverallScore;
  }
  if (minDaysSinceLastInteraction !== null) {
    definition.minDaysSinceLastInteraction = minDaysSinceLastInteraction;
  }
  if (maxDaysSinceLastInteraction !== null) {
    definition.maxDaysSinceLastInteraction = maxDaysSinceLastInteraction;
  }
  if (birthdayWithinDays !== null) {
    definition.birthdayWithinDays = birthdayWithinDays;
  }

  if (
    definition.minOverallScore !== undefined &&
    definition.maxOverallScore !== undefined &&
    definition.minOverallScore > definition.maxOverallScore
  ) {
    throw new Error("Segment definition minOverallScore cannot exceed maxOverallScore");
  }

  if (
    definition.minDaysSinceLastInteraction !== undefined &&
    definition.maxDaysSinceLastInteraction !== undefined &&
    definition.minDaysSinceLastInteraction > definition.maxDaysSinceLastInteraction
  ) {
    throw new Error(
      "Segment definition minDaysSinceLastInteraction cannot exceed maxDaysSinceLastInteraction",
    );
  }

  return definition;
}

function parseSegmentDefinition(value: string | null | undefined): SegmentDefinition {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return {};
  }
  return normalizeSegmentDefinition({
    city: typeof parsed.city === "string" ? parsed.city : undefined,
    qualityTier:
      typeof parsed.qualityTier === "string"
        ? (parsed.qualityTier as ContactQualityTier)
        : undefined,
    tagsAny: Array.isArray(parsed.tagsAny)
      ? parsed.tagsAny.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    tagsAll: Array.isArray(parsed.tagsAll)
      ? parsed.tagsAll.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    minOverallScore:
      typeof parsed.minOverallScore === "number" ? parsed.minOverallScore : undefined,
    maxOverallScore:
      typeof parsed.maxOverallScore === "number" ? parsed.maxOverallScore : undefined,
    minDaysSinceLastInteraction:
      typeof parsed.minDaysSinceLastInteraction === "number"
        ? parsed.minDaysSinceLastInteraction
        : undefined,
    maxDaysSinceLastInteraction:
      typeof parsed.maxDaysSinceLastInteraction === "number"
        ? parsed.maxDaysSinceLastInteraction
        : undefined,
    birthdayWithinDays:
      typeof parsed.birthdayWithinDays === "number" ? parsed.birthdayWithinDays : undefined,
  });
}

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysSinceTimestamp(value: string | null | undefined, now = new Date()): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.floor((utcDayStart(now) - utcDayStart(parsed)) / 86_400_000);
}

function daysUntilNextBirthday(value: string | null | undefined, now = new Date()): number | null {
  const raw = maybeString(value);
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const nowDay = utcDayStart(now);
  let nextBirthday = Date.UTC(now.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  if (nextBirthday < nowDay) {
    nextBirthday = Date.UTC(now.getUTCFullYear() + 1, parsed.getUTCMonth(), parsed.getUTCDate());
  }
  return Math.floor((nextBirthday - nowDay) / 86_400_000);
}

function chooseDisplayName(input: UpsertContactInput): string {
  const displayName = normalizeWhitespace(input.displayName);
  if (displayName) {
    return displayName;
  }
  const first = normalizeWhitespace(input.firstName);
  const last = normalizeWhitespace(input.lastName);
  const combined = `${first} ${last}`.trim();
  if (combined) {
    return combined;
  }
  const identity = input.identities?.find((entry) => normalizeIdentityValue(entry));
  return (
    normalizeHandle(identity?.handle) ||
    normalizeEmail(identity?.email) ||
    normalizePhone(identity?.phoneE164) ||
    normalizeLower(identity?.externalId) ||
    "Unknown Contact"
  );
}

function chooseExistingDisplayName(params: {
  requestedDisplayName: string;
  existingDisplayName?: string | null;
  identities?: ContactIdentityInput[];
}): string {
  const requested = normalizeWhitespace(params.requestedDisplayName);
  const existing = normalizeWhitespace(params.existingDisplayName);
  if (!requested || !existing) {
    return requested || existing || "Unknown Contact";
  }
  const requestedLower = normalizeLower(requested);
  const identityFallbacks = new Set<string>();
  for (const identity of params.identities ?? []) {
    const normalized = normalizeIdentityValue(identity);
    if (normalized) {
      identityFallbacks.add(normalized);
    }
  }
  return identityFallbacks.has(requestedLower) ? existing : requested;
}

function resolveOverallScore(input: RecordScoreInput): number {
  if (typeof input.overallScore === "number" && Number.isFinite(input.overallScore)) {
    return input.overallScore;
  }
  const values = [
    input.responsivenessScore,
    input.attendanceLikelihoodScore,
    input.socialValueScore,
    input.spendPotentialScore,
    input.reliabilityScore,
    input.promoterFitScore,
  ].filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function resolvePromoterCrmPaths(stateDir: string): { dbDir: string; dbPath: string } {
  const dbDir = path.join(stateDir, "plugins", "promoter-crm");
  return {
    dbDir,
    dbPath: path.join(dbDir, "promoter-crm.db"),
  };
}

export class PromoterCrmStore {
  private readonly db: DatabaseSync;

  constructor(private readonly paths: { dbDir: string; dbPath: string }) {
    fs.mkdirSync(paths.dbDir, { recursive: true });
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(paths.dbPath);
    ensurePromoterCrmSchema(this.db);
    this.backfillIdentityLinksFromInteractionMetadata();
    this.backfillConversationSemantics();
    this.backfillMessageSemantics();
  }

  close(): void {
    this.db.close();
  }

  getStatus(): {
    dbPath: string;
    tableCounts: Record<string, number>;
  } {
    const tableCounts: Record<string, number> = {};
    for (const table of PROMOTER_CRM_TABLES) {
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
        | { count?: number }
        | undefined;
      tableCounts[table] = row?.count ?? 0;
    }
    return {
      dbPath: this.paths.dbPath,
      tableCounts,
    };
  }

  private createIngestJob(params: {
    source: IngestSource;
    sourceLabel?: string;
    fileName?: string;
    initiatedBy?: string;
  }): { ingestJobId: string; startedAt: string } {
    const ingestJobId = randomUUID();
    const startedAt = nowIso();
    this.db
      .prepare(`
        INSERT INTO ingest_jobs (
          ingest_job_id,
          source,
          source_label,
          file_name,
          status,
          stats_json,
          initiated_by,
          started_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        ingestJobId,
        params.source,
        maybeString(params.sourceLabel),
        maybeString(params.fileName),
        "running",
        JSON.stringify({}),
        maybeString(params.initiatedBy),
        startedAt,
        null,
      );
    return { ingestJobId, startedAt };
  }

  private appendIngestJobItem(params: {
    ingestJobId: string;
    rowNumber?: number;
    externalId?: string;
    action: IngestItemAction;
    resolvedContactId?: string;
    rawPayload: Record<string, unknown>;
    errorText?: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO ingest_job_items (
          ingest_job_item_id,
          ingest_job_id,
          row_number,
          external_id,
          action,
          resolved_contact_id,
          raw_payload_json,
          error_text,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        params.ingestJobId,
        typeof params.rowNumber === "number" ? params.rowNumber : null,
        maybeString(params.externalId),
        params.action,
        maybeString(params.resolvedContactId),
        JSON.stringify(params.rawPayload),
        maybeString(params.errorText),
        nowIso(),
      );
  }

  private finishIngestJob(params: {
    ingestJobId: string;
    status: "completed" | "failed";
    stats: Record<string, unknown>;
  }): void {
    this.db
      .prepare(`
        UPDATE ingest_jobs
        SET status = ?, stats_json = ?, finished_at = ?
        WHERE ingest_job_id = ?
      `)
      .run(params.status, JSON.stringify(params.stats), nowIso(), params.ingestJobId);
  }

  private backfillIdentityLink(
    contactId: string,
    identity: ContactIdentityInput & { channel: IdentityChannel },
  ): void {
    const normalizedValue = normalizeIdentityValue(identity);
    if (!normalizedValue) {
      return;
    }

    const existing = this.db
      .prepare(`
        SELECT identity_id, is_primary
        FROM contact_identities
        WHERE channel = ? AND normalized_value = ?
        LIMIT 1
      `)
      .get(identity.channel, normalizedValue) as
      | { identity_id?: string; is_primary?: number }
      | undefined;
    const currentIdentityCount =
      (
        this.db
          .prepare("SELECT COUNT(*) AS count FROM contact_identities WHERE contact_id = ?")
          .get(contactId) as { count?: number } | undefined
      )?.count ?? 0;
    const identityId = existing?.identity_id ?? randomUUID();
    const isPrimary = existing?.is_primary ?? (currentIdentityCount === 0 ? 1 : 0);
    const now = nowIso();

    this.db
      .prepare(`
        INSERT INTO contact_identities (
          identity_id,
          contact_id,
          channel,
          external_id,
          handle,
          email,
          phone_e164,
          profile_url,
          reply_url,
          avatar_url,
          identity_role,
          normalized_value,
          source,
          is_primary,
          confidence,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, normalized_value) DO UPDATE SET
          contact_id = excluded.contact_id,
          external_id = COALESCE(excluded.external_id, contact_identities.external_id),
          handle = COALESCE(excluded.handle, contact_identities.handle),
          email = COALESCE(excluded.email, contact_identities.email),
          phone_e164 = COALESCE(excluded.phone_e164, contact_identities.phone_e164),
          profile_url = COALESCE(contact_identities.profile_url, excluded.profile_url),
          reply_url = COALESCE(contact_identities.reply_url, excluded.reply_url),
          avatar_url = COALESCE(contact_identities.avatar_url, excluded.avatar_url),
          identity_role = COALESCE(contact_identities.identity_role, excluded.identity_role),
          source = COALESCE(excluded.source, contact_identities.source),
          confidence = COALESCE(excluded.confidence, contact_identities.confidence),
          updated_at = excluded.updated_at
      `)
      .run(
        identityId,
        contactId,
        identity.channel,
        maybeString(identity.externalId),
        maybeString(normalizeHandle(identity.handle)),
        maybeString(normalizeEmail(identity.email)),
        maybeString(normalizePhone(identity.phoneE164)),
        maybeUrl(identity.profileUrl),
        maybeUrl(identity.replyUrl),
        maybeUrl(identity.avatarUrl),
        identity.identityRole ?? "lead",
        normalizedValue,
        maybeString(identity.source),
        isPrimary,
        typeof identity.confidence === "number" ? identity.confidence : 1,
        now,
        now,
      );
  }

  private backfillIdentityLinksFromInteractionMetadata(): void {
    const rows = this.db
      .prepare(`
        SELECT contact_id, metadata_json
        FROM interaction_history
        WHERE metadata_json IS NOT NULL
        ORDER BY occurred_at DESC
      `)
      .all() as Array<{ contact_id?: string; metadata_json?: string }>;
    const aggregated = new Map<
      string,
      {
        manychatContactId?: string;
        liveChatUrl?: string;
        profilePic?: string;
        instagramHandle?: string;
        instagramId?: string;
        instagramProfileUrl?: string;
      }
    >();

    for (const row of rows) {
      const contactId = maybeString(row.contact_id);
      if (!contactId) {
        continue;
      }

      const metadata = parseJsonObject(row.metadata_json);
      if (!metadata) {
        continue;
      }
      const contact = asObject(metadata.contact);
      const liveChatUrl =
        readMetadataText(metadata, ["live_chat_url"]) ||
        readMetadataText(contact, ["live_chat_url"]);
      const profilePic =
        readMetadataText(metadata, ["profile_pic"]) || readMetadataText(contact, ["profile_pic"]);
      const manychatContactId =
        readMetadataText(metadata, ["manychat_contact_id"]) || readMetadataText(contact, ["id"]);
      const instagramHandle =
        readMetadataText(metadata, ["instagram_username"]) ||
        readMetadataText(contact, ["ig_username", "instagram_username"]);
      const instagramId =
        readMetadataText(contact, ["ig_id", "instagram_id"]) ||
        readMetadataText(metadata, ["instagram_id"]);
      const instagramProfileUrl =
        readMetadataText(metadata, ["instagram_profile_url"]) ||
        buildInstagramProfileUrl(instagramHandle) ||
        undefined;

      const current = aggregated.get(contactId) ?? {};
      aggregated.set(contactId, {
        manychatContactId: current.manychatContactId ?? manychatContactId,
        liveChatUrl: current.liveChatUrl ?? liveChatUrl,
        profilePic: current.profilePic ?? profilePic,
        instagramHandle: current.instagramHandle ?? instagramHandle,
        instagramId: current.instagramId ?? instagramId,
        instagramProfileUrl: current.instagramProfileUrl ?? instagramProfileUrl,
      });
    }

    for (const [contactId, data] of aggregated) {
      if (data.manychatContactId || data.liveChatUrl || data.profilePic) {
        this.backfillIdentityLink(contactId, {
          channel: "manychat",
          externalId: data.manychatContactId,
          profileUrl: data.liveChatUrl,
          replyUrl: data.liveChatUrl,
          avatarUrl: data.profilePic,
          source: "manychat",
        });
      }

      if (data.instagramHandle || data.instagramId || data.instagramProfileUrl || data.profilePic) {
        this.backfillIdentityLink(contactId, {
          channel: "instagram",
          externalId: data.instagramId,
          handle: data.instagramHandle,
          profileUrl: data.instagramProfileUrl,
          avatarUrl: data.profilePic,
          source: "manychat",
        });
      }
    }
  }

  private backfillConversationSemantics(): void {
    this.db
      .prepare(`
        UPDATE contact_identities
        SET identity_role = COALESCE(identity_role, 'lead')
        WHERE identity_role IS NULL OR TRIM(identity_role) = ''
      `)
      .run();

    this.db
      .prepare(`
        UPDATE conversations
        SET
          logical_channel = CASE
            WHEN logical_channel IS NOT NULL AND TRIM(logical_channel) <> '' THEN logical_channel
            WHEN channel = 'manychat' AND EXISTS (
              SELECT 1
              FROM contact_identities ci
              WHERE ci.contact_id = conversations.contact_id
                AND ci.channel = 'instagram'
            ) THEN 'instagram'
            ELSE channel
          END,
          transport = CASE
            WHEN transport IS NOT NULL AND TRIM(transport) <> '' THEN transport
            WHEN channel = 'manychat' THEN 'manychat'
            WHEN channel = 'imessage' THEN 'bluebubbles'
            ELSE 'other'
          END,
          conversation_role = COALESCE(NULLIF(TRIM(conversation_role), ''), 'crm')
      `)
      .run();
  }

  private backfillMessageSemantics(): void {
    const rows = this.db
      .prepare(`
        SELECT message_id, direction, metadata_json
        FROM messages
        WHERE actor_role IS NULL OR authorship_mode IS NULL
      `)
      .all() as Array<{
      message_id: string;
      direction: Direction;
      metadata_json: string | null;
    }>;

    const update = this.db.prepare(`
      UPDATE messages
      SET actor_role = ?, authorship_mode = ?
      WHERE message_id = ?
    `);

    for (const row of rows) {
      const metadata = parseJsonObject(row.metadata_json);
      const source = readMetadataText(metadata, ["source"]);
      const actorRole: MessageActorRole = row.direction === "inbound" ? "contact" : "user";
      let authorshipMode: MessageAuthorshipMode = "connector_import";
      if (source === "control_ui_manual_reply") {
        authorshipMode = "manual_user";
      } else if (source === "control_ui_manychat_send") {
        authorshipMode = "assistant_send";
      }
      update.run(actorRole, authorshipMode, row.message_id);
    }
  }

  private withTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private getContactRow(contactId: string): ContactRow {
    const row = this.db.prepare("SELECT * FROM contacts WHERE contact_id = ?").get(contactId) as
      | ContactRow
      | undefined;
    if (!row) {
      throw new Error(`Contact not found: ${contactId}`);
    }
    return row;
  }

  private resolveFlexibleContactId(contactId: string): string | null {
    const normalized = maybeString(contactId);
    if (!normalized) {
      return null;
    }

    const exact = this.db
      .prepare(
        `
          SELECT contact_id
          FROM contacts
          WHERE contact_id = ?
          LIMIT 1
        `,
      )
      .get(normalized) as { contact_id: string } | undefined;
    if (exact?.contact_id) {
      return exact.contact_id;
    }

    const selector = parseIdentitySelector(normalized);
    const matchValue = selector.value.toLowerCase();
    const channelClause = selector.channel ? "AND channel = ?" : "";
    const params: Array<string> = [];
    if (selector.channel) {
      params.push(selector.channel);
    }
    params.push(matchValue, matchValue, matchValue, matchValue, matchValue, matchValue);

    const matchedIdentity = this.db
      .prepare(
        `
          SELECT contact_id
          FROM contact_identities
          WHERE 1 = 1
            ${channelClause}
            AND (
              lower(COALESCE(handle, '')) = ?
              OR lower(COALESCE(external_id, '')) = ?
              OR lower(COALESCE(email, '')) = ?
              OR lower(COALESCE(phone_e164, '')) = ?
              OR lower(COALESCE(profile_url, '')) = ?
              OR lower(COALESCE(reply_url, '')) = ?
            )
          ORDER BY is_primary DESC, updated_at DESC
          LIMIT 1
        `,
      )
      .get(...params) as { contact_id: string } | undefined;

    return matchedIdentity?.contact_id ?? null;
  }

  private resolveFlexibleConversationId(conversationId: string): string | null {
    const normalized = maybeString(conversationId);
    if (!normalized) {
      return null;
    }

    const exact = this.db
      .prepare(
        `
          SELECT conversation_id
          FROM conversation_inbox
          WHERE conversation_id = ?
             OR external_thread_id = ?
          ORDER BY COALESCE(last_inbound_at, last_message_sent_at, last_message_at) DESC
          LIMIT 1
        `,
      )
      .get(normalized, normalized) as { conversation_id: string } | undefined;
    if (exact?.conversation_id) {
      return exact.conversation_id;
    }

    if (/^\d+$/.test(normalized)) {
      const suffixMatch = this.db
        .prepare(
          `
            SELECT conversation_id
            FROM conversation_inbox
            WHERE external_thread_id LIKE ?
            ORDER BY COALESCE(last_inbound_at, last_message_sent_at, last_message_at) DESC
            LIMIT 1
          `,
        )
        .get(`%/${normalized}`) as { conversation_id: string } | undefined;
      if (suffixMatch?.conversation_id) {
        return suffixMatch.conversation_id;
      }
    }

    return null;
  }

  private getSegmentRow(segmentId: string): SegmentRow {
    const row = this.db.prepare("SELECT * FROM segments WHERE segment_id = ?").get(segmentId) as
      | SegmentRow
      | undefined;
    if (!row) {
      throw new Error(`Segment not found: ${segmentId}`);
    }
    return row;
  }

  private getLatestScore(contactId: string): LatestScoreRow | null {
    const row = this.db
      .prepare(`
        SELECT
          score_id,
          overall_score,
          responsiveness_score,
          attendance_likelihood_score,
          social_value_score,
          spend_potential_score,
          reliability_score,
          promoter_fit_score,
          rationale,
          created_at
        FROM contact_score_snapshots
        WHERE contact_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(contactId) as LatestScoreRow | undefined;
    return row ?? null;
  }

  private getNextInvite(contactId: string): {
    event_id: string;
    campaign_id: string | null;
    event_name: string;
    starts_at: string;
    invite_status: InviteStatus;
    rsvp_status: RsvpStatus;
  } | null {
    const now = nowIso();
    const row = this.db
      .prepare(`
        SELECT
          ei.event_id,
          ei.campaign_id,
          e.display_name AS event_name,
          e.starts_at,
          ei.invite_status,
          ei.rsvp_status
        FROM event_invites ei
        JOIN events e ON e.event_id = ei.event_id
        WHERE ei.contact_id = ?
          AND e.starts_at >= ?
          AND ei.invite_status IN ('draft', 'invited', 'confirmed', 'tentative')
        ORDER BY e.starts_at ASC
        LIMIT 1
      `)
      .get(contactId, now) as
      | {
          event_id: string;
          campaign_id: string | null;
          event_name: string;
          starts_at: string;
          invite_status: InviteStatus;
          rsvp_status: RsvpStatus;
        }
      | undefined;
    return row ?? null;
  }

  private resolveExistingContactId(input: UpsertContactInput): string | null {
    if (input.contactId) {
      return input.contactId;
    }
    const candidates = new Set<string>();
    for (const identity of input.identities ?? []) {
      const normalizedValue = normalizeIdentityValue(identity);
      if (!normalizedValue) {
        continue;
      }
      const exactRows = this.db
        .prepare(`
          SELECT contact_id
          FROM contact_identities
          WHERE channel = ? AND normalized_value = ?
        `)
        .all(identity.channel, normalizedValue) as Array<{ contact_id: string }>;
      for (const row of exactRows) {
        candidates.add(row.contact_id);
      }
      if (candidates.size > 0) {
        continue;
      }
      if (!isNormalizedPhone(normalizedValue) && !isNormalizedEmail(normalizedValue)) {
        continue;
      }
      const crossChannelRows = this.db
        .prepare(`
          SELECT contact_id
          FROM contact_identities
          WHERE normalized_value = ?
        `)
        .all(normalizedValue) as Array<{ contact_id: string }>;
      for (const row of crossChannelRows) {
        candidates.add(row.contact_id);
      }
    }
    if (candidates.size > 1) {
      throw new Error(
        `Identity resolution matched multiple contacts: ${Array.from(candidates).join(", ")}`,
      );
    }
    return candidates.values().next().value ?? null;
  }

  private syncIdentities(contactId: string, identities: ContactIdentityInput[] | undefined): void {
    if (!identities) {
      return;
    }
    const now = nowIso();
    const insert = this.db.prepare(`
      INSERT INTO contact_identities (
        identity_id,
        contact_id,
        channel,
        external_id,
        handle,
        email,
        phone_e164,
          profile_url,
          reply_url,
          avatar_url,
          identity_role,
          normalized_value,
          source,
          is_primary,
          confidence,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, normalized_value) DO UPDATE SET
        contact_id = excluded.contact_id,
        external_id = excluded.external_id,
        handle = excluded.handle,
        email = excluded.email,
        phone_e164 = excluded.phone_e164,
        profile_url = COALESCE(excluded.profile_url, contact_identities.profile_url),
        reply_url = COALESCE(excluded.reply_url, contact_identities.reply_url),
        avatar_url = COALESCE(excluded.avatar_url, contact_identities.avatar_url),
        identity_role = COALESCE(excluded.identity_role, contact_identities.identity_role),
        source = excluded.source,
        is_primary = excluded.is_primary,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `);
    for (const identity of identities) {
      const normalizedValue = normalizeIdentityValue(identity);
      if (!normalizedValue) {
        continue;
      }
      insert.run(
        randomUUID(),
        contactId,
        identity.channel,
        maybeString(identity.externalId),
        maybeString(normalizeHandle(identity.handle)),
        maybeString(normalizeEmail(identity.email)),
        maybeString(normalizePhone(identity.phoneE164)),
        maybeUrl(identity.profileUrl),
        maybeUrl(identity.replyUrl),
        maybeUrl(identity.avatarUrl),
        identity.identityRole ?? "lead",
        normalizedValue,
        maybeString(identity.source),
        identity.isPrimary ? 1 : 0,
        typeof identity.confidence === "number" ? identity.confidence : 1,
        now,
        now,
      );
    }
  }

  private syncTags(contactId: string, tags: string[] | undefined): void {
    if (!tags) {
      return;
    }
    const normalizedTags = [...new Set(tags.map(normalizeTag).filter(Boolean))];
    const now = nowIso();
    const upsertTag = this.db.prepare(`
      INSERT INTO tags (tag_id, normalized_name, display_name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET display_name = excluded.display_name
    `);
    const linkTag = this.db.prepare(`
      INSERT INTO contact_tag_links (contact_id, tag_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(contact_id, tag_id) DO NOTHING
    `);

    this.db.prepare("DELETE FROM contact_tag_links WHERE contact_id = ?").run(contactId);
    for (const tag of normalizedTags) {
      const existing = this.db
        .prepare("SELECT tag_id FROM tags WHERE normalized_name = ?")
        .get(tag) as { tag_id?: string } | undefined;
      const tagId = existing?.tag_id ?? randomUUID();
      upsertTag.run(tagId, tag, tag, now);
      linkTag.run(contactId, tagId, now);
    }
  }

  private syncPreferences(
    contactId: string,
    preferences: ContactPreferenceInput[] | undefined,
  ): void {
    if (!preferences) {
      return;
    }
    const now = nowIso();
    const insert = this.db.prepare(`
      INSERT INTO contact_preferences (
        preference_id,
        contact_id,
        category,
        preference,
        value,
        normalized_value,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contact_id, category, preference, normalized_value) DO UPDATE SET
        value = excluded.value
    `);

    this.db.prepare("DELETE FROM contact_preferences WHERE contact_id = ?").run(contactId);
    for (const preference of preferences) {
      const normalizedValue = normalizeTag(preference.value);
      if (!normalizedValue) {
        continue;
      }
      insert.run(
        randomUUID(),
        contactId,
        preference.category,
        preference.preference,
        preference.value.trim(),
        normalizedValue,
        now,
      );
    }
  }

  private getExistingPreferenceInputs(contactId: string): ContactPreferenceInput[] {
    const rows = this.db
      .prepare(`
        SELECT category, preference, value
        FROM contact_preferences
        WHERE contact_id = ?
      `)
      .all(contactId) as Array<{
      category: ContactPreferenceInput["category"];
      preference: ContactPreferenceInput["preference"];
      value: string;
    }>;
    return rows.map((row) => ({
      category: row.category,
      preference: row.preference,
      value: row.value,
    }));
  }

  private hasContactNoteBody(contactId: string, note: string): boolean {
    const normalizedNote = normalizeWhitespace(note);
    if (!normalizedNote) {
      return false;
    }
    const row = this.db
      .prepare(`
        SELECT note_id
        FROM contact_notes
        WHERE contact_id = ? AND TRIM(body) = ?
        LIMIT 1
      `)
      .get(contactId, normalizedNote) as { note_id?: string } | undefined;
    return Boolean(row?.note_id);
  }

  private prepareImportedContactInput(input: UpsertContactInput): UpsertContactInput {
    const existingContactId = this.resolveExistingContactId(input);
    if (!existingContactId) {
      return input;
    }

    const nextInput: UpsertContactInput = { ...input };

    if (input.tags && input.tags.length > 0) {
      const mergedTags = [
        ...new Set([...this.listContactTags(existingContactId), ...input.tags].map(normalizeTag)),
      ].filter(Boolean);
      nextInput.tags = mergedTags.length > 0 ? mergedTags : undefined;
    }

    if (input.preferences && input.preferences.length > 0) {
      const merged = new Map<string, ContactPreferenceInput>();
      for (const preference of this.getExistingPreferenceInputs(existingContactId)) {
        const key = `${preference.category}:${preference.preference}:${normalizeTag(preference.value)}`;
        merged.set(key, preference);
      }
      for (const preference of input.preferences) {
        const key = `${preference.category}:${preference.preference}:${normalizeTag(preference.value)}`;
        merged.set(key, preference);
      }
      nextInput.preferences = [...merged.values()];
    }

    if (input.note && this.hasContactNoteBody(existingContactId, input.note)) {
      nextInput.note = undefined;
    }

    return nextInput;
  }

  upsertContact(input: UpsertContactInput): {
    contactId: string;
    displayName: string;
    latestScore: LatestScoreRow | null;
    action: "created" | "updated";
  } {
    return this.withTransaction(() => {
      const now = nowIso();
      const contactId = this.resolveExistingContactId(input) ?? randomUUID();
      const existing = this.db
        .prepare("SELECT * FROM contacts WHERE contact_id = ?")
        .get(contactId) as ContactRow | undefined;
      const displayName = chooseExistingDisplayName({
        requestedDisplayName: chooseDisplayName(input),
        existingDisplayName: existing?.display_name,
        identities: input.identities,
      });

      const firstName = maybeString(input.firstName) ?? existing?.first_name ?? null;
      const lastName = maybeString(input.lastName) ?? existing?.last_name ?? null;
      const city = maybeString(input.city) ?? existing?.city ?? null;
      const birthday = maybeString(input.birthday) ?? existing?.birthday ?? null;
      const qualityTier = input.qualityTier ?? existing?.quality_tier ?? null;
      const manualScoreOverride =
        maybeNumber(input.manualScoreOverride) ?? existing?.manual_score_override ?? null;

      if (existing) {
        this.db
          .prepare(`
            UPDATE contacts
            SET display_name = ?, first_name = ?, last_name = ?, city = ?, birthday = ?,
                quality_tier = ?, manual_score_override = ?, updated_at = ?
            WHERE contact_id = ?
          `)
          .run(
            displayName,
            firstName,
            lastName,
            city,
            birthday,
            qualityTier,
            manualScoreOverride,
            now,
            contactId,
          );
      } else {
        this.db
          .prepare(`
            INSERT INTO contacts (
              contact_id,
              display_name,
              first_name,
              last_name,
              city,
              birthday,
              quality_tier,
              manual_score_override,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            contactId,
            displayName,
            firstName,
            lastName,
            city,
            birthday,
            qualityTier,
            manualScoreOverride,
            now,
            now,
          );
      }

      this.syncIdentities(contactId, input.identities);
      this.syncTags(contactId, input.tags);
      this.syncPreferences(contactId, input.preferences);

      if (maybeString(input.note)) {
        this.db
          .prepare(`
            INSERT INTO contact_notes (
              note_id,
              contact_id,
              note_type,
              body,
              created_by,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(
            randomUUID(),
            contactId,
            "promoter",
            input.note!.trim(),
            input.createdBy ?? null,
            now,
          );
      }

      return {
        contactId,
        displayName,
        latestScore: this.getLatestScore(contactId),
        action: existing ? "updated" : "created",
      };
    });
  }

  findContacts(input: SearchContactsInput): Array<Record<string, unknown>> {
    const query = normalizeLower(input.query);
    const tag = normalizeTag(input.tag ?? "");
    const params: Array<string | number> = [];
    const filters: string[] = [];

    if (query) {
      filters.push(`
        (
          LOWER(c.display_name) LIKE ?
          OR LOWER(COALESCE(c.first_name, '')) LIKE ?
          OR LOWER(COALESCE(c.last_name, '')) LIKE ?
          OR EXISTS (
            SELECT 1
            FROM contact_identities ci
            WHERE ci.contact_id = c.contact_id
              AND ci.normalized_value LIKE ?
          )
        )
      `);
      const like = `%${query}%`;
      params.push(like, like, like, like);
    }

    if (input.city) {
      filters.push("LOWER(COALESCE(c.city, '')) = ?");
      params.push(normalizeLower(input.city));
    }

    if (input.qualityTier) {
      filters.push("c.quality_tier = ?");
      params.push(input.qualityTier);
    }

    if (input.segmentId) {
      filters.push(`
        EXISTS (
          SELECT 1
          FROM segment_memberships sm
          WHERE sm.contact_id = c.contact_id
            AND sm.segment_id = ?
        )
      `);
      params.push(input.segmentId);
    }

    if (tag) {
      filters.push(`
        EXISTS (
          SELECT 1
          FROM contact_tag_links ctl
          JOIN tags t ON t.tag_id = ctl.tag_id
          WHERE ctl.contact_id = c.contact_id
            AND t.normalized_name = ?
        )
      `);
      params.push(tag);
    }

    const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
    params.push(limit);

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`
        SELECT
          c.contact_id,
          c.display_name,
          c.city,
          c.quality_tier,
          c.manual_score_override,
          c.created_at,
          c.updated_at,
          (
            SELECT overall_score
            FROM contact_score_snapshots css
            WHERE css.contact_id = c.contact_id
            ORDER BY css.created_at DESC
            LIMIT 1
          ) AS latest_score
        FROM contacts c
        ${whereClause}
        ORDER BY COALESCE(latest_score, 0) DESC, c.updated_at DESC
        LIMIT ?
      `)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      ...row,
      tags: this.listContactTags(String(row.contact_id)),
      identities: this.listContactIdentities(String(row.contact_id)),
    }));
  }

  recordScore(input: RecordScoreInput): { scoreId: string; overallScore: number } {
    return this.withTransaction(() => {
      this.getContactRow(input.contactId);
      const scoreId = randomUUID();
      const createdAt = nowIso();
      const overallScore = resolveOverallScore(input);
      this.db
        .prepare(`
          INSERT INTO contact_score_snapshots (
            score_id,
            contact_id,
            responsiveness_score,
            attendance_likelihood_score,
            social_value_score,
            spend_potential_score,
            reliability_score,
            promoter_fit_score,
            overall_score,
            rationale,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          scoreId,
          input.contactId,
          maybeNumber(input.responsivenessScore),
          maybeNumber(input.attendanceLikelihoodScore),
          maybeNumber(input.socialValueScore),
          maybeNumber(input.spendPotentialScore),
          maybeNumber(input.reliabilityScore),
          maybeNumber(input.promoterFitScore),
          overallScore,
          maybeString(input.rationale),
          createdAt,
        );
      return { scoreId, overallScore };
    });
  }

  private upsertVenue(input: UpsertVenueInput): { venueId: string; displayName: string } {
    const now = nowIso();
    const normalizedName = normalizeTag(input.name);
    if (!normalizedName) {
      throw new Error("Venue name is required");
    }
    const existing = input.venueId
      ? (this.db.prepare("SELECT venue_id FROM venues WHERE venue_id = ?").get(input.venueId) as
          | { venue_id?: string }
          | undefined)
      : (this.db
          .prepare(
            "SELECT venue_id FROM venues WHERE normalized_name = ? AND COALESCE(city, '') = ?",
          )
          .get(normalizedName, normalizeWhitespace(input.city)) as
          | { venue_id?: string }
          | undefined);
    const venueId = existing?.venue_id ?? input.venueId ?? randomUUID();
    const displayName = input.name.trim();

    this.db
      .prepare(`
        INSERT INTO venues (
          venue_id,
          normalized_name,
          display_name,
          city,
          neighborhood,
          audience_type,
          vibe,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(venue_id) DO UPDATE SET
          normalized_name = excluded.normalized_name,
          display_name = excluded.display_name,
          city = excluded.city,
          neighborhood = excluded.neighborhood,
          audience_type = excluded.audience_type,
          vibe = excluded.vibe,
          updated_at = excluded.updated_at
      `)
      .run(
        venueId,
        normalizedName,
        displayName,
        normalizeWhitespace(input.city),
        maybeString(input.neighborhood),
        maybeString(input.audienceType),
        maybeString(input.vibe),
        now,
        now,
      );

    return { venueId, displayName };
  }

  upsertEvent(input: UpsertEventInput): {
    eventId: string;
    venueId: string;
    displayName: string;
  } {
    return this.withTransaction(() => {
      const now = nowIso();
      const { venueId } = this.upsertVenue(input.venue);
      const eventId = input.eventId ?? randomUUID();
      this.db
        .prepare(`
          INSERT INTO events (
            event_id,
            venue_id,
            display_name,
            starts_at,
            ends_at,
            theme,
            target_crowd,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            venue_id = excluded.venue_id,
            display_name = excluded.display_name,
            starts_at = excluded.starts_at,
            ends_at = excluded.ends_at,
            theme = excluded.theme,
            target_crowd = excluded.target_crowd,
            status = excluded.status,
            updated_at = excluded.updated_at
        `)
        .run(
          eventId,
          venueId,
          input.name.trim(),
          input.startsAt,
          maybeString(input.endsAt),
          maybeString(input.theme),
          maybeString(input.targetCrowd),
          input.status ?? "planned",
          now,
          now,
        );

      return { eventId, venueId, displayName: input.name.trim() };
    });
  }

  upsertCampaign(input: UpsertCampaignInput): {
    campaignId: string;
    displayName: string;
  } {
    return this.withTransaction(() => {
      if (input.eventId) {
        const eventExists = this.db
          .prepare("SELECT event_id FROM events WHERE event_id = ?")
          .get(input.eventId) as { event_id?: string } | undefined;
        if (!eventExists?.event_id) {
          throw new Error(`Event not found: ${input.eventId}`);
        }
      }

      const displayName = normalizeWhitespace(input.displayName);
      if (!displayName) {
        throw new Error("Campaign displayName is required");
      }

      const now = nowIso();
      const existing = input.campaignId
        ? (this.db
            .prepare("SELECT campaign_id FROM campaigns WHERE campaign_id = ?")
            .get(input.campaignId) as { campaign_id?: string } | undefined)
        : undefined;
      const campaignId = existing?.campaign_id ?? input.campaignId ?? randomUUID();

      this.db
        .prepare(`
          INSERT INTO campaigns (
            campaign_id,
            event_id,
            display_name,
            objective,
            audience_segment,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(campaign_id) DO UPDATE SET
            event_id = excluded.event_id,
            display_name = excluded.display_name,
            objective = excluded.objective,
            audience_segment = excluded.audience_segment,
            status = excluded.status,
            updated_at = excluded.updated_at
        `)
        .run(
          campaignId,
          maybeString(input.eventId),
          displayName,
          maybeString(input.objective),
          maybeString(input.audienceSegment),
          maybeString(input.status) ?? "draft",
          now,
          now,
        );

      return { campaignId, displayName };
    });
  }

  upsertInvite(input: UpsertInviteInput): { inviteId: string } {
    return this.withTransaction(() => {
      this.getContactRow(input.contactId);
      const eventExists = this.db
        .prepare("SELECT event_id FROM events WHERE event_id = ?")
        .get(input.eventId) as { event_id?: string } | undefined;
      if (!eventExists?.event_id) {
        throw new Error(`Event not found: ${input.eventId}`);
      }
      if (input.campaignId) {
        const campaignExists = this.db
          .prepare("SELECT campaign_id FROM campaigns WHERE campaign_id = ?")
          .get(input.campaignId) as { campaign_id?: string } | undefined;
        if (!campaignExists?.campaign_id) {
          throw new Error(`Campaign not found: ${input.campaignId}`);
        }
      }

      const now = nowIso();
      const existing = this.db
        .prepare("SELECT invite_id FROM event_invites WHERE contact_id = ? AND event_id = ?")
        .get(input.contactId, input.eventId) as { invite_id?: string } | undefined;
      const inviteId = input.inviteId ?? existing?.invite_id ?? randomUUID();

      this.db
        .prepare(`
          INSERT INTO event_invites (
            invite_id,
            contact_id,
            event_id,
            campaign_id,
            invite_status,
            rsvp_status,
            attendance_result,
            spend_amount,
            brought_guest_count,
            table_outcome,
            contribution_summary,
            note,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(contact_id, event_id) DO UPDATE SET
            campaign_id = excluded.campaign_id,
            invite_status = excluded.invite_status,
            rsvp_status = excluded.rsvp_status,
            attendance_result = excluded.attendance_result,
            spend_amount = excluded.spend_amount,
            brought_guest_count = excluded.brought_guest_count,
            table_outcome = excluded.table_outcome,
            contribution_summary = excluded.contribution_summary,
            note = excluded.note,
            updated_at = excluded.updated_at
        `)
        .run(
          inviteId,
          input.contactId,
          input.eventId,
          maybeString(input.campaignId),
          input.inviteStatus ?? "draft",
          input.rsvpStatus ?? "unknown",
          input.attendanceResult ?? "unknown",
          maybeNumber(input.spendAmount),
          typeof input.broughtGuestCount === "number" ? input.broughtGuestCount : null,
          maybeString(input.tableOutcome),
          maybeString(input.contributionSummary),
          maybeString(input.note),
          now,
          now,
        );

      return { inviteId };
    });
  }

  private upsertConversation(params: {
    contactId: string;
    channel: IdentityChannel;
    logicalChannel?: IdentityChannel;
    transport?: ConversationTransport;
    conversationRole?: ConversationRole;
    externalThreadId?: string;
    occurredAt: string;
  }): string | null {
    const threadId = maybeString(params.externalThreadId);
    if (!threadId) {
      return null;
    }
    const now = nowIso();
    const existing = this.db
      .prepare(`
        SELECT conversation_id
        FROM conversations
        WHERE channel = ? AND external_thread_id = ?
      `)
      .get(params.channel, threadId) as { conversation_id?: string } | undefined;
    const conversationId = existing?.conversation_id ?? randomUUID();

    this.db
      .prepare(`
        INSERT INTO conversations (
          conversation_id,
          contact_id,
          channel,
          logical_channel,
          transport,
          conversation_role,
          external_thread_id,
          status,
          started_at,
          last_message_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, external_thread_id) DO UPDATE SET
          contact_id = excluded.contact_id,
          logical_channel = COALESCE(excluded.logical_channel, conversations.logical_channel),
          transport = COALESCE(excluded.transport, conversations.transport),
          conversation_role = COALESCE(excluded.conversation_role, conversations.conversation_role),
          last_message_at = excluded.last_message_at,
          updated_at = excluded.updated_at
      `)
      .run(
        conversationId,
        params.contactId,
        params.channel,
        maybeString(params.logicalChannel),
        maybeString(params.transport),
        maybeString(params.conversationRole ?? "crm"),
        threadId,
        "active",
        params.occurredAt,
        params.occurredAt,
        now,
        now,
      );

    return conversationId;
  }

  private upsertMessage(params: {
    conversationId: string;
    direction?: Direction;
    actorRole?: MessageActorRole;
    authorshipMode?: MessageAuthorshipMode;
    externalMessageId?: string;
    status?: string;
    content?: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  }): { messageId: string; action: "created" | "updated" } | null {
    const externalMessageId = maybeString(params.externalMessageId);
    const hasMessage = externalMessageId || maybeString(params.content);
    if (!hasMessage) {
      return null;
    }
    const now = nowIso();
    const existing = externalMessageId
      ? (this.db
          .prepare(`
            SELECT message_id
            FROM messages
            WHERE conversation_id = ? AND external_message_id = ?
          `)
          .get(params.conversationId, externalMessageId) as { message_id?: string } | undefined)
      : undefined;
    const messageId = existing?.message_id ?? randomUUID();
    this.db
      .prepare(`
        INSERT INTO messages (
          message_id,
          conversation_id,
          external_message_id,
          direction,
          actor_role,
          authorship_mode,
          status,
          content,
          sent_at,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id, external_message_id) DO UPDATE SET
          direction = excluded.direction,
          actor_role = COALESCE(excluded.actor_role, messages.actor_role),
          authorship_mode = COALESCE(excluded.authorship_mode, messages.authorship_mode),
          status = excluded.status,
          content = excluded.content,
          sent_at = excluded.sent_at,
          metadata_json = excluded.metadata_json
      `)
      .run(
        messageId,
        params.conversationId,
        externalMessageId,
        params.direction ?? "outbound",
        maybeString(params.actorRole),
        maybeString(params.authorshipMode),
        maybeString(params.status),
        maybeString(params.content),
        params.occurredAt,
        params.metadata ? JSON.stringify(params.metadata) : null,
        now,
      );
    return {
      messageId,
      action: existing?.message_id ? "updated" : "created",
    };
  }

  logInteraction(input: LogInteractionInput): { interactionId: string } {
    return this.withTransaction(() => {
      this.getContactRow(input.contactId);
      const occurredAt = input.occurredAt ?? nowIso();
      let conversationId = maybeString(input.conversationId);
      let conversationChannel: IdentityChannel | null = maybeString(
        input.channel,
      ) as IdentityChannel | null;

      if (conversationId) {
        const existingConversation = this.db
          .prepare(`
            SELECT conversation_id, contact_id, channel, logical_channel, transport, conversation_role
            FROM conversations
            WHERE conversation_id = ?
          `)
          .get(conversationId) as
          | { conversation_id?: string; contact_id?: string; channel?: IdentityChannel }
          | undefined;
        if (!existingConversation?.conversation_id) {
          throw new Error(`Conversation not found: ${conversationId}`);
        }
        if (existingConversation.contact_id !== input.contactId) {
          throw new Error("Conversation does not belong to the requested contact.");
        }
        conversationChannel = existingConversation.channel ?? conversationChannel ?? null;
      } else if (input.channel && input.conversationExternalId) {
        const identities = this.listContactIdentities(input.contactId);
        conversationId = this.upsertConversation({
          contactId: input.contactId,
          channel: input.channel,
          logicalChannel:
            input.logicalChannel ??
            inferConversationLogicalChannel({
              identities,
              transportChannel: input.channel,
              storedLogicalChannel: undefined,
            }),
          transport: input.transport ?? resolveConversationTransport(input.channel),
          conversationRole: input.conversationRole ?? "crm",
          externalThreadId: input.conversationExternalId,
          occurredAt,
        });
        conversationChannel = input.channel;
      }

      if (conversationId) {
        this.db
          .prepare(`
            UPDATE conversations
            SET last_message_at = ?, updated_at = ?
            WHERE conversation_id = ?
          `)
          .run(occurredAt, nowIso(), conversationId);
      }

      const messageId =
        conversationId && (input.messageExternalId || input.content)
          ? this.upsertMessage({
              conversationId,
              direction: input.direction,
              actorRole: input.actorRole ?? (input.direction === "inbound" ? "contact" : "user"),
              authorshipMode: input.authorshipMode ?? "connector_import",
              externalMessageId: input.messageExternalId,
              status: input.messageStatus,
              content: input.content,
              occurredAt,
              metadata: input.metadata,
            })
          : null;

      const interactionId = input.interactionId ?? randomUUID();
      const createdAt = nowIso();
      this.db
        .prepare(`
          INSERT INTO interaction_history (
            interaction_id,
            contact_id,
            event_id,
            campaign_id,
            conversation_id,
            message_id,
            channel,
            kind,
            direction,
            sentiment,
            summary,
            outcome,
            best_next_action,
            intent_tags_json,
            metadata_json,
            occurred_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(interaction_id) DO UPDATE SET
            event_id = excluded.event_id,
            campaign_id = excluded.campaign_id,
            conversation_id = excluded.conversation_id,
            message_id = excluded.message_id,
            channel = excluded.channel,
            kind = excluded.kind,
            direction = excluded.direction,
            sentiment = excluded.sentiment,
            summary = excluded.summary,
            outcome = excluded.outcome,
            best_next_action = excluded.best_next_action,
            intent_tags_json = excluded.intent_tags_json,
            metadata_json = excluded.metadata_json,
            occurred_at = excluded.occurred_at
        `)
        .run(
          interactionId,
          input.contactId,
          maybeString(input.eventId),
          maybeString(input.campaignId),
          conversationId,
          messageId?.messageId ?? null,
          maybeString(conversationChannel ?? input.channel),
          input.kind,
          maybeString(input.direction),
          maybeString(input.sentiment),
          input.summary.trim(),
          maybeString(input.outcome),
          maybeString(input.bestNextAction),
          input.intentTags ? JSON.stringify(input.intentTags) : null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          occurredAt,
          createdAt,
        );
      return { interactionId };
    });
  }

  completeOpenFollowupTasks(
    contactId: string,
    status: Exclude<FollowupTaskStatus, "open"> = "done",
  ): {
    contactId: string;
    updatedCount: number;
    status: Exclude<FollowupTaskStatus, "open">;
  } {
    this.getContactRow(contactId);
    const updatedAt = nowIso();
    const result = this.db
      .prepare(`
        UPDATE followup_tasks
        SET status = ?, updated_at = ?
        WHERE contact_id = ?
          AND status = 'open'
      `)
      .run(status, updatedAt, contactId);
    return {
      contactId,
      updatedCount: Number(result.changes ?? 0),
      status,
    };
  }

  upsertSegment(input: UpsertSegmentInput): {
    segmentId: string;
    displayName: string;
    definition: SegmentDefinition;
  } {
    return this.withTransaction(() => {
      const displayName = normalizeWhitespace(input.displayName);
      if (!displayName) {
        throw new Error("Segment displayName is required");
      }

      const now = nowIso();
      const definition = normalizeSegmentDefinition(input.definition);
      const existing = input.segmentId
        ? (this.db
            .prepare("SELECT segment_id FROM segments WHERE segment_id = ?")
            .get(input.segmentId) as { segment_id?: string } | undefined)
        : undefined;
      const segmentId = existing?.segment_id ?? input.segmentId ?? randomUUID();

      this.db
        .prepare(`
          INSERT INTO segments (
            segment_id,
            display_name,
            definition_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(segment_id) DO UPDATE SET
            display_name = excluded.display_name,
            definition_json = excluded.definition_json,
            updated_at = excluded.updated_at
        `)
        .run(segmentId, displayName, JSON.stringify(definition), now, now);

      return { segmentId, displayName, definition };
    });
  }

  refreshSegment(input: RefreshSegmentInput): {
    segmentId: string;
    displayName: string;
    definition: SegmentDefinition;
    membershipCount: number;
    members: Array<Record<string, unknown>>;
  } {
    return this.withTransaction(() => {
      const segment = this.getSegmentRow(input.segmentId);
      const definition = parseSegmentDefinition(segment.definition_json);
      const calculatedAt = nowIso();
      const candidates = this.db
        .prepare(`
          SELECT
            c.contact_id,
            c.display_name,
            c.city,
            c.birthday,
            c.quality_tier,
            (
              SELECT overall_score
              FROM contact_score_snapshots css
              WHERE css.contact_id = c.contact_id
              ORDER BY css.created_at DESC
              LIMIT 1
            ) AS latest_score,
            (
              SELECT MAX(ih.occurred_at)
              FROM interaction_history ih
              WHERE ih.contact_id = c.contact_id
            ) AS last_interaction_at
          FROM contacts c
        `)
        .all() as SegmentCandidateRow[];
      const tagRows = this.db
        .prepare(`
          SELECT ctl.contact_id, t.normalized_name
          FROM contact_tag_links ctl
          JOIN tags t ON t.tag_id = ctl.tag_id
        `)
        .all() as Array<{ contact_id: string; normalized_name: string }>;
      const tagsByContact = new Map<string, string[]>();
      for (const row of tagRows) {
        const list = tagsByContact.get(row.contact_id) ?? [];
        list.push(row.normalized_name);
        tagsByContact.set(row.contact_id, list);
      }

      this.db.prepare("DELETE FROM segment_memberships WHERE segment_id = ?").run(input.segmentId);
      const insert = this.db.prepare(`
        INSERT INTO segment_memberships (
          segment_id,
          contact_id,
          reason,
          calculated_at
        ) VALUES (?, ?, ?, ?)
      `);

      const members: Array<Record<string, unknown>> = [];
      for (const candidate of candidates) {
        const tags = [...new Set(tagsByContact.get(candidate.contact_id) ?? [])];
        const tagSet = new Set(tags);
        const reasons: string[] = [];

        if (definition.city) {
          if (normalizeLower(candidate.city ?? "") !== normalizeLower(definition.city)) {
            continue;
          }
          reasons.push(`city=${normalizeLower(definition.city)}`);
        }

        if (definition.qualityTier) {
          if (candidate.quality_tier !== definition.qualityTier) {
            continue;
          }
          reasons.push(`qualityTier=${definition.qualityTier}`);
        }

        if (definition.tagsAny && definition.tagsAny.length > 0) {
          const matched = definition.tagsAny.filter((tag) => tagSet.has(tag));
          if (matched.length === 0) {
            continue;
          }
          reasons.push(`tagsAny=${matched.join(",")}`);
        }

        if (definition.tagsAll && definition.tagsAll.length > 0) {
          const missing = definition.tagsAll.filter((tag) => !tagSet.has(tag));
          if (missing.length > 0) {
            continue;
          }
          reasons.push(`tagsAll=${definition.tagsAll.join(",")}`);
        }

        if (definition.minOverallScore !== undefined) {
          if (
            typeof candidate.latest_score !== "number" ||
            candidate.latest_score < definition.minOverallScore
          ) {
            continue;
          }
          reasons.push(`score>=${definition.minOverallScore}`);
        }

        if (definition.maxOverallScore !== undefined) {
          if (
            typeof candidate.latest_score !== "number" ||
            candidate.latest_score > definition.maxOverallScore
          ) {
            continue;
          }
          reasons.push(`score<=${definition.maxOverallScore}`);
        }

        const daysSinceLastInteraction = daysSinceTimestamp(candidate.last_interaction_at);
        if (definition.minDaysSinceLastInteraction !== undefined) {
          const effectiveDays = daysSinceLastInteraction ?? Number.POSITIVE_INFINITY;
          if (effectiveDays < definition.minDaysSinceLastInteraction) {
            continue;
          }
          reasons.push(`daysSinceLastInteraction>=${definition.minDaysSinceLastInteraction}`);
        }

        if (definition.maxDaysSinceLastInteraction !== undefined) {
          if (
            daysSinceLastInteraction === null ||
            daysSinceLastInteraction > definition.maxDaysSinceLastInteraction
          ) {
            continue;
          }
          reasons.push(`daysSinceLastInteraction<=${definition.maxDaysSinceLastInteraction}`);
        }

        if (definition.birthdayWithinDays !== undefined) {
          const daysUntilBirthday = daysUntilNextBirthday(candidate.birthday);
          if (daysUntilBirthday === null || daysUntilBirthday > definition.birthdayWithinDays) {
            continue;
          }
          reasons.push(`birthdayWithinDays<=${definition.birthdayWithinDays}`);
        }

        const reason = reasons.join("; ") || "matched segment definition";
        insert.run(input.segmentId, candidate.contact_id, reason, calculatedAt);
        members.push({
          contactId: candidate.contact_id,
          displayName: candidate.display_name,
          city: candidate.city,
          qualityTier: candidate.quality_tier,
          latestScore: candidate.latest_score,
          lastInteractionAt: candidate.last_interaction_at,
          tags,
          reason,
        });
      }

      members.sort((left, right) => {
        const leftScore =
          typeof left.latestScore === "number" ? left.latestScore : Number.NEGATIVE_INFINITY;
        const rightScore =
          typeof right.latestScore === "number" ? right.latestScore : Number.NEGATIVE_INFINITY;
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }
        return String(left.displayName).localeCompare(String(right.displayName));
      });

      return {
        segmentId: segment.segment_id,
        displayName: segment.display_name,
        definition,
        membershipCount: members.length,
        members,
      };
    });
  }

  importContactsFromCsv(input: ImportCsvInput): {
    ingestJobId: string;
    source: IngestSource;
    fileName: string | null;
    stats: Record<string, number>;
    items: Array<Record<string, unknown>>;
  } {
    const ingestJob = this.createIngestJob({
      source: "csv",
      sourceLabel: input.sourceLabel,
      fileName: input.fileName,
      initiatedBy: input.initiatedBy,
    });
    const rows = parseCsvRows(input.csvText);
    const stats = {
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };
    const items: Array<Record<string, unknown>> = [];

    try {
      for (const row of rows) {
        const mapped = mapCsvRowToContactInput(row.values);
        if (!mapped.input) {
          stats.skipped += 1;
          const item = {
            rowNumber: row.rowNumber,
            action: "skipped",
            externalId: mapped.externalId ?? null,
            error: mapped.skipReason ?? "Row did not contain importable contact data.",
          } satisfies Record<string, unknown>;
          items.push(item);
          this.appendIngestJobItem({
            ingestJobId: ingestJob.ingestJobId,
            rowNumber: row.rowNumber,
            externalId: mapped.externalId,
            action: "skipped",
            rawPayload: row.values,
            errorText: mapped.skipReason,
          });
          continue;
        }

        try {
          const preparedInput = this.prepareImportedContactInput({
            ...mapped.input,
            createdBy: input.initiatedBy,
          });
          const result = this.upsertContact(preparedInput);
          stats[result.action] += 1;
          const item = {
            rowNumber: row.rowNumber,
            action: result.action,
            contactId: result.contactId,
            displayName: result.displayName,
            externalId: mapped.externalId ?? null,
          } satisfies Record<string, unknown>;
          items.push(item);
          this.appendIngestJobItem({
            ingestJobId: ingestJob.ingestJobId,
            rowNumber: row.rowNumber,
            externalId: mapped.externalId,
            action: result.action,
            resolvedContactId: result.contactId,
            rawPayload: row.values,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          stats.failed += 1;
          const item = {
            rowNumber: row.rowNumber,
            action: "failed",
            externalId: mapped.externalId ?? null,
            error: message,
          } satisfies Record<string, unknown>;
          items.push(item);
          this.appendIngestJobItem({
            ingestJobId: ingestJob.ingestJobId,
            rowNumber: row.rowNumber,
            externalId: mapped.externalId,
            action: "failed",
            rawPayload: row.values,
            errorText: message,
          });
        }
      }

      this.finishIngestJob({
        ingestJobId: ingestJob.ingestJobId,
        status: "completed",
        stats,
      });

      return {
        ingestJobId: ingestJob.ingestJobId,
        source: "csv",
        fileName: maybeString(input.fileName),
        stats,
        items,
      };
    } catch (err) {
      this.finishIngestJob({
        ingestJobId: ingestJob.ingestJobId,
        status: "failed",
        stats,
      });
      throw err;
    }
  }

  importContactsFromCsvFile(params: { csvPath: string; initiatedBy?: string }): {
    ingestJobId: string;
    source: IngestSource;
    fileName: string | null;
    stats: Record<string, number>;
    items: Array<Record<string, unknown>>;
  } {
    const csvText = fs.readFileSync(params.csvPath, "utf8");
    return this.importContactsFromCsv({
      csvText,
      fileName: path.basename(params.csvPath),
      sourceLabel: params.csvPath,
      initiatedBy: params.initiatedBy,
    });
  }

  importManychatPayload(input: ImportManychatInput): {
    ingestJobId: string;
    source: IngestSource;
    fileName: string | null;
    contactId: string | null;
    externalContactId: string | null;
    stats: Record<string, number>;
    items: Array<Record<string, unknown>>;
  } {
    const ingestJob = this.createIngestJob({
      source: "manychat",
      sourceLabel: input.sourceLabel,
      fileName: input.fileName,
      initiatedBy: input.initiatedBy,
    });
    const stats = {
      contactsCreated: 0,
      contactsUpdated: 0,
      contactsSkipped: 0,
      contactsFailed: 0,
      messagesImported: 0,
      interactionsLogged: 0,
    };
    const items: Array<Record<string, unknown>> = [];

    try {
      const parsed = parseManychatPayload(input.payload);
      if (!parsed.input) {
        stats.contactsSkipped += 1;
        const item = {
          action: "skipped",
          externalId: parsed.externalContactId ?? null,
          error: parsed.skipReason ?? "ManyChat payload did not contain an importable contact.",
        } satisfies Record<string, unknown>;
        items.push(item);
        this.appendIngestJobItem({
          ingestJobId: ingestJob.ingestJobId,
          externalId: parsed.externalContactId,
          action: "skipped",
          rawPayload: parsed.metadata,
          errorText: parsed.skipReason,
        });
        this.finishIngestJob({
          ingestJobId: ingestJob.ingestJobId,
          status: "completed",
          stats,
        });
        return {
          ingestJobId: ingestJob.ingestJobId,
          source: "manychat",
          fileName: maybeString(input.fileName),
          contactId: null,
          externalContactId: parsed.externalContactId ?? null,
          stats,
          items,
        };
      }

      const preparedInput = this.prepareImportedContactInput({
        ...parsed.input,
        createdBy: input.initiatedBy,
      });
      const contact = this.upsertContact(preparedInput);
      if (contact.action === "created") {
        stats.contactsCreated += 1;
      } else {
        stats.contactsUpdated += 1;
      }
      const contactItem = {
        action: contact.action,
        contactId: contact.contactId,
        displayName: contact.displayName,
        externalId: parsed.externalContactId ?? null,
        messageCount: parsed.messages.length,
      } satisfies Record<string, unknown>;
      items.push(contactItem);
      this.appendIngestJobItem({
        ingestJobId: ingestJob.ingestJobId,
        externalId: parsed.externalContactId,
        action: contact.action,
        resolvedContactId: contact.contactId,
        rawPayload: parsed.metadata,
      });

      for (const message of parsed.messages) {
        const occurredAt = message.occurredAt ?? nowIso();
        const stableMessageId =
          maybeString(message.externalMessageId) ??
          buildStableImportId("manychat-message", [
            parsed.externalContactId,
            message.externalThreadId,
            message.direction,
            occurredAt,
            message.content,
          ]);
        const interactionId = buildStableImportId("manychat-interaction", [
          parsed.externalContactId,
          message.externalThreadId,
          stableMessageId,
          message.direction,
        ]);
        const interactionKind: InteractionKind =
          message.direction === "inbound" ? "reply" : "outreach";
        const summaryPrefix =
          message.direction === "inbound" ? "ManyChat inbound" : "ManyChat outbound";
        const summary = `${summaryPrefix}: ${message.content.slice(0, 120)}`;

        this.logInteraction({
          interactionId,
          contactId: contact.contactId,
          channel: "manychat",
          logicalChannel: contactHasIdentityChannel(
            (preparedInput.identities ?? []).map((identity) => ({ channel: identity.channel })),
            "instagram",
          )
            ? "instagram"
            : "manychat",
          transport: "manychat",
          conversationRole: "crm",
          kind: interactionKind,
          direction: message.direction,
          actorRole: message.direction === "inbound" ? "contact" : "user",
          authorshipMode: "connector_import",
          summary,
          occurredAt,
          conversationExternalId: message.externalThreadId ?? parsed.externalThreadId,
          messageExternalId: stableMessageId,
          messageStatus: message.status,
          content: message.content,
          metadata: {
            ...parsed.metadata,
            manychat_message: message.metadata ?? null,
          },
        });
        stats.messagesImported += 1;
        stats.interactionsLogged += 1;

        const messageItem = {
          action: "updated",
          contactId: contact.contactId,
          externalId: stableMessageId,
          direction: message.direction,
          occurredAt,
        } satisfies Record<string, unknown>;
        items.push(messageItem);
        this.appendIngestJobItem({
          ingestJobId: ingestJob.ingestJobId,
          externalId: stableMessageId,
          action: "updated",
          resolvedContactId: contact.contactId,
          rawPayload: {
            ...parsed.metadata,
            message: message.metadata ?? {
              externalMessageId: stableMessageId,
              externalThreadId: message.externalThreadId ?? parsed.externalThreadId ?? null,
              direction: message.direction,
              status: message.status ?? null,
              content: message.content,
              occurredAt,
            },
          },
        });
      }

      this.finishIngestJob({
        ingestJobId: ingestJob.ingestJobId,
        status: "completed",
        stats,
      });

      return {
        ingestJobId: ingestJob.ingestJobId,
        source: "manychat",
        fileName: maybeString(input.fileName),
        contactId: contact.contactId,
        externalContactId: parsed.externalContactId ?? null,
        stats,
        items,
      };
    } catch (err) {
      stats.contactsFailed += 1;
      this.finishIngestJob({
        ingestJobId: ingestJob.ingestJobId,
        status: "failed",
        stats,
      });
      throw err;
    }
  }

  importManychatPayloadFile(params: { jsonPath: string; initiatedBy?: string }): {
    ingestJobId: string;
    source: IngestSource;
    fileName: string | null;
    contactId: string | null;
    externalContactId: string | null;
    stats: Record<string, number>;
    items: Array<Record<string, unknown>>;
  } {
    const raw = fs.readFileSync(params.jsonPath, "utf8");
    const payload = JSON.parse(raw) as unknown;
    return this.importManychatPayload({
      payload,
      fileName: path.basename(params.jsonPath),
      sourceLabel: params.jsonPath,
      initiatedBy: params.initiatedBy,
    });
  }

  importBlueBubblesPayload(input: ImportBlueBubblesInput): {
    ingestJobId: string;
    source: IngestSource;
    fileName: string | null;
    contactsImported: number;
    stats: Record<string, number>;
    items: Array<Record<string, unknown>>;
  } {
    const ingestJob = this.createIngestJob({
      source: "imessage",
      sourceLabel: input.sourceLabel,
      fileName: input.fileName,
      initiatedBy: input.initiatedBy,
    });
    const stats = {
      contactsCreated: 0,
      contactsUpdated: 0,
      contactsSkipped: 0,
      contactsFailed: 0,
      messagesImported: 0,
      interactionsLogged: 0,
    };
    const items: Array<Record<string, unknown>> = [];

    try {
      const messageDrafts = parseBlueBubblesMessageQueryPayload(input.payload);
      const messageKeys = new Set(
        messageDrafts.map((draft) => draft.externalThreadId || draft.externalContactId || ""),
      );
      const chatDrafts = input.chatPayload
        ? parseBlueBubblesChatQueryPayload(input.chatPayload).filter((draft) => {
            const key = draft.externalThreadId || draft.externalContactId || "";
            return key ? !messageKeys.has(key) : true;
          })
        : [];
      const drafts = [...messageDrafts, ...chatDrafts];
      for (const draft of drafts) {
        if (!draft.input) {
          stats.contactsSkipped += 1;
          continue;
        }

        const preparedInput = this.prepareImportedContactInput({
          ...draft.input,
          createdBy: input.initiatedBy,
        });
        const contact = this.upsertContact(preparedInput);
        if (contact.action === "created") {
          stats.contactsCreated += 1;
        } else {
          stats.contactsUpdated += 1;
        }

        items.push({
          action: contact.action,
          contactId: contact.contactId,
          displayName: contact.displayName,
          externalId: draft.externalContactId ?? null,
          threadId: draft.externalThreadId ?? null,
          messageCount: draft.messages.length,
        });
        this.appendIngestJobItem({
          ingestJobId: ingestJob.ingestJobId,
          externalId: draft.externalContactId ?? draft.externalThreadId,
          action: contact.action,
          resolvedContactId: contact.contactId,
          rawPayload: draft.metadata,
        });

        for (const message of draft.messages) {
          const occurredAt = message.occurredAt ?? nowIso();
          const stableMessageId =
            maybeString(message.externalMessageId) ??
            buildStableImportId("bluebubbles-message", [
              draft.externalContactId,
              draft.externalThreadId,
              message.direction,
              occurredAt,
              message.content,
            ]);
          const interactionId = buildStableImportId("bluebubbles-interaction", [
            draft.externalThreadId,
            stableMessageId,
            message.direction,
          ]);

          this.logInteraction({
            interactionId,
            contactId: contact.contactId,
            channel: "imessage",
            logicalChannel: "imessage",
            transport: "bluebubbles",
            conversationRole: "crm",
            kind: message.direction === "inbound" ? "reply" : "outreach",
            direction: message.direction,
            actorRole: message.direction === "inbound" ? "contact" : "user",
            authorshipMode: "connector_import",
            summary: `BlueBubbles ${message.direction}: ${message.content.slice(0, 120)}`,
            occurredAt,
            conversationExternalId: message.externalThreadId ?? draft.externalThreadId,
            messageExternalId: stableMessageId,
            messageStatus: message.status,
            content: message.content,
            metadata: {
              ...draft.metadata,
              bluebubbles_message: message.metadata ?? null,
            },
          });
          stats.messagesImported += 1;
          stats.interactionsLogged += 1;
        }
      }

      this.finishIngestJob({
        ingestJobId: ingestJob.ingestJobId,
        status: "completed",
        stats,
      });

      return {
        ingestJobId: ingestJob.ingestJobId,
        source: "imessage",
        fileName: maybeString(input.fileName),
        contactsImported: stats.contactsCreated + stats.contactsUpdated,
        stats,
        items,
      };
    } catch (err) {
      stats.contactsFailed += 1;
      this.finishIngestJob({
        ingestJobId: ingestJob.ingestJobId,
        status: "failed",
        stats,
      });
      throw err;
    }
  }

  logBlueBubblesLiveMessage(input: {
    accountId?: string;
    senderAddress: string;
    senderDisplayName?: string;
    externalThreadId: string;
    externalMessageId?: string;
    direction: Direction;
    occurredAt?: string;
    status?: string;
    content: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
  }): {
    contactId: string;
    conversationId: string | null;
    interactionId: string;
    messageAction: "created" | "updated" | null;
  } {
    const preparedContact = buildBlueBubblesContactInput({
      address: input.senderAddress,
      displayName: input.senderDisplayName?.trim() || input.senderAddress,
    });
    if (!preparedContact) {
      throw new Error("BlueBubbles live message requires a sender address.");
    }
    const contact = this.upsertContact({
      ...preparedContact,
      createdBy: input.createdBy,
    });
    const occurredAt = input.occurredAt ?? nowIso();
    const stableMessageId =
      maybeString(input.externalMessageId) ??
      buildStableImportId("bluebubbles-live-message", [
        input.accountId,
        input.senderAddress,
        input.externalThreadId,
        input.direction,
        occurredAt,
        input.content,
      ]);
    const interactionId = buildStableImportId("bluebubbles-live-interaction", [
      input.accountId,
      input.externalThreadId,
      stableMessageId,
      input.direction,
    ]);
    this.logInteraction({
      interactionId,
      contactId: contact.contactId,
      channel: "imessage",
      logicalChannel: "imessage",
      transport: "bluebubbles",
      conversationRole: "crm",
      kind: input.direction === "inbound" ? "reply" : "outreach",
      direction: input.direction,
      actorRole: input.direction === "inbound" ? "contact" : "user",
      authorshipMode: input.direction === "inbound" ? "connector_import" : "manual_user",
      summary: `BlueBubbles ${input.direction}: ${input.content.slice(0, 120)}`,
      occurredAt,
      conversationExternalId: input.externalThreadId,
      messageExternalId: stableMessageId,
      messageStatus: input.status,
      content: input.content,
      metadata: {
        source: "bluebubbles-live",
        accountId: input.accountId,
        ...(input.metadata ?? {}),
      },
    });
    const thread = this.getConversationThread({
      contactId: contact.contactId,
      channel: "imessage",
      limit: 1,
    });
    const messages = Array.isArray(thread.messages)
      ? (thread.messages as Array<Record<string, unknown>>)
      : [];
    const latestMessage =
      messages.find((entry) => entry.externalMessageId === stableMessageId) ??
      messages.find((entry) => entry.content === input.content);
    return {
      contactId: contact.contactId,
      conversationId:
        typeof (thread.conversation as Record<string, unknown>)?.conversationId === "string"
          ? ((thread.conversation as Record<string, unknown>).conversationId as string)
          : null,
      interactionId,
      messageAction:
        typeof latestMessage?.messageAction === "string"
          ? (latestMessage.messageAction as "created" | "updated")
          : null,
    };
  }

  rankFollowups(input: RankFollowupsInput): {
    refreshedAt: string;
    minDaysSinceLastInteraction: number;
    taskCount: number;
    tasks: Array<Record<string, unknown>>;
  } {
    return this.withTransaction(() => {
      const refreshedAt = nowIso();
      const minDaysSinceLastInteraction = Math.max(
        0,
        Math.min(input.minDaysSinceLastInteraction ?? 7, 365),
      );
      const limit = Math.max(1, Math.min(input.limit ?? 25, 100));

      this.db
        .prepare(`
          DELETE FROM followup_tasks
          WHERE source = 'rules' AND status = 'open'
        `)
        .run();

      const candidates = this.db
        .prepare(`
          SELECT
            c.contact_id,
            c.display_name,
            c.quality_tier,
            c.manual_score_override,
            (
              SELECT overall_score
              FROM contact_score_snapshots css
              WHERE css.contact_id = c.contact_id
              ORDER BY css.created_at DESC
              LIMIT 1
            ) AS latest_score,
            (
              SELECT MAX(ih.occurred_at)
              FROM interaction_history ih
              WHERE ih.contact_id = c.contact_id
            ) AS last_interaction_at,
            (
              SELECT best_next_action
              FROM interaction_history ih
              WHERE ih.contact_id = c.contact_id
                AND ih.best_next_action IS NOT NULL
                AND TRIM(ih.best_next_action) <> ''
              ORDER BY ih.occurred_at DESC
              LIMIT 1
            ) AS last_best_next_action
          FROM contacts c
        `)
        .all() as FollowupCandidateRow[];

      const insert = this.db.prepare(`
        INSERT INTO followup_tasks (
          followup_task_id,
          contact_id,
          event_id,
          campaign_id,
          source,
          status,
          priority,
          recommended_action,
          reason,
          due_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const candidate of candidates) {
        const effectiveScore =
          maybeNumber(candidate.manual_score_override) ?? maybeNumber(candidate.latest_score) ?? 0;
        const daysSinceLastInteraction = daysSinceTimestamp(candidate.last_interaction_at);
        const nextInvite = this.getNextInvite(candidate.contact_id);
        const reasons: string[] = [];
        let recommendedAction = normalizeWhitespace(candidate.last_best_next_action ?? "");
        let priority = Math.max(0, Math.min(100, effectiveScore * 0.55));
        let dueAt: string | null = null;
        let relatedEventId: string | null = null;
        let relatedCampaignId: string | null = null;

        if (candidate.quality_tier === "vip") {
          priority += 20;
          reasons.push("qualityTier=vip");
        } else if (candidate.quality_tier === "regular") {
          priority += 10;
          reasons.push("qualityTier=regular");
        }

        if (nextInvite) {
          const eventDate = new Date(nextInvite.starts_at);
          const hoursUntilEvent = Number.isNaN(eventDate.getTime())
            ? null
            : Math.floor((eventDate.getTime() - Date.now()) / 3_600_000);
          relatedEventId = nextInvite.event_id;
          relatedCampaignId = nextInvite.campaign_id;
          dueAt =
            hoursUntilEvent !== null && hoursUntilEvent <= 48 ? refreshedAt : nextInvite.starts_at;
          priority += 20;
          reasons.push(`upcomingEvent=${nextInvite.event_name}`);
          reasons.push(`inviteStatus=${nextInvite.invite_status}`);
          if (!recommendedAction) {
            if (
              nextInvite.invite_status === "confirmed" &&
              hoursUntilEvent !== null &&
              hoursUntilEvent <= 48
            ) {
              recommendedAction = "confirm_arrival";
            } else if (
              nextInvite.invite_status === "tentative" ||
              nextInvite.rsvp_status === "maybe"
            ) {
              recommendedAction = "confirm_rsvp";
            } else {
              recommendedAction = "send_invite_follow_up";
            }
          }
        }

        if (daysSinceLastInteraction === null) {
          priority += 15;
          reasons.push("noPriorInteraction");
          if (!recommendedAction) {
            recommendedAction = "introduce_contact";
          }
        } else if (daysSinceLastInteraction >= minDaysSinceLastInteraction) {
          priority += Math.min(daysSinceLastInteraction * 2, 25);
          reasons.push(`daysSinceLastInteraction=${daysSinceLastInteraction}`);
          if (!recommendedAction) {
            recommendedAction = "reactivate_contact";
          }
        }

        if (!recommendedAction) {
          continue;
        }

        if (reasons.length === 0) {
          reasons.push("bestNextActionAvailable");
        }

        insert.run(
          randomUUID(),
          candidate.contact_id,
          relatedEventId,
          relatedCampaignId,
          "rules",
          "open",
          Math.max(0, Math.min(100, Math.round(priority))),
          recommendedAction,
          reasons.join("; "),
          dueAt,
          refreshedAt,
          refreshedAt,
        );
      }

      const tasks = this.db
        .prepare(`
          SELECT
            ft.followup_task_id,
            ft.contact_id,
            c.display_name AS contact_name,
            c.quality_tier,
            ft.event_id,
            e.display_name AS event_name,
            ft.campaign_id,
            cp.display_name AS campaign_name,
            ft.priority,
            ft.recommended_action,
            ft.reason,
            ft.due_at,
            ft.created_at,
            ft.updated_at
          FROM followup_tasks ft
          JOIN contacts c ON c.contact_id = ft.contact_id
          LEFT JOIN events e ON e.event_id = ft.event_id
          LEFT JOIN campaigns cp ON cp.campaign_id = ft.campaign_id
          WHERE ft.status = 'open'
          ORDER BY ft.priority DESC, COALESCE(ft.due_at, ft.created_at) ASC, c.display_name ASC
          LIMIT ?
        `)
        .all(limit) as Array<Record<string, unknown>>;

      return {
        refreshedAt,
        minDaysSinceLastInteraction,
        taskCount: tasks.length,
        tasks,
      };
    });
  }

  getVenueAttendance(input: GetVenueAttendanceInput): {
    venue: Record<string, unknown>;
    attendees: Array<Record<string, unknown>>;
  } {
    const venue = this.db
      .prepare(`
        SELECT venue_id, display_name, city, neighborhood, audience_type, vibe
        FROM venues
        WHERE venue_id = ?
      `)
      .get(input.venueId) as Record<string, unknown> | undefined;
    if (!venue) {
      throw new Error(`Venue not found: ${input.venueId}`);
    }

    const filters: string[] = ["venue_id = ?"];
    const params: Array<string | number> = [input.venueId];
    if (input.attendanceResult) {
      filters.push("attendance_result = ?");
      params.push(input.attendanceResult);
    }
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    params.push(limit);

    const attendees = this.db
      .prepare(`
        SELECT
          contact_id,
          contact_name,
          event_id,
          event_name,
          starts_at,
          invite_id,
          invite_status,
          rsvp_status,
          attendance_result,
          spend_amount,
          brought_guest_count,
          table_outcome,
          contribution_summary,
          note
        FROM venue_attendance_history
        WHERE ${filters.join(" AND ")}
        ORDER BY
          starts_at DESC,
          CASE attendance_result
            WHEN 'attended' THEN 0
            WHEN 'late' THEN 1
            WHEN 'flaked' THEN 2
            ELSE 3
          END,
          contact_name ASC
        LIMIT ?
      `)
      .all(...params) as Array<Record<string, unknown>>;

    return { venue, attendees };
  }

  private listContactIdentities(contactId: string): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(`
        SELECT
          identity_id,
          channel,
          external_id,
          handle,
          email,
          phone_e164,
          profile_url,
          reply_url,
          avatar_url,
          identity_role,
          source,
          is_primary,
          confidence,
          updated_at
        FROM contact_identities
        WHERE contact_id = ?
        ORDER BY is_primary DESC, updated_at DESC
      `)
      .all(contactId) as Array<Record<string, unknown>>;
    return rows;
  }

  private listContactTags(contactId: string): string[] {
    const rows = this.db
      .prepare(`
        SELECT t.display_name
        FROM contact_tag_links ctl
        JOIN tags t ON t.tag_id = ctl.tag_id
        WHERE ctl.contact_id = ?
        ORDER BY t.display_name ASC
      `)
      .all(contactId) as Array<{ display_name: string }>;
    return rows.map((row) => row.display_name);
  }

  private listContactPreferences(contactId: string): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(`
        SELECT category, preference, value
        FROM contact_preferences
        WHERE contact_id = ?
        ORDER BY category ASC, preference ASC, value ASC
      `)
      .all(contactId) as Array<Record<string, unknown>>;
    return rows;
  }

  private listOpenFollowupTasks(contactId: string, limit = 3): Array<Record<string, unknown>> {
    const effectiveLimit = Math.max(1, Math.min(limit, 25));
    return this.db
      .prepare(`
        SELECT
          followup_task_id,
          event_id,
          campaign_id,
          source,
          status,
          priority,
          recommended_action,
          reason,
          due_at,
          created_at,
          updated_at
        FROM followup_tasks
        WHERE contact_id = ?
          AND status = 'open'
        ORDER BY priority DESC, COALESCE(due_at, created_at) ASC
        LIMIT ?
      `)
      .all(contactId, effectiveLimit) as Array<Record<string, unknown>>;
  }

  private findConversationInboxRow(input: {
    conversationId?: string;
    contactId?: string;
    channel?: IdentityChannel;
  }): InboxConversationRow | null {
    const resolvedConversationId = input.conversationId
      ? this.resolveFlexibleConversationId(input.conversationId)
      : null;
    const resolvedContactId = input.contactId
      ? this.resolveFlexibleContactId(input.contactId)
      : null;
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (resolvedConversationId) {
      filters.push("ci.conversation_id = ?");
      params.push(resolvedConversationId);
    } else if (resolvedContactId) {
      filters.push("ci.contact_id = ?");
      params.push(resolvedContactId);
      if (input.channel) {
        if (input.channel === "instagram") {
          filters.push("COALESCE(ci.logical_channel, ci.channel) = ?");
          params.push("instagram");
        } else if (input.channel === "manychat") {
          filters.push("COALESCE(ci.transport, ci.channel) = ?");
          params.push("manychat");
        } else {
          filters.push("COALESCE(ci.logical_channel, ci.channel) = ?");
          params.push(input.channel);
        }
      }
    } else {
      throw new Error("Conversation lookup requires conversationId or contactId");
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;
    const row = this.db
      .prepare(`
        SELECT
          ci.conversation_id,
          ci.contact_id,
          ci.contact_name,
          c.quality_tier,
          (
            SELECT overall_score
            FROM contact_score_snapshots css
            WHERE css.contact_id = ci.contact_id
            ORDER BY css.created_at DESC
            LIMIT 1
          ) AS latest_score,
          ci.channel,
          ci.logical_channel,
          ci.transport,
          ci.conversation_role,
          ci.external_thread_id,
          ci.conversation_status,
          ci.started_at,
          ci.last_message_at,
          ci.last_message_id,
          ci.last_message_direction,
          ci.last_message_status,
          ci.last_message_content,
          ci.last_message_sent_at,
          ci.last_inbound_message_id,
          ci.last_inbound_content,
          ci.last_inbound_at,
          ci.last_outbound_message_id,
          ci.last_outbound_content,
          ci.last_outbound_at,
          ci.total_message_count,
          ci.inbound_message_count,
          ci.outbound_message_count
        FROM conversation_inbox ci
        JOIN contacts c ON c.contact_id = ci.contact_id
        ${whereClause}
        ORDER BY COALESCE(ci.last_inbound_at, ci.last_message_sent_at, ci.last_message_at) DESC
        LIMIT 1
      `)
      .get(...params) as InboxConversationRow | undefined;
    return row ?? null;
  }

  getRecentInbox(input: RecentInboxInput): {
    refreshedAt: string;
    conversations: Array<Record<string, unknown>>;
  } {
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (input.channel) {
      if (input.channel === "instagram") {
        filters.push("COALESCE(ci.logical_channel, ci.channel) = ?");
        params.push("instagram");
      } else if (input.channel === "manychat") {
        filters.push("COALESCE(ci.transport, ci.channel) = ?");
        params.push("manychat");
      } else {
        filters.push("COALESCE(ci.logical_channel, ci.channel) = ?");
        params.push(input.channel);
      }
    }

    if (input.onlyNeedsReply) {
      filters.push("ci.last_message_direction = 'inbound'");
    }

    if (typeof input.sinceHours === "number" && Number.isFinite(input.sinceHours)) {
      const boundedHours = Math.max(0, Math.min(input.sinceHours, 24 * 30));
      const threshold = new Date(Date.now() - boundedHours * 3_600_000).toISOString();
      filters.push(
        "COALESCE(ci.last_inbound_at, ci.last_message_sent_at, ci.last_message_at) >= ?",
      );
      params.push(threshold);
    }

    const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
    params.push(limit);
    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const rows = this.db
      .prepare(`
        SELECT
          ci.conversation_id,
          ci.contact_id,
          ci.contact_name,
          c.quality_tier,
          (
            SELECT overall_score
            FROM contact_score_snapshots css
            WHERE css.contact_id = ci.contact_id
            ORDER BY css.created_at DESC
            LIMIT 1
          ) AS latest_score,
          ci.channel,
          ci.logical_channel,
          ci.transport,
          ci.conversation_role,
          ci.external_thread_id,
          ci.conversation_status,
          ci.started_at,
          ci.last_message_at,
          ci.last_message_id,
          ci.last_message_direction,
          ci.last_message_status,
          ci.last_message_content,
          ci.last_message_sent_at,
          ci.last_inbound_message_id,
          ci.last_inbound_content,
          ci.last_inbound_at,
          ci.last_outbound_message_id,
          ci.last_outbound_content,
          ci.last_outbound_at,
          ci.total_message_count,
          ci.inbound_message_count,
          ci.outbound_message_count
        FROM conversation_inbox ci
        JOIN contacts c ON c.contact_id = ci.contact_id
        ${whereClause}
        ORDER BY
          COALESCE(ci.last_inbound_at, ci.last_message_sent_at, ci.last_message_at) DESC,
          ci.last_message_at DESC
        LIMIT ?
      `)
      .all(...params) as InboxConversationRow[];

    const conversations = rows.map((row) => {
      const lastMessage = presentMessageContent(row.last_message_content);
      const lastInboundMessage = presentMessageContent(row.last_inbound_content);
      const identities = this.listContactIdentities(row.contact_id);
      const openFollowupTasks = this.listOpenFollowupTasks(row.contact_id, 3);
      const channelContext = describeConversationChannelContext(
        identities,
        row.channel,
        input.channel,
        row.logical_channel,
        row.transport,
      );
      return {
        conversationId: row.conversation_id,
        contactId: row.contact_id,
        contactName: row.contact_name,
        channel: row.channel,
        matchedChannel: channelContext.matchedChannel,
        logicalChannel: channelContext.logicalChannel,
        transport: channelContext.transport,
        conversationRole: row.conversation_role ?? "crm",
        channelLabel: channelContext.channelLabel,
        externalThreadId: row.external_thread_id,
        status: row.conversation_status,
        qualityTier: row.quality_tier,
        latestScore: row.latest_score,
        startedAt: row.started_at,
        lastMessageAt: row.last_message_at,
        lastActivityAt: row.last_inbound_at ?? row.last_message_sent_at ?? row.last_message_at,
        needsReply: row.last_message_direction === "inbound",
        counts: {
          totalMessages: row.total_message_count,
          inboundMessages: row.inbound_message_count,
          outboundMessages: row.outbound_message_count,
        },
        lastMessage: {
          messageId: row.last_message_id,
          direction: row.last_message_direction,
          status: row.last_message_status,
          content: row.last_message_content,
          contentType: lastMessage.contentType,
          preview: lastMessage.preview,
          attachmentUrls: lastMessage.attachmentUrls,
          sentAt: row.last_message_sent_at ?? row.last_message_at,
        },
        lastInboundMessage: row.last_inbound_message_id
          ? {
              messageId: row.last_inbound_message_id,
              content: row.last_inbound_content,
              contentType: lastInboundMessage.contentType,
              preview: lastInboundMessage.preview,
              attachmentUrls: lastInboundMessage.attachmentUrls,
              sentAt: row.last_inbound_at,
            }
          : null,
        tags: this.listContactTags(row.contact_id),
        primaryIdentity: channelContext.primaryIdentity,
        replyUrl: channelContext.replyUrl,
        profileUrl: channelContext.profileUrl,
        openFollowupTasks,
      };
    });

    return {
      refreshedAt: nowIso(),
      conversations,
    };
  }

  private listContactConversationTabs(
    contactId: string,
    requestedChannel?: IdentityChannel,
  ): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(`
        SELECT
          ci.conversation_id,
          ci.contact_id,
          ci.contact_name,
          ci.channel,
          ci.logical_channel,
          ci.transport,
          ci.conversation_role,
          ci.external_thread_id,
          ci.conversation_status,
          ci.started_at,
          ci.last_message_at,
          ci.last_message_id,
          ci.last_message_direction,
          ci.last_message_status,
          ci.last_message_content,
          ci.last_message_sent_at,
          ci.last_inbound_message_id,
          ci.last_inbound_content,
          ci.last_inbound_at,
          ci.last_outbound_message_id,
          ci.last_outbound_content,
          ci.last_outbound_at,
          ci.total_message_count,
          ci.inbound_message_count,
          ci.outbound_message_count
        FROM conversation_inbox ci
        WHERE ci.contact_id = ?
        ORDER BY COALESCE(ci.last_inbound_at, ci.last_message_sent_at, ci.last_message_at) DESC
      `)
      .all(contactId) as InboxConversationRow[];
    const identities = this.listContactIdentities(contactId);

    return rows.map((row) => {
      const channelContext = describeConversationChannelContext(
        identities,
        row.channel,
        requestedChannel,
        row.logical_channel,
        row.transport,
      );
      const lastMessage = presentMessageContent(row.last_message_content);
      return {
        conversationId: row.conversation_id,
        channel: row.channel,
        matchedChannel: channelContext.matchedChannel,
        logicalChannel: channelContext.logicalChannel,
        transport: channelContext.transport,
        conversationRole: row.conversation_role ?? "crm",
        channelLabel: channelContext.channelLabel,
        lastActivityAt: row.last_inbound_at ?? row.last_message_sent_at ?? row.last_message_at,
        needsReply: row.last_message_direction === "inbound",
        replyUrl: channelContext.replyUrl,
        profileUrl: channelContext.profileUrl,
        counts: {
          totalMessages: row.total_message_count,
          inboundMessages: row.inbound_message_count,
          outboundMessages: row.outbound_message_count,
        },
        lastMessage: {
          messageId: row.last_message_id,
          direction: row.last_message_direction,
          status: row.last_message_status,
          content: row.last_message_content,
          contentType: lastMessage.contentType,
          preview: lastMessage.preview,
          attachmentUrls: lastMessage.attachmentUrls,
          sentAt: row.last_message_sent_at ?? row.last_message_at,
        },
      };
    });
  }

  getConversationThread(input: GetConversationThreadInput): {
    contact: Record<string, unknown>;
    identities: Array<Record<string, unknown>>;
    tags: string[];
    latestScore: LatestScoreRow | null;
    conversation: Record<string, unknown>;
    conversationTabs: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    interactions: Array<Record<string, unknown>>;
    followupTasks: Array<Record<string, unknown>>;
  } {
    const conversationRow = this.findConversationInboxRow(input);
    if (!conversationRow) {
      if (input.conversationId) {
        throw new Error(`Conversation not found: ${input.conversationId}`);
      }
      throw new Error("Conversation not found for the requested contact/channel");
    }

    const contact = this.getContactRow(conversationRow.contact_id);
    const latestScore = this.getLatestScore(conversationRow.contact_id);
    const identities = this.listContactIdentities(conversationRow.contact_id);
    const channelContext = describeConversationChannelContext(
      identities,
      conversationRow.channel,
      input.channel,
      conversationRow.logical_channel,
      conversationRow.transport,
    );
    const tags = this.listContactTags(conversationRow.contact_id);
    const followupTasks = this.listOpenFollowupTasks(conversationRow.contact_id, 10);
    const conversationTabs = this.listContactConversationTabs(
      conversationRow.contact_id,
      input.channel,
    );
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

    const messageRows = this.db
      .prepare(`
        SELECT
          message_id,
          external_message_id,
          direction,
          actor_role,
          authorship_mode,
          status,
          content,
          sent_at,
          metadata_json,
          created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY sent_at DESC, created_at DESC
        LIMIT ?
      `)
      .all(conversationRow.conversation_id, limit) as ConversationMessageRow[];
    const messages = [...messageRows].reverse().map((row) => {
      const metadata = parseJsonObject(row.metadata_json);
      const presentation = presentMessageContent(row.content);
      return {
        messageId: row.message_id,
        externalMessageId: row.external_message_id,
        direction: row.direction,
        actorRole: row.actor_role,
        authorshipMode: row.authorship_mode,
        status: row.status,
        content: row.content,
        contentType: presentation.contentType,
        preview: presentation.preview,
        attachmentUrls: presentation.attachmentUrls,
        sentAt: row.sent_at,
        createdAt: row.created_at,
        metadata,
      };
    });

    const interactions = this.db
      .prepare(`
        SELECT
          interaction_id,
          event_id,
          campaign_id,
          message_id,
          channel,
          kind,
          direction,
          sentiment,
          summary,
          outcome,
          best_next_action,
          intent_tags_json,
          metadata_json,
          occurred_at
        FROM interaction_history
        WHERE conversation_id = ?
        ORDER BY occurred_at DESC
        LIMIT 20
      `)
      .all(conversationRow.conversation_id)
      .map((row) => {
        const entry = row as Record<string, unknown> & {
          intent_tags_json?: string;
          metadata_json?: string;
        };
        return {
          ...entry,
          intent_tags: parseJsonArray(entry.intent_tags_json),
          metadata: parseJsonObject(entry.metadata_json),
        };
      });

    const lastMessage = presentMessageContent(conversationRow.last_message_content);
    const lastInboundMessage = presentMessageContent(conversationRow.last_inbound_content);

    return {
      contact: {
        contactId: contact.contact_id,
        displayName: contact.display_name,
        firstName: contact.first_name,
        lastName: contact.last_name,
        city: contact.city,
        birthday: contact.birthday,
        qualityTier: contact.quality_tier,
        manualScoreOverride: contact.manual_score_override,
        createdAt: contact.created_at,
        updatedAt: contact.updated_at,
      },
      identities,
      tags,
      latestScore,
      conversation: {
        conversationId: conversationRow.conversation_id,
        contactId: conversationRow.contact_id,
        channel: conversationRow.channel,
        matchedChannel: channelContext.matchedChannel,
        logicalChannel: channelContext.logicalChannel,
        transport: channelContext.transport,
        conversationRole: conversationRow.conversation_role ?? "crm",
        channelLabel: channelContext.channelLabel,
        externalThreadId: conversationRow.external_thread_id,
        status: conversationRow.conversation_status,
        startedAt: conversationRow.started_at,
        lastMessageAt: conversationRow.last_message_at,
        lastActivityAt:
          conversationRow.last_inbound_at ??
          conversationRow.last_message_sent_at ??
          conversationRow.last_message_at,
        needsReply: conversationRow.last_message_direction === "inbound",
        counts: {
          totalMessages: conversationRow.total_message_count,
          inboundMessages: conversationRow.inbound_message_count,
          outboundMessages: conversationRow.outbound_message_count,
        },
        lastMessage: {
          messageId: conversationRow.last_message_id,
          direction: conversationRow.last_message_direction,
          status: conversationRow.last_message_status,
          content: conversationRow.last_message_content,
          contentType: lastMessage.contentType,
          preview: lastMessage.preview,
          attachmentUrls: lastMessage.attachmentUrls,
          sentAt: conversationRow.last_message_sent_at ?? conversationRow.last_message_at,
        },
        lastInboundMessage: conversationRow.last_inbound_message_id
          ? {
              messageId: conversationRow.last_inbound_message_id,
              content: conversationRow.last_inbound_content,
              contentType: lastInboundMessage.contentType,
              preview: lastInboundMessage.preview,
              attachmentUrls: lastInboundMessage.attachmentUrls,
              sentAt: conversationRow.last_inbound_at,
            }
          : null,
        replyUrl: channelContext.replyUrl,
        profileUrl: channelContext.profileUrl,
      },
      conversationTabs,
      messages,
      interactions,
      followupTasks,
    };
  }

  resolveConversationReplyTarget(
    input: ResolveConversationReplyTargetInput,
  ): ResolvedConversationReplyTarget {
    if (!input.conversationId && !input.contactId) {
      throw new Error("Provide conversationId or contactId to resolve a CRM reply target.");
    }

    const thread = this.getConversationThread({
      conversationId: input.conversationId,
      contactId: input.contactId,
      channel: input.channel,
      limit: 1,
    });
    const identities = thread.identities;
    const conversation = thread.conversation as Record<string, unknown>;
    const contact = thread.contact as Record<string, unknown>;
    const contactId = typeof contact.contactId === "string" ? contact.contactId : "";
    const contactName =
      (typeof contact.displayName === "string" && contact.displayName.trim()) || contactId;
    const conversationId =
      typeof conversation.conversationId === "string" ? conversation.conversationId : "";
    const baseChannel =
      (typeof conversation.channel === "string" &&
        readIdentityChannel(conversation.channel as IdentityChannel)) ||
      "manychat";
    const transportValue =
      (typeof conversation.transport === "string" && conversation.transport.trim()) || "";
    const resolvedTransport = resolveConversationTransport(baseChannel, transportValue);
    const inferredInstagramChannel = contactHasIdentityChannel(identities, "instagram");
    const resolvedMatchedChannel =
      typeof conversation.matchedChannel === "string"
        ? readIdentityChannel(conversation.matchedChannel as IdentityChannel)
        : null;
    const matchedChannel = inferredInstagramChannel
      ? "instagram"
      : (resolvedMatchedChannel ??
        (resolvedTransport === "bluebubbles" ? "imessage" : baseChannel));
    const externalThreadIdRaw =
      (typeof conversation.externalThreadId === "string" && conversation.externalThreadId) ||
      (typeof conversation.replyUrl === "string" && conversation.replyUrl) ||
      undefined;
    const replyUrlRaw =
      (typeof conversation.replyUrl === "string" && conversation.replyUrl) || undefined;
    const profileUrlRaw =
      (typeof conversation.profileUrl === "string" && conversation.profileUrl) || undefined;
    const instagramProfileUrl =
      chooseChannelIdentityUrl(identities, "instagram", "profile_url") ??
      chooseChannelIdentityUrl(identities, "instagram", "reply_url");
    const externalThreadId = maybeString(externalThreadIdRaw) ?? null;
    const baseTarget = {
      contactId,
      contactName,
      conversationId,
      externalThreadId,
      matchedChannel,
      replyUrl:
        maybeString(replyUrlRaw) ??
        choosePreferredIdentityUrl(identities, baseChannel, "reply_url"),
      profileUrl:
        maybeString(profileUrlRaw) ??
        choosePreferredIdentityUrl(identities, baseChannel, "profile_url"),
      instagramProfileUrl: instagramProfileUrl ?? null,
    };

    if (resolvedTransport === "manychat") {
      const manychatIdentity =
        identities.find((identity) => identity.channel === "manychat") ?? null;
      if (!manychatIdentity) {
        throw new Error("No ManyChat identity is linked to this contact.");
      }

      const subscriberId =
        maybeString(
          readMetadataText(manychatIdentity, ["external_id", "externalId", "subscriber_id"]),
        ) ?? null;
      if (!subscriberId || !/^\d+$/.test(subscriberId)) {
        throw new Error("ManyChat subscriber id is missing or invalid for this contact.");
      }

      return {
        ...baseTarget,
        transport: "manychat",
        subscriberId,
      };
    }

    if (resolvedTransport === "bluebubbles") {
      const imessageIdentity =
        identities.find((identity) => identity.channel === "imessage") ?? null;
      const bluebubblesSenderAddress =
        maybeString(
          readMetadataText(imessageIdentity, [
            "external_id",
            "externalId",
            "phone_e164",
            "phoneE164",
            "email",
            "handle",
          ]),
        ) ?? null;
      const bluebubblesTarget =
        externalThreadId ??
        maybeString(
          readMetadataText(imessageIdentity, [
            "reply_url",
            "replyUrl",
            "external_id",
            "externalId",
            "phone_e164",
            "phoneE164",
            "email",
            "handle",
          ]),
        ) ??
        bluebubblesSenderAddress;
      if (!bluebubblesTarget) {
        throw new Error("No BlueBubbles reply target is linked to this contact.");
      }

      return {
        ...baseTarget,
        transport: "bluebubbles",
        bluebubblesTarget,
        bluebubblesSenderAddress: bluebubblesSenderAddress ?? bluebubblesTarget,
      };
    }

    throw new Error(
      `This conversation transport is not supported for direct CRM send (${resolvedTransport}).`,
    );
  }

  resolveManychatReplyTarget(input: ResolveManychatReplyTargetInput): {
    contactId: string;
    contactName: string;
    conversationId: string;
    externalThreadId: string | null;
    subscriberId: string;
    matchedChannel: IdentityChannel;
    replyUrl: string | null;
    profileUrl: string | null;
    instagramProfileUrl: string | null;
  } {
    const target = this.resolveConversationReplyTarget(input);
    if (target.transport !== "manychat" || !target.subscriberId) {
      throw new Error("This conversation is not backed by ManyChat transport.");
    }

    return {
      contactId: target.contactId,
      contactName: target.contactName,
      conversationId: target.conversationId,
      externalThreadId: target.externalThreadId,
      subscriberId: target.subscriberId,
      matchedChannel: target.matchedChannel,
      replyUrl: target.replyUrl,
      profileUrl: target.profileUrl,
      instagramProfileUrl: target.instagramProfileUrl,
    };
  }

  getContact(contactId: string): Record<string, unknown> {
    const resolvedContactId = this.resolveFlexibleContactId(contactId) ?? contactId;
    const contact = this.getContactRow(resolvedContactId);
    const latestScore = this.getLatestScore(resolvedContactId);
    const notes = this.db
      .prepare(`
        SELECT note_id, note_type, body, created_by, created_at
        FROM contact_notes
        WHERE contact_id = ?
        ORDER BY created_at DESC
        LIMIT 25
      `)
      .all(resolvedContactId) as Array<Record<string, unknown>>;
    const invites = this.db
      .prepare(`
        SELECT
          ei.invite_id,
          ei.campaign_id,
          ei.invite_status,
          ei.rsvp_status,
          ei.attendance_result,
          ei.spend_amount,
          ei.brought_guest_count,
          ei.table_outcome,
          ei.contribution_summary,
          ei.note,
          e.event_id,
          e.display_name AS event_name,
          e.starts_at,
          c.display_name AS campaign_name,
          v.venue_id,
          v.display_name AS venue_name
        FROM event_invites ei
        JOIN events e ON e.event_id = ei.event_id
        LEFT JOIN campaigns c ON c.campaign_id = ei.campaign_id
        LEFT JOIN venues v ON v.venue_id = e.venue_id
        WHERE ei.contact_id = ?
        ORDER BY e.starts_at DESC
        LIMIT 25
      `)
      .all(resolvedContactId) as Array<Record<string, unknown>>;
    const segments = this.db
      .prepare(`
        SELECT
          s.segment_id,
          s.display_name,
          sm.reason,
          sm.calculated_at
        FROM segment_memberships sm
        JOIN segments s ON s.segment_id = sm.segment_id
        WHERE sm.contact_id = ?
        ORDER BY sm.calculated_at DESC, s.display_name ASC
      `)
      .all(resolvedContactId) as Array<Record<string, unknown>>;
    const interactions = this.db
      .prepare(`
        SELECT
          interaction_id,
          event_id,
          campaign_id,
          conversation_id,
          message_id,
          channel,
          kind,
          direction,
          sentiment,
          summary,
          outcome,
          best_next_action,
          intent_tags_json,
          metadata_json,
          occurred_at
        FROM interaction_history
        WHERE contact_id = ?
        ORDER BY occurred_at DESC
        LIMIT 50
      `)
      .all(resolvedContactId)
      .map((row) => {
        const entry = row as Record<string, unknown> & {
          intent_tags_json?: string;
          metadata_json?: string;
        };
        return {
          ...entry,
          intent_tags: parseJsonArray(entry.intent_tags_json),
          metadata: parseJsonObject(entry.metadata_json),
        };
      });
    const messages = this.db
      .prepare(`
        SELECT
          m.message_id,
          m.external_message_id,
          m.direction,
          m.status,
          m.content,
          m.sent_at,
          c.channel,
          c.external_thread_id
        FROM messages m
        JOIN conversations c ON c.conversation_id = m.conversation_id
        WHERE c.contact_id = ?
        ORDER BY m.sent_at DESC
        LIMIT 50
      `)
      .all(resolvedContactId) as Array<Record<string, unknown>>;
    const followupTasks = this.db
      .prepare(`
        SELECT
          followup_task_id,
          event_id,
          campaign_id,
          source,
          status,
          priority,
          recommended_action,
          reason,
          due_at,
          created_at,
          updated_at
        FROM followup_tasks
        WHERE contact_id = ?
        ORDER BY
          CASE status
            WHEN 'open' THEN 0
            WHEN 'done' THEN 1
            ELSE 2
          END,
          priority DESC,
          COALESCE(due_at, created_at) ASC
        LIMIT 25
      `)
      .all(resolvedContactId) as Array<Record<string, unknown>>;

    return {
      contact: {
        contactId: contact.contact_id,
        displayName: contact.display_name,
        firstName: contact.first_name,
        lastName: contact.last_name,
        city: contact.city,
        birthday: contact.birthday,
        qualityTier: contact.quality_tier,
        manualScoreOverride: contact.manual_score_override,
        createdAt: contact.created_at,
        updatedAt: contact.updated_at,
      },
      identities: this.listContactIdentities(resolvedContactId),
      tags: this.listContactTags(resolvedContactId),
      preferences: this.listContactPreferences(resolvedContactId),
      latestScore,
      notes,
      invites,
      segments,
      interactions,
      messages,
      followupTasks,
    };
  }
}

export function withPromoterCrmStore<T>(
  options: StoreOptions,
  fn: (store: PromoterCrmStore) => T,
): T {
  const store = new PromoterCrmStore(resolvePromoterCrmPaths(options.stateDir));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}
