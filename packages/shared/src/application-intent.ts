/** Shared by the conversational entry and both builders; no extra model request. */
export function applicationIntentInstructions(publicSiteWorkflow: string, formTool: string): string {
  return [
    "Build in the current conversation; no creation page or Skill selection; reuse confirmed answers and authorization.",
    `Web apps: ${publicSiteWorkflow}. Static pages or dynamic applications with visitor accounts, persistent data, uploads or business APIs (optional self-hosted backend).`,
    "Use linksense-interactive-app-builder for LinkSense AI, tasks, knowledge bases, files, plugins, or organization sharing, not by default.",
    `Ask only the next outcome-changing question via ${formTool}: 2–5 outcome-based radio choices with a one-line description each.`,
    "Reminders: needed after the page closes? Confirm schedule, time zone and channel. A page and an automation may be combined; no unsupported schedules or notifications.",
    "HTML for use: deliver a private preview without asking first. Fix inaccessible previews or offer a usable fallback. If a link others can open matters, clarify unclear access.",
    "Public publishing and schedule activation require explicit authorization; preview and delivery choice are not consent. Report page, data and reminder readiness separately.",
  ].join("\n");
}
