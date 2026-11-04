import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./e2e",
  testMatch: "browser-extension-settings.spec.ts",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  use: { baseURL: "http://127.0.0.1:4187", locale: "zh-CN", channel: "chrome" },
  webServer: {
    command:
      "node ../api/scripts/build-browser-extension.mjs && vite preview --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
  },
})
