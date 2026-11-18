import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { escapeHtml } from "./public-page.js";

const analyticsSiteSchema = z.object({
  id: z.number().int().positive(),
  domain: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});

/** Stable synthetic domain: tinytraffic identifies sites by domain, not by path. */
export function analyticsDomain(siteId: string): string {
  return `${siteId}.linksense.invalid`;
}

export class WebSiteAnalytics {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  dashboardUrl(siteId: number): string {
    return new URL(`/sites/${siteId}`, this.config.baseUrl).href;
  }

  scriptTag(domain: string): string {
    return `<script defer data-linksense-analytics="1" data-domain="${escapeHtml(domain)}" data-api="${escapeHtml(`${this.config.baseUrl}/api/event`)}" src="${escapeHtml(`${this.config.baseUrl}/js/script.js`)}"></script>`;
  }

  /** Creates the remote site once and keeps its dashboard name and public access current. */
  async ensureSite(input: { name: string; domain: string }): Promise<{ id: number; domain: string }> {
    let site = await this.find(input.domain);
    if (!site) {
      const response = await this.request("/api/v1/sites", {
        method: "POST",
        body: JSON.stringify({ domain: input.domain, timezone: "UTC" }),
      });
      if (response.status === 409) {
        await response.body?.cancel();
        site = await this.find(input.domain);
      } else {
        site = analyticsSiteSchema.parse(await this.json(response));
      }
    }
    if (!site) throw new AppError("WEB_SITE_ANALYTICS_UNAVAILABLE");
    const name = [...input.name].slice(0, 100).join("");
    const updated = await this.request(`/api/v1/sites/${site.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, public: true }),
    });
    if (!updated.ok) {
      await updated.body?.cancel();
      throw new AppError("WEB_SITE_ANALYTICS_UNAVAILABLE");
    }
    await updated.body?.cancel();
    return { id: site.id, domain: site.domain };
  }

  private async find(domain: string): Promise<z.infer<typeof analyticsSiteSchema> | undefined> {
    const response = await this.request("/api/v1/sites", { method: "GET" });
    const sites = z.array(analyticsSiteSchema).parse(await this.json(response));
    return sites.find(site => site.domain === domain || site.aliases.includes(domain));
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<Response> {
    try {
      return await this.fetcher(new URL(path, this.config.baseUrl), {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError("WEB_SITE_ANALYTICS_UNAVAILABLE");
    }
  }

  private async json(response: Response): Promise<unknown> {
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError("WEB_SITE_ANALYTICS_UNAVAILABLE");
    }
    try {
      return await response.json();
    } catch {
      throw new AppError("WEB_SITE_ANALYTICS_UNAVAILABLE");
    }
  }
}
