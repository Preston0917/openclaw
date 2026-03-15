# Promoter CRM (plugin)

Adds a normalized promoter CRM foundation to OpenClaw using a local SQLite
database under the OpenClaw state directory.

This plugin is designed to translate the current `promoter-assistant` product
direction into an OpenClaw-native data layer instead of mirroring the Airtable
schema. The schema follows Chen-style entity relationships:

- `Contact`
- `ContactIdentity`
- `Tag`
- `ContactPreference`
- `ContactNote`
- `ContactScoreSnapshot`
- `Venue`
- `Event`
- `Campaign`
- `EventInvite`
- `Conversation`
- `Message`
- `InteractionHistory`
- `Segment`
- `SegmentMembership`

Start with the conceptual model in [`ERD.md`](./ERD.md). It explains how the
CRM is shaped around Chen-style entities and relationship tables, and how that
maps onto the current SQLite schema.

## Enable

1. Enable the plugin:

```json
{
  "plugins": {
    "entries": {
      "promoter-crm": { "enabled": true }
    }
  }
}
```

2. Allow the tools for the agent that should use the CRM:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": [
            "promoter_crm_status",
            "promoter_crm_upsert_contact",
            "promoter_crm_find_contacts",
            "promoter_crm_record_score",
            "promoter_crm_upsert_event",
            "promoter_crm_upsert_campaign",
            "promoter_crm_upsert_invite",
            "promoter_crm_upsert_segment",
            "promoter_crm_refresh_segment",
            "promoter_crm_rank_followups",
            "promoter_crm_log_interaction",
            "promoter_crm_get_contact",
            "promoter_crm_get_venue_attendance",
            "promoter_crm_recent_inbox",
            "promoter_crm_get_conversation_thread",
            "promoter_crm_send_manychat_reply"
          ]
        }
      }
    ]
  }
}
```

## CLI

```bash
openclaw promoter-crm init
openclaw promoter-crm status
openclaw promoter-crm import-csv ./contacts.csv
openclaw promoter-crm import-manychat ./manychat-contact.json
openclaw promoter-crm followup-queue --limit 25
openclaw promoter-crm recent-inbox --limit 20 --only-needs-reply
openclaw promoter-crm conversation-thread --contact-id <contact-id> --channel manychat
openclaw promoter-crm send-manychat-reply --contact-id <contact-id> --text "On it" --confirm-send
```

## What it covers today

- Identity resolution across multiple source/channel identities
- Normalized contact storage with tags, notes, and preferences
- Event and venue records
- Campaign records tied to event goals
- Invite lifecycle tracking
- Score snapshots for prioritization workflows
- Saved audience segments with materialized memberships
- Unified interaction, conversation, and message history
- Venue attendance lookup across events through the normalized invite path
- CSV contact import with ingest job auditing
- ManyChat JSON and webhook ingestion into normalized contacts, conversations, messages, and interaction history
- Operational ingest tables for future Google Contacts syncs
- Persisted follow-up queue ranking driven by score, invite state, and stale conversations
- Read-model inbox queries for recent inbound conversations and normalized thread inspection
- Outbound ManyChat replies with normalized CRM logging so OpenClaw can see what it sent

## Foundation docs

- `ERD.md`: conceptual model, cardinalities, and product-spec mapping
- `src/schema.ts`: physical SQLite schema that implements the ERD
- `promoter-crm import-csv`: imports contact rows using common columns like `display_name`, `phone`, `email`, `instagram_handle`, `manychat_id`, `tags`, and `preferred_music`
- `promoter-crm import-manychat`: ingests ManyChat "Full Contact Data" JSON plus optional message arrays into the normalized CRM graph

## ManyChat connector

ManyChat is modeled as a CRM/source connector, not as a native OpenClaw chat
transport. The importer expects the official ManyChat "Full Contact Data" JSON
shape, with optional `messages` or `message` payloads if you want to hydrate
conversation history alongside the contact record.

For local testing, import a saved JSON payload:

```bash
openclaw promoter-crm import-manychat ./manychat-contact.json
```

For live ingestion from ManyChat External Request, point ManyChat at:

`POST /promoter-crm/webhooks/manychat`

The webhook is public (`auth: "plugin"`) but requires a shared secret in one
of these headers:

- `x-promoter-crm-webhook-secret`
- `x-manychat-secret`
- `Authorization: Bearer <secret>`

Configure the expected secret in the OpenClaw gateway environment:

```bash
export PROMOTER_CRM_MANYCHAT_WEBHOOK_SECRET="replace-me"
```

Recommended pattern:

- Use ManyChat "Full Contact Data" export payloads to create or refresh contacts.
- Add `messages` or `message` objects in your External Request body when you
  want to import live conversation events.
- Replays are idempotent for the same message ids or the same synthesized
  ManyChat message fingerprint, so webhook retries do not multiply the thread.
- Outbound replies sent through `promoter_crm_send_manychat_reply` are logged back
  into the same normalized conversation so the CRM thread shows what OpenClaw sent.

To enable outbound replies, make the ManyChat API key available to the gateway:

```bash
export MANYCHAT_API_KEY="page_id:api_token"
```

The reply tool uses ManyChat's `sendContent` endpoint with Dynamic Block `v2`
text payloads and should only be used after the user explicitly approves the
send.

## Database location

The plugin stores its database at:

`$OPENCLAW_STATE_DIR/plugins/promoter-crm/promoter-crm.db`

If `OPENCLAW_STATE_DIR` is unset, OpenClaw defaults to `~/.openclaw`.
