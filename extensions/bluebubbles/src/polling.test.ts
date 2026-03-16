import { describe, expect, it } from "vitest";
import type { ResolvedBlueBubblesAccount } from "./accounts.js";
import { shouldUseBlueBubblesPollingFallback } from "./polling.js";

function createAccount(
  overrides: Partial<ResolvedBlueBubblesAccount["config"]> = {},
): ResolvedBlueBubblesAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    baseUrl: "http://127.0.0.1:1234",
    config: {
      serverUrl: "http://127.0.0.1:1234",
      password: "test-password",
      dmPolicy: "open",
      groupPolicy: "open",
      ...overrides,
    },
  };
}

describe("shouldUseBlueBubblesPollingFallback", () => {
  it("respects explicit polling enablement", () => {
    const enabled = shouldUseBlueBubblesPollingFallback({
      account: createAccount({ polling: { enabled: true } }),
      serverInfo: { helper_connected: true },
    });
    expect(enabled).toBe(true);
  });

  it("respects explicit polling disablement", () => {
    const enabled = shouldUseBlueBubblesPollingFallback({
      account: createAccount({ polling: { enabled: false } }),
      serverInfo: { helper_connected: false },
    });
    expect(enabled).toBe(false);
  });

  it("auto-enables polling when the BlueBubbles helper is disconnected", () => {
    const enabled = shouldUseBlueBubblesPollingFallback({
      account: createAccount(),
      serverInfo: { helper_connected: false },
    });
    expect(enabled).toBe(true);
  });

  it("keeps polling off when helper connectivity is healthy or unknown", () => {
    expect(
      shouldUseBlueBubblesPollingFallback({
        account: createAccount(),
        serverInfo: { helper_connected: true },
      }),
    ).toBe(false);
    expect(
      shouldUseBlueBubblesPollingFallback({
        account: createAccount(),
        serverInfo: undefined,
      }),
    ).toBe(false);
  });
});
