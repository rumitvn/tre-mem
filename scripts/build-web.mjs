import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, 'dist', 'web', 'public');
mkdirSync(outdir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(root, 'web', 'index.tsx')],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  jsx: 'automatic',
  target: ['es2020'],
  outdir,
  entryNames: 'app',
  loader: { '.css': 'css', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  logLevel: 'silent',
});

// No-flash theme bootstrap runs before first paint.
const themeBoot = `(()=>{try{var t=localStorage.getItem('tre-theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){}})()`;

const html = `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <title>tre · shared roots</title>
    <script>${themeBoot}</script>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="/app.js" defer></script>
  </body>
</html>
`;
writeFileSync(join(outdir, 'index.html'), html);

const out = result.metafile.outputs;
const total = Object.entries(out)
  .filter(([f]) => f.endsWith('.js') || f.endsWith('.css'))
  .reduce((n, [, v]) => n + v.bytes, 0);
console.log(`built dashboard → dist/web/public (${(total / 1024).toFixed(1)} kb raw)`);
