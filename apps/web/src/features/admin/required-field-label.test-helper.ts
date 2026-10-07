import { expect } from "vitest"

export function formLabelPattern(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\*?$`)
}

export function expectRequiredLabel(
  control: HTMLElement,
  required = true
): void {
  const label = Array.from(document.querySelectorAll("label")).find(
    (candidate) => candidate.htmlFor === control.id
  )
  expect(label, `Label for ${control.id}`).toBeDefined()
  const indicator = label?.querySelector('span[aria-hidden="true"]')
  if (required) {
    expect(indicator).toHaveTextContent("*")
    expect(indicator).toHaveClass("text-destructive")
    expect(label?.lastElementChild).toBe(indicator)
  } else {
    expect(indicator).toBeNull()
  }
}
