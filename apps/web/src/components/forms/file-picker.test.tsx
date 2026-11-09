import { createRef } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { FilePicker } from "./file-picker"

afterEach(cleanup)

it("preserves the native file input, ref, description, and selection callback", async () => {
  const ref = createRef<HTMLInputElement>()
  const onChange = vi.fn()
  render(
    <>
      <label htmlFor="package">Package</label>
      <FilePicker
        id="package"
        ref={ref}
        prompt="Choose a package"
        description="ZIP files only"
        accept=".zip"
        onChange={onChange}
      />
    </>
  )
  const input = screen.getByLabelText("Package")
  expect(input).toBe(ref.current)
  expect(input).toHaveAccessibleDescription("ZIP files only")
  const file = new File(["package"], "test.zip", { type: "application/zip" })
  await userEvent.setup().upload(input, file)
  expect(ref.current?.files?.[0]).toBe(file)
  expect(onChange).toHaveBeenCalledOnce()
})
