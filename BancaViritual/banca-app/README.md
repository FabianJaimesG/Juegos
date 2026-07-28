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

### Tras cambiar valores

```bash
npm run db:seed     # vuelca board.ts a la BD (propiedades)
npm run gen:cards   # regenera las tarjetas SVG de public/properties/
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
5. ⏳ Habilitar Realtime en las tablas de partida y sincronizar el estado.
6. ⏳ Portar el banquero actual (jugadores, pagar/cobrar/transferir, dados, historial, voz, gráfico).
7. ⏳ Funciones nuevas: comprar propiedad → hipoteca → casas → negociación → patrimonio en info.
