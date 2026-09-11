/** Shared payload construction for individual and grouped native deliveries. */
export function methodEventPayload<TParams extends Record<string, unknown>>(
  method: string,
  params: TParams,
  local: Record<string, unknown> = {},
): {
  schema_version: 1 | 2;
  source: "linksense_runner" | "codex_app_server";
  method: string;
  params: TParams;
  local?: Record<string, unknown>;
} {
  return {
    schema_version: method === "linksense/form/request" ? (1 as const) : (2 as const),
    source: method === "linksense/form/request" ? ("linksense_runner" as const) : ("codex_app_server" as const),
    method,
    params,
    ...(Object.keys(local).length > 0 ? { local } : {}),
  };
}
