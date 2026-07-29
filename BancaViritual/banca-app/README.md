# Banca (nueva versión) — Vite + React + TS + Supabase

Reescritura de la "Banca" (banquero virtual de Monopoly) con código fuente real, pensada para crecer:
propiedades del tablero, compra, renta, hipoteca, casas, negocios entre jugadores y extensiones.

- **Frontend:** Vite + React + TypeScript (SPA).
- **Backend:** Supabase (Postgres + Realtime + Auth + Edge Functions). Sin servidor propio.
- **Esquema/migraciones:** Prisma (`prisma/schema.prisma`) sobre el Postgres de Supabase.
- **Runtime de datos:** el navegador usa `@supabase/supabase-js` (REST/Realtime). **Prisma NO corre
  en el navegador**; es solo herramienta de esquema/migraciones en desarrollo.

> La versión actual en producción sigue siendo el archivo `../banca-virtual.html` (un solo HTML).
> Este proyecto es la base para migrar. Mientras se porta, aquel sigue funcionando.

## Requisitos de entorno

Copia `.env.example` a `.env` y rellena:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — públicas (van al navegador; protegidas por RLS).
- `DATABASE_URL` — **secreto**, solo para Prisma. Vite no lo expone (no tiene prefijo `VITE_`).
  Obtén la cadena en Supabase Dashboard → *Settings → Database → Connection string* (pestaña ORM),
  tras *Reset database password*.

El proyecto Supabase ya existe: `banca-monopoly` (ref `wwgnidbcwlfmvpkoyvpk`, región us-east-2).

## Scripts

```bash
npm install            # instalar dependencias
npm run dev            # servidor de desarrollo (Vite)
npm run build          # typecheck (tsc) + build de producción
npm run preview        # previsualizar el build
npm test               # pruebas de reglas y de cartas (sin dependencias)

# Base de datos (Prisma → Supabase Postgres)
npx prisma validate    # validar el esquema
npx prisma migrate dev --name init   # crea las tablas en Supabase (requiere DATABASE_URL)
npx prisma studio      # explorar datos
```

## Modelo de datos (inicial)

`prisma/schema.prisma` define:

- **Property** — catálogo del tablero (precio, `rent[]` por nivel, `houseCost`, `mortgage`,
  `colorGroup`, `expansion`). Independiente de la partida; las extensiones se separan por `expansion`.
- **Game** — una partida/sala (código, símbolo de moneda, turno, `settings`).
- **Player** — jugador de una partida (nombre, icono, color, `balance`, `bankrupt`, `seat`).
- **Ownership** — propiedad poseída por un jugador en una partida (`houses`, `mortgaged`).
- **Transaction** — historial de movimientos (para historial y undo).
- **Trade** — negocios entre jugadores (futuro).

## 🔧 Dónde cambiar valores (IMPORTANTE)

Toda la configuración editable vive en dos archivos. **No hace falta tocar código de la app.**

### 1. Reglas económicas → `src/domain/config.ts`

| Quiero cambiar… | Campo en `GAME_CONFIG` |
|---|---|
| **Dinero inicial** de cada jugador | `initialBalance` (1500) |
| **Monto de SALIDA** (lo que cobras al pasar) | `goSalary` (200) |
| Impuesto sobre ingresos | `incomeTax` (200) |
| Impuesto de lujo | `luxuryTax` (100) |
| **Casas disponibles** en el banco | `bankHouses` (32) |
| **Hoteles disponibles** en el banco | `bankHotels` (12) |
| Cuánto devuelve **vender una casa** | `houseSellRefundRate` (0.5 = mitad) |
| Recargo para **deshipotecar** | `unmortgageSurchargeRate` (0.1 = 10%) |

### 2. Valores de cada propiedad → `src/domain/board.ts`

- **Nombre, precio, renta, hipoteca** de cada propiedad: en el arreglo `PROPERTIES`.
  Formato de `rent`: calles `[base, 1casa, 2, 3, 4, hotel]`; ferrocarriles `[1, 2, 3, 4]`;
  servicios `[×4, ×10]`.
- **Costo de casa por grupo de color** (50/100/150/200) y color visual: en `GROUPS`.

### 3. Cartas (Arca Comunal / Fortuna) → `src/domain/cards.ts`

- Las 32 cartas clásicas están en `CARDS`, con `pack: 'base'`.
- **Añadir una modalidad de juego** (prisión, parada libre, todo en venta…): agrega
  cartas con otro `pack` y registra la modalidad en `PACKS`. Aparece sola en el panel
  de la pantalla de preparación, donde se elige qué mazos usar en la partida.
- Cada carta declara un `effect`. Los efectos **liquidables** (`bank_pay`, `bank_charge`,
  `collect_each`, `pay_each`, `repairs`, `pot_add`, `pot_take`, `limo`…) los aplica el motor
  solo; los **instructivos** (`goto`, `move_back`, `to_jail`, `nearest`, `manual`…) solo
  muestran el texto, porque la app no rastrea la posición de las fichas en el tablero físico.
- `keep: true` marca las cartas que **se guardan en la mano** en vez de descartarse
  (salir de la cárcel, exención de renta, renta doble). Se usan con `USE_CARD`.
- `copies` define cuántas veces entra una carta al mazo (balance).
- Si una modalidad necesita un efecto que no existe, se añade una variante a
  `CardEffect` y su caso en `actionFor()` (`src/game/engine.ts`).
- En los textos, `{m}` se reemplaza por el símbolo de moneda de la partida.

### 4. Ruleta y modalidad Parada Libre → `src/domain/cards.ts`

- `WHEEL`: los 8 sectores (4 de castigo, 4 de premio). Reutilizan `CardEffect`.
- Girar cuesta **1 ficha de giro** y entrega **1 ficha de bonificación** (regla de la caja:
  "toma una tarjeta de Bonificación cada vez que gires").
- Con la modalidad activa, **todo pago al banco** (`PLAYER_TO_BANK`: multas, impuestos,
  cartas) alimenta el bote. Las compras y construcciones NO.
- `settings.maxSpins` (por defecto 3) topa las fichas obtenidas perdonando rentas: sin
  tope, dos jugadores pueden pactar no cobrarse para fabricar fichas gratis del banco.
- Balance del mazo de Bonificación: 24 cartas vía `copies` por carta.

### Tras cambiar valores

```bash
npm run db:seed     # vuelca board.ts a la BD (propiedades)
npm run gen:cards   # regenera las tarjetas SVG de public/properties/
npm run gen:cardart # regenera el arte de las cartas en public/cards/

npx tsx scripts/enable-cards-rls.ts   # lectura pública de la tabla Card (una vez)
```

## 📐 Reglas de negociación / hipoteca (acordadas)

- En una negociación se pueden intercambiar propiedades **hipotecadas o no**, y **dinero**.
- Solo aparecen propiedades **sin casas** (si el grupo tiene casas, hay que venderlas antes).
- Una propiedad hipotecada se transfiere **tal cual (sigue hipotecada)**; **no** se cobra el 10% en
  la negociación. El nuevo dueño es responsable de **deshipotecarla después**, como acción aparte.
- Construir requiere **grupo de color completo y sin hipotecas**, respetando construcción pareja
  (*even build*) y el **límite de casas/hoteles del banco** (`availableBuildings()` en `wealth.ts`).

## Estado y próximos pasos

1. ✅ Scaffold + Supabase client + esquema Prisma + build verde.
2. ✅ Migración aplicada (`prisma migrate`) y **28 propiedades sembradas** en Supabase.
3. ✅ Dominio POO: clase `Property` + renta clásica, `wealth.ts` (patrimonio), `PropertyCard`, 28 SVG.
4. ✅ Nombres/valores confirmados con las fotos del tablero (edición clásica en español).
5. ✅ Engine + UI: banquero, pagar/transferir unificado, cobrar, comprar propiedad,
   hipoteca, casas (even-build + límite del banco), **negociación**, patrimonio por jugador.
6. ✅ **Sincronización en vivo**: tabla `Room` (JSON) + Supabase Realtime. Crear/unirse a sala,
   enlace de invitación (`?room=`), recuperación de quien entra tarde. Habilitar con
   `npx tsx scripts/enable-realtime.ts` (ya ejecutado).
7. ✅ Cartas: 71 en 6 modalidades (`cards.ts`), mazos Arca/Fortuna/Bonificación, arte SVG propio,
   panel de modalidades, y tabla `Card` sembrada en Supabase.
8. ✅ Expansión **Parada Libre**: bote acumulado, limusina dorada, ruleta de 8 sectores, fichas
   de giro/bonificación (negociables) y canje renta→ficha con tope anti-alianzas.
9. ✅ Expansión **Prisión**: estado de cárcel, fianza, condena por turnos e indultos.
10. ⏳ Portar extras del banquero original: dados/turnos, sonido, voz, gráfico de patrimonio.
11. ⏳ Desplegar en GitHub Pages / Vercel (build estático) y probar entre dispositivos reales.
