import type {
  ContactIdentityInput,
  ContactPreferenceInput,
  ContactQualityTier,
  UpsertContactInput,
} from "./store.js";

export type ParsedCsvRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type CsvContactDraft = {
  input: UpsertContactInput | null;
  externalId?: string;
  skipReason?: string;
};

const DISPLAY_NAME_KEYS = ["display_name", "displayname", "full_name", "fullname", "name"];
const FIRST_NAME_KEYS = ["first_name", "firstname", "given_name", "givenname"];
const LAST_NAME_KEYS = ["last_name", "lastname", "family_name", "familyname", "surname"];
const CITY_KEYS = ["city", "town"];
const BIRTHDAY_KEYS = ["birthday", "birth_date", "birthdate", "dob"];
const QUALITY_TIER_KEYS = ["quality_tier", "qualitytier", "tier"];
const NOTE_KEYS = ["note", "notes", "promoter_note", "promoter_notes"];
const TAG_KEYS = ["tag", "tags", "labels"];
const PHONE_KEYS = ["phone", "phone_e164", "mobile", "mobile_phone", "phone_number"];
const EMAIL_KEYS = ["email", "email_address", "mail"];
const INSTAGRAM_KEYS = ["instagram", "instagram_handle", "ig", "ig_handle", "instagram_username"];
const MANYCHAT_KEYS = ["manychat_id", "manychat_subscriber_id", "subscriber_id"];
const GOOGLE_KEYS = ["google_contact_id", "google_resource_name"];
const WHATSAPP_KEYS = ["whatsapp_id", "whatsapp_phone", "wa_phone"];
const CSV_EXTERNAL_ID_KEYS = ["external_id", "source_id", "row_id", "lead_id"];

const PREFERENCE_COLUMNS: Array<{
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

function normalizeHeader(value: string): string {
  return value
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeWhitespace(value: string | undefined): string {
  return value?.trim() ?? "";
}

function firstValue(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = normalizeWhitespace(row[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function splitMultiValue(value: string): string[] {
  return value
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
    source: "csv",
    isPrimary: identities.length === 0,
  });
}

export function parseCsvRows(text: string): ParsedCsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const headerRow = rows.shift() ?? [];
  const headers = headerRow.map((header, index) => {
    const normalized = normalizeHeader(header) || `column_${index + 1}`;
    return normalized;
  });

  return rows
    .map((rawRow, index) => {
      const values: Record<string, string> = {};
      let hasValue = false;
      for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
        const value = rawRow[columnIndex] ?? "";
        const normalizedValue = normalizeWhitespace(value);
        if (normalizedValue) {
          hasValue = true;
        }
        values[headers[columnIndex]] = normalizedValue;
      }
      if (!hasValue) {
        return null;
      }
      return {
        rowNumber: index + 2,
        values,
      };
    })
    .filter((entry): entry is ParsedCsvRow => entry !== null);
}

export function mapCsvRowToContactInput(row: Record<string, string>): CsvContactDraft {
  const displayName = firstValue(row, DISPLAY_NAME_KEYS);
  const firstName = firstValue(row, FIRST_NAME_KEYS);
  const lastName = firstValue(row, LAST_NAME_KEYS);
  const city = firstValue(row, CITY_KEYS);
  const birthday = firstValue(row, BIRTHDAY_KEYS);
  const note = firstValue(row, NOTE_KEYS);
  const qualityTier = parseQualityTier(firstValue(row, QUALITY_TIER_KEYS));
  const tags = splitMultiValue(firstValue(row, TAG_KEYS));

  const identities: ContactIdentityInput[] = [];
  pushIdentity(identities, {
    channel: "phone",
    phoneE164: firstValue(row, PHONE_KEYS),
  });
  pushIdentity(identities, {
    channel: "email",
    email: firstValue(row, EMAIL_KEYS),
  });
  pushIdentity(identities, {
    channel: "instagram",
    handle: firstValue(row, INSTAGRAM_KEYS),
  });
  pushIdentity(identities, {
    channel: "manychat",
    externalId: firstValue(row, MANYCHAT_KEYS),
  });
  pushIdentity(identities, {
    channel: "google",
    externalId: firstValue(row, GOOGLE_KEYS),
  });
  pushIdentity(identities, {
    channel: "whatsapp",
    externalId: firstValue(row, WHATSAPP_KEYS),
  });
  pushIdentity(identities, {
    channel: "csv",
    externalId: firstValue(row, CSV_EXTERNAL_ID_KEYS),
  });

  const preferences: ContactPreferenceInput[] = [];
  for (const column of PREFERENCE_COLUMNS) {
    const raw = firstValue(row, column.keys);
    for (const value of splitMultiValue(raw)) {
      preferences.push({
        category: column.category,
        preference: column.preference,
        value,
      });
    }
  }

  if (!displayName && !firstName && !lastName && identities.length === 0) {
    return {
      input: null,
      skipReason: "Row has no display name, name parts, or contact identity.",
    };
  }

  const externalId =
    firstValue(row, MANYCHAT_KEYS) ||
    firstValue(row, GOOGLE_KEYS) ||
    firstValue(row, CSV_EXTERNAL_ID_KEYS) ||
    firstValue(row, EMAIL_KEYS) ||
    firstValue(row, PHONE_KEYS) ||
    firstValue(row, INSTAGRAM_KEYS);

  return {
    externalId: externalId || undefined,
    input: {
      displayName: displayName || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      city: city || undefined,
      birthday: birthday || undefined,
      qualityTier,
      identities,
      tags,
      preferences,
      note: note || undefined,
    },
  };
}
