// The icons of the approved designs – Lucide (ISC licence, lucide.dev), the same version the designs were drawn with
// (lucide-static 0.460.0) – drawn as CSS masks so they take the text colour: <i class="i i-<name>">.
// A new icon: add its name to scripts/icons.txt, then: node scripts/build-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const names = fs.readFileSync(path.join(here, 'icons.txt'), 'utf8').split(/\s+/).filter(Boolean);
const dir = path.join(here, '..', 'node_modules', 'lucide-static', 'icons');
let out = '/* FALCON icons – Lucide (ISC licence, lucide.dev), made by scripts/build-icons.mjs – do not edit by hand */\n';
const missing = [];
for (const n of names) {
  const f = path.join(dir, n + '.svg');
  if (!fs.existsSync(f)) { missing.push(n); continue; }
  const svg = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s*class="[^"]*"/, '')
    .replace(/currentColor/g, 'black').replace(/\s*\n\s*/g, ' ').trim();
  const uri = 'data:image/svg+xml,' + svg.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');
  out += `.i-${n}{--m:url("${uri}")}\n`;
}
if (missing.length) { console.error('Not in Lucide:', missing.join(' ')); process.exit(1); }
fs.writeFileSync(path.join(here, '..', 'src', 'styles', 'icons.css'), out);
console.log('icons:', names.length);
