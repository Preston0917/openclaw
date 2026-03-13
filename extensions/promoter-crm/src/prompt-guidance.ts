export const PROMOTER_CRM_AGENT_GUIDANCE = `
When the promoter CRM plugin is enabled:

- Use promoter CRM tools before making outreach decisions if contact or event state matters.
- Prefer promoter_crm_upsert_contact when ingesting or reconciling a person across channels.
- Prefer promoter_crm_find_contacts when building invite lists or follow-up queues.
- Prefer promoter_crm_record_score when ranking contacts for outreach.
- Prefer promoter_crm_upsert_event, promoter_crm_upsert_campaign, and promoter_crm_upsert_invite for event planning and RSVP tracking.
- Prefer promoter_crm_upsert_segment and promoter_crm_refresh_segment when saving or recalculating audience segments.
- Prefer promoter_crm_get_venue_attendance when you need to answer who attended, flaked, or was invited at a venue.
- Prefer promoter_crm_log_interaction after meaningful outreach, replies, summaries, or attendance updates.
- Prefer promoter_crm_get_contact before drafting personalized outreach so you can use unified history, notes, invites, and latest score context.
`.trim();
