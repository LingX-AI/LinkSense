export const requestUserFormUsageInstructions =
  "Call request_user_form whenever you need user confirmation, clarification, a choice, missing information, or feedback. This applies even for a single question or a yes/no decision; the user does not need to ask for a form."

// Keep result and authorization semantics on the discovered tool too: a caller
// must not depend on unrelated workflows in the MCP server description.
export const requestUserFormSafetyInstructions = [
  "Wait for returned answers before dependent work. Submission alone, missing input, cancellation, rejection, timeout, defaults or failure are not consent; explain blockers without performing the dependent action.",
  "Never request passwords, API keys, tokens, credentials or other secrets. A form records intent only; subsequent tools must enforce authorization, freshness, validation and auditing.",
  "Do not replace native tool approvals or the Plan proposed_plan review. Plan forms clarify requirements and decisions; submission cannot authorize implementation or change mode.",
].join(" ")

export const interactiveFormInstructions = [
  requestUserFormUsageInstructions,
  "Also use it for explicitly requested interactive, fillable or selectable forms or cards, even one field. Never substitute Markdown, plain-text questions or html-preview, or claim display without a successful call.",
  "Do not ask again for information or authorization already provided unless scope or circumstances change; continue directly when no response is needed.",
  "Form message: explain the question and why; combine related questions, require only necessary fields. Use single_select for exclusive choices, textarea for open feedback, typed controls otherwise. Write all form text in the user's language plainly.",
  "Use purpose=input for ordinary collection, preferences and feedback. Use purpose=approval only for a clearly described external side effect, with a required two-option decision field and exact approve/reject values. Do not preselect approval.",
  "waiting_policy: required waits indefinitely; optional uses a complete valid recommendation for all fields after 3 minutes without submission. Drafts cannot extend deadlines; approvals require required.",
  requestUserFormSafetyInstructions,
].join("\n")
