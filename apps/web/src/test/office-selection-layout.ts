import { platform } from "@floating-ui/react-dom"
import { vi } from "vitest"

/** Supply the viewport and button measurements that jsdom cannot lay out. */
export function mockOfficeSelectionLayout() {
  vi.spyOn(platform, "getClippingRect").mockResolvedValue({
    x: 0,
    y: 0,
    width: 2000,
    height: 2000,
  })
  const getDimensions = platform.getDimensions
  vi.spyOn(platform, "getDimensions").mockImplementation((element) =>
    element.classList.contains("office-selection-action")
      ? { width: 144, height: 28 }
      : getDimensions(element)
  )
}
