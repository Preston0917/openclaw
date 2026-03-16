import type { OpenClawConfig } from "openclaw/plugin-sdk/bluebubbles";
import type { ResolvedBlueBubblesAccount } from "./accounts.js";
import { normalizeWebhookMessage } from "./monitor-normalize.js";
import { processMessage } from "./monitor-processing.js";
import type {
  BlueBubblesCoreRuntime,
  BlueBubblesRuntimeEnv,
  WebhookTarget,
} from "./monitor-shared.js";
import type { BlueBubblesServerInfo } from "./probe.js";
import { buildBlueBubblesApiUrl, blueBubblesFetchWithTimeout } from "./types.js";

type BlueBubblesPollingTarget = {
  account: ResolvedBlueBubblesAccount;
  config: OpenClawConfig;
  runtime: BlueBubblesRuntimeEnv;
  core: BlueBubblesCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

type PolledBlueBubblesMessage = Record<string, unknown>;

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_INITIAL_LOOKBACK_MS = 15 * 60 * 1_000;
const DEFAULT_POLL_LIMIT = 100;
const SEEN_MESSAGE_TTL_MS = 30 * 60 * 1_000;
const MAX_SEEN_MESSAGE_IDS = 2_048;

function trimOrNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function clampPollingInterval(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.max(1_000, Math.floor(value as number));
}

function clampInitialLookback(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_INITIAL_LOOKBACK_MS;
  }
  return Math.max(0, Math.floor(value as number));
}

function getTimestampFromMessage(record: Record<string, unknown>): number {
  const raw =
    (typeof record.dateCreated === "number" ? record.dateCreated : null) ??
    (typeof record.date === "number" ? record.date : null) ??
    (typeof record.timestamp === "number" ? record.timestamp : null) ??
    0;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return raw > 1_000_000_000_000 ? raw : raw * 1_000;
}

function buildSeenMessageKey(record: Record<string, unknown>): string {
  const guid = typeof record.guid === "string" ? record.guid.trim() : "";
  if (guid) {
    return `guid:${guid}`;
  }
  const rowId =
    typeof record.originalROWID === "number"
      ? record.originalROWID
      : typeof record.rowid === "number"
        ? record.rowid
        : null;
  if (rowId !== null) {
    return `row:${rowId}`;
  }
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const date = getTimestampFromMessage(record);
  return `fallback:${text}:${date}`;
}

function pruneSeenMessageIds(seen: Map<string, number>, now = Date.now()): void {
  const cutoff = now - SEEN_MESSAGE_TTL_MS;
  for (const [key, value] of seen) {
    if (value < cutoff) {
      seen.delete(key);
    }
  }
  while (seen.size > MAX_SEEN_MESSAGE_IDS) {
    const oldest = seen.keys().next().value;
    if (!oldest) {
      break;
    }
    seen.delete(oldest);
  }
}

async function fetchPolledBlueBubblesMessages(params: {
  account: ResolvedBlueBubblesAccount;
  afterMs: number;
  limit?: number;
}): Promise<PolledBlueBubblesMessage[]> {
  const baseUrl = trimOrNull(params.account.baseUrl);
  const password = trimOrNull(params.account.config.password);
  if (!baseUrl || !password) {
    return [];
  }
  const url = buildBlueBubblesApiUrl({
    baseUrl,
    path: "/api/v1/message/query",
    password,
  });
  const body = {
    after: Math.max(0, params.afterMs),
    limit: params.limit ?? DEFAULT_POLL_LIMIT,
    offset: 0,
    sort: "ASC",
    with: ["attachments", "chats", "chat.participants"],
  };
  const res = await blueBubblesFetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    10_000,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const payload = (await res.json().catch(() => null)) as {
    data?: unknown;
    metadata?: { count?: number };
  } | null;
  if (!payload || !Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.filter(
    (entry): entry is PolledBlueBubblesMessage =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

export function shouldUseBlueBubblesPollingFallback(params: {
  account: ResolvedBlueBubblesAccount;
  serverInfo?: BlueBubblesServerInfo | null;
}): boolean {
  const configured = params.account.config.polling?.enabled;
  if (configured === true) {
    return true;
  }
  if (configured === false) {
    return false;
  }
  return params.serverInfo?.helper_connected === false;
}

export function startBlueBubblesPollingFallback(params: {
  account: ResolvedBlueBubblesAccount;
  config: OpenClawConfig;
  runtime: BlueBubblesRuntimeEnv;
  core: BlueBubblesCoreRuntime;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  serverInfo?: BlueBubblesServerInfo | null;
}): () => void {
  const enabled = shouldUseBlueBubblesPollingFallback({
    account: params.account,
    serverInfo: params.serverInfo,
  });
  if (!enabled) {
    return () => {};
  }

  const intervalMs = clampPollingInterval(params.account.config.polling?.intervalMs);
  const initialLookbackMs = clampInitialLookback(params.account.config.polling?.initialLookbackMs);
  const seenMessageIds = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let cursorMs = Date.now() - initialLookbackMs;
  let running = false;

  const target: WebhookTarget = {
    account: params.account,
    config: params.config,
    runtime: params.runtime,
    core: params.core,
    path: "",
    statusSink: params.statusSink,
  };

  const stop = () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (delayMs = intervalMs) => {
    if (stopped || params.abortSignal.aborted) {
      return;
    }
    timer = setTimeout(run, delayMs);
  };

  const run = async () => {
    if (stopped || params.abortSignal.aborted || running) {
      return;
    }
    running = true;
    try {
      pruneSeenMessageIds(seenMessageIds);
      const fetchAfter = Math.max(0, cursorMs - 1);
      const messages = await fetchPolledBlueBubblesMessages({
        account: params.account,
        afterMs: fetchAfter,
      });

      for (const record of messages) {
        const seenKey = buildSeenMessageKey(record);
        if (seenMessageIds.has(seenKey)) {
          const timestamp = getTimestampFromMessage(record);
          if (timestamp > cursorMs) {
            cursorMs = timestamp;
          }
          continue;
        }

        seenMessageIds.set(seenKey, Date.now());
        const timestamp = getTimestampFromMessage(record);
        if (timestamp > cursorMs) {
          cursorMs = timestamp;
        }

        const normalized = normalizeWebhookMessage({ type: "new-message", data: record });
        if (!normalized) {
          continue;
        }
        await processMessage(normalized, target);
      }
    } catch (error) {
      params.runtime.error?.(
        `[${params.account.accountId}] BlueBubbles polling fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
      schedule();
    }
  };

  params.runtime.log?.(
    `[${params.account.accountId}] BlueBubbles polling fallback enabled (interval=${intervalMs}ms, helper_connected=${params.serverInfo?.helper_connected ?? "unknown"})`,
  );

  if (params.abortSignal.aborted) {
    stop();
    return stop;
  }
  params.abortSignal.addEventListener("abort", stop, { once: true });
  schedule(0);
  return stop;
}
