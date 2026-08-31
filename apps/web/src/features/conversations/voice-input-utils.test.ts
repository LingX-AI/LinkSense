import { beforeEach, describe, expect, it } from "vitest"

import { ApiError } from "@/api/client"
import {
  appendVoiceTranscript,
  getVoiceInputFailureMessage,
} from "@/features/conversations/voice-input-utils"
import i18n from "@/i18n"

describe("voice input utilities", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  it("appends a normalized transcript without changing existing spacing", () => {
    expect(appendVoiceTranscript("", "  修改标题  ")).toBe("修改标题")
    expect(appendVoiceTranscript("请", "修改标题")).toBe("请 修改标题")
    expect(appendVoiceTranscript("请 ", "修改标题")).toBe("请 修改标题")
    expect(appendVoiceTranscript("请", "   ")).toBe("请")
  })

  it("localizes recording failures in Chinese and English", async () => {
    expect(
      getVoiceInputFailureMessage({ kind: "permission_denied" }, i18n.t)
    ).toBe("麦克风权限未开启，请允许当前页面使用麦克风后重试。")

    await i18n.changeLanguage("en-US")
    expect(
      getVoiceInputFailureMessage(
        {
          kind: "service_failed",
          cause: new ApiError({
            status: 408,
            errorCode: "VOICE_TRANSCRIPTION_TIMEOUT",
          }),
        },
        i18n.t
      )
    ).toBe("Speech recognition timed out. Try again.")
  })
})
