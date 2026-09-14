import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FormEvent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SearchInput } from "@/components/ui/search-input"
import { InputGroup } from "@/components/ui/input-group"
import i18n from "@/i18n"

afterEach(cleanup)

describe("SearchInput", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "clears with a localized custom button and restores input focus in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const onValueChange = vi.fn()
      const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
        event.preventDefault()
      )
      render(
        <form onSubmit={onSubmit}>
          <InputGroup>
            <SearchInput
              type="search"
              value="你好"
              onValueChange={onValueChange}
              aria-label="Search"
            />
          </InputGroup>
        </form>
      )
      const input = screen.getByRole("searchbox")
      const button = screen.getByRole("button", {
        name: language === "en-US" ? "Clear" : "清除",
      })
      expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
      await userEvent.click(button)
      expect(input).toHaveValue("")
      expect(input).toHaveFocus()
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith("")
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
      await userEvent.type(input, "再次搜索")
      expect(input).toHaveValue("再次搜索")
      expect(screen.getByRole("button")).toBeVisible()
    }
  )

  it.each(["disabled", "readOnly"] as const)(
    "cannot clear a %s input",
    async (property) => {
      const onValueChange = vi.fn()
      render(
        <InputGroup>
          <SearchInput
            value="你好"
            onValueChange={onValueChange}
            {...{ [property]: true }}
          />
        </InputGroup>
      )
      const button = screen.getByRole("button")
      expect(button).toBeDisabled()
      await userEvent.click(button)
      expect(screen.getByRole("textbox")).toHaveValue("你好")
      expect(onValueChange).not.toHaveBeenCalled()
    }
  )

  it("keeps the clear button disabled during IME composition and supports keyboard clearing after commit", async () => {
    const onValueChange = vi.fn()
    render(
      <InputGroup>
        <SearchInput value="" onValueChange={onValueChange} />
      </InputGroup>
    )
    const input = screen.getByRole("textbox")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: "ni" }, isComposing: true })
    expect(screen.getByRole("button")).toBeDisabled()
    fireEvent.input(input, { target: { value: "你好" }, isComposing: true })
    fireEvent.compositionEnd(input, { data: "你好" })
    expect(screen.getByRole("button")).toBeEnabled()
    onValueChange.mockClear()
    await userEvent.click(input)
    await userEvent.tab()
    expect(screen.getByRole("button")).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    expect(input).toHaveValue("")
    expect(input).toHaveFocus()
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("")
  })

  it("keeps typing synchronous when the search consumer defers its update", () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <SearchInput aria-label="Search" value="" onValueChange={onValueChange} />
    )
    const input = screen.getByRole("textbox")
    fireEvent.input(input, { target: { value: "report " } })
    expect(input).toHaveValue("report ")
    expect(onValueChange).toHaveBeenLastCalledWith("report ")
    rerender(
      <SearchInput aria-label="Search" value="" onValueChange={onValueChange} />
    )
    expect(input).toHaveValue("report ")
    fireEvent.input(input, { target: { value: "report 2026" } })
    expect(input).toHaveValue("report 2026")
    rerender(
      <SearchInput
        aria-label="Search"
        value="report 2026"
        onValueChange={onValueChange}
      />
    )
    expect(input).toHaveValue("report 2026")
    rerender(
      <SearchInput
        aria-label="Search"
        value="历史"
        onValueChange={onValueChange}
      />
    )
    expect(input).toHaveValue("历史")
    rerender(
      <SearchInput aria-label="Search" value="" onValueChange={onValueChange} />
    )
    expect(input).toHaveValue("")
    expect(onValueChange).toHaveBeenCalledTimes(2)
  })

  it.each(["input-before-end", "input-after-end"])(
    "preserves consecutive Chinese compositions with %s event ordering",
    (order) => {
      const onValueChange = vi.fn()
      render(
        <SearchInput
          aria-label="Search"
          value=""
          onValueChange={onValueChange}
        />
      )
      const input = screen.getByRole("textbox")
      for (const [draft, committed] of [
        ["zhi", "知识"],
        ["知识ku", "知识库"],
      ]) {
        onValueChange.mockClear()
        fireEvent.compositionStart(input)
        fireEvent.input(input, { target: { value: draft }, isComposing: true })
        expect(input).toHaveValue(draft)
        expect(onValueChange).not.toHaveBeenCalled()
        if (order === "input-before-end") {
          fireEvent.input(input, {
            target: { value: committed },
            isComposing: true,
          })
        }
        fireEvent.compositionEnd(input, {
          target: { value: committed },
          data: committed,
        })
        if (order === "input-after-end") {
          fireEvent.input(input, {
            target: { value: committed },
            isComposing: false,
          })
        }
        expect(input).toHaveValue(committed)
        expect(onValueChange).toHaveBeenLastCalledWith(committed)
      }
    }
  )
})
