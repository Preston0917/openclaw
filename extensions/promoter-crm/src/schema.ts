import type { DatabaseSync } from "node:sqlite";

export const PROMOTER_CRM_TABLES = [
  "contacts",
  "contact_identities",
  "contact_merges",
  "tags",
  "contact_tag_links",
  "contact_notes",
  "contact_preferences",
  "venues",
  "events",
  "campaigns",
  "event_invites",
  "contact_score_snapshots",
  "conversations",
  "messages",
  "interaction_history",
  "segments",
  "segment_memberships",
  "followup_tasks",
  "ingest_jobs",
  "ingest_job_items",
] as const;

export function ensurePromoterCrmSchema(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 1000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      contact_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      city TEXT,
      birthday TEXT,
      quality_tier TEXT CHECK (quality_tier IN ('prospect', 'warm', 'regular', 'vip', 'table')),
      manual_score_override REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_identities (
      identity_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      external_id TEXT,
      handle TEXT,
      email TEXT,
      phone_e164 TEXT,
      normalized_value TEXT NOT NULL,
      source TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(channel, normalized_value)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_contact_identities_contact
    ON contact_identities(contact_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_merges (
      merge_id TEXT PRIMARY KEY,
      from_contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      into_contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      reason TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      CHECK (from_contact_id <> into_contact_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      tag_id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_tag_links (
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (contact_id, tag_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_notes (
      note_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      note_type TEXT NOT NULL DEFAULT 'promoter',
      body TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_created
    ON contact_notes(contact_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_preferences (
      preference_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('venue', 'music', 'borough', 'vibe')),
      preference TEXT NOT NULL CHECK (preference IN ('prefer', 'avoid')),
      value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(contact_id, category, preference, normalized_value)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS venues (
      venue_id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      neighborhood TEXT,
      audience_type TEXT,
      vibe TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(normalized_name, city)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      venue_id TEXT REFERENCES venues(venue_id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      theme TEXT,
      target_crowd TEXT,
      status TEXT NOT NULL CHECK (status IN ('planned', 'live', 'completed', 'canceled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_starts_at
    ON events(starts_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      campaign_id TEXT PRIMARY KEY,
      event_id TEXT REFERENCES events(event_id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      objective TEXT,
      audience_segment TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_event
    ON campaigns(event_id, status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS event_invites (
      invite_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      campaign_id TEXT REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
      invite_status TEXT NOT NULL CHECK (invite_status IN ('draft', 'invited', 'confirmed', 'tentative', 'declined')) DEFAULT 'draft',
      rsvp_status TEXT NOT NULL CHECK (rsvp_status IN ('unknown', 'pending', 'yes', 'no', 'maybe')) DEFAULT 'unknown',
      attendance_result TEXT NOT NULL CHECK (attendance_result IN ('unknown', 'attended', 'flaked', 'late')) DEFAULT 'unknown',
      spend_amount REAL,
      brought_guest_count INTEGER,
      table_outcome TEXT,
      contribution_summary TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(contact_id, event_id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_invites_event
    ON event_invites(event_id, invite_status, attendance_result);
  `);
  db.exec(`
    CREATE VIEW IF NOT EXISTS venue_attendance_history AS
    SELECT
      v.venue_id,
      v.display_name AS venue_name,
      v.city AS venue_city,
      e.event_id,
      e.display_name AS event_name,
      e.starts_at,
      ei.invite_id,
      ei.contact_id,
      c.display_name AS contact_name,
      ei.invite_status,
      ei.rsvp_status,
      ei.attendance_result,
      ei.spend_amount,
      ei.brought_guest_count,
      ei.table_outcome,
      ei.contribution_summary,
      ei.note
    FROM event_invites ei
    JOIN contacts c ON c.contact_id = ei.contact_id
    JOIN events e ON e.event_id = ei.event_id
    JOIN venues v ON v.venue_id = e.venue_id;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_score_snapshots (
      score_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      responsiveness_score REAL,
      attendance_likelihood_score REAL,
      social_value_score REAL,
      spend_potential_score REAL,
      reliability_score REAL,
      promoter_fit_score REAL,
      overall_score REAL NOT NULL,
      rationale TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_contact_score_snapshots_contact_created
    ON contact_score_snapshots(contact_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      external_thread_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')) DEFAULT 'active',
      started_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(channel, external_thread_id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_contact_updated
    ON conversations(contact_id, updated_at DESC);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_channel_last_message
    ON conversations(channel, last_message_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
      external_message_id TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      status TEXT,
      content TEXT,
      sent_at TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(conversation_id, external_message_id)
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_external
    ON messages(conversation_id, external_message_id)
    WHERE external_message_id IS NOT NULL;
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_sent
    ON messages(conversation_id, sent_at DESC);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_direction_sent
    ON messages(direction, sent_at DESC);
  `);
  db.exec(`
    CREATE VIEW IF NOT EXISTS conversation_inbox AS
    SELECT
      conv.conversation_id,
      conv.contact_id,
      c.display_name AS contact_name,
      conv.channel,
      conv.external_thread_id,
      conv.status AS conversation_status,
      conv.started_at,
      conv.last_message_at,
      last_message.message_id AS last_message_id,
      last_message.direction AS last_message_direction,
      last_message.status AS last_message_status,
      last_message.content AS last_message_content,
      last_message.sent_at AS last_message_sent_at,
      last_inbound.message_id AS last_inbound_message_id,
      last_inbound.content AS last_inbound_content,
      last_inbound.sent_at AS last_inbound_at,
      last_outbound.message_id AS last_outbound_message_id,
      last_outbound.content AS last_outbound_content,
      last_outbound.sent_at AS last_outbound_at,
      (
        SELECT COUNT(*)
        FROM messages m_count
        WHERE m_count.conversation_id = conv.conversation_id
      ) AS total_message_count,
      (
        SELECT COUNT(*)
        FROM messages m_count
        WHERE m_count.conversation_id = conv.conversation_id
          AND m_count.direction = 'inbound'
      ) AS inbound_message_count,
      (
        SELECT COUNT(*)
        FROM messages m_count
        WHERE m_count.conversation_id = conv.conversation_id
          AND m_count.direction = 'outbound'
      ) AS outbound_message_count
    FROM conversations conv
    JOIN contacts c ON c.contact_id = conv.contact_id
    LEFT JOIN messages last_message ON last_message.message_id = (
      SELECT m_latest.message_id
      FROM messages m_latest
      WHERE m_latest.conversation_id = conv.conversation_id
      ORDER BY m_latest.sent_at DESC, m_latest.created_at DESC
      LIMIT 1
    )
    LEFT JOIN messages last_inbound ON last_inbound.message_id = (
      SELECT m_inbound.message_id
      FROM messages m_inbound
      WHERE m_inbound.conversation_id = conv.conversation_id
        AND m_inbound.direction = 'inbound'
      ORDER BY m_inbound.sent_at DESC, m_inbound.created_at DESC
      LIMIT 1
    )
    LEFT JOIN messages last_outbound ON last_outbound.message_id = (
      SELECT m_outbound.message_id
      FROM messages m_outbound
      WHERE m_outbound.conversation_id = conv.conversation_id
        AND m_outbound.direction = 'outbound'
      ORDER BY m_outbound.sent_at DESC, m_outbound.created_at DESC
      LIMIT 1
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS interaction_history (
      interaction_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      event_id TEXT REFERENCES events(event_id) ON DELETE SET NULL,
      campaign_id TEXT REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(conversation_id) ON DELETE SET NULL,
      message_id TEXT REFERENCES messages(message_id) ON DELETE SET NULL,
      channel TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('outreach', 'reply', 'note', 'attendance', 'follow_up', 'summary', 'campaign')),
      direction TEXT CHECK (direction IN ('inbound', 'outbound')),
      sentiment TEXT,
      summary TEXT NOT NULL,
      outcome TEXT,
      best_next_action TEXT,
      intent_tags_json TEXT,
      metadata_json TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_interaction_history_contact_occurred
    ON interaction_history(contact_id, occurred_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      segment_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      definition_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_memberships (
      segment_id TEXT NOT NULL REFERENCES segments(segment_id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      reason TEXT,
      calculated_at TEXT NOT NULL,
      PRIMARY KEY (segment_id, contact_id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_segment_memberships_contact
    ON segment_memberships(contact_id, calculated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS followup_tasks (
      followup_task_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      event_id TEXT REFERENCES events(event_id) ON DELETE SET NULL,
      campaign_id TEXT REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK (source IN ('rules', 'manual')) DEFAULT 'rules',
      status TEXT NOT NULL CHECK (status IN ('open', 'done', 'dismissed')) DEFAULT 'open',
      priority REAL NOT NULL,
      recommended_action TEXT NOT NULL,
      reason TEXT NOT NULL,
      due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_followup_tasks_status_priority
    ON followup_tasks(status, priority DESC, due_at ASC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingest_jobs (
      ingest_job_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_label TEXT,
      file_name TEXT,
      status TEXT NOT NULL,
      stats_json TEXT,
      initiated_by TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ingest_jobs_source_started
    ON ingest_jobs(source, started_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingest_job_items (
      ingest_job_item_id TEXT PRIMARY KEY,
      ingest_job_id TEXT NOT NULL REFERENCES ingest_jobs(ingest_job_id) ON DELETE CASCADE,
      row_number INTEGER,
      external_id TEXT,
      action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'merged', 'skipped', 'failed')),
      resolved_contact_id TEXT REFERENCES contacts(contact_id) ON DELETE SET NULL,
      raw_payload_json TEXT NOT NULL,
      error_text TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ingest_job_items_job_action
    ON ingest_job_items(ingest_job_id, action, row_number);
  `);
}
