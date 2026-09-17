import { defineConfig } from "vitest/config"

// Module-mocking tests require a fresh module graph.
const isolatedTests = [
  "test/system-maintenance-jobs.test.ts",
  "test/bot-channels-clients.test.ts",
  "test/user-home-capability-materializer.test.ts",
  "test/knowledge-source-runtime.test.ts",
  "test/managed-task-title.test.ts",
  "test/object-storage.test.ts",
  "test/safe-http-fetch.test.ts",
  "test/docling-extraction.test.ts",
  "test/deployment-task-settlement.test.ts",
]

export default defineConfig({
  test: {
    pool: "threads",
    maxWorkers: 4,
    maxConcurrency: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "services",
          include: ["test/**/*.test.ts"],
          exclude: isolatedTests,
          isolate: false,
          setupFiles: ["./test/environment-cleanup.ts"],
        },
      },
      {
        extends: true,
        test: { name: "isolated", include: isolatedTests },
      },
    ],
  },
})
