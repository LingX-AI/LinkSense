import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog"

afterEach(cleanup)

describe("workspace dialog presentation", () => {
  it.each(["default", "workspace"] as const)(
    "opts into the workspace geometry only for the %s variant",
    (variant) => {
      render(
        <Dialog open>
          <DialogContent variant={variant}>
            <DialogHeader>
              <DialogTitle>Resource configuration</DialogTitle>
              <DialogDescription>
                Configure existing resources.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )
      const dialog = screen.getByRole("dialog", {
        name: "Resource configuration",
      })
      expect(dialog).toHaveAttribute("data-variant", variant)
      if (variant === "workspace") {
        expect(dialog).toHaveClass("sm:max-w-150", "border-0", "ring-inset")
        expect(dialog).not.toHaveClass("sm:max-w-[30rem]")
      } else {
        expect(dialog).toHaveClass("sm:max-w-[30rem]")
        expect(dialog).not.toHaveClass("sm:max-w-150")
      }
    }
  )
})
