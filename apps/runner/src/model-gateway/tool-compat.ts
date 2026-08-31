import { createHash } from "node:crypto";

const DEFAULT_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const TOOL_SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

type JsonObject = Record<string, unknown>;

type ToolMapping =
  | {
      kind: "namespace";
      alias: string;
      namespace: string;
      name: string;
      parameters: JsonObject;
    }
  | {
      kind: "custom";
      alias: string;
      name: string;
    }
  | {
      kind: "tool_search";
      alias: string;
    };

export type ToolCompatibilityContext = {
  mappingsByAlias: Map<string, ToolMapping>;
  namespaceAliases: Map<string, string>;
  customAliases: Map<string, string>;
  toolSearchAlias: string | null;
  rewrittenItemIds: Set<string>;
  usedFunctionNames: Set<string>;
};

export type TranslatedResponsesRequest = {
  body: JsonObject;
  context: ToolCompatibilityContext;
};

export function translateResponsesRequest(
  source: JsonObject,
): TranslatedResponsesRequest {
  const body = { ...source };
  const originalInput = Array.isArray(source.input) ? source.input : [];
  const { input, liftedTools } = liftAdditionalTools(originalInput);
  const declaredTools = [
    ...(Array.isArray(source.tools) ? source.tools : []),
    ...liftedTools,
  ];
  const discoveredTools = input.flatMap((item) =>
    isRecord(item) &&
    item.type === "tool_search_output" &&
    Array.isArray(item.tools)
      ? item.tools
      : [],
  );
  const allToolDefinitions = [...declaredTools, ...discoveredTools];
  const context = createContext(allToolDefinitions);
  registerHistoricalMappings(input, context);
  const translatedTools = allToolDefinitions.flatMap((tool) =>
    translateToolDefinition(tool, context),
  );

  body.input = input.map((item) => translateInputItem(item, context));
  body.tools = deduplicateFunctionTools(translatedTools);
  return { body, context };
}

export function rewriteResponsesPayload(
  source: unknown,
  context: ToolCompatibilityContext,
): unknown | null {
  if (!isRecord(source)) return source;
  const type = stringValue(source.type);
  if (
    (type === "response.function_call_arguments.delta" ||
      type === "response.function_call_arguments.done") &&
    typeof source.item_id === "string" &&
    context.rewrittenItemIds.has(source.item_id)
  ) {
    return null;
  }

  const result: JsonObject = { ...source };
  if (isRecord(source.item)) {
    result.item = rewriteOutputItem(source.item, context);
  }
  if (isRecord(source.response) && Array.isArray(source.response.output)) {
    result.response = {
      ...source.response,
      output: source.response.output.map((item) =>
        isRecord(item) ? rewriteOutputItem(item, context) : item,
      ),
    };
  }
  if (Array.isArray(source.output)) {
    result.output = source.output.map((item) =>
      isRecord(item) ? rewriteOutputItem(item, context) : item,
    );
  }
  return result;
}

function createContext(tools: unknown[]): ToolCompatibilityContext {
  const usedFunctionNames = new Set(
    tools.flatMap((tool) =>
      isRecord(tool) &&
      tool.type === "function" &&
      typeof tool.name === "string"
        ? [tool.name]
        : [],
    ),
  );
  const context: ToolCompatibilityContext = {
    mappingsByAlias: new Map(),
    namespaceAliases: new Map(),
    customAliases: new Map(),
    toolSearchAlias: null,
    rewrittenItemIds: new Set(),
    usedFunctionNames,
  };
  for (const tool of tools) registerToolDefinition(tool, context);
  return context;
}

function registerToolDefinition(
  source: unknown,
  context: ToolCompatibilityContext,
): void {
  if (!isRecord(source)) return;
  if (
    source.type === "namespace" &&
    typeof source.name === "string" &&
    Array.isArray(source.tools)
  ) {
    for (const child of source.tools) {
      if (!isRecord(child) || typeof child.name !== "string") continue;
      const key = namespaceKey(source.name, child.name);
      if (context.namespaceAliases.has(key)) continue;
      const alias = reserveAlias(
        `${source.name}__${child.name}`,
        `namespace:${key}`,
        context,
      );
      const mapping: ToolMapping = {
        kind: "namespace",
        alias,
        namespace: source.name,
        name: child.name,
        parameters: isRecord(child.parameters)
          ? child.parameters
          : { ...DEFAULT_PARAMETERS },
      };
      context.namespaceAliases.set(key, alias);
      context.mappingsByAlias.set(alias, mapping);
    }
    return;
  }
  if (source.type === "custom" && typeof source.name === "string") {
    if (context.customAliases.has(source.name)) return;
    const alias = reserveAlias(
      source.name,
      `custom:${source.name}`,
      context,
    );
    context.customAliases.set(source.name, alias);
    context.mappingsByAlias.set(alias, {
      kind: "custom",
      alias,
      name: source.name,
    });
    return;
  }
  if (source.type === "tool_search" && context.toolSearchAlias === null) {
    const alias = reserveAlias("tool_search", "tool_search", context);
    context.toolSearchAlias = alias;
    context.mappingsByAlias.set(alias, {
      kind: "tool_search",
      alias,
    });
  }
}

function registerHistoricalMappings(
  input: unknown[],
  context: ToolCompatibilityContext,
): void {
  for (const item of input) {
    if (!isRecord(item)) continue;
    if (
      (item.type === "tool_search_call" ||
        item.type === "tool_search_output") &&
      context.toolSearchAlias === null
    ) {
      const alias = reserveAlias("tool_search", "tool_search", context);
      context.toolSearchAlias = alias;
      context.mappingsByAlias.set(alias, {
        kind: "tool_search",
        alias,
      });
      continue;
    }
    if (
      (item.type === "custom_tool_call" ||
        item.type === "custom_tool_call_output") &&
      typeof item.name === "string" &&
      !context.customAliases.has(item.name)
    ) {
      const alias = reserveAlias(
        item.name,
        `custom:${item.name}`,
        context,
      );
      context.customAliases.set(item.name, alias);
      context.mappingsByAlias.set(alias, {
        kind: "custom",
        alias,
        name: item.name,
      });
      continue;
    }
    if (
      item.type === "function_call" &&
      typeof item.namespace === "string" &&
      typeof item.name === "string"
    ) {
      const key = namespaceKey(item.namespace, item.name);
      if (context.namespaceAliases.has(key)) continue;
      const alias = reserveAlias(
        `${item.namespace}__${item.name}`,
        `namespace:${key}`,
        context,
      );
      context.namespaceAliases.set(key, alias);
      context.mappingsByAlias.set(alias, {
        kind: "namespace",
        alias,
        namespace: item.namespace,
        name: item.name,
        parameters: { ...DEFAULT_PARAMETERS },
      });
    }
  }
}

function translateToolDefinition(
  source: unknown,
  context: ToolCompatibilityContext,
): unknown[] {
  if (!isRecord(source)) return [source];
  if (
    source.type === "namespace" &&
    typeof source.name === "string" &&
    Array.isArray(source.tools)
  ) {
    return source.tools.flatMap((child) => {
      if (!isRecord(child) || typeof child.name !== "string") return [];
      const alias = context.namespaceAliases.get(
        namespaceKey(source.name as string, child.name),
      );
      if (!alias) return [];
      return [
        {
          type: "function",
          name: alias,
          description: stringValue(child.description),
          strict: child.strict === true,
          parameters: isRecord(child.parameters)
            ? child.parameters
            : DEFAULT_PARAMETERS,
        },
      ];
    });
  }
  if (source.type === "custom" && typeof source.name === "string") {
    const alias = context.customAliases.get(source.name);
    if (!alias) return [];
    return [
      {
        type: "function",
        name: alias,
        description: stringValue(source.description),
        strict: false,
        parameters: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description: "Freeform input for this tool.",
            },
          },
          required: ["input"],
          additionalProperties: false,
        },
      },
    ];
  }
  if (source.type === "tool_search") {
    const alias = context.toolSearchAlias;
    if (!alias) return [];
    return [
      {
        type: "function",
        name: alias,
        description:
          stringValue(source.description) ||
          "Search the deferred tool catalog by query.",
        strict: false,
        parameters: isRecord(source.parameters)
          ? source.parameters
          : TOOL_SEARCH_PARAMETERS,
      },
    ];
  }
  return [source];
}

function translateInputItem(
  source: unknown,
  context: ToolCompatibilityContext,
): unknown {
  if (!isRecord(source)) return source;
  if (
    source.type === "function_call" &&
    typeof source.namespace === "string" &&
    typeof source.name === "string"
  ) {
    const alias = context.namespaceAliases.get(
      namespaceKey(source.namespace, source.name),
    );
    if (!alias) return source;
    const rest = { ...source };
    delete rest.namespace;
    return {
      ...rest,
      name: alias,
      arguments: asArgumentsString(source.arguments),
    };
  }
  if (source.type === "tool_search_call") {
    if (!context.toolSearchAlias) return source;
    return {
      ...copyItemMetadata(source),
      type: "function_call",
      name: context.toolSearchAlias,
      arguments: asArgumentsString(source.arguments),
    };
  }
  if (source.type === "tool_search_output") {
    return {
      ...copyItemMetadata(source),
      type: "function_call_output",
      output: JSON.stringify(Array.isArray(source.tools) ? source.tools : []),
    };
  }
  if (
    source.type === "custom_tool_call" &&
    typeof source.name === "string"
  ) {
    const alias = context.customAliases.get(source.name);
    if (!alias) return source;
    return {
      ...copyItemMetadata(source),
      type: "function_call",
      name: alias,
      arguments: JSON.stringify({
        input: typeof source.input === "string" ? source.input : asText(source.input),
      }),
    };
  }
  if (source.type === "custom_tool_call_output") {
    return {
      ...copyItemMetadata(source),
      type: "function_call_output",
      output: asText(source.output),
    };
  }
  return source;
}

function rewriteOutputItem(
  source: JsonObject,
  context: ToolCompatibilityContext,
): JsonObject {
  if (source.type !== "function_call" || typeof source.name !== "string") {
    return source;
  }
  const mapping = context.mappingsByAlias.get(source.name);
  if (!mapping) return source;
  const metadata = copyItemMetadata(source);
  if (typeof source.id === "string") {
    if (mapping.kind !== "namespace") {
      context.rewrittenItemIds.add(source.id);
    }
  }
  if (mapping.kind === "tool_search") {
    const args = parseArguments(source.arguments);
    if (typeof args.limit === "string" && /^-?\d+$/u.test(args.limit)) {
      args.limit = Number(args.limit);
    }
    return {
      ...metadata,
      type: "tool_search_call",
      execution: "client",
      arguments: args,
    };
  }
  if (mapping.kind === "custom") {
    return {
      ...metadata,
      type: "custom_tool_call",
      name: mapping.name,
      input: customToolInput(source.arguments),
    };
  }
  const args = coerceArguments(
    parseArguments(source.arguments),
    mapping.parameters,
  );
  return {
    ...metadata,
    type: "function_call",
    namespace: mapping.namespace,
    name: mapping.name,
    arguments:
      source.arguments === "" ? "" : JSON.stringify(args),
  };
}

function liftAdditionalTools(input: unknown[]): {
  input: unknown[];
  liftedTools: unknown[];
} {
  const kept: unknown[] = [];
  const liftedTools: unknown[] = [];
  for (const item of input) {
    if (
      isRecord(item) &&
      item.type === "additional_tools" &&
      Array.isArray(item.tools)
    ) {
      liftedTools.push(...item.tools);
      if (item.content !== undefined) {
        kept.push({
          type: "message",
          role: typeof item.role === "string" ? item.role : "developer",
          content: item.content,
        });
      }
      continue;
    }
    kept.push(item);
  }
  return { input: kept, liftedTools };
}

function deduplicateFunctionTools(tools: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (
      isRecord(tool) &&
      tool.type === "function" &&
      typeof tool.name === "string"
    ) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
    }
    result.push(tool);
  }
  return result.reverse();
}

function reserveAlias(
  preferred: string,
  identity: string,
  context: ToolCompatibilityContext,
): string {
  const validPreferred = normalizeFunctionName(preferred);
  if (
    validPreferred === preferred &&
    preferred.length <= 64 &&
    !context.usedFunctionNames.has(preferred)
  ) {
    context.usedFunctionNames.add(preferred);
    return preferred;
  }
  const digest = createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 10);
  const stem = normalizeFunctionName(preferred).slice(0, 50) || "tool";
  let alias = `${stem.slice(0, 53)}_${digest}`;
  if (context.usedFunctionNames.has(alias)) {
    alias = `linksense_tool_${digest}`;
  }
  context.usedFunctionNames.add(alias);
  return alias;
}

function normalizeFunctionName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_").replace(/^_+/u, "");
}

function namespaceKey(namespace: string, name: string): string {
  return `${namespace}\u0000${name}`;
}

function copyItemMetadata(source: JsonObject): JsonObject {
  return Object.fromEntries(
    ["id", "call_id", "status"].flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
}

function customToolInput(value: unknown): string {
  if (value === "") return "";
  const parsed = parseArguments(value);
  if (typeof parsed.input === "string") return parsed.input;
  for (const candidate of Object.values(parsed)) {
    if (typeof candidate === "string") return candidate;
  }
  return asArgumentsString(value);
}

function parseArguments(value: unknown): JsonObject {
  if (isRecord(value)) return { ...value };
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return { input: value };
  }
}

function asArgumentsString(value: unknown): string {
  if (typeof value === "string") return value || "{}";
  return value === undefined ? "{}" : JSON.stringify(value);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function coerceArguments(
  value: JsonObject,
  schema: JsonObject,
): JsonObject {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      coerceSchemaValue(item, properties[key]),
    ]),
  );
}

function coerceSchemaValue(value: unknown, schema: unknown): unknown {
  if (!isRecord(schema)) return value;
  const type = schema.type;
  if (
    (type === "integer" || type === "number") &&
    typeof value === "string" &&
    /^-?(?:\d+|\d*\.\d+)$/u.test(value)
  ) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (type === "boolean" && typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (type === "object" && isRecord(value)) {
    return coerceArguments(value, schema);
  }
  if (type === "array" && Array.isArray(value)) {
    return value.map((item) => coerceSchemaValue(item, schema.items));
  }
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is JsonObject {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}
