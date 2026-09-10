import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../apps/web');
const require = createRequire(resolve(web, 'package.json'));
const twRequire = createRequire(require.resolve('@tailwindcss/vite'));
const { compile, optimize } = twRequire('@tailwindcss/node');
const names = ['copy.mjs', 'model.mjs', 'app.mjs'];
const sources = await Promise.all(names.map((name) => readFile(resolve(here, name), 'utf8')));
const theme = await readFile(resolve(here, 'theme.css'), 'utf8');
const compiler = await compile(theme, { base: web, onDependency() {} });
const candidates = [...new Set(sources.join('\n').split(/[\s"'`<>]+/))];
const css = optimize(compiler.build(candidates), { minify: true }).code;
const js = sources.join('\n').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>LinkSense · AI 工作空间</title><style>${css}</style></head>
<body class="bg-paper font-sans text-ink"><div id="app"></div><script type="module">${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
await writeFile(resolve(here, 'index.html'), html);
console.log(`Built offline HTML: ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
