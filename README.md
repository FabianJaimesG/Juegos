# Juegos

Colección de juegos sencillos, pensados para poder abrirlos y jugarlos desde cualquier
dispositivo (celular, tablet o computador) con acceso a este repositorio.

## Idea

Cada juego vive en su propia carpeta y, en la medida de lo posible, es autocontenido: un único
archivo HTML sin dependencias externas ni pasos de instalación. Así, para jugar solo hace falta
abrir el archivo en un navegador (por ejemplo con doble clic, o sirviéndolo con algo como
`python3 -m http.server`) — no se necesita Node, ni `npm install`, ni un build.

## Juegos

- [`BancaViritual/`](./BancaViritual) — Banca virtual para tu Monopolio de mesa: lleva los saldos
  de cada jugador desde el celular en vez de usar billetes de papel. Abrir
  `BancaViritual/banca-virtual.html` en el navegador.

## Cómo agregar un juego nuevo

1. Crear una carpeta nueva en la raíz con el nombre del juego.
2. Dejarlo como un HTML autocontenido (o el mínimo de archivos posible) para que se pueda abrir
   directamente en el navegador sin build.
3. Agregar una entrada en la lista de "Juegos" de este README.
