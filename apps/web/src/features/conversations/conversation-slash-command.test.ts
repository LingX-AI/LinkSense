// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  findConversationSkillCommandTrigger,
  findConversationTaskReferenceTrigger,
  findConversationSlashCommandTrigger,
  isConversationContextCompactionCommand,
  removeConversationSkillCommandTrigger,
  removeConversationSlashCommandTrigger,
  removeConversationTaskReferenceTrigger,
} from "@/features/conversations/conversation-slash-command"

describe("conversation slash command trigger", () => {
  it("recognizes only standalone context compaction commands", () => {
    expect(isConversationContextCompactionCommand("/压缩")).toBe(true)
    expect(isConversationContextCompactionCommand("  /compact  ")).toBe(true)
    expect(isConversationContextCompactionCommand("请 /压缩")).toBe(false)
    expect(isConversationContextCompactionCommand("/压缩 现在")).toBe(false)
  })

  it("recognizes a slash command at the start or after whitespace", () => {
    expect(findConversationSlashCommandTrigger("/")).toEqual({
      start: 0,
      end: 1,
      query: "",
    })
    expect(findConversationSlashCommandTrigger("整理材料 /skill")).toEqual({
      start: 5,
      end: 11,
      query: "skill",
    })
    expect(findConversationSlashCommandTrigger("第一行\n/知识")).toEqual({
      start: 4,
      end: 7,
      query: "知识",
    })
  })

  it("does not treat URL paths or completed prose as slash commands", () => {
    expect(
      findConversationSlashCommandTrigger("https://example.com/path")
    ).toBeNull()
    expect(findConversationSlashCommandTrigger("请查看/skills")).toBeNull()
    expect(findConversationSlashCommandTrigger("/skills 后续说明")).toBeNull()
  })

  it("consumes only the active slash token", () => {
    const value = "整理材料 /skill"
    const trigger = findConversationSlashCommandTrigger(value)
    expect(trigger).not.toBeNull()
    if (!trigger) return

    const consumed = removeConversationSlashCommandTrigger(value, trigger)
    expect(consumed).toBe("整理材料 ")
  })
})

describe("task @ reference trigger", () => {
  it("opens at a text boundary and supports queries with spaces", () => {
    expect(findConversationTaskReferenceTrigger("@")).toEqual({
      start: 0,
      end: 1,
      query: "",
    })
    expect(
      findConversationTaskReferenceTrigger("Compare @product research")
    ).toEqual({ start: 8, end: 25, query: "product research" })
    expect(
      findConversationTaskReferenceTrigger("First line\n@调研")
    ).toMatchObject({ query: "调研" })
  })
  it("does not treat email addresses or URL paths as task references", () => {
    for (const value of [
      "owner@example.com",
      "https://example.com/@task",
      "@@task",
      "@task\nNext line",
    ])
      expect(findConversationTaskReferenceTrigger(value)).toBeNull()
  })
  it("consumes only the reference at the caret and preserves the remaining draft", () => {
    const value = "Compare @report with the existing plan"
    const caret = "Compare @report".length
    const trigger = findConversationTaskReferenceTrigger(value, caret)
    expect(trigger).toEqual({ start: 8, end: caret, query: "report" })
    expect(removeConversationTaskReferenceTrigger(value, trigger!)).toBe(
      "Compare  with the existing plan"
    )
  })
})

describe("conversation Skill command trigger", () => {
  it("recognizes a Skill command at the start or after whitespace", () => {
    expect(findConversationSkillCommandTrigger("$")).toEqual({
      start: 0,
      end: 1,
      query: "",
    })
    expect(findConversationSkillCommandTrigger("整理材料 $review")).toEqual({
      start: 5,
      end: 12,
      query: "review",
    })
    expect(findConversationSkillCommandTrigger("第一行\n$审查")).toEqual({
      start: 4,
      end: 7,
      query: "审查",
    })
  })

  it("does not treat currency or completed prose as Skill commands", () => {
    expect(findConversationSkillCommandTrigger("价格是$100")).toBeNull()
    expect(findConversationSkillCommandTrigger("$review 后续说明")).toBeNull()
    expect(findConversationSkillCommandTrigger("$$review")).toBeNull()
  })

  it("consumes only the active Skill token", () => {
    const value = "整理材料 $review"
    const trigger = findConversationSkillCommandTrigger(value)
    expect(trigger).not.toBeNull()
    if (!trigger) return

    expect(removeConversationSkillCommandTrigger(value, trigger)).toBe(
      "整理材料 "
    )
  })
})
