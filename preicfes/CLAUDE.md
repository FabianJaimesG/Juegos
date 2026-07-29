# CLAUDE.md

Guía para trabajar en este juego (para Claude Code y para colaboradores).

## Qué es

Colección de juegos de trivia de mesa que comparten el mismo motor (tablero, turnos,
temporizador, sonido), en español, mobile-first y **sin build**. Se elige la modalidad desde
`index.html`:

- **`trivia-saber11.html`** — repaso para el **ICFES Saber 11**. Banco de preguntas por materia
  cargado desde `data/*.js` (ver abajo). Es el juego principal de este repo.
- **`trivia-corona.html`** — trivia de cultura general (categorías clásicas: ciencia, arte,
  historia, geografía, deportes, entretenimiento). Mismo motor, con su banco de preguntas
  **inline** (no modularizado). Cada juego tiene un enlace «← Menú de juegos» que vuelve a
  `index.html`.

El resto de esta guía describe `trivia-saber11.html`, cuyo tema central es un **banco de
preguntas** de opción múltiple. Se abre directamente en el navegador (doble clic sobre
`index.html`, o `python3 -m http.server`).

A diferencia del otro juego del repo (`BancaViritual/`), este HTML **no** está minificado: es
código fuente legible y editable a mano.

## Arquitectura

- **`trivia-saber11.html`** — toda la lógica del juego (tablero, turnos, temporizador, sonido,
  render de preguntas). No contiene los datos del banco.
- **`data/*.js`** — el banco de preguntas, **un archivo por materia**. Se cargan con
  `<script src="data/…">` *antes* del script principal (esto funciona en `file://`, a diferencia
  de `fetch`, por eso NO usamos JSON externo ni SQLite).
- **`data/_categorias.js`** — define las categorías del juego (se carga primero).
- **`_fuente/`** — cartillas/PDF originales para autoría. **No se versiona** (ver `.gitignore`).

### Cómo se conecta

El HTML define un registro global antes de cargar los datos:

```js
window.BANCO = {
  cats: [], preguntas: {},
  addCats(list){ ... },        // usado por data/_categorias.js
  add(cat, arr){ ... }         // usado por cada data/<materia>.js
};
```

Cada archivo de materia solo llama `BANCO.add('naturales', [ ...preguntas... ])`. El juego lee
`BANCO.cats` y `BANCO.preguntas` (como `CATS` y `QUESTIONS`).

Categorías (ids): `lectura`, `mates`, `sociales`, `naturales`, `ingles`, `razona`.

## Esquema de una pregunta

```js
{
  q: "Enunciado de la pregunta",
  a: ["Correcta", "Distractor 1", "Distractor 2", "Distractor 3"], // la PRIMERA es la correcta; el juego baraja
  exp: "Explicación breve (opcional)",
  d: 2,            // opcional: dificultad alta
  src: "FIS80",    // opcional: fuente/cuadernillo (trazabilidad)
  n: 12,           // opcional: número original en la fuente

  // Figura opcional — usar UNO de estos:
  table: { head:[...], rows:[[...]] }, // tabla HTML
  svg:   "<svg …>…</svg>",             // diagrama redibujado (preferido para gráficas simples)
  img:   { src:"data:image/webp;base64,…", alt:"Descripción" }, // imagen embebida en base64
  sign:  "Texto de un letrero",
  pasaje:"Texto largo de contexto"
}
```

Regla **la primera opción es la correcta** en el archivo fuente; el juego las baraja al mostrar.

## Figuras: SVG vs imagen

- **Preferir SVG** (redibujar) para gráficas y diagramas simples: es nítido, liviano, se adapta
  al tema y no infla el archivo. Es el patrón mayoritario del banco.
- **Usar `img` (base64)** solo cuando la figura no se pueda redibujar bien (fotos, figuras
  complejas). Antes de embeber: redimensionar a ~800px de ancho y comprimir (WebP, ~30-80KB) para
  no inflar el `data/<materia>.js`. Siempre incluir `alt` (accesibilidad).

## Agregar preguntas

1. Editar el `data/<materia>.js` correspondiente y añadir objetos al arreglo de `BANCO.add`.
2. Abrir el juego y llamar `validarBanco()` en la consola: reporta preguntas sin enunciado, sin
   opciones o con `img` sin `alt`.

## Probar

- Abrir `trivia-saber11.html` (doble clic) o servir con `python3 -m http.server` y abrir en el
  navegador; probar también desde el celular en la misma red.
- Consola: `validarBanco()` para chequear el esquema.
- Botones **Descargar preguntas / Cargar preguntas** exportan/importan el banco como JSON
  (incluye las imágenes base64).

## Notas

- No hay dependencias externas ni CDN: todo debe funcionar offline y en `file://`.
- Rutas de `data/*.js` son relativas: mantener la carpeta `data/` junto al HTML.
