import { type WebSite } from "@linksense/shared"
import { z } from "zod"

/** The custom-slug address; auto-generated slugs are UUIDs and have no custom link. */
export function siteCustomAliasUrl(site: WebSite): string | undefined {
  return site.alias_url && !z.uuid().safeParse(site.slug).success
    ? site.alias_url
    : undefined
}

/** Where a site's visit action should open: the custom slug when there is one. */
export function siteVisitUrl(site: WebSite): string {
  return siteCustomAliasUrl(site) ?? site.url ?? site.url_path
}
