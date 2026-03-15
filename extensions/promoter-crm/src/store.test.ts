import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePromoterCrmPaths, withPromoterCrmStore } from "./store.js";

const tempDirs: string[] = [];

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-promoter-crm-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("promoter CRM store", () => {
  it("initializes the normalized schema and reports table counts", async () => {
    const stateDir = await makeStateDir();
    const status = withPromoterCrmStore({ stateDir }, (store) => store.getStatus());

    expect(status.dbPath).toBe(resolvePromoterCrmPaths(stateDir).dbPath);
    expect(status.tableCounts.contacts).toBe(0);
    expect(status.tableCounts.events).toBe(0);
    expect(status.tableCounts.interaction_history).toBe(0);
    expect(status.tableCounts.ingest_jobs).toBe(0);
  });

  it("resolves repeated identities back to the same contact", async () => {
    const stateDir = await makeStateDir();
    const result = withPromoterCrmStore({ stateDir }, (store) => {
      const first = store.upsertContact({
        firstName: "Ava",
        lastName: "Stone",
        identities: [
          {
            channel: "instagram",
            handle: "@ava.stone",
            source: "manual",
            isPrimary: true,
          },
        ],
        tags: ["vip", "birthday"],
        preferences: [
          { category: "music", preference: "prefer", value: "house" },
          { category: "borough", preference: "prefer", value: "Brooklyn" },
        ],
        note: "Met at rooftop opener.",
      });

      const second = store.upsertContact({
        displayName: "Ava Stone",
        city: "New York",
        identities: [
          {
            channel: "instagram",
            handle: "ava.stone",
            source: "instagram",
            isPrimary: true,
          },
          {
            channel: "phone",
            phoneE164: "+1 (973) 555-0101",
            source: "manual",
          },
        ],
      });

      return store.getContact(second.contactId);
    });

    const contact = result.contact as {
      contactId: string;
      city: string | null;
      displayName: string;
    };
    const identities = result.identities as Array<{ channel: string }>;
    const tags = result.tags as string[];

    expect(contact.displayName).toBe("Ava Stone");
    expect(contact.city).toBe("New York");
    expect(identities).toHaveLength(2);
    expect(tags).toEqual(["birthday", "vip"]);
  });

  it("creates events, invites, scores, and interaction history in one graph", async () => {
    const stateDir = await makeStateDir();
    const result = withPromoterCrmStore({ stateDir }, (store) => {
      const contact = store.upsertContact({
        displayName: "Miles Rivera",
        identities: [{ channel: "phone", phoneE164: "+12125550111", isPrimary: true }],
      });
      const event = store.upsertEvent({
        name: "Friday Table Push",
        startsAt: "2026-03-20T22:00:00.000Z",
        venue: {
          name: "Skyline Room",
          city: "New York",
          neighborhood: "Manhattan",
          audienceType: "table-heavy",
          vibe: "upscale",
        },
        theme: "birthday tables",
        targetCrowd: "high-spend regulars",
      });
      const campaign = store.upsertCampaign({
        eventId: event.eventId,
        displayName: "Friday VIP table push",
        objective: "Fill two high-value tables",
        audienceSegment: "vip-table-prospects",
        status: "active",
      });
      const invite = store.upsertInvite({
        contactId: contact.contactId,
        eventId: event.eventId,
        campaignId: campaign.campaignId,
        inviteStatus: "confirmed",
        rsvpStatus: "yes",
        attendanceResult: "attended",
        contributionSummary: "Strong table candidate",
      });
      const score = store.recordScore({
        contactId: contact.contactId,
        responsivenessScore: 90,
        spendPotentialScore: 95,
        reliabilityScore: 80,
        promoterFitScore: 85,
        rationale: "Fast replies and strong spend history.",
      });
      store.logInteraction({
        contactId: contact.contactId,
        eventId: event.eventId,
        campaignId: campaign.campaignId,
        channel: "whatsapp",
        kind: "outreach",
        direction: "outbound",
        summary: "Sent personalized table invite.",
        bestNextAction: "Confirm arrival time on event day.",
        conversationExternalId: "thread-123",
        messageExternalId: "msg-123",
        content: "We have a birthday table opening Friday if you want in.",
      });
      return {
        invite,
        score,
        contact: store.getContact(contact.contactId),
        venueAttendance: store.getVenueAttendance({
          venueId: event.venueId,
          attendanceResult: "attended",
        }),
      };
    });

    const latestScore = result.contact.latestScore as { overall_score: number; rationale: string };
    const invites = result.contact.invites as Array<{
      invite_status: string;
      campaign_name: string;
    }>;
    const interactions = result.contact.interactions as Array<{ summary: string }>;
    const messages = result.contact.messages as Array<{ channel: string; content: string }>;

    expect(result.invite.inviteId).toBeTruthy();
    expect(latestScore.overall_score).toBeGreaterThan(0);
    expect(latestScore.rationale).toContain("Fast replies");
    expect(invites[0]?.invite_status).toBe("confirmed");
    expect(invites[0]?.campaign_name).toBe("Friday VIP table push");
    expect(interactions[0]?.summary).toBe("Sent personalized table invite.");
    expect(messages[0]?.channel).toBe("whatsapp");
    expect(result.venueAttendance.attendees).toHaveLength(1);
    expect((result.venueAttendance.attendees[0] as { contact_name: string }).contact_name).toBe(
      "Miles Rivera",
    );
  });

  it("materializes saved audience segments from normalized contact facts", async () => {
    const stateDir = await makeStateDir();
    const result = withPromoterCrmStore({ stateDir }, (store) => {
      const sky = store.upsertContact({
        displayName: "Sky James",
        city: "New York",
        tags: ["vip", "birthday"],
        identities: [{ channel: "instagram", handle: "@skyj", isPrimary: true }],
      });
      const remy = store.upsertContact({
        displayName: "Remy North",
        city: "New York",
        tags: ["prospect"],
        identities: [{ channel: "phone", phoneE164: "+12125550189", isPrimary: true }],
      });

      store.recordScore({
        contactId: sky.contactId,
        overallScore: 92,
        rationale: "VIP regular with strong attendance history.",
      });
      store.recordScore({
        contactId: remy.contactId,
        overallScore: 48,
        rationale: "New lead with limited history.",
      });

      const segment = store.upsertSegment({
        displayName: "NY VIP 80+",
        definition: {
          city: "New York",
          tagsAny: ["vip"],
          minOverallScore: 80,
        },
      });
      const refreshed = store.refreshSegment({ segmentId: segment.segmentId });
      const matches = store.findContacts({ segmentId: segment.segmentId, limit: 10 });
      const contact = store.getContact(sky.contactId);

      return { refreshed, matches, contact };
    });

    const refreshedMembers = result.refreshed.members as Array<{
      displayName: string;
      reason: string;
    }>;
    const matches = result.matches as Array<{ display_name: string }>;
    const segments = result.contact.segments as Array<{ display_name: string; reason: string }>;

    expect(result.refreshed.membershipCount).toBe(1);
    expect(refreshedMembers[0]?.displayName).toBe("Sky James");
    expect(refreshedMembers[0]?.reason).toContain("score>=80");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.display_name).toBe("Sky James");
    expect(segments[0]?.display_name).toBe("NY VIP 80+");
    expect(segments[0]?.reason).toContain("tagsAny=vip");
  });

  it("imports CSV contacts and records ingest audit rows", async () => {
    const stateDir = await makeStateDir();
    const result = withPromoterCrmStore({ stateDir }, (store) => {
      const imported = store.importContactsFromCsv({
        fileName: "contacts.csv",
        initiatedBy: "codex-test",
        csvText: [
          "display_name,instagram_handle,phone,city,tags,note,preferred_music,manychat_id",
          "Ava Stone,@ava.stone,,,,,,",
          'Ava Stone,@ava.stone,+1 (212) 555-0199,New York,"vip,birthday","Met at opener",house,',
          ",,,,vip,Missing identity and name,,",
          "Miles Rivera,,,,prospect,,,mc-42",
        ].join("\n"),
      });

      const avaMatch = store.findContacts({ query: "ava stone", limit: 5 })[0] as
        | { contact_id?: string }
        | undefined;
      const ava = avaMatch?.contact_id ? store.getContact(avaMatch.contact_id) : null;
      const status = store.getStatus();

      return {
        imported,
        ava,
        status,
      };
    });

    expect(result.imported.stats.created).toBe(2);
    expect(result.imported.stats.updated).toBe(1);
    expect(result.imported.stats.skipped).toBe(1);
    expect(result.imported.stats.failed).toBe(0);
    expect(result.imported.items).toHaveLength(4);
    expect(result.status.tableCounts.ingest_jobs).toBe(1);
    expect(result.status.tableCounts.ingest_job_items).toBe(4);

    const contact = result.ava?.contact as { city: string | null; displayName: string };
    const identities = result.ava?.identities as Array<{ channel: string }>;
    const tags = result.ava?.tags as string[];
    const preferences = result.ava?.preferences as Array<{ category: string; value: string }>;
    const notes = result.ava?.notes as Array<{ body: string }>;

    expect(contact.displayName).toBe("Ava Stone");
    expect(contact.city).toBe("New York");
    expect(identities.map((entry) => entry.channel).sort()).toEqual(["instagram", "phone"]);
    expect(tags).toEqual(["birthday", "vip"]);
    expect(preferences[0]).toMatchObject({ category: "music", value: "house" });
    expect(notes[0]?.body).toBe("Met at opener");
  });

  it("imports ManyChat payloads into contacts, conversations, and messages idempotently", async () => {
    const stateDir = await makeStateDir();
    const result = withPromoterCrmStore({ stateDir }, (store) => {
      const payload = {
        id: "mc-501",
        first_name: "Ava",
        last_name: "Stone",
        name: "Ava Stone",
        status: "ACTIVE",
        live_chat_url: "https://manychat.com/livechat?user_ref=mc-501",
        last_input_text: "I'm down for Friday",
        last_interaction: "2026-03-14T02:00:00.000Z",
        last_growth_tool: "IG Story Reply",
        custom_fields: {
          phone: "+1 (212) 555-0199",
          email: "ava@example.com",
          instagram_handle: "@ava.stone",
          city: "New York",
          birthday: "1998-04-18",
          tags: ["vip", "birthday"],
          preferred_music: "house, afrobeats",
          preferred_venue: "Skyline Room",
          promoter_notes: "Brings table-ready friends",
        },
        messages: [
          {
            id: "mc-msg-1",
            direction: "outbound",
            text: "Friday invite?",
            created_at: "2026-03-14T01:55:00.000Z",
          },
          {
            id: "mc-msg-2",
            direction: "inbound",
            text: "I'm down for Friday",
            created_at: "2026-03-14T02:00:00.000Z",
          },
        ],
      };

      const first = store.importManychatPayload({
        payload,
        sourceLabel: "manychat-test",
        initiatedBy: "codex-test",
      });
      const second = store.importManychatPayload({
        payload,
        sourceLabel: "manychat-test",
        initiatedBy: "codex-test",
      });
      const contact = first.contactId ? store.getContact(first.contactId) : null;
      const status = store.getStatus();

      return { first, second, contact, status };
    });

    expect(result.first.stats.contactsCreated).toBe(1);
    expect(result.first.stats.messagesImported).toBe(2);
    expect(result.second.stats.contactsUpdated).toBe(1);
    expect(result.second.stats.messagesImported).toBe(2);
    expect(result.status.tableCounts.contacts).toBe(1);
    expect(result.status.tableCounts.contact_identities).toBe(4);
    expect(result.status.tableCounts.conversations).toBe(1);
    expect(result.status.tableCounts.messages).toBe(2);
    expect(result.status.tableCounts.interaction_history).toBe(2);
    expect(result.status.tableCounts.contact_notes).toBe(1);
    expect(result.status.tableCounts.ingest_jobs).toBe(2);

    const contact = result.contact?.contact as { displayName: string; city: string | null };
    const identities = result.contact?.identities as Array<{
      channel: string;
      handle?: string | null;
      profile_url?: string | null;
      reply_url?: string | null;
      avatar_url?: string | null;
    }>;
    const tags = result.contact?.tags as string[];
    const preferences = result.contact?.preferences as Array<{ category: string; value: string }>;
    const notes = result.contact?.notes as Array<{ body: string }>;
    const messages = result.contact?.messages as Array<{
      channel: string;
      direction: string;
      content: string;
    }>;
    const interactions = result.contact?.interactions as Array<{ kind: string; summary: string }>;

    expect(contact.displayName).toBe("Ava Stone");
    expect(contact.city).toBe("New York");
    expect(identities.map((entry) => entry.channel).sort()).toEqual([
      "email",
      "instagram",
      "manychat",
      "phone",
    ]);
    expect(identities.find((entry) => entry.channel === "manychat")).toMatchObject({
      profile_url: "https://manychat.com/livechat?user_ref=mc-501",
      reply_url: "https://manychat.com/livechat?user_ref=mc-501",
    });
    expect(identities.find((entry) => entry.channel === "instagram")).toMatchObject({
      handle: "ava.stone",
      profile_url: "https://www.instagram.com/ava.stone/",
    });
    expect(tags).toEqual(["birthday", "vip"]);
    expect(preferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "music", value: "house" }),
        expect.objectContaining({ category: "music", value: "afrobeats" }),
        expect.objectContaining({ category: "venue", value: "Skyline Room" }),
      ]),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("Brings table-ready friends");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.channel).toBe("manychat");
    expect(interactions.map((entry) => entry.kind).sort()).toEqual(["outreach", "reply"]);
    expect(interactions[0]?.summary).toContain("ManyChat");
  });

  it("builds a recent inbox and conversation thread from normalized ManyChat messages", async () => {
    const stateDir = await makeStateDir();
    const result = withPromoterCrmStore({ stateDir }, (store) => {
      const payload = {
        id: "mc-900",
        first_name: "Marc",
        last_name: "Bieber",
        name: "Marc Bieber",
        status: "ACTIVE",
        live_chat_url: "https://app.manychat.com/fb3160512/chat/mc-900",
        ig_username: "marc.b",
        last_interaction: "2026-03-14T03:10:00.000Z",
        messages: [
          {
            id: "mc-msg-a",
            direction: "outbound",
            text: "Send me what you're thinking for Friday.",
            created_at: "2026-03-14T03:00:00.000Z",
          },
          {
            id: "mc-msg-b",
            direction: "inbound",
            text: "Here is the vibe I'm thinking",
            created_at: "2026-03-14T03:05:00.000Z",
          },
          {
            id: "mc-msg-c",
            direction: "inbound",
            text: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123",
            created_at: "2026-03-14T03:10:00.000Z",
          },
        ],
      };

      const imported = store.importManychatPayload({
        payload,
        sourceLabel: "manychat-inbox-test",
        initiatedBy: "codex-test",
      });
      const inbox = store.getRecentInbox({
        channel: "manychat",
        limit: 10,
        onlyNeedsReply: true,
      });
      const instagramInbox = store.getRecentInbox({
        channel: "instagram",
        limit: 10,
        onlyNeedsReply: true,
      });
      const thread = imported.contactId
        ? store.getConversationThread({
            contactId: imported.contactId,
            channel: "manychat",
            limit: 10,
          })
        : null;
      const instagramThread = imported.contactId
        ? store.getConversationThread({
            contactId: imported.contactId,
            channel: "instagram",
            limit: 10,
          })
        : null;

      return { imported, inbox, instagramInbox, thread, instagramThread };
    });

    const conversations = result.inbox.conversations as Array<{
      contactName: string;
      needsReply: boolean;
      lastMessage: {
        contentType: string;
        preview: string;
      };
    }>;
    const instagramConversations = result.instagramInbox.conversations as Array<{
      contactName: string;
      matchedChannel: string;
      channelLabel: string;
      primaryIdentity: { channel: string; handle?: string };
      replyUrl: string;
      profileUrl: string;
    }>;
    const threadMessages = result.thread?.messages as Array<{
      direction: string;
      contentType: string;
      content: string;
      attachmentUrls: string[];
    }>;
    const threadConversation = result.thread?.conversation as {
      channel: string;
      needsReply: boolean;
    };
    const instagramThreadConversation = result.instagramThread?.conversation as {
      channel: string;
      matchedChannel: string;
      channelLabel: string;
      replyUrl: string;
      profileUrl: string;
    };

    expect(result.imported.stats.messagesImported).toBe(3);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.contactName).toBe("Marc Bieber");
    expect(conversations[0]?.needsReply).toBe(true);
    expect(conversations[0]?.lastMessage.contentType).toBe("attachment");
    expect(conversations[0]?.lastMessage.preview).toBe("Instagram media attachment");
    expect(instagramConversations).toHaveLength(1);
    expect(instagramConversations[0]?.contactName).toBe("Marc Bieber");
    expect(instagramConversations[0]?.matchedChannel).toBe("instagram");
    expect(instagramConversations[0]?.channelLabel).toBe("instagram via manychat");
    expect(instagramConversations[0]?.primaryIdentity.channel).toBe("instagram");
    expect(instagramConversations[0]?.profileUrl).toBe("https://www.instagram.com/marc.b/");
    expect(instagramConversations[0]?.replyUrl).toBe(
      "https://app.manychat.com/fb3160512/chat/mc-900",
    );
    expect(threadConversation?.channel).toBe("manychat");
    expect(threadConversation?.needsReply).toBe(true);
    expect(instagramThreadConversation?.channel).toBe("manychat");
    expect(instagramThreadConversation?.matchedChannel).toBe("instagram");
    expect(instagramThreadConversation?.channelLabel).toBe("instagram via manychat");
    expect(instagramThreadConversation?.profileUrl).toBe("https://www.instagram.com/marc.b/");
    expect(instagramThreadConversation?.replyUrl).toBe(
      "https://app.manychat.com/fb3160512/chat/mc-900",
    );
    expect(threadMessages).toHaveLength(3);
    expect(threadMessages[2]?.direction).toBe("inbound");
    expect(threadMessages[2]?.contentType).toBe("attachment");
    expect(threadMessages[2]?.content).toContain("lookaside.fbsbx.com");
    expect(threadMessages[2]?.attachmentUrls).toEqual([
      "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123",
    ]);
  });

  it("ranks persisted follow-up tasks from invite urgency and stale outreach", async () => {
    const stateDir = await makeStateDir();
    const now = Date.now();
    const result = withPromoterCrmStore({ stateDir }, (store) => {
      const vip = store.upsertContact({
        displayName: "Nina Vale",
        qualityTier: "vip",
        identities: [{ channel: "phone", phoneE164: "+12125550155", isPrimary: true }],
      });
      const stale = store.upsertContact({
        displayName: "Jules Hart",
        identities: [{ channel: "instagram", handle: "@juleshart", isPrimary: true }],
      });
      const fresh = store.upsertContact({
        displayName: "Kai Bloom",
        identities: [{ channel: "email", email: "kai@example.com", isPrimary: true }],
      });

      store.recordScore({ contactId: vip.contactId, overallScore: 95, rationale: "VIP regular." });
      store.recordScore({
        contactId: stale.contactId,
        overallScore: 74,
        rationale: "Good lead, needs reactivation.",
      });
      store.recordScore({
        contactId: fresh.contactId,
        overallScore: 81,
        rationale: "Recently active.",
      });

      const event = store.upsertEvent({
        name: "Saturday Headliner",
        startsAt: new Date(now + 24 * 3_600_000).toISOString(),
        venue: {
          name: "Lotus Room",
          city: "New York",
        },
      });
      const campaign = store.upsertCampaign({
        eventId: event.eventId,
        displayName: "Headliner confirmations",
        status: "active",
      });
      store.upsertInvite({
        contactId: vip.contactId,
        eventId: event.eventId,
        campaignId: campaign.campaignId,
        inviteStatus: "confirmed",
        rsvpStatus: "yes",
      });

      store.logInteraction({
        contactId: stale.contactId,
        channel: "instagram",
        kind: "outreach",
        direction: "outbound",
        summary: "Checked in after a quiet stretch.",
        occurredAt: new Date(now - 12 * 86_400_000).toISOString(),
      });
      store.logInteraction({
        contactId: fresh.contactId,
        channel: "email",
        kind: "reply",
        direction: "inbound",
        summary: "Recently replied about next week.",
        occurredAt: new Date(now - 1 * 86_400_000).toISOString(),
      });

      const queue = store.rankFollowups({ limit: 10, minDaysSinceLastInteraction: 7 });
      const vipView = store.getContact(vip.contactId);
      const staleView = store.getContact(stale.contactId);
      const freshView = store.getContact(fresh.contactId);

      return { queue, vipView, staleView, freshView };
    });

    const tasks = result.queue.tasks as Array<{
      contact_name: string;
      recommended_action: string;
      priority: number;
    }>;
    const vipTasks = result.vipView.followupTasks as Array<{ recommended_action: string }>;
    const staleTasks = result.staleView.followupTasks as Array<{ recommended_action: string }>;
    const freshTasks = result.freshView.followupTasks as Array<{ recommended_action: string }>;

    expect(result.queue.taskCount).toBe(2);
    expect(tasks[0]?.contact_name).toBe("Nina Vale");
    expect(tasks[0]?.recommended_action).toBe("confirm_arrival");
    expect(tasks[0]?.priority).toBeGreaterThan(tasks[1]?.priority ?? 0);
    expect(tasks[1]?.contact_name).toBe("Jules Hart");
    expect(tasks[1]?.recommended_action).toBe("reactivate_contact");
    expect(vipTasks[0]?.recommended_action).toBe("confirm_arrival");
    expect(staleTasks[0]?.recommended_action).toBe("reactivate_contact");
    expect(freshTasks).toHaveLength(0);
  });
});
