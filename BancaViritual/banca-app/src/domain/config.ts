/**
 * ⚙️ CONFIGURACIÓN DEL JUEGO — valores editables en un solo lugar.
 *
 * Cambia aquí las reglas económicas. Los VALORES DE CADA PROPIEDAD (precio, renta,
 * hipoteca, costo de casa, nombre) NO están aquí: están en `board.ts`.
 *
 * Tras cambiar valores de propiedades en board.ts, vuelve a sembrar:  npm run db:seed
 */
export const GAME_CONFIG = {
  /** Dinero con el que empieza cada jugador. Clásico: 1500. */
  initialBalance: 1500,

  /** Dinero que se cobra al pasar (o caer) en SALIDA. Clásico: 200. */
  goSalary: 200,

  /** Impuesto sobre ingresos ("PAGUE $200" en el tablero). */
  incomeTax: 200,

  /** Impuesto de lujo ("POSESIONES DE LUJO $100"). */
  luxuryTax: 100,

  /** Fianza para salir de la cárcel. Clásico: 50. */
  bail: 50,
  /** Turnos que se puede permanecer en la cárcel antes de pagar la fianza a la fuerza. */
  jailTurns: 3,

  /** Casas y hoteles disponibles en el banco (regla de escasez clásica). */
  bankHouses: 32,
  bankHotels: 12,

  /** Al vender una casa se recupera esta fracción de su costo. Clásico: 0.5 (la mitad). */
  houseSellRefundRate: 0.5,

  /** Recargo para deshipotecar sobre el valor de hipoteca. Clásico: 0.1 (10%). */
  unmortgageSurchargeRate: 0.1,
} as const;

export type GameConfig = typeof GAME_CONFIG;
