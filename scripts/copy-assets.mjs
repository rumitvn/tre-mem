import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const assets = [['src/store/schema.sql', 'dist/store/schema.sql']];

for (const [from, to] of assets) {
  const src = join(root, from);
  const dst = join(root, to);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
  console.log(`copied ${from} -> ${to}`);
}
