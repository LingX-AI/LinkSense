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

When adopting that verified descriptor, save it as
`deploy/baselines/images.lock.json`, then run
`node scripts/baseline-adoption.mjs --write` and commit both the descriptor and
the mechanically synchronized Docker defaults. `--check` verifies that direct
source builds and daily release build arguments refer to the same images.

Never adopt an unverified candidate, use mutable `latest` references, overwrite
a product release, or remove runtime functionality to make a baseline pass.
Temporary registry failures can use **Re-run failed jobs** while intermediate
artifacts are valid. A new recipe or a real vulnerability requires a new
source commit and baseline maintenance; it cannot be silently rebuilt during
an application release.

Recipe maintenance is a two-phase change. Source CI first checks that the
committed Docker defaults still match the recorded baseline, and tests the
strict recipe-admission checks with isolated fixtures. It does not require a
new baseline before the maintenance workflow can build it. Application builds
and release preparation still require `baseline-adoption.mjs --check` and the
exact current recipe fingerprint: maintain the new images, adopt their verified
descriptor, pass CI and Security again, and only then publish the product.

Worker supervisor capability changes are application changes, not environment
recipe changes. Rebuild both the Runner controller and Worker application
images, and recreate existing Worker containers so their creation-time
capability policy is updated. Keep all user data volumes. The supervisor needs
`SETPCAP` in the container allowance and its inheritable/ambient sets to clear
task capability bounding sets; tasks must still have all five sets cleared.
The release and native image gates exercise this actual supervisor-to-task
chain using `pnpm test:runtime:worker-isolation <local-worker-image>`.
