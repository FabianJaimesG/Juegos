/**
 * Arte de las cartas: un SVG por carta en public/cards/{id}.svg
 * y una hoja de muestra en public/cards/_muestra.svg
 *
 * Diseño 100% propio: no reproduce ilustraciones, tipografías ni composición de
 * ninguna edición comercial. La identidad es "certificado bancario": papel color
 * hueso, guilloché de seguridad, marco de esquinas biseladas y sello troquelado.
 *
 * Ejecutar: npx tsx scripts/gen-cardart.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS, DECKS, PACKS, cardText, isAutomatic, type CardDef } from '../src/domain/cards';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/cards');
mkdirSync(OUT, { recursive: true });

const W = 340;
const H = 500;
const SYM = '$';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Corta el texto en líneas de ~`max` caracteres. */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if ((cur + ' ' + word).trim().length > max && cur) {
      out.push(cur);
      cur = word;
    } else {
      cur = (cur + ' ' + word).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Marco de esquinas biseladas (octógono alargado). */
function bevelPath(x: number, y: number, w: number, h: number, c: number): string {
  return [
    `M${x + c},${y}`, `H${x + w - c}`, `L${x + w},${y + c}`,
    `V${y + h - c}`, `L${x + w - c},${y + h}`, `H${x + c}`,
    `L${x},${y + h - c}`, `V${y + c}`, 'Z',
  ].join(' ');
}

/** Una carta como grupo SVG, para poder componer hojas de varias. */
function cardBody(c: CardDef): string {
  const deck = DECKS[c.deck];
  const pack = PACKS[c.pack];
  const auto = isAutomatic(c.effect);
  const copies = c.copies ?? 1;
  const lines = wrap(cardText(c, SYM), 26).slice(0, 7);
  // El bloque de texto se centra vertical en la zona libre entre sello y cinta.
  const textTop = 332 - (lines.length - 1) * 11;

  return `
  <!-- papel -->
  <rect x="0" y="0" width="${W}" height="${H}" rx="20" fill="url(#paper)"/>
  <rect x="0" y="0" width="${W}" height="${H}" rx="20" fill="url(#guilloche)" opacity=".5"/>

  <!-- cabecera del mazo -->
  <path d="M0,20 a20,20 0 0 1 20,-20 h${W - 40} a20,20 0 0 1 20,20 v66 h-${W} z" fill="${deck.color}"/>
  <path d="M0,80 h${W} v6 h-${W} z" fill="#12211b" opacity=".18"/>
  <text x="${W / 2}" y="40" text-anchor="middle" class="deck">${esc(deck.label.toUpperCase())}</text>
  <text x="${W / 2}" y="64" text-anchor="middle" class="brand">BANCA · CARTA DE JUEGO</text>

  <!-- marco interior -->
  <path d="${bevelPath(16, 100, W - 32, H - 170, 16)}" fill="none" stroke="#1f3d31" stroke-width="1.6" opacity=".55"/>
  <path d="${bevelPath(22, 106, W - 44, H - 182, 12)}" fill="none" stroke="#1f3d31" stroke-width=".7" opacity=".35"/>

  <!-- sello troquelado con el icono -->
  <circle cx="${W / 2}" cy="176" r="42" fill="none" stroke="${pack.color}" stroke-width="2" opacity=".8"/>
  <circle cx="${W / 2}" cy="176" r="36" fill="${pack.color}" opacity=".1"/>
  <circle cx="${W / 2}" cy="176" r="36" fill="none" stroke="${pack.color}" stroke-width=".8" stroke-dasharray="2 4" opacity=".7"/>
  <text x="${W / 2}" y="192" text-anchor="middle" class="icon">${c.emoji}</text>

  <!-- filetes -->
  <line x1="60" y1="238" x2="${W - 60}" y2="238" stroke="#1f3d31" stroke-width="1" opacity=".3"/>
  <circle cx="${W / 2}" cy="238" r="3" fill="${pack.color}" opacity=".8"/>

  <!-- texto de la carta -->
  ${lines
    .map((l, i) => `<text x="${W / 2}" y="${textTop + i * 22}" text-anchor="middle" class="body">${esc(l)}</text>`)
    .join('\n  ')}

  <!-- cinta de modalidad -->
  <path d="M0,${H - 56} h${W} v36 a20,20 0 0 1 -20,20 h-${W - 40} a20,20 0 0 1 -20,-20 z" fill="${pack.color}"/>
  <text x="20" y="${H - 32}" class="pack">${esc(pack.emoji)} ${esc(pack.label.toUpperCase())}</text>
  <text x="${W - 20}" y="${H - 32}" text-anchor="end" class="pack">${c.keep ? 'SE GUARDA' : auto ? 'AUTOMÁTICA' : 'MANUAL'}</text>
  ${copies > 1 ? `<text x="${W / 2}" y="${H - 32}" text-anchor="middle" class="pack">×${copies}</text>` : ''}`;
}

const STYLE = `
  <style>
    .deck{fill:#f4efe4;font-size:21px;font-weight:700;letter-spacing:3px}
    .brand{fill:#f4efe4;font-size:9px;letter-spacing:2.4px;opacity:.75}
    .icon{font-size:38px}
    .body{fill:#1b2f26;font-size:16px}
    .pack{fill:#fdfaf3;font-size:10px;font-weight:700;letter-spacing:1.6px}
  </style>`;

const DEFS = `
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdfaf3"/><stop offset="1" stop-color="#efe7d6"/>
    </linearGradient>
    <pattern id="guilloche" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <path d="M0,8 q4,-8 8,0 t8,0" fill="none" stroke="#2f6f4e" stroke-width=".45" opacity=".22"/>
    </pattern>
  </defs>`;

const FONT = `font-family="'Oswald','Futura','Avenir Next',system-ui,sans-serif"`;

function svg(c: CardDef): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>${DEFS}${STYLE}
${cardBody(c)}
</svg>`;
}

/** Hoja con varias cartas lado a lado, para revisar el diseño de un vistazo. */
function sheet(cards: CardDef[], cols: number): string {
  const gap = 24;
  const rows = Math.ceil(cards.length / cols);
  const sw = cols * W + (cols + 1) * gap;
  const sh = rows * H + (rows + 1) * gap;
  const groups = cards
    .map((c, i) => {
      const x = gap + (i % cols) * (W + gap);
      const y = gap + Math.floor(i / cols) * (H + gap);
      return `<g transform="translate(${x},${y})">${cardBody(c)}</g>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}" ${FONT}>${DEFS}${STYLE}
  <rect width="${sw}" height="${sh}" fill="#14231c"/>
${groups}
</svg>`;
}

let n = 0;
for (const c of CARDS) {
  writeFileSync(resolve(OUT, `${c.id}.svg`), svg(c), 'utf8');
  n += 1;
}

// Muestra: una carta representativa de cada modalidad.
const picks = ['par-limusina', 'par-gran-premio', 'par-casa-gratis', 'par-sin-renta',
  'arca-error-bancario', 'fortuna-reparaciones', 'pri-fianza-express', 'enr-dedo-pegajoso'];
const muestra = picks.map((id) => CARDS.find((c) => c.id === id)!).filter(Boolean);
writeFileSync(resolve(OUT, '_muestra.svg'), sheet(muestra, 4), 'utf8');

console.log(`Generadas ${n} cartas en public/cards/ + _muestra.svg (${muestra.length} cartas)`);
