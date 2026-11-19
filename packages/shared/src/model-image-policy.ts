/**
 * Model-image capability policy shared by every request ingress.
 *
 * Providers receive model requests through different transports (the runner
 * model gateway, the desktop model proxy) and protocols (Responses, Chat
 * Completions). Image parts must never be serialized into text for a model
 * that does not accept images: base64 content is tokenized as ordinary text by
 * those upstreams and can consume hundreds of thousands of context tokens.
 *
 * Callers apply this policy to the complete outgoing body before protocol
 * translation so historical items, user attachments and tool results are all
 * covered.
 */

export const modelImageOmittedPlaceholder =
  "[image omitted: the selected model does not support image input]";

export type ModelContentParts = {
  text: string;
  images: Record<string, unknown>[];
};

export type ModelImagePart = Record<string, unknown> & {
  /** Responses uses `input_image`; Chat Completions uses `image_url`. */
  type: "input_image" | "image_url";
};

export function isModelImagePart(value: unknown): value is ModelImagePart {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const type = (value as Record<string, unknown>).type;
  return type === "input_image" || type === "image_url";
}

/**
 * Replaces every image part in a Responses or Chat Completions body with a
 * short text placeholder, in place, and returns the number of replaced parts.
 *
 * Use this for models whose provider settings do not declare image input
 * support. Tool definition trees are skipped because they cannot carry
 * request images and may legitimately contain `type` schemas.
 */
export function omitUnsupportedModelImages(
  body: Record<string, unknown>,
  placeholder: string = modelImageOmittedPlaceholder
): number {
  let replaced = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const child: unknown = value[index];
        if (isModelImagePart(child)) {
          value[index] = imageOmittedPart(child, placeholder);
          replaced += 1;
        } else {
          visit(child);
        }
      }
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (isModelImagePart(record)) {
      // Content parts normally live in arrays; mutate in place if one does not.
      const replacement = imageOmittedPart(record, placeholder);
      for (const key of Object.keys(record)) delete record[key];
      Object.assign(record, replacement);
      replaced += 1;
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "tools" || key === "tool_choice" || key === "parameters") {
        continue;
      }
      visit(child);
    }
  };
  visit(body);
  return replaced;
}

/**
 * Splits Responses content/output parts into text and image parts without
 * dropping either. Used when a tool result must be re-shaped for protocols
 * that cannot carry images inside a tool message.
 */
export function splitModelContentParts(value: unknown): ModelContentParts {
  if (typeof value === "string") return { text: value, images: [] };
  if (value === undefined || value === null) return { text: "", images: [] };
  if (!Array.isArray(value)) {
    return { text: stringify(value), images: [] };
  }
  const text: string[] = [];
  const images: Record<string, unknown>[] = [];
  for (const part of value) {
    if (typeof part === "string") {
      if (part !== "") text.push(part);
      continue;
    }
    if (typeof part !== "object" || part === null || Array.isArray(part)) {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (isModelImagePart(record)) {
      images.push(record);
      continue;
    }
    const type = record.type;
    if (type === "input_text" || type === "output_text" || type === "text") {
      const partText = record.text;
      if (typeof partText === "string" && partText !== "") text.push(partText);
      continue;
    }
    text.push(stringify(record));
  }
  return { text: text.join("\n"), images };
}

function imageOmittedPart(
  part: Record<string, unknown>,
  placeholder: string
): Record<string, unknown> {
  return part.type === "image_url"
    ? { type: "text", text: placeholder }
    : { type: "input_text", text: placeholder };
}

function stringify(value: unknown): string {
  return JSON.stringify(value) ?? "";
}
