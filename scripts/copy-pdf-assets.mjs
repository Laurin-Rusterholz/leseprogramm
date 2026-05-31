// Kopiert die CMap- und Standardschrift-Daten von pdf.js nach public/pdfjs,
// damit pdf.js auch PDFs mit CID-/Spezialschriften korrekt extrahieren kann.
// Läuft automatisch vor `dev` und `build` (siehe package.json).
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcBase = resolve(root, 'node_modules/pdfjs-dist');
const outBase = resolve(root, 'public/pdfjs');

for (const dir of ['cmaps', 'standard_fonts']) {
  const from = resolve(srcBase, dir);
  const to = resolve(outBase, dir);
  if (!existsSync(from)) {
    console.warn(`[copy-pdf-assets] fehlt: ${from}`);
    continue;
  }
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`[copy-pdf-assets] ${dir} -> public/pdfjs/${dir}`);
}
