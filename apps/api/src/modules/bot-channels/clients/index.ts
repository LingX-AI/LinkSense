import type { Redis } from "ioredis";
import type { ChannelEncryption } from "../state.js";
import type {
  BotChannelClient,
  ChannelConnectInput,
  ChannelSession,
} from "../types.js";
import { connectDingtalk } from "./dingtalk.js";
import { connectTeams } from "./teams.js";
import { connectWecom } from "./wecom.js";

export class OfficialBotChannelClient implements BotChannelClient {
  constructor(
    private readonly redis: Redis,
    private readonly encryption: ChannelEncryption,
  ) {}
  connect(input: ChannelConnectInput): Promise<ChannelSession> {
    switch (input.credentials.provider) {
      case "wecom":
        return connectWecom(input);
      case "dingtalk":
        return connectDingtalk(input);
      case "teams":
        return connectTeams(input, this.redis, this.encryption);
    }
  }
}
