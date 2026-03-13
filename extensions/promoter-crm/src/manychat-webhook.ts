import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_WEBHOOK_BODY_TIMEOUT_MS,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  readJsonBodyWithLimit,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk/compat";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { withPromoterCrmStore } from "./store.js";

function readHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0]?.trim() ?? "") : (value?.trim() ?? "");
}

function getWebhookSecret(req: IncomingMessage): string {
  const direct =
    readHeader(req.headers["x-promoter-crm-webhook-secret"]) ||
    readHeader(req.headers["x-manychat-secret"]);
  if (direct) {
    return direct;
  }
  const authorization = readHeader(req.headers.authorization);
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return "";
}

function secretsMatch(expected: string, actual: string): boolean {
  if (!expected || !actual) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): true {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
  return true;
}

export function createManychatWebhookHandler(api: OpenClawPluginApi) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<true> => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return true;
    }

    const expectedSecret = process.env.PROMOTER_CRM_MANYCHAT_WEBHOOK_SECRET?.trim() ?? "";
    if (!expectedSecret) {
      return sendJson(res, 503, {
        error: "ManyChat webhook secret is not configured.",
        envVar: "PROMOTER_CRM_MANYCHAT_WEBHOOK_SECRET",
      });
    }

    const providedSecret = getWebhookSecret(req);
    if (!secretsMatch(expectedSecret, providedSecret)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    const body = await readJsonBodyWithLimit(req, {
      maxBytes: DEFAULT_WEBHOOK_MAX_BODY_BYTES,
      timeoutMs: DEFAULT_WEBHOOK_BODY_TIMEOUT_MS,
      emptyObjectOnEmpty: false,
    });
    if (!body.ok) {
      const statusCode =
        body.code === "PAYLOAD_TOO_LARGE" ? 413 : body.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
      return sendJson(res, statusCode, {
        error: body.code === "INVALID_JSON" ? body.error : requestBodyErrorToText(body.code),
      });
    }

    const stateDir = api.runtime.state.resolveStateDir(process.env);
    const result = withPromoterCrmStore({ stateDir }, (store) =>
      store.importManychatPayload({
        payload: body.value,
        sourceLabel: "manychat-webhook",
        initiatedBy: "manychat-webhook",
      }),
    );

    return sendJson(res, 200, {
      ok: true,
      result,
    });
  };
}
