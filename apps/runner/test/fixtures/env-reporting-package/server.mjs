#!/usr/bin/env node

import process from "node:process"

process.stdout.write(
  JSON.stringify({
    ccId: process.env.CC_ID ?? null,
    ccPassword: process.env.CC_PASSWORD ?? null,
    unrelatedSupervisorSecret:
      process.env.UNRELATED_SUPERVISOR_SECRET ?? null,
    forwardingMetadata:
      process.env.LINKSENSE_PNPM_PASSTHROUGH_ENV_NAMES ?? null,
  })
)
