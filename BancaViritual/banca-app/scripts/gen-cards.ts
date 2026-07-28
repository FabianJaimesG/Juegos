// Genera un SVG temático por propiedad en public/properties/{id}.svg
// Ejecutar: npx tsx scripts/gen-cards.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, PROPERTIES } from '../src/domain/board';
import type { PropertyDef } from '../src/domain/types';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/properties');
mkdirSync(OUT, { recursive: true });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rentRows(p: PropertyDef): { label: string; value: number }[] {
  if (p.kind === 'railroad') {
    return p.rent.map((v, i) => ({ label: `${i + 1} ferrocarril${i ? 'es' : ''}`, value: v }));
  }
  if (p.kind === 'utility') {
    return [
      { label: 'Con un servicio', value: p.rent[0] },
      { label: 'Con ambos', value: p.rent[1] },
    ];
  }
  const labels = ['Renta base', 'Con 1 casa', 'Con 2 casas', 'Con 3 casas', 'Con 4 casas', 'Con hotel'];
  return p.rent.map((v, i) => ({ label: labels[i] ?? `Nivel ${i}`, value: v }));
}

// Word-wrap simple a máx `max` caracteres por línea (hasta 2 líneas).
function wrap(name: string, max = 16): string[] {
  const words = name.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

function svg(p: PropertyDef): string {
  const g = GROUPS[p.colorGroup];
  const rows = rentRows(p);
  const nameLines = wrap(p.name);
  const W = 300;
  const H = 440;
  const railOrUtil = p.kind !== 'street';

  const rentY0 = 210;
  const rowH = 26;
  const rentSvg = rows
    .map((r, i) => {
      const y = rentY0 + i * rowH;
      return `<text x="24" y="${y}" class="rl">${esc(r.label)}</text><text x="${W - 24}" y="${y}" class="rv" text-anchor="end">${r.value}</text>`;
    })
    .join('');

  const footY = H - 30;
  const foot = [`💰 ${p.price}`, ...(p.houseCost ? [`🏠 ${p.houseCost}`] : []), `🏦 ${p.mortgage}`];
  const footSvg = foot
    .map((t, i) => `<text x="${24 + i * 95}" y="${footY}" class="ft">${t}</text>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Oswald',system-ui,sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f2a21"/><stop offset="1" stop-color="#0a1f18"/>
    </linearGradient>
  </defs>
  <style>
    .nm{fill:#eef7f1;font-size:22px;font-weight:700}
    .rl{fill:#a9c9ba;font-size:14px}
    .rv{fill:#6fe3a6;font-size:15px;font-weight:600}
    .ft{fill:#cfe6da;font-size:14px}
    .gl{fill:#ffffff;font-size:12px;letter-spacing:1px;font-weight:700}
    .em{font-size:52px}
    .div{stroke:#14382b;stroke-width:1}
  </style>
  <rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="url(#bg)" stroke="#1e4d3c"/>
  <rect x="0" y="0" width="${W}" height="120" rx="18" fill="${g.color}"/>
  <rect x="0" y="90" width="${W}" height="30" fill="${g.color}"/>
  <text x="${W / 2}" y="60" text-anchor="middle" class="em">${p.emoji}</text>
  ${nameLines.map((l, i) => `<text x="${W / 2}" y="${100 + i * 24}" text-anchor="middle" class="nm">${esc(l)}</text>`).join('')}
  <line x1="16" y1="150" x2="${W - 16}" y2="150" class="div"/>
  ${rentSvg}
  <line x1="16" y1="${footY - 22}" x2="${W - 16}" y2="${footY - 22}" class="div"/>
  ${footSvg}
</svg>`;
}

let n = 0;
for (const p of PROPERTIES) {
  writeFileSync(resolve(OUT, `${p.id}.svg`), svg(p), 'utf8');
  n += 1;
}
console.log(`Generados ${n} SVG en public/properties/`);
