import { describe, expect, it } from "vitest"

import viteConfig from "../vite.config"

describe("Vite dependency optimization", () => {
  it("pre-bundles dependencies first discovered by lazy preview workers", () => {
    expect(viteConfig).toMatchObject({
      optimizeDeps: {
        exclude: expect.arrayContaining(["pptx-react-viewer"]),
        include: expect.arrayContaining([
          "pptx-react-viewer > jszip",
          "@zip.js/zip.js",
        ]),
      },
    })
  })
})

describe("Vite production asset naming", () => {
  it("fingerprints application styles while keeping explicit embed entrypoints", () => {
    const output = viteConfig.build?.rollupOptions?.output

    expect(output).toBeDefined()
    expect(Array.isArray(output)).toBe(false)
    if (!output || Array.isArray(output)) {
      throw new Error("Expected one production output configuration")
    }
    if (
      typeof output.entryFileNames !== "function" ||
      typeof output.assetFileNames !== "function"
    ) {
      throw new Error("Expected functional production asset naming")
    }

    expect(output.entryFileNames({ name: "embed" } as never)).toBe(
      "assets/embed-app.js"
    )
    expect(output.assetFileNames({ names: ["app.css"] } as never)).toBe(
      "assets/app-[hash][extname]"
    )
  })
})

describe("Vitest execution limits", () => {
  it("keeps local failures fast while allowing for constrained CI runners", () => {
    expect(viteConfig.test?.testTimeout).toBe(process.env.CI ? 15_000 : 5_000)
  })
})
