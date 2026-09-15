import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"

import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { enUS } from "@/i18n/en-US"
import { zhCN } from "@/i18n/zh-CN"

describe("task project localization", () => {
  it("provides both locales and falls back to Chinese for a missing translation", async () => {
    const instance = createInstance()
    const englishProjects: Record<string, string> = { ...enUS.projects }
    delete englishProjects.choose
    delete englishProjects.noResults
    delete englishProjects.reorderCompleted
    delete englishProjects.clearSelection
    delete englishProjects.projectlessTask
    await instance.init({
      fallbackLng: "zh-CN",
      resources: {
        "zh-CN": { translation: { projects: zhCN.projects } },
        "en-US": { translation: { projects: englishProjects } },
      },
    })
    expect(instance.t("projects.create", { lng: "zh-CN" })).toBe("新建项目")
    expect(instance.t("projects.create", { lng: "en-US" })).toBe("New project")
    expect(instance.t("projects.choose", { lng: "en-US" })).toBe("项目")
    expect(instance.t("projects.search", { lng: "zh-CN" })).toBe("搜索项目")
    expect(instance.t("projects.search", { lng: "en-US" })).toBe(
      "Search projects"
    )
    expect(enUS.projects.noResults).toBe("No matching projects")
    expect(enUS.projects.clearSelection).toBe("Clear project selection")
    expect(enUS.projects.projectlessTask).toBe("Task in common workspace")
    expect(instance.t("projects.projectlessTask", { lng: "zh-CN" })).toBe(
      "公共空间任务"
    )
    expect(instance.t("projects.projectlessTask", { lng: "en-US" })).toBe(
      "公共空间任务"
    )
    expect(instance.t("projects.clearSelection", { lng: "zh-CN" })).toBe(
      "取消项目选择"
    )
    expect(instance.t("projects.clearSelection", { lng: "en-US" })).toBe(
      "取消项目选择"
    )
    expect(zhCN.projects.renameAction).toBe("重命名")
    expect(enUS.projects.renameAction).toBe("Rename")
    expect(
      instance.t("projects.reorderCompleted", {
        lng: "en-US",
        title: "工作",
        position: 2,
      })
    ).toBe("已将项目“工作”移动到第 2 位。")
    expect(enUS.projects.reorderCompleted).toBe(
      "Moved project “{{title}}” to position {{position}}."
    )
    expect(instance.t("projects.noResults", { lng: "en-US" })).toBe(
      "未找到匹配的项目"
    )
    for (const code of ["PROJECT_NAME_EXISTS", "PROJECT_NOT_FOUND"]) {
      expect(
        getErrorMessage(
          new ApiError({ status: 409, errorCode: code }),
          instance.getFixedT("zh-CN")
        )
      ).toMatch(/项目/)
      expect(
        getErrorMessage(
          new ApiError({ status: 409, errorCode: code }),
          instance.getFixedT("en-US")
        )
      ).toMatch(/project/)
    }
  })
})
