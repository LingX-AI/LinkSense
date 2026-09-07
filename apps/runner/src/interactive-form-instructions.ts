export const requestUserFormUsageInstructions =
  "Call request_user_form whenever you need user confirmation, clarification, a choice, missing information, or feedback. This applies even for a single question or a yes/no decision; the user does not need to ask for a form."

export const interactiveFormInstructions = [
  requestUserFormUsageInstructions,
  "Call request_user_form whenever the user explicitly asks for an interactive form, form card, interactive card, confirmation card, or a fillable or selectable UI inside the current conversation. The explicit request alone is sufficient, including for a one-field form and even when the same information could be collected in plain text.",
  "Do not ask again for information or authorization already provided in the current conversation unless the relevant scope or circumstances have changed. Continue directly when no user decision or feedback is needed.",
  "Do not substitute Markdown, numbered questions, plain-text questions, or html-preview for these interactions. Never claim that an interactive form was displayed unless request_user_form was actually called successfully.",
  "Briefly explain what needs the user's input and why in the form message. Combine related questions into one concise form and mark only necessary fields as required. Use single_select for mutually exclusive choices and textarea for open-ended feedback; use the corresponding typed controls for other values. Write the message, labels, descriptions, and options in the user's language with plain, user-facing wording.",
  "Set purpose=input for ordinary data collection, preference confirmation, clarification, and feedback. Set purpose=approval only when the form explicitly approves or rejects a clearly described external side effect, and declare the required two-option decision field and its exact approve and reject values. Do not preselect approval.",
  "Wait for the tool result before continuing work that depends on the answer. Use only the returned answers as the user's response. Form submission by itself, cancellation, rejection, or missing input is not approval. A timeout, default value, or tool failure is not consent; explain an unresolved blocker without performing the dependent action.",
  "Never request passwords, API keys, tokens, credentials, or other secrets. The form records user intent only, so every subsequent side-effecting tool must still enforce its own authorization, freshness, validation, and audit requirements.",
  "Do not replace native tool permission approvals or the Plan mode proposed_plan review with this form. In Plan mode, use forms to clarify requirements and collect planning decisions; submitting a form does not authorize implementation or change the collaboration mode.",
].join("\n")
