import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { mapCsvRowToContactInput, parseCsvRows } from "./csv-import.js";
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
export type EventStatus = "planned" | "live" | "completed" | "canceled";
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type InviteStatus = "draft" | "invited" | "confirmed" | "tentative" | "declined";
export type RsvpStatus = "unknown" | "pending" | "yes" | "no" | "maybe";
export type AttendanceResult = "unknown" | "attended" | "flaked" | "late";
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

export type ContactIdentityInput = {
  channel: IdentityChannel;
  externalId?: string;
  handle?: string;
  email?: string;
  phoneE164?: string;
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
  eventId?: string;
  campaignId?: string;
  channel?: IdentityChannel;
  kind: InteractionKind;
  direction?: Direction;
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

export type ImportCsvInput = {
  csvText: string;
  fileName?: string;
  sourceLabel?: string;
  initiatedBy?: string;
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

function normalizeIdentityValue(identity: ContactIdentityInput): string {
  return (
    normalizeLower(identity.externalId) ||
    normalizeEmail(identity.email) ||
    normalizePhone(identity.phoneE164) ||
    normalizeHandle(identity.handle)
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function maybeString(value: string | undefined): string | null {
  const trimmed = normalizeWhitespace(value);
  return trimmed ? trimmed : null;
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
    rawPayload: Record<string, string>;
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
      const rows = this.db
        .prepare(`
          SELECT contact_id
          FROM contact_identities
          WHERE channel = ? AND normalized_value = ?
        `)
        .all(identity.channel, normalizedValue) as Array<{ contact_id: string }>;
      for (const row of rows) {
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
        normalized_value,
        source,
        is_primary,
        confidence,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, normalized_value) DO UPDATE SET
        contact_id = excluded.contact_id,
        external_id = excluded.external_id,
        handle = excluded.handle,
        email = excluded.email,
        phone_e164 = excluded.phone_e164,
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
      const displayName = chooseDisplayName(input);

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
          external_thread_id,
          status,
          started_at,
          last_message_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, external_thread_id) DO UPDATE SET
          contact_id = excluded.contact_id,
          last_message_at = excluded.last_message_at,
          updated_at = excluded.updated_at
      `)
      .run(
        conversationId,
        params.contactId,
        params.channel,
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
    externalMessageId?: string;
    status?: string;
    content?: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  }): string | null {
    const hasMessage = maybeString(params.externalMessageId) || maybeString(params.content);
    if (!hasMessage) {
      return null;
    }
    const now = nowIso();
    const messageId = randomUUID();
    this.db
      .prepare(`
        INSERT INTO messages (
          message_id,
          conversation_id,
          external_message_id,
          direction,
          status,
          content,
          sent_at,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        messageId,
        params.conversationId,
        maybeString(params.externalMessageId),
        params.direction ?? "outbound",
        maybeString(params.status),
        maybeString(params.content),
        params.occurredAt,
        params.metadata ? JSON.stringify(params.metadata) : null,
        now,
      );
    return messageId;
  }

  logInteraction(input: LogInteractionInput): { interactionId: string } {
    return this.withTransaction(() => {
      this.getContactRow(input.contactId);
      const occurredAt = input.occurredAt ?? nowIso();
      const conversationId =
        input.channel && input.conversationExternalId
          ? this.upsertConversation({
              contactId: input.contactId,
              channel: input.channel,
              externalThreadId: input.conversationExternalId,
              occurredAt,
            })
          : null;
      const messageId =
        conversationId && (input.messageExternalId || input.content)
          ? this.upsertMessage({
              conversationId,
              direction: input.direction,
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
        `)
        .run(
          interactionId,
          input.contactId,
          maybeString(input.eventId),
          maybeString(input.campaignId),
          conversationId,
          messageId,
          maybeString(input.channel),
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
          const result = this.upsertContact({
            ...mapped.input,
            createdBy: input.initiatedBy,
          });
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

  getContact(contactId: string): Record<string, unknown> {
    const contact = this.getContactRow(contactId);
    const latestScore = this.getLatestScore(contactId);
    const notes = this.db
      .prepare(`
        SELECT note_id, note_type, body, created_by, created_at
        FROM contact_notes
        WHERE contact_id = ?
        ORDER BY created_at DESC
        LIMIT 25
      `)
      .all(contactId) as Array<Record<string, unknown>>;
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
      .all(contactId) as Array<Record<string, unknown>>;
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
      .all(contactId) as Array<Record<string, unknown>>;
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
      .all(contactId)
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
      .all(contactId) as Array<Record<string, unknown>>;

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
      identities: this.listContactIdentities(contactId),
      tags: this.listContactTags(contactId),
      preferences: this.listContactPreferences(contactId),
      latestScore,
      notes,
      invites,
      segments,
      interactions,
      messages,
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
