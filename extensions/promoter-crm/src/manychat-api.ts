const MANYCHAT_API_BASE_URL = "https://api.manychat.com";

export type SendManychatTextInput = {
  apiKey: string;
  subscriberId: number;
  text: string;
  messageTag?: string;
  otnTopicName?: string;
};

export type SendManychatTextResult = {
  endpoint: string;
  requestBody: Record<string, unknown>;
  responseStatus: number;
  responseBody: unknown;
};

function parseJsonOrText(bodyText: string): unknown {
  if (!bodyText.trim()) {
    return null;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export function buildManychatTextContent(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("ManyChat reply text is required.");
  }
  return {
    version: "v2",
    content: {
      messages: [
        {
          type: "text",
          text: trimmed,
        },
      ],
      actions: [],
      quick_replies: [],
    },
  };
}

export async function sendManychatText(input: SendManychatTextInput): Promise<SendManychatTextResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("ManyChat API key is required.");
  }
  if (!Number.isInteger(input.subscriberId) || input.subscriberId <= 0) {
    throw new Error("ManyChat subscriber id must be a positive integer.");
  }

  const endpoint = `${MANYCHAT_API_BASE_URL}/fb/sending/sendContent`;
  const requestBody: Record<string, unknown> = {
    subscriber_id: input.subscriberId,
    data: buildManychatTextContent(input.text),
  };
  if (input.messageTag?.trim()) {
    requestBody.message_tag = input.messageTag.trim();
  }
  if (input.otnTopicName?.trim()) {
    requestBody.otn_topic_name = input.otnTopicName.trim();
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const responseText = await response.text();
  const responseBody = parseJsonOrText(responseText);

  if (!response.ok) {
    const details =
      typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody ?? {});
    throw new Error(
      `ManyChat sendContent failed (${response.status} ${response.statusText}): ${details}`,
    );
  }

  return {
    endpoint,
    requestBody,
    responseStatus: response.status,
    responseBody,
  };
}
