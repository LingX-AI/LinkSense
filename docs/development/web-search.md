# Web search

Administrators configure one global search service in **Model settings → Web search**. The search service is independent of the task's chat model. Supported providers are DeepSeek, Tavily, Brave Search, Exa, Google Custom Search, SerpAPI and SearXNG. Google additionally requires a search engine ID. SearXNG requires an instance with JSON search enabled.

Search endpoints must be public HTTPS URLs on the standard HTTPS port, without embedded credentials, query parameters or fragments. API requests pin validated DNS addresses, reject private destinations, do not follow redirects, and bound response size. This also applies to self-hosted SearXNG instances.

Settings and credentials are encrypted in the existing system settings record. Updates preserve unrelated settings and check the expected revision. Omitting a key preserves it only when the provider and endpoint are unchanged. Explicitly clearing a required key requires disabling the service. A connection test uses the current draft and may incur provider charges, but does not save changes.

## Execution boundary

`search_web` is a read-only Core MCP tool in Default and Plan. It accepts a query of up to 128 Unicode characters and an optional result limit of 1–20. The configured timeout is 1–60 seconds. Google returns at most ten results per upstream request. Search results contain titles, source links, excerpts, optional summaries and publication dates. External content remains untrusted reference material.

Calls pass through the worker's task-scoped token, the controller's authenticated owner callback, and the API's current active-user, task-ownership and running-turn checks. Provider keys never enter the task environment, workspace or tool arguments. The API reads settings for each search; a call already in progress keeps its original configuration. The request cancellation signal propagates to the upstream transport. Searches are not automatically retried or routed to another provider.

## SDK integration

The API uses `@plust/search-sdk@1.3.0` and adds a DeepSeek implementation of its `SearchProvider` interface. DeepSeek maps `maxResults` to `count` and preserves its short excerpt, longer summary and date. Provider-native responses are validated before normalization; only the bounded public result contract leaves the API.

The pnpm-managed SDK patch adds a replaceable HTTP transport and caller cancellation, fixes the Tavily and Brave result-count parameters, and updates Exa's authentication, search parameters and source fields. These differences are covered by adapter tests. The patch removes the unused standalone MCP export; a pnpm override removes its FastMCP dependency. LinkSense retains its existing Core MCP server and avoids adding another MCP stack or incompatible authentication dependencies.

## Upgrade and verification

No database schema migration is required. Existing settings and task records remain usable; web search defaults to disabled when no configuration exists. Deploy the API and worker changes together and restart workers so new and existing tasks discover the tool on their next execution. No user needs to recreate a task or reinstall a plugin.

Focused checks:

```sh
pnpm --filter @linksense/shared test
pnpm --filter @linksense/api test test/web-search-provider.test.ts test/web-search-settings.test.ts test/web-search-routes.test.ts test/safe-http-fetch.test.ts
pnpm --filter @linksense/runner test test/web-search.test.ts test/core-service-registry.test.ts test/process-pool.test.ts test/controller-server.test.ts
pnpm --filter @linksense/web exec vitest run --project components src/features/admin/web-search-settings-form.test.tsx
```

Tests mock external search services. Verify credentials and account access using the administrator's connection test after deployment. Browser verification is performed only when explicitly requested.
