import { lazy, type ComponentType } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  OFFICE_PREVIEW_ENTER_ANIMATION_NAME,
  OFFICE_PREVIEW_ENTER_CLASS,
  OfficePreviewSuspenseBoundary,
} from "@/components/media/office-preview/office-preview-suspense-boundary"

describe("OfficePreviewSuspenseBoundary", () => {
  afterEach(() => cleanup())

  it("removes the entrance class after a cached preview finishes entering", () => {
    render(
      <OfficePreviewSuspenseBoundary
        fallback={(className) => (
          <aside className={className} data-testid="loading-preview" />
        )}
      >
        {(className) => (
          <aside className={className} data-testid="cached-preview" />
        )}
      </OfficePreviewSuspenseBoundary>
    )

    const preview = screen.getByTestId("cached-preview")
    expect(preview).toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)

    const animationEnd = new Event("animationend", { bubbles: true })
    Object.defineProperty(animationEnd, "animationName", {
      value: OFFICE_PREVIEW_ENTER_ANIMATION_NAME,
    })
    fireEvent(preview, animationEnd)

    expect(preview).not.toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)
  })

  it("removes the entrance class when the cached entrance is cancelled", () => {
    render(
      <OfficePreviewSuspenseBoundary
        fallback={(className) => (
          <aside className={className} data-testid="loading-preview" />
        )}
      >
        {(className) => (
          <aside className={className} data-testid="cached-preview" />
        )}
      </OfficePreviewSuspenseBoundary>
    )

    const preview = screen.getByTestId("cached-preview")
    const animationCancel = new Event("animationcancel", { bubbles: true })
    Object.defineProperty(animationCancel, "animationName", {
      value: OFFICE_PREVIEW_ENTER_ANIMATION_NAME,
    })
    fireEvent(preview, animationCancel)

    expect(preview).not.toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)
  })

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
