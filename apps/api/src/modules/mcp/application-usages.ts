import {
  mcpServerApplicationUsagesSchema,
  type McpServerApplicationUsage,
} from "@linksense/shared"

import type { Prisma } from "../../generated/prisma/client.js"

export async function listMcpServerApplicationUsages(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
  ownerId: string,
  serverId: string
): Promise<McpServerApplicationUsage[]> {
  // App bindings always use the app owner's MCP servers. Resolve private
  // preview IDs to the development entries shown in the owner's app catalog.
  // A member's installed version stays usable while any service channel allows it.
  const rows = await transaction.$queryRaw`
    WITH owned_apps AS (
      SELECT id, name, kind, development_only, published_version_id
      FROM applications
      WHERE owner_id = ${ownerId}::uuid AND status IN ('active', 'disabled') AND deleted_at IS NULL
    ),
    visible_apps AS (
      SELECT * FROM owned_apps WHERE NOT development_only
    ),
    bound_apps AS (
      SELECT application_id FROM application_mcp_servers WHERE mcp_server_id = ${serverId}::uuid
    ),
    direct_service_grants AS (
      SELECT grant_row.application_id, grant_row.grantee_type, grant_row.user_id, grant_row.user_group_id
      FROM application_grants grant_row
      JOIN visible_apps app ON app.id = grant_row.application_id
      WHERE app.kind <> 'public_knowledge' AND app.published_version_id IS NOT NULL
        AND grant_row.status = 'active' AND 'service' = ANY(grant_row.usage_modes)
    ),
    center_service_versions AS (
      SELECT app.id AS application_id, release.version_id
      FROM visible_apps app
      JOIN application_listings listing ON listing.application_id = app.id
      JOIN application_releases release ON release.id = listing.current_release_id
        AND release.listing_id = listing.id AND release.application_id = app.id
      WHERE app.kind <> 'public_knowledge' AND listing.status = 'published'
        AND release.status = 'approved' AND 'service' = ANY(release.usage_modes)
    ),
    service_installations AS (
      SELECT installed.application_id, installed.version_id, installed.owner_id
      FROM application_runtime_installations installed
      JOIN visible_apps app ON app.id = installed.application_id
      JOIN users recipient ON recipient.id = installed.owner_id
      WHERE installed.owner_id <> ${ownerId}::uuid
        AND recipient.status = 'active' AND recipient.self_registered_at IS NULL
    ),
    version_locations(application_id, version_id, location) AS (
      SELECT app.id, installed.version_id, 'application'
      FROM visible_apps app
      JOIN application_runtime_installations installed ON installed.application_id = app.id
        AND installed.owner_id = ${ownerId}::uuid
      UNION ALL
      SELECT id, published_version_id, 'application' FROM visible_apps WHERE kind = 'public_knowledge'
      UNION ALL
      SELECT app.id, app.published_version_id, 'shared'
      FROM visible_apps app
      WHERE EXISTS (SELECT 1 FROM direct_service_grants grants WHERE grants.application_id = app.id)
      UNION ALL
      SELECT application_id, version_id, 'center' FROM center_service_versions
      UNION ALL
      SELECT installed.application_id, installed.version_id, 'shared_installation'
      FROM service_installations installed
      WHERE EXISTS (
        SELECT 1 FROM direct_service_grants grants
        WHERE grants.application_id = installed.application_id AND (
          (grants.grantee_type = 'user' AND grants.user_id = installed.owner_id) OR
          (grants.grantee_type = 'user_group' AND EXISTS (
            SELECT 1 FROM user_group_members membership
            WHERE membership.user_group_id = grants.user_group_id
              AND membership.user_id = installed.owner_id AND membership.status = 'active'
          ))
        )
      )
      UNION ALL
      SELECT installed.application_id, installed.version_id, 'center_installation'
      FROM service_installations installed
      JOIN center_service_versions center ON center.application_id = installed.application_id
    ),
    usages(application_id, name, kind, location) AS (
      SELECT app.id, app.name, app.kind, 'application'
      FROM bound_apps binding JOIN visible_apps app ON app.id = binding.application_id
      UNION ALL
      SELECT COALESCE(app.id, development.id), COALESCE(app.name, development.name), 'interactive', 'draft'
      FROM bound_apps binding
      JOIN owned_apps preview ON preview.id = binding.application_id AND preview.development_only
      JOIN application_developments development ON development.preview_application_id = preview.id
        AND development.owner_id = ${ownerId}::uuid
      LEFT JOIN visible_apps app ON app.id = development.application_id
      WHERE development.application_id IS NULL OR app.id IS NOT NULL
      UNION ALL
      SELECT app.id, app.name, app.kind, usage.location
      FROM version_locations usage
      JOIN visible_apps app ON app.id = usage.application_id
      JOIN application_versions version ON version.id = usage.version_id
        AND version.application_id = app.id AND version.assets_ready
      WHERE version.definition_json -> 'mcpServerIds' @> jsonb_build_array(${serverId}::uuid::text)
    )
    SELECT application_id, name, kind, array_agg(DISTINCT location ORDER BY location) AS locations
    FROM usages
    GROUP BY application_id, name, kind
    ORDER BY name, application_id
  `
  return mcpServerApplicationUsagesSchema.parse(rows)
}
