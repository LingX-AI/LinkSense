import { vi } from "vitest";
import type { WebSiteBackend } from "../src/generated/prisma/client.js";
import { encryptJson } from "../src/lib/crypto.js";
import { AppError } from "../src/lib/errors.js";
import type { WebSiteBackendStore } from "../src/modules/web-site-backends/repository.js";
import { WebSiteBackendService, appHostLabel } from "../src/modules/web-site-backends/service.js";
import { WebSiteService } from "../src/modules/web-sites/service.js";
import { testConfig } from "./test-config.js";
import { ownerId, taskId, siteId, now, siteFixture } from "./web-sites.fixture.js";

export const backendId = "60000000-0000-4000-8000-000000000001";
export function backendFixture(appsBaseUrl: string | null = "https://apps.example.net") {
  const config = testConfig({
    LINKSENSE_APPWRITE_ENDPOINT: "https://backend.example.test/v1",
    LINKSENSE_APPWRITE_ADMIN_EMAIL: "operator@example.test",
    LINKSENSE_APPWRITE_ADMIN_PASSWORD: "test-operator-password",
    LINKSENSE_DYNAMIC_APPS_BASE_URL: appsBaseUrl ?? undefined,
  });
  const site = siteFixture();
  site.row.site.backendId = backendId;
  const row: WebSiteBackend = {
    id: backendId, ownerId, conversationId: taskId, projectId: "ls-test-project", hostLabel: appHostLabel(backendId), hostResolved: true, name: "Appointments",
    status: "ready", runtimeMode: null, leaseUntil: null, createdAt: now, updatedAt: now,
    encryptedCredential: encryptJson({ key: "test-project-management-key" }, config.credentialMasterKey, config.credentialKeyId, `web-site-backend:${backendId}`),
  };
  let published = true;
  const addresses = new Set([appHostLabel(backendId)]);
  const store: WebSiteBackendStore = {
    reserve: vi.fn(async () => row),
    owned: vi.fn(async (owner, id) => {
      if (owner !== ownerId || id !== backendId) throw new AppError("WEB_SITE_NOT_FOUND");
      return { ...row };
    }),
    byHostLabel: vi.fn(async label => (label === (row.hostLabel ?? backendId) ||
      (!row.hostResolved && (label === backendId || addresses.has(label)))) ? { id: backendId } : null),
    findById: vi.fn(async id => id === backendId ? row : null),
    findByHostLabel: vi.fn(async hostLabel => addresses.has(hostLabel) ? { id: backendId } : null),
    setHostLabel: vi.fn(async (id, lease, hostLabel, hostResolved = true) => {
      if (id !== backendId) throw new AppError("WEB_SITE_NOT_FOUND");
      if (row.leaseUntil?.getTime() !== lease.getTime() || lease.getTime() <= Date.now()) throw new AppError("CONFLICT");
      if (hostLabel !== null) addresses.add(hostLabel);
      row.hostLabel = hostLabel;
      row.hostResolved = hostResolved;
    }),
    acquire: vi.fn(async (owner, id, lease) => {
      if (owner !== ownerId || id !== backendId) throw new AppError("WEB_SITE_NOT_FOUND");
      if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) throw new AppError("CONFLICT");
      row.leaseUntil = lease;
    }),
    finish: vi.fn(async (_id, _lease, status, encryptedCredential) => {
      if (row.leaseUntil?.getTime() !== _lease.getTime()) throw new AppError("CONFLICT");
      row.leaseUntil = null;
      if (status) row.status = status;
      if (encryptedCredential) row.encryptedCredential = encryptedCredential;
    }),
    publicBinding: vi.fn(async () => {
      if (!published) throw new AppError("WEB_SITE_NOT_FOUND");
      return { backend: row, siteId };
    }),
    source: vi.fn(async () => ({ objectKey: "source/code.tar.gz", size: 4, checksum: null })),
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ total: 0, functions: [], tables: [] }));
  const service = new WebSiteBackendService(store, site.storage, config, fetcher);
  return {
    config, store, row, fetcher, service, site,
    sites: new WebSiteService(site.store, site.storage, service),
    disable: () => { published = false; site.row.site.status = "disabled"; },
  };
}
