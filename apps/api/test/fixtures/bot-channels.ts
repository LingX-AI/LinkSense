import type { BotChannelCredentials } from "@linksense/shared";
export const testCredentials: BotChannelCredentials[] = [
  {
    provider: "wecom",
    bot_id: "aib-test",
    secret: "test-secret",
  },
  {
    provider: "dingtalk",
    client_id: "ding-test",
    client_secret: "test-secret",
  },
  {
    provider: "teams",
    client_id: "11111111-1111-4111-8111-111111111111",
    client_secret: "test-secret",
    tenant_id: "22222222-2222-4222-8222-222222222222",
  },
];
export function platformPayload(provider: string, group = false) {
  if (provider === "wecom")
    return {
      msgid: "m1",
      aibotid: "aib-test",
      chattype: group ? "group" : "single",
      chatid: group ? "group1" : undefined,
      from: { userid: "member" },
      msgtype: "text",
      text: { content: "hello" },
    };
  if (provider === "dingtalk")
    return {
      msgId: "m1",
      robotCode: "ding-test",
      conversationId: "group1",
      conversationType: group ? "2" : "1",
      senderId: "member",
      senderStaffId: "member",
      msgtype: "text",
      text: { content: "hello" },
      createAt: 1_780_000_000_000,
      isInAtList: group,
    };
  return {
    type: "message",
    id: "1780000000000",
    channelId: "msteams",
    text: "<at>LinkSense</at> hello",
    serviceUrl: "https://smba.trafficmanager.net/amer/",
    from: { aadObjectId: "33333333-3333-4333-8333-333333333333", role: "user" },
    recipient: { id: "bot-id" },
    conversation: {
      id: "group1",
      conversationType: group ? "channel" : "personal",
    },
    channelData: { tenant: { id: "22222222-2222-4222-8222-222222222222" } },
    entities: [{ type: "mention", mentioned: { id: "bot-id" } }],
  };
}
