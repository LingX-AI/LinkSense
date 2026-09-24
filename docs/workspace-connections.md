# Google Docs, Gmail and Outlook connections

These are three independent official connection packages, alongside OneDrive/SharePoint. Users authorize each account from **Plugin Center → Connectors**. Authorization opens a new tab and returning to the catalog refreshes the account state. The card and detail dialog use locally bundled product logos.

## Configuration

The API reuses the encrypted Google/Microsoft OAuth client configuration from social sign-in, independently of whether social sign-in is enabled. No additional secrets are needed. Before enabling these providers, run `pnpm db:migrate:deploy` against the deployment database. Migration `20260924040000_expand_user_connection_providers` expands the existing provider CHECK constraint to accept Google Docs, Gmail and Outlook. It preserves all existing rows, encrypted grants, fields and indexes; do not modify the already-applied table-creation migration. Without this upgrade, all three authorization-start endpoints fail with HTTP 500 before opening the provider consent page. Existing OneDrive/SharePoint grants remain usable in the same encrypted record format.

Register each **Web** redirect path below under its Google or Microsoft client for every deployment origin. The current registered origins are:

- `http://localhost:18172` (development)
- `https://linksense.lingx-ai.com`
- `https://explore.linksense.org` (preconfigured before the deployment is available)

| Client | Redirect path |
| --- | --- |
| Google | `/api/v1/auth/social/google/callback` |
| Google | `/api/v1/connectors/google_docs/callback` |
| Google | `/api/v1/connectors/gmail/callback` |
| Microsoft | `/api/v1/auth/social/microsoft/callback` |
| Microsoft | `/api/v1/connectors/onedrive/callback` |
| Microsoft | `/api/v1/connectors/sharepoint/callback` |
| Microsoft | `/api/v1/connectors/outlook/callback` |

On 2026-09-24, the Google Cloud and Microsoft Entra LinkSense applications were updated and their saved configuration verified in the consoles. Each hosted origin has all seven applicable callback URLs above, and the existing localhost callbacks were retained. Google also registers both HTTPS origins as authorized JavaScript origins; its authorized domains include `lingx-ai.com` and `linksense.org`. No client secrets, consent scopes, or social-login enablement settings were changed.

Each deployment must set `LINKSENSE_PUBLIC_BASE_URL` to its own canonical HTTPS origin and configure the matching OAuth clients in its social-sign-in settings. Both sign-in and connector callback URLs are derived from that value, not from the incoming request host. Registering two domains in the provider consoles does not make one API instance dynamically select a different callback origin for each request. Server deployment settings were not changed as part of this registration. End-to-end hosted sign-in and connector authorization remain to be verified; in particular, `explore.linksense.org` was unavailable at configuration time. Google's console advises that OAuth client changes may take five minutes to several hours to propagate.

Enable **Google Docs API**, **Google Drive API**, and **Gmail API**. Register these Google consent scopes:

- Google Docs: `openid email https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.readonly`
- Gmail: `openid email https://www.googleapis.com/auth/gmail.modify`

Drive read access supports searching existing document metadata and exporting existing documents. The connector exposes Google document operations; it does not bulk-sync a user's Drive.

Document creation and editing use the Docs API's `documents` scope; `drive.file` is not needed by any current operation and is neither requested nor required on callback/refresh. Existing grants that also contain `drive.file` remain usable without data migration or reauthorization. During a consent failure investigation, selecting all three scopes produced a Google-hosted 502 on `/signin/oauth/consent/approval`; selecting only `documents` and `drive.readonly` returned to the application successfully. After removing the redundant request and requirement, the full browser authorization flow completed and the connector showed connected. Keep the two required scopes enforced rather than accepting incomplete grants or broadening access to full Drive write access.

Microsoft uses **delegated**, user-consented `openid profile offline_access User.Read Mail.ReadWrite Mail.Send`. Outlook supports personal Microsoft accounts and work/school accounts with an Exchange Online mailbox. Organization policy can require administrator approval. Application permissions or organization-wide admin consent are not part of this setup.

Google testing-mode apps are limited to their registered test users. Publishing to other users and obtaining approval for sensitive/restricted scopes are separate Google review steps; configuring callbacks and enabling APIs does not complete that review.

## Available operations

| Connection | Read | Write |
| --- | --- | --- |
| Google Docs | Title search, document/tab content and revisions, PDF/Word/text export | Create document, insert/replace text, bold/italic/underline selected ranges |
| Gmail | Search, messages/threads, draft list/read, labels, attachment download | Create/update/reply drafts, send a draft, change read state, archive/trash, apply/remove existing labels |
| Outlook | Search, messages/threads, draft list/read, top-level folders, attachment download | Create/update/reply drafts, send a draft, change read state, archive/trash, move to an existing folder |

- Sending is a separate `send_draft` operation. Drafting does not send mail. Tool guidance requires an explicit user request to send; sending and other mutations are never automatically retried after uncertain errors.
- Mail attachments come from task-relative workspace paths, with path/symlink checks. Outgoing attachments total at most 3 MiB. Outlook `update_draft` preserves attachments; create a new draft to include different attachments.
- Downloads stay in the task workspace; bytes are not inserted into model context. Download limit is 20 MiB. Google Drive imposes its own 10 MB export limit.
- Doc edits require the revision read by the caller and support tab IDs. If creation succeeds but inserting initial content fails, the result returns that document ID with `content_written: false`, so the agent can edit it instead of creating duplicates.
- Responses are paginated with a content hash; provider pagination tokens are encrypted and bound to the owner, provider, query, connection revision and expiry.
- Plan mode exposes only read tools and disallows file downloads into the workspace.

## Runtime architecture

Each connected provider publishes only its trusted official package: `linksense-google-docs`, `linksense-gmail`, or `linksense-outlook`. Each has `read` and `write` tools, with operation schemas restricted to that service. Tools are supplied through native Codex plugin discovery, not added to `linksense_core`. Disconnected services do not publish their packages.

The task-scoped endpoint `/mcp-connections/:conversationId/execute` authenticates the worker process, verifies the active turn and write policy, and forwards to `/internal/connections/execute`. Provider access/refresh tokens remain encrypted on the API side and are never exposed to the runner or model. The API uses official Google service SDKs and the Microsoft Graph SDK, with PKCE/OIDC handled by the existing `openid-client` dependency and MIME composed by the existing Nodemailer dependency.

Deploy API, controller and worker together because the internal transport changed from a Microsoft-only route to `/execute`. No compatibility endpoint is retained. Existing account records need not be re-created. Restart execution workers before starting new tasks on the new API.

## Verification

Unit tests cover OAuth state/nonce/signature/refresh, account isolation and encrypted paging, Graph/Gmail request structures, draft/send separation, attachments, error redaction, retry behavior, Plan restrictions, plugin selection and locally bundled logos. These checks mock provider network boundaries and do not send real mail. Live provider access still requires the individual user to authorize each connection.

Run `pnpm test:connections:postgres` for the real PostgreSQL persistence regression. It creates a disposable PostgreSQL 16 container, reproduces the three failures on the historical schema, deploys the forward migration, and verifies fresh-install and upgrade writes for every provider in the shared contract. It also checks preservation and continued usability of existing grants, unchanged historical migration checksums, owner isolation, uniqueness, status and payload constraints, and repeated deployment. It never loads the application database configuration.

Official API references:
- https://developers.google.com/workspace/docs/api/reference/rest
- https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/create#authorization-scopes
- https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate#authorization-scopes
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export
- https://developers.google.com/workspace/gmail/api/reference/rest
- https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview
