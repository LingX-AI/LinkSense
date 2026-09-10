import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"

import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { enUS } from "@/i18n/en-US"
import { zhCN } from "@/i18n/zh-CN"

describe("task category localization", () => {
  it("provides both locales and falls back to Chinese for a missing translation", async () => {
    const instance = createInstance()
    const englishCategories: Record<string, string> = { ...enUS.taskCategories }
    delete englishCategories.choose
    delete englishCategories.noResults
    delete englishCategories.reorderCompleted
    delete englishCategories.clearSelection
    delete englishCategories.unclassifiedTask
    await instance.init({
      fallbackLng: "zh-CN",
      resources: {
        "zh-CN": { translation: { taskCategories: zhCN.taskCategories } },
        "en-US": { translation: { taskCategories: englishCategories } },
      },
    })
    expect(instance.t("taskCategories.create", { lng: "zh-CN" })).toBe(
      "新建任务分类"
    )
    expect(instance.t("taskCategories.create", { lng: "en-US" })).toBe(
      "New task category"
    )
    expect(instance.t("taskCategories.choose", { lng: "en-US" })).toBe(
      "任务分类"
    )
    expect(instance.t("taskCategories.search", { lng: "zh-CN" })).toBe(
      "搜索分类"
    )
    expect(instance.t("taskCategories.search", { lng: "en-US" })).toBe(
      "Search categories"
    )
    expect(enUS.taskCategories.noResults).toBe("No matching categories")
    expect(enUS.taskCategories.clearSelection).toBe("Clear category selection")
    expect(enUS.taskCategories.unclassifiedTask).toBe("Unclassified task")
    expect(instance.t("taskCategories.unclassifiedTask", { lng: "zh-CN" })).toBe(
      "未分类任务"
    )
    expect(instance.t("taskCategories.unclassifiedTask", { lng: "en-US" })).toBe(
      "未分类任务"
    )
    expect(instance.t("taskCategories.clearSelection", { lng: "zh-CN" })).toBe(
      "取消分类选择"
    )
    expect(instance.t("taskCategories.clearSelection", { lng: "en-US" })).toBe(
      "取消分类选择"
    )
    expect(zhCN.taskCategories.renameAction).toBe("重命名")
    expect(enUS.taskCategories.renameAction).toBe("Rename")
    expect(
      instance.t("taskCategories.reorderCompleted", {
        lng: "en-US",
        title: "工作",
        position: 2,
      })
    ).toBe("已将分类“工作”移动到第 2 位。")
    expect(enUS.taskCategories.reorderCompleted).toBe(
      "Moved category “{{title}}” to position {{position}}."
    )
    expect(instance.t("taskCategories.noResults", { lng: "en-US" })).toBe(
      "未找到匹配的分类"
    )
    for (const code of [
      "TASK_CATEGORY_NAME_EXISTS",
      "TASK_CATEGORY_NOT_FOUND",
    ]) {
      expect(
        getErrorMessage(
          new ApiError({ status: 409, errorCode: code }),
          instance.getFixedT("zh-CN")
        )
      ).toMatch(/分类/)
      expect(
        getErrorMessage(
          new ApiError({ status: 409, errorCode: code }),
          instance.getFixedT("en-US")
        )
      ).toMatch(/category/)
    }
  })
})
