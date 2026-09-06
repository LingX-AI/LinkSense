import { describe, expect, it } from "vitest";
import {
  botChannelCreateSchema,
  botChannelConnectionSchema,
} from "@linksense/shared";
import {
  projectChannelMessage,
  validTeamsServiceUrl,
} from "../src/modules/bot-channels/clients/message-projection.js";
import {
  encryptChannelCredentials,
  decryptChannelCredentials,
  encryptReplyContext,
  decryptReplyContext,
} from "../src/modules/bot-channels/state.js";
import { boundedChunks } from "../src/modules/bot-channels/runtime.js";
import { backendI18n, translateBackend } from "../src/lib/i18n.js";

import { testCredentials, platformPayload } from "./fixtures/bot-channels.js";

describe.each(testCredentials)("$provider message boundary", (credentials) => {
  it("projects an authorized direct text message and its reply route", () => {
    const message = projectChannelMessage(
      credentials,
      platformPayload(credentials.provider),
    );
    expect(message).toMatchObject({
      text: "hello",
      senderId: credentials.allowed_sender_id,
      group: false,
      context: { provider: credentials.provider },
    });
  });
  it("projects an authorized group mention", () => {
    expect(
      projectChannelMessage(
        credentials,
        platformPayload(credentials.provider, true),
      ),
    ).toMatchObject({ text: "hello", group: true });
  });
  it("rejects a different sender and groups disabled by the owner", () => {
    expect(
      projectChannelMessage(
        { ...credentials, allowed_sender_id: "another" },
        platformPayload(credentials.provider),
      ),
    ).toBeNull();
    expect(
      projectChannelMessage(
        { ...credentials, allow_group_messages: false },
        platformPayload(credentials.provider, true),
      ),
    ).toBeNull();
  });
  it("ignores malformed and unsupported payloads", () => {
    for (const value of [
      null,
      {},
      [],
      "hello",
      { ...platformPayload(credentials.provider), text: undefined },
    ])
      expect(projectChannelMessage(credentials, value)).toBeNull();
  });
  it("validates configuration without permitting extra credentials or empty secrets", () => {
    expect(botChannelCreateSchema.safeParse(credentials).success).toBe(true);
    expect(
      botChannelCreateSchema.safeParse({ ...credentials, secret: "" }).success,
    ).toBe(false);
    expect(
      botChannelCreateSchema.safeParse({ ...credentials, arbitrary: true })
        .success,
    ).toBe(false);
  });
});

it("preserves Teams channel threads and rejects cross-tenant or unmentioned group activity", () => {
  const credentials = testCredentials[2]!;
  const payload = platformPayload("teams", true);
  expect(
    projectChannelMessage(credentials, {
      ...payload,
      replyToId: "1780000000001",
    })?.chatId,
  ).toBe("group1;messageid=1780000000001");
  expect(
    projectChannelMessage(credentials, { ...payload, entities: [] }),
  ).toBeNull();
  expect(
    projectChannelMessage(credentials, {
      ...payload,
      channelData: { tenant: { id: "44444444-4444-4444-8444-444444444444" } },
    }),
  ).toBeNull();
  expect(
    projectChannelMessage(credentials, {
      ...payload,
      serviceUrl: "http://127.0.0.1",
    }),
  ).toBeNull();
});

it("rejects DingTalk group callbacks without a bot mention", () => {
  expect(
    projectChannelMessage(testCredentials[1]!, {
      ...platformPayload("dingtalk", true),
      isInAtList: false,
    }),
  ).toBeNull();
});

it("restricts Teams reply destinations to the public Teams service", () => {
  for (const url of [
    "http://smba.trafficmanager.net",
    "https://smba.trafficmanager.net.attacker.test",
    "https://attacker.test",
    "https://user@smba.trafficmanager.net",
    "https://smba.trafficmanager.net:444",
  ])
    expect(validTeamsServiceUrl(url)).toBe(false);
  expect(
    validTeamsServiceUrl("https://smba.infra.teams.microsoft.com/teams/"),
  ).toBe(true);
});

it("encrypts credentials and binds ciphertext to the connection or inbound record", () => {
  const encryption = {
    masterKey: Buffer.alloc(32, 9).toString("base64"),
    keyId: "bot-test",
  };
  const encryptedCredentials = encryptChannelCredentials(
    "c1",
    testCredentials[0]!,
    encryption,
  );
  expect(encryptedCredentials).not.toContain("test-secret");
  const row = {
    id: "c1",
    encryptedCredentials,
    encryptionKeyId: encryption.keyId,
  } as Parameters<typeof decryptChannelCredentials>[0];
  expect(decryptChannelCredentials(row, encryption)).toEqual(
    testCredentials[0],
  );
  expect(() =>
    decryptChannelCredentials({ ...row, id: "c2" }, encryption),
  ).toThrow();
  const context = { provider: "wecom" as const, chatId: "member" };
  const encryptedContext = encryptReplyContext("m1", context, encryption);
  const inbound = {
    id: "m1",
    encryptedContext,
    encryptionKeyId: encryption.keyId,
  } as Parameters<typeof decryptReplyContext>[0];
  expect(decryptReplyContext(inbound, encryption)).toEqual(context);
  expect(() =>
    decryptReplyContext({ ...inbound, id: "m2" }, encryption),
  ).toThrow();
  expect(
    botChannelConnectionSchema.safeParse({ ...row, secret: "test-secret" })
      .success,
  ).toBe(false);
});

it("chunks multibyte replies without damaging characters and bounds large answers", () => {
  const text = "你好😀".repeat(500);
  const chunks = boundedChunks(text, "zh-CN");
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 3500)).toBe(true);
  expect(boundedChunks("a".repeat(40000), "en-US")).toHaveLength(10);
});

it("provides localized task responses and Chinese fallback", () => {
  for (const key of [
    "processingFailed",
    "taskFailed",
    "emptyResponse",
    "longResponse",
  ]) {
    const full = `botChannels.${key}`;
    expect(translateBackend(full, "zh-CN")).not.toBe(full);
    expect(translateBackend(full, "en-US")).not.toBe(
      translateBackend(full, "zh-CN"),
    );
    expect(backendI18n.t(full, { lng: "fr" })).toBe(
      translateBackend(full, "zh-CN"),
    );
  }
});
