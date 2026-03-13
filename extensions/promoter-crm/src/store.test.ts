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
});
