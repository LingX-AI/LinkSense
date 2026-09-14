import { defineConfig } from "vitest/config"

// These tests evaluate initialization under different globals or module mocks.
const isolatedTests = [
  "test/controller-startup.test.ts",
  "test/execution-startup.test.ts",
  "test/browser-init-page.test.ts",
  "test/controller-worker-contract.test.ts",
  "test/http-egress-proxy.test.ts",
  "test/event-outbox.test.ts",
]

export default defineConfig({
  test: {
    pool: "forks",
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: "runtime",
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
