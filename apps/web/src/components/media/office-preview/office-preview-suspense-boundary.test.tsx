import { lazy, type ComponentType } from "react"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  OFFICE_PREVIEW_ENTER_CLASS,
  OfficePreviewSuspenseBoundary,
} from "@/components/media/office-preview/office-preview-suspense-boundary"

describe("OfficePreviewSuspenseBoundary", () => {
  it("does not restart the entrance animation when a presented fallback is replaced", async () => {
    let resolvePreview:
      | ((module: { default: ComponentType<{ className?: string }> }) => void)
      | undefined
    const DeferredPreview = lazy(
      () =>
        new Promise<{
          default: ComponentType<{ className?: string }>
        }>((resolve) => {
          resolvePreview = resolve
        })
    )

    render(
      <OfficePreviewSuspenseBoundary
        fallback={(className) => (
          <aside className={className} data-testid="loading-preview" />
        )}
      >
        {(className) => <DeferredPreview className={className} />}
      </OfficePreviewSuspenseBoundary>
    )

    expect(screen.getByTestId("loading-preview")).toHaveClass(
      OFFICE_PREVIEW_ENTER_CLASS
    )

    await act(async () => {
      resolvePreview?.({
        default: ({ className }) => (
          <aside className={className} data-testid="resolved-preview" />
        ),
      })
    })

    expect(await screen.findByTestId("resolved-preview")).not.toHaveClass(
      OFFICE_PREVIEW_ENTER_CLASS
    )
  })
})
