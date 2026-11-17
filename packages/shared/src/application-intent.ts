/** Shared by the conversational entry and both builders; no extra model request. */
export function applicationIntentInstructions(publicSiteWorkflow: string, formTool: string): string {
  return [
    "Create apps in the current conversation, new or existing; no creation page or Skill selection; reuse confirmed answers.",
    `Use ${publicSiteWorkflow} for Web apps: static pages or dynamic applications with visitor accounts, persistent data, uploads or business APIs on the self-hosted backend. Backend is optional.`,
    "Use linksense-interactive-app-builder for LinkSense AI, tasks, knowledge bases, files, plugins, or organization sharing. Do not silently default to an interactive application.",
    `Ask only the next outcome-changing question via ${formTool}: 2–5 result-based radio choices; explain what each option means with a one-line description. No technical-type quiz or repeat questions.`,
    "Reminders: clarify whether they must work after the page closes. Resolve schedule, time zone and channel. A page and an automation may be combined; never promise unsupported schedules or visitor notifications.",
    "Preview requests do not authorize public publishing; choosing a delivery shape alone does not authorize publication or schedule activation. Reuse authorization. Report page, data and reminder readiness separately.",
  ].join("\n");
}
