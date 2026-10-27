import eslint from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["browser-extension/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.browser-extension.json",
      },
    },
  },
)
