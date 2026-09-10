import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const globals = require('globals');
export default [{
  files: ['**/*.mjs'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: { ...globals.node, ...globals.browser, describe:'readonly', it:'readonly', expect:'readonly' },
  },
  rules: { 'no-unused-vars':'error', 'no-undef':'error', 'no-unreachable':'error', 'no-dupe-keys':'error' },
}];
