import type { ProjectColor } from "@linksense/shared"

export const projectColorClasses: Record<ProjectColor, string> = {
  default: "text-foreground",
  red: "text-[var(--project-icon-red)]",
  orange: "text-[var(--project-icon-orange)]",
  yellow: "text-[var(--project-icon-yellow)]",
  green: "text-[var(--project-icon-green)]",
  blue: "text-[var(--project-icon-blue)]",
  purple: "text-[var(--project-icon-purple)]",
  pink: "text-[var(--project-icon-pink)]",
  teal: "text-[var(--project-icon-teal)]",
  cyan: "text-[var(--project-icon-cyan)]",
  brown: "text-[var(--project-icon-brown)]",
  gray: "text-[var(--project-icon-gray)]",
}
