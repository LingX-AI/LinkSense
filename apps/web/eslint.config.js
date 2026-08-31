import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public/vendor/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      // shadcn components intentionally export reusable variant helpers.
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/components/ui/**/*.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'button',
          'details',
          'input',
          'label',
          'option',
          'select',
          'summary',
          'table',
          'tbody',
          'td',
          'textarea',
          'th',
          'thead',
          'tr',
        ].map((name) => ({
          selector: `JSXOpeningElement[name.name='${name}']`,
          message: `Use the corresponding shadcn/ui component instead of a native <${name}> element.`,
        })),
      ],
    },
  },
])
