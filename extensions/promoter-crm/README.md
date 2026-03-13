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
            "promoter_crm_log_interaction",
            "promoter_crm_get_contact",
            "promoter_crm_get_venue_attendance"
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

## Foundation docs

- `ERD.md`: conceptual model, cardinalities, and product-spec mapping
- `src/schema.ts`: physical SQLite schema that implements the ERD

## Database location

The plugin stores its database at:

`$OPENCLAW_STATE_DIR/plugins/promoter-crm/promoter-crm.db`

If `OPENCLAW_STATE_DIR` is unset, OpenClaw defaults to `~/.openclaw`.
