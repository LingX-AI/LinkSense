#!/bin/sh
# Remove build-time-only packages that pnpm deploy resolves into production
# images, and drop sources/tests that only the dist build needs.
set -eu

[ "$#" -eq 1 ] || {
  printf 'usage: %s <deploy-directory>\n' "$0" >&2
  exit 64
}
deploy_root=$1
[ -d "$deploy_root/node_modules" ] || {
  printf 'Missing node_modules in %s\n' "$deploy_root" >&2
  exit 1
}

# The workspace root depends on Prisma for migration and seed tooling. pnpm's
# legacy deploy copies those root dependencies into every application deploy,
# and @prisma/client auto-installs its `prisma` and `typescript` peers. Neither
# application imports the CLI, Studio, PGlite or TypeScript at runtime.
for dev_package in \
  prisma \
  '@prisma+studio-core' \
  '@prisma+dev' \
  '@electric-sql+pglite' \
  '@electric-sql+pglite-socket' \
  '@electric-sql+pglite-tools' \
  effect \
  typescript
do
  rm -rf "$deploy_root"/node_modules/.pnpm/"$dev_package"@*
done

# Drop links that pointed at the pruned packages, including dangling .bin
# entries. Valid links are preserved.
find "$deploy_root/node_modules" -type l ! -exec test -e {} \; -delete

# Production runs dist; deployed sources and test suites are dead weight.
rm -rf \
  "$deploy_root/src" \
  "$deploy_root/test" \
  "$deploy_root/scripts" \
  "$deploy_root/vitest.config.ts" \
  "$deploy_root/vitest.config.mts" \
  "$deploy_root/eslint.config.js" \
  "$deploy_root/eslint.config.mjs"

if find "$deploy_root/node_modules/.pnpm" -maxdepth 1 -name 'prisma@*' -print -quit | grep -q .; then
  printf 'The Prisma CLI remained in the production deploy\n' >&2
  exit 1
fi
