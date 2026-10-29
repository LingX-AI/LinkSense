# Google Docs, Gmail and Outlook connections

These are three independent official connection packages, alongside OneDrive/SharePoint. Users authorize each account from **Plugin Center → Connectors**. Authorization opens a new tab and returning to the catalog refreshes the account state. The card and detail dialog use locally bundled product logos.

## Configuration

Administrators configure these services from the separate **Settings → Connectors** administration menu (`/admin/connectors`). Each of the five connectors has its own app ID and secret, configuration status, callback URL, and required permissions. App IDs and secrets are encrypted in system settings; saved secrets are never returned to the browser. Users still authorize their own accounts from Plugin Center. Third-party sign-in settings are independent of connector configuration.

Before starting the updated API, run `pnpm db:migrate:deploy` against the deployment database. Besides Prisma migrations, this command initializes the independent encrypted connector configuration. On an existing installation, it copies the previously shared Microsoft app into OneDrive, SharePoint and Outlook, and the Google app into Google Docs and Gmail. This is an idempotent deployment data upgrade: it leaves login configuration, user authorization records, account IDs, grants and existing settings intact. Later runs do not overwrite independently edited connector settings or import subsequent login changes. OAuth requests read only the new connector configuration; there is no runtime fallback to sign-in settings. The migration environment must receive the existing `LINKSENSE_CREDENTIAL_MASTER_KEY` and `LINKSENSE_CREDENTIAL_KEY_ID`; initialization fails instead of replacing an unreadable configuration. Deploy the migration image before the API and Web changes. No new table, column, or Prisma migration is required for this configuration split.

Saving the same app ID with an empty secret field retains the current secret. Secret rotation takes effect for subsequent token refreshes. Changing an app ID requires the new app's secret and explicit acknowledgement if user grants already exist; those users must reconnect. Other connectors and sign-in settings remain independent. Configuration changes are audited without storing credential values.

The existing migration `20260924040000_expand_user_connection_providers` expands the provider CHECK constraint to accept Google Docs, Gmail and Outlook. It preserves all existing rows, encrypted grants, fields and indexes; do not modify the already-applied table-creation migration. Without this upgrade, all three authorization-start endpoints fail with HTTP 500 before opening the provider consent page. Existing OneDrive/SharePoint grants remain usable in the same encrypted record format.

Register each connector's **Web** redirect path below under its configured Google or Microsoft client for every deployment origin. Multiple connectors may use the same external app, but their settings are saved separately. Previously registered origins include:

- `http://localhost:18172` (development)
- `https://linksense.lingx-ai.com`
- `https://explore.linksense.org` (preconfigured before the deployment is available)

| Client | Redirect path |
| --- | --- |
| Google | `/api/v1/connectors/google_docs/callback` |
| Google | `/api/v1/connectors/gmail/callback` |
| Microsoft | `/api/v1/connectors/onedrive/callback` |
| Microsoft | `/api/v1/connectors/sharepoint/callback` |
| Microsoft | `/api/v1/connectors/outlook/callback` |

On 2026-09-24, the Google Cloud and Microsoft Entra LinkSense applications were updated and their saved configuration verified in the consoles. Each hosted origin has all seven applicable callback URLs above, and the existing localhost callbacks were retained. Google also registers both HTTPS origins as authorized JavaScript origins; its authorized domains include `lingx-ai.com` and `linksense.org`. No client secrets, consent scopes, or social-login enablement settings were changed.

Each deployment must set `LINKSENSE_PUBLIC_BASE_URL` to its own canonical HTTPS origin and configure matching OAuth apps in **Connectors**. The public origin and credential encryption master key remain deployment environment variables. Both sign-in and connector callback URLs are derived from the public origin, not from the incoming request host. Registering two domains in the provider consoles does not make one API instance dynamically select a different callback origin for each request. The historical console-registration check did not change server deployment settings. End-to-end hosted sign-in and connector authorization remain to be verified; in particular, `explore.linksense.org` was unavailable at that time. Google's console advises that OAuth client changes may take five minutes to several hours to propagate.

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

Run `pnpm test:connections:postgres` for the real PostgreSQL persistence regression. It creates a disposable PostgreSQL 16 container, reproduces the three failures on the historical schema, deploys the forward migration, and verifies fresh-install and upgrade writes for every provider in the shared contract. It also runs the actual connector-settings initialization command, checks preservation and continued usability of pre-split encrypted grants, configures new connectors, rotates secrets, changes a login app independently, and verifies reconnect after an acknowledged connector app change. Historical migration checksums, owner isolation, uniqueness, status and payload constraints, and repeated deployment are checked. Provider network calls are mocked; no real user documents or mail are accessed. It never loads the application database configuration.

Official API references:
- https://developers.google.com/workspace/docs/api/reference/rest
- https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/create#authorization-scopes
- https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate#authorization-scopes
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export
- https://developers.google.com/workspace/gmail/api/reference/rest
- https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview
