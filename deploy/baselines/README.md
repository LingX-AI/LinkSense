# Independent image baselines

`Maintain image baselines` builds the expensive environment independently of
product versions on GitHub-hosted native AMD64 and ARM64 runners. It stores the
images in GHCR; no additional server is required. Dispatch it from `main` after
CI and Security have passed, using the configured `LINKSENSE_RELEASE_ACTOR`.
It never creates a product Git tag or GitHub Release.

The four runtime packages contain Node/pnpm, API document-conversion tools,
Nginx, and the Worker environment respectively. The Worker includes its pinned
Codex CLI, Python and Node libraries, Chromium, native build tools and fonts,
but not the LinkSense application server. The six vendor derivatives retain
their existing patches, licenses and native startup checks. External SILO and
BusyBox references are resolved once to dual-architecture index digests.

Every candidate receives SBOM/provenance metadata. Acceptance requires both
architecture security gates, preservation of existing storage objects and
identities, and anonymous availability of every referenced image. Maintenance
scans the runtime images using the existing 13-role gate: API/Web/Worker map to
their runtimes, and Migrate/Runner map to the Node runtime. These are baseline
scans, not a replacement for scanning the final application images at release.

Only a successful maintenance run produces `verified-baseline/images.lock.json`.
Commit that descriptor when adopting the baseline. It records immutable image
references, source commit, maintenance run and the complete environment recipe
fingerprint. Changes to the Codex pin, environment dependency locks, fonts,
runtime recipes or vendor patches require a new verified baseline. Business
source changes and product version bumps do not invalidate the baseline.

```sh
gh workflow run maintain-baselines.yml --ref main --repo LingX-AI/LinkSense
gh run download RUN_ID --name verified-baseline --dir /absolute/empty/directory \
  --repo LingX-AI/LinkSense
pnpm --dir deploy/baselines/tools install --prod --frozen-lockfile --ignore-workspace
node deploy/baselines/tools/baseline-images.mjs verify /absolute/empty/directory/images.lock.json
node deploy/baselines/tools/baseline-images.mjs verify-proof /absolute/empty/directory/images.lock.json
```

Never adopt an unverified candidate, use mutable `latest` references, overwrite
a product release, or remove runtime functionality to make a baseline pass.
Temporary registry failures can use **Re-run failed jobs** while intermediate
artifacts are valid. A new recipe or a real vulnerability requires a new
source commit and baseline maintenance; it cannot be silently rebuilt during
an application release.
