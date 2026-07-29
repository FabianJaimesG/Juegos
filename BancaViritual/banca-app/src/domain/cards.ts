/**
 * 🃏 CARTAS — Arca Comunal y Fortuna.
 *
 * Igual que `board.ts`, esto es un catálogo literal que viaja en el bundle.
 * El campo `pack` agrupa las cartas por MODALIDAD de juego: 'base' son las 32
 * del Monopoly clásico; para añadir una modalidad (prisión, parada libre, todo
 * en venta…) basta con agregar cartas con otro `pack` y registrarlo en `PACKS`.
 *
 * En los textos, `{m}` se reemplaza por el símbolo de moneda de la partida.
 */

export type DeckId = 'arca' | 'fortuna' | 'bonificacion';

/**
 * Efecto de una carta.
 *
 * Los seis primeros son LIQUIDABLES: el motor mueve el dinero solo.
 * Los cuatro últimos son INSTRUCTIVOS: implican mover la ficha en el tablero
 * físico, así que la app solo muestra la instrucción (la app no rastrea
 * posiciones). Algunos llevan además dinero automático (`bonus`).
 */
export type CardEffect =
  // ── Liquidables: el motor mueve el dinero solo ──
  | { kind: 'bank_pay'; amount: number } // el banco te paga
  | { kind: 'bank_charge'; amount: number } // pagas al banco
  | { kind: 'collect_each'; amount: number } // cada jugador te paga
  | { kind: 'pay_each'; amount: number } // pagas a cada jugador
  | { kind: 'repairs'; perHouse: number; perHotel: number } // según tus construcciones
  | { kind: 'pay_percent'; rate: number; of: 'networth' | 'cash' } // % de tu patrimonio/efectivo
  | { kind: 'pay_per_property'; amount: number } // pagas por cada propiedad tuya
  | { kind: 'collect_per_property'; amount: number } // cobras por cada propiedad tuya
  | { kind: 'collect_richest'; amount: number } // el jugador más rico te paga
  | { kind: 'pay_richest'; amount: number } // le pagas al jugador más rico
  | { kind: 'pot_take'; share: number } // te llevas el bote (1 = todo, 0.5 = la mitad)
  | { kind: 'pot_add'; amount: number } // aportas al bote de Parada Libre
  | { kind: 'limo' } // te conviertes en la limusina dorada
  | { kind: 'jail_free' } // sales de la cárcel sin pagar fianza
  // ── Instructivas: el jugador actúa sobre el tablero físico ──
  | { kind: 'goto'; label: string; collectGo: boolean; bonus?: number }
  | { kind: 'move_back'; steps: number }
  | { kind: 'to_jail' }
  | { kind: 'nearest'; of: 'railroad' | 'utility' }
  | { kind: 'manual' } // la carta se explica sola; nadie mueve dinero automáticamente
  | { kind: 'free_house' } // construyes una casa gratis, saltándote las reglas de grupo
  // ── Instructivas de expansión (la app no puede resolverlas sola) ──
  | { kind: 'auction' } // sale una propiedad a subasta
  | { kind: 'free_property' } // te quedas una propiedad libre sin pagarla
  | { kind: 'rent_exempt' } // no pagas la próxima renta
  | { kind: 'rent_double' } // cobras el doble la próxima vez
  | { kind: 'force_swap' }; // intercambio obligado de propiedad

export interface CardDef {
  /** slug estable, p. ej. "arca-error-bancario". */
  id: string;
  deck: DeckId;
  /** Modalidad a la que pertenece la carta. */
  pack: string;
  /** Texto literal de la carta física. `{m}` = símbolo de moneda. */
  text: string;
  emoji: string;
  effect: CardEffect;
  /**
   * La carta NO se descarta al robarla: pasa a la mano del jugador, que decide
   * cuándo usarla (y puede negociarla). Comportamiento general, no exclusivo de
   * "salir de la cárcel".
   */
  keep?: boolean;
  /** Cuántas copias entran al mazo. Por defecto 1. */
  copies?: number;
}

/** Metadatos de cada mazo (para la UI). */
export const DECKS: Record<DeckId, { label: string; emoji: string; color: string }> = {
  arca: { label: 'Arca Comunal', emoji: '📦', color: '#7cc6e8' },
  fortuna: { label: 'Fortuna', emoji: '❓', color: '#f7941d' },
  bonificacion: { label: 'Bonificación', emoji: '⭐', color: '#eab308' },
};

export interface PackDef {
  label: string;
  emoji: string;
  desc: string;
  /** Color de identidad de la modalidad (cinta de la carta y panel). */
  color: string;
  /** Aviso cuando la modalidad necesita mecánica que aún no existe. */
  todo?: string;
}

/** Modalidades de juego disponibles. Añade aquí cada expansión nueva. */
export const PACKS: Record<string, PackDef> = {
  base: {
    label: 'Clásico',
    emoji: '🎩',
    desc: 'Las 32 cartas de siempre: cobros, pagos y visitas a la cárcel.',
    color: '#2f6f4e',
  },
  prision: {
    label: 'Prisión',
    emoji: '🚔',
    desc: 'Fianzas, indultos y condenas. Entrar es fácil; salir, caro.',
    color: '#4b5563',
  },
  'parada-libre': {
    label: 'Parada Libre',
    emoji: '🅿️',
    desc: 'Bote acumulado, limusina dorada y ruleta. Cada jugador empieza con 2 fichas de giro y 2 cartas de Bonificación en la mano, que usa cuando quiera.',
    color: '#0e7490',
  },
  'todo-venta': {
    label: 'Todo en Venta',
    emoji: '🏷️',
    desc: 'Subastas, tasaciones y liquidaciones. Nada es tuyo para siempre.',
    color: '#b45309',
  },
  'banca-total': {
    label: 'Banca Total',
    emoji: '💳',
    desc: 'La economía se mueve: intereses, bonos y recesiones para todos.',
    color: '#6d28d9',
  },
  enredos: {
    label: 'Enredos',
    emoji: '🃏',
    desc: 'Favores, descuidos y jugadas turbias entre jugadores.',
    color: '#be123c',
  },
};

// ─────────────────────────── Arca Comunal (16) ───────────────────────────
const ARCA: CardDef[] = [
  { id: 'arca-error-bancario', deck: 'arca', pack: 'base', emoji: '🏦',
    text: 'Error bancario a su favor. Cobre {m}200.',
    effect: { kind: 'bank_pay', amount: 200 } },
  { id: 'arca-honorarios-medicos', deck: 'arca', pack: 'base', emoji: '🩺',
    text: 'Honorarios médicos. Pague {m}50.',
    effect: { kind: 'bank_charge', amount: 50 } },
  { id: 'arca-hospital', deck: 'arca', pack: 'base', emoji: '🏥',
    text: 'Pague cuenta de hospital por {m}100.',
    effect: { kind: 'bank_charge', amount: 100 } },
  { id: 'arca-colegiaturas', deck: 'arca', pack: 'base', emoji: '🎓',
    text: 'Pague colegiaturas por {m}50.',
    effect: { kind: 'bank_charge', amount: 50 } },
  { id: 'arca-fondo-vacacional', deck: 'arca', pack: 'base', emoji: '🏝️',
    text: 'Vencimiento de fondo vacacional. Reciba {m}100.',
    effect: { kind: 'bank_pay', amount: 100 } },
  { id: 'arca-seguro-vida', deck: 'arca', pack: 'base', emoji: '📄',
    text: 'Vencimiento de seguro de vida. Cobre {m}100.',
    effect: { kind: 'bank_pay', amount: 100 } },
  { id: 'arca-devolucion-impuestos', deck: 'arca', pack: 'base', emoji: '🧾',
    text: 'Devolución de impuestos. Cobre {m}20.',
    effect: { kind: 'bank_pay', amount: 20 } },
  { id: 'arca-consultoria', deck: 'arca', pack: 'base', emoji: '💼',
    text: 'Recibe {m}25 por consultoría.',
    effect: { kind: 'bank_pay', amount: 25 } },
  { id: 'arca-herencia', deck: 'arca', pack: 'base', emoji: '📜',
    text: 'Hereda {m}100.',
    effect: { kind: 'bank_pay', amount: 100 } },
  { id: 'arca-venta-acciones', deck: 'arca', pack: 'base', emoji: '📈',
    text: 'Por venta de acciones reciba {m}50.',
    effect: { kind: 'bank_pay', amount: 50 } },
  { id: 'arca-concurso-belleza', deck: 'arca', pack: 'base', emoji: '🏆',
    text: 'Ganó el segundo premio en un concurso de belleza. Cobre {m}10.',
    effect: { kind: 'bank_pay', amount: 10 } },
  { id: 'arca-cumpleanos', deck: 'arca', pack: 'base', emoji: '🎂',
    text: 'Es su cumpleaños. Cobre {m}10 a cada jugador.',
    effect: { kind: 'collect_each', amount: 10 } },
  { id: 'arca-reparacion-vial', deck: 'arca', pack: 'base', emoji: '🚧',
    text: 'Por reparación vial le cobran: {m}40 por casa, {m}115 por hotel.',
    effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'arca-salir-carcel', deck: 'arca', pack: 'base', emoji: '🔑',
    text: 'Salga de la cárcel gratis. Conserve esta tarjeta hasta utilizarla o venderla.',
    keep: true, effect: { kind: 'jail_free' } },
  { id: 'arca-avance-salida', deck: 'arca', pack: 'base', emoji: '🟢',
    text: 'Avance a "Salida" (cobre {m}200).',
    effect: { kind: 'goto', label: 'SALIDA', collectGo: false, bonus: 200 } },
  { id: 'arca-a-la-carcel', deck: 'arca', pack: 'base', emoji: '🚔',
    text: 'Váyase a la cárcel. Vaya directamente a la cárcel, no pase por "Salida", no cobre {m}200.',
    effect: { kind: 'to_jail' } },
];

// ───────────────────────────── Fortuna (16) ──────────────────────────────
const FORTUNA: CardDef[] = [
  { id: 'fortuna-avance-salida', deck: 'fortuna', pack: 'base', emoji: '🟢',
    text: 'Avance a "Salida" (cobre {m}200).',
    effect: { kind: 'goto', label: 'SALIDA', collectGo: false, bonus: 200 } },
  { id: 'fortuna-plaza-san-carlos', deck: 'fortuna', pack: 'base', emoji: '⛪',
    text: 'Avance a Plaza San Carlos. Si pasa por "Salida" cobre {m}200.',
    effect: { kind: 'goto', label: 'Plaza San Carlos', collectGo: true } },
  { id: 'fortuna-illinois', deck: 'fortuna', pack: 'base', emoji: '🌽',
    text: 'Avance a Avenida Illinois. Si pasa por "Salida" cobre {m}200.',
    effect: { kind: 'goto', label: 'Avenida Illinois', collectGo: true } },
  { id: 'fortuna-muelle', deck: 'fortuna', pack: 'base', emoji: '🎡',
    text: 'Avance a El Muelle.',
    effect: { kind: 'goto', label: 'El Muelle', collectGo: false } },
  { id: 'fortuna-reading', deck: 'fortuna', pack: 'base', emoji: '🚂',
    text: 'Viaje en el Ferrocarril Reading. Si pasa por "Salida" cobre {m}200.',
    effect: { kind: 'goto', label: 'Ferrocarril Reading', collectGo: true } },
  { id: 'fortuna-ferrocarril-cercano-1', deck: 'fortuna', pack: 'base', emoji: '🚉',
    text: 'Avance al ferrocarril más cercano. Si está a la venta, puede comprárselo al Banco. Si es propiedad de alguien, pague el doble de la renta marcada.',
    effect: { kind: 'nearest', of: 'railroad' } },
  { id: 'fortuna-ferrocarril-cercano-2', deck: 'fortuna', pack: 'base', emoji: '🚉',
    text: 'Avance al ferrocarril más cercano. Si está a la venta, puede comprárselo al Banco. Si es propiedad de alguien, pague el doble de la renta marcada.',
    effect: { kind: 'nearest', of: 'railroad' } },
  { id: 'fortuna-servicio-cercano', deck: 'fortuna', pack: 'base', emoji: '💡',
    text: 'Avance al servicio más cercano. Si está a la venta, puede comprárselo al Banco. Si es propiedad de alguien, tire los dados y pague diez veces lo tirado.',
    effect: { kind: 'nearest', of: 'utility' } },
  { id: 'fortuna-retroceda-3', deck: 'fortuna', pack: 'base', emoji: '↩️',
    text: 'Retroceda tres casillas.',
    effect: { kind: 'move_back', steps: 3 } },
  { id: 'fortuna-a-la-carcel', deck: 'fortuna', pack: 'base', emoji: '🚔',
    text: 'Váyase a la cárcel. Vaya directamente a la cárcel, no pase por "Salida", no cobre {m}200.',
    effect: { kind: 'to_jail' } },
  { id: 'fortuna-salir-carcel', deck: 'fortuna', pack: 'base', emoji: '🔑',
    text: 'Salga de la cárcel gratis. Conserve esta tarjeta hasta utilizarla o venderla.',
    keep: true, effect: { kind: 'jail_free' } },
  { id: 'fortuna-reparaciones', deck: 'fortuna', pack: 'base', emoji: '🔧',
    text: 'Haga reparaciones en sus propiedades: por cada casa pague {m}25, por cada hotel pague {m}100.',
    effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'fortuna-presidente', deck: 'fortuna', pack: 'base', emoji: '👔',
    text: 'Ha sido elegido presidente del consejo de administración. Pague a cada jugador {m}50.',
    effect: { kind: 'pay_each', amount: 50 } },
  { id: 'fortuna-prestamo-construccion', deck: 'fortuna', pack: 'base', emoji: '🏗️',
    text: 'Por cumplimiento en pago del préstamo de construcción cobre {m}150.',
    effect: { kind: 'bank_pay', amount: 150 } },
  { id: 'fortuna-dividendos', deck: 'fortuna', pack: 'base', emoji: '💰',
    text: 'El banco le paga dividendos por {m}50.',
    effect: { kind: 'bank_pay', amount: 50 } },
  { id: 'fortuna-multa-velocidad', deck: 'fortuna', pack: 'base', emoji: '🚨',
    text: 'Pague multa por exceso de velocidad {m}15.',
    effect: { kind: 'bank_charge', amount: 15 } },
];

// ══════════════════ MODALIDADES ══════════════════
// Cartas propias, escritas para esta app. Se mezclan con los mazos existentes
// (`deck`) cuando su modalidad está activa.

// ── 🚔 Prisión ──
const PRISION: CardDef[] = [
  { id: 'pri-indulto', deck: 'arca', pack: 'prision', emoji: '📜',
    text: 'Indulto firmado. Consérvalo: cancela una estancia en la cárcel cuando quieras.',
    keep: true, effect: { kind: 'jail_free' } },
  { id: 'pri-fianza-express', deck: 'arca', pack: 'prision', emoji: '⚖️',
    text: 'Fianza exprés. Paga {m}75 y sales en el acto.',
    effect: { kind: 'bank_charge', amount: 75 } },
  { id: 'pri-evasion', deck: 'fortuna', pack: 'prision', emoji: '🚨',
    text: 'Te sorprenden evadiendo impuestos. A la cárcel, sin cobrar nada de camino.',
    effect: { kind: 'to_jail' } },
  { id: 'pri-desacato', deck: 'fortuna', pack: 'prision', emoji: '🔨',
    text: 'Desacato al juez. Paga {m}100 de multa.',
    effect: { kind: 'bank_charge', amount: 100 } },
  { id: 'pri-abogado', deck: 'arca', pack: 'prision', emoji: '💼',
    text: 'Tu abogado gana el caso. El banco te compensa {m}50.',
    effect: { kind: 'bank_pay', amount: 50 } },
  { id: 'pri-soborno', deck: 'fortuna', pack: 'prision', emoji: '🤝',
    text: 'Un guardia mira hacia otro lado. Paga {m}50 al jugador más rico.',
    effect: { kind: 'pay_richest', amount: 50 } },
  { id: 'pri-buen-comportamiento', deck: 'arca', pack: 'prision', emoji: '🕊️',
    text: 'Buen comportamiento. Sales en tu próximo turno sin pagar fianza.',
    effect: { kind: 'manual' } },
  { id: 'pri-visita-conyugal', deck: 'fortuna', pack: 'prision', emoji: '🎁',
    text: 'Te llega un paquete de casa. Cobra {m}25 a cada jugador libre.',
    effect: { kind: 'collect_each', amount: 25 } },
];

// ── 🅿️ Parada Libre ──
// Mazo propio de BONIFICACIÓN (24 cartas). TODAS se guardan en la mano: el
// jugador las acumula y decide en qué momento usarlas. El reparto de copias
// busca que las decisivas (Gran Premio, Limusina) sean un evento y no rutina.
const PARADA: CardDef[] = [
  { id: 'par-casa-gratis', deck: 'bonificacion', pack: 'parada-libre', emoji: '🏠', keep: true, copies: 5,
    text: 'Casa gratis. Construye una casa en cualquiera de tus propiedades, aunque no tengas el grupo de color completo.',
    effect: { kind: 'free_house' } },
  { id: 'par-sin-renta', deck: 'bonificacion', pack: 'parada-libre', emoji: '🛡️', copies: 5, keep: true,
    text: 'No pagas renta la próxima vez que caigas en una propiedad de otro jugador. Consérvala hasta usarla.',
    effect: { kind: 'rent_exempt' } },
  { id: 'par-limusina', deck: 'bonificacion', pack: 'parada-libre', emoji: '🚘', keep: true, copies: 3,
    text: 'Mejora de vehículo. Cambia tu ficha por la limusina dorada: las propiedades libres donde caigas son tuyas gratis y no pagas renta a nadie.',
    effect: { kind: 'limo' } },
  { id: 'par-propiedad-gratis', deck: 'bonificacion', pack: 'parada-libre', emoji: '🎁', keep: true, copies: 4,
    text: 'Propiedad gratis. Toma cualquier propiedad sin dueño, sin tener que caer en ella.',
    effect: { kind: 'free_property' } },
  { id: 'par-renta-doble', deck: 'bonificacion', pack: 'parada-libre', emoji: '💰', copies: 3, keep: true,
    text: 'Cobra renta doble la próxima vez que un jugador caiga en una de tus propiedades. Consérvala hasta usarla.',
    effect: { kind: 'rent_double' } },
  { id: 'par-intercambio', deck: 'bonificacion', pack: 'parada-libre', emoji: '🔀', keep: true, copies: 2,
    text: 'Intercambio forzoso. Cambia una de tus propiedades por la de otro jugador. No se negocia: el otro debe aceptar.',
    effect: { kind: 'force_swap' } },
  { id: 'par-gran-premio', deck: 'bonificacion', pack: 'parada-libre', emoji: '🎰', keep: true, copies: 2,
    text: 'Gran premio. Te llevas todo el dinero acumulado en la Parada Libre.',
    effect: { kind: 'pot_take', share: 1 } },
];

// ── 🏷️ Todo en Venta ──
const VENTA: CardDef[] = [
  { id: 'ven-subasta', deck: 'fortuna', pack: 'todo-venta', emoji: '🔨',
    text: 'Subasta relámpago. La siguiente propiedad libre sale al mejor postor.',
    effect: { kind: 'auction' } },
  { id: 'ven-tasacion', deck: 'arca', pack: 'todo-venta', emoji: '📈',
    text: 'Tasación al alza. Cobra {m}50 por cada propiedad que tengas.',
    effect: { kind: 'collect_per_property', amount: 50 } },
  { id: 'ven-corredor', deck: 'fortuna', pack: 'todo-venta', emoji: '🧾',
    text: 'Comisión del corredor. Paga {m}25 por cada propiedad que tengas.',
    effect: { kind: 'pay_per_property', amount: 25 } },
  { id: 'ven-plusvalia', deck: 'fortuna', pack: 'todo-venta', emoji: '🏛️',
    text: 'Impuesto de plusvalía. Paga el 10% de tu patrimonio.',
    effect: { kind: 'pay_percent', rate: 0.1, of: 'networth' } },
  { id: 'ven-liquidacion', deck: 'arca', pack: 'todo-venta', emoji: '🏚️',
    text: 'Liquidación urgente. Puedes vender una propiedad al banco por su valor de hipoteca.',
    effect: { kind: 'manual' } },
  { id: 'ven-oferta-hostil', deck: 'fortuna', pack: 'todo-venta', emoji: '💸',
    text: 'Oferta hostil. Puedes comprar una propiedad sin construir de otro jugador pagando el doble de su precio.',
    effect: { kind: 'manual' } },
  { id: 'ven-remate', deck: 'arca', pack: 'todo-venta', emoji: '🏷️',
    text: 'Remate del banco. Consigues una casa sin pagarla.',
    effect: { kind: 'free_house' } },
  { id: 'ven-boom', deck: 'arca', pack: 'todo-venta', emoji: '🌆',
    text: 'Boom inmobiliario. El banco te paga {m}150 por tus terrenos.',
    effect: { kind: 'bank_pay', amount: 150 } },
];

// ── 💳 Banca Total ──
const BANCA: CardDef[] = [
  { id: 'ban-interes', deck: 'fortuna', pack: 'banca-total', emoji: '📉',
    text: 'Suben las tasas. Paga el 5% de tu patrimonio.',
    effect: { kind: 'pay_percent', rate: 0.05, of: 'networth' } },
  { id: 'ban-dividendo', deck: 'arca', pack: 'banca-total', emoji: '💹',
    text: 'Tus inversiones rinden. Cobra {m}150.',
    effect: { kind: 'bank_pay', amount: 150 } },
  { id: 'ban-auditoria', deck: 'fortuna', pack: 'banca-total', emoji: '🔍',
    text: 'Auditoría sorpresa. Paga el 10% de tu efectivo.',
    effect: { kind: 'pay_percent', rate: 0.1, of: 'cash' } },
  { id: 'ban-recesion', deck: 'fortuna', pack: 'banca-total', emoji: '📊',
    text: 'Recesión. Todos los jugadores pagan {m}50 al banco.',
    effect: { kind: 'manual' } },
  { id: 'ban-rescate', deck: 'arca', pack: 'banca-total', emoji: '🛟',
    text: 'Rescate financiero. Si tienes menos de {m}200, el banco te presta {m}200.',
    effect: { kind: 'manual' } },
  { id: 'ban-credito', deck: 'arca', pack: 'banca-total', emoji: '💳',
    text: 'Aprueban tu crédito. Cobra {m}100.',
    effect: { kind: 'bank_pay', amount: 100 } },
  { id: 'ban-comision', deck: 'fortuna', pack: 'banca-total', emoji: '🏦',
    text: 'Comisiones ocultas. Paga {m}75.',
    effect: { kind: 'bank_charge', amount: 75 } },
  { id: 'ban-inflacion', deck: 'arca', pack: 'banca-total', emoji: '🎈',
    text: 'Inflación. Las rentas suben al doble hasta que alguien pase por Salida.',
    effect: { kind: 'manual' } },
];

// ── 🃏 Enredos ──
const ENREDOS: CardDef[] = [
  { id: 'enr-descuido', deck: 'fortuna', pack: 'enredos', emoji: '🫣',
    text: 'Descuido del cajero. Si nadie lo nota antes de tu próximo turno, cobra {m}100.',
    effect: { kind: 'manual' } },
  { id: 'enr-dedo-pegajoso', deck: 'fortuna', pack: 'enredos', emoji: '🖐️',
    text: 'Se te quedó pegado. El jugador más rico te paga {m}50.',
    effect: { kind: 'collect_richest', amount: 50 } },
  { id: 'enr-te-pillaron', deck: 'arca', pack: 'enredos', emoji: '👀',
    text: 'Te pillaron con las manos en la caja. Paga {m}50 al jugador más rico.',
    effect: { kind: 'pay_richest', amount: 50 } },
  { id: 'enr-favor', deck: 'arca', pack: 'enredos', emoji: '🤞',
    text: 'Cobras un favor viejo. Cada jugador te paga {m}20.',
    effect: { kind: 'collect_each', amount: 20 } },
  { id: 'enr-ronda', deck: 'fortuna', pack: 'enredos', emoji: '🍻',
    text: 'Invitas la ronda. Paga {m}20 a cada jugador.',
    effect: { kind: 'pay_each', amount: 20 } },
  { id: 'enr-cambio-silla', deck: 'arca', pack: 'enredos', emoji: '🔄',
    text: 'Cambio de sillas. Intercambia tu puesto en el orden de turnos con quien elijas.',
    effect: { kind: 'manual' } },
  { id: 'enr-registro', deck: 'fortuna', pack: 'enredos', emoji: '🔦',
    text: 'Registro sorpresa. Enseña tus cartas guardadas a la mesa.',
    effect: { kind: 'manual' } },
  { id: 'enr-trato-turbio', deck: 'arca', pack: 'enredos', emoji: '🕶️',
    text: 'Trato bajo la mesa. Intercambia una propiedad sin construir con otro jugador que acepte.',
    effect: { kind: 'manual' } },
];

export const CARDS: CardDef[] = [
  ...ARCA, ...FORTUNA,
  ...PRISION, ...PARADA, ...VENTA, ...BANCA, ...ENREDOS,
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
export const getCard = (id: string): CardDef | undefined => BY_ID.get(id);

/** Cartas distintas de un mazo dentro de las modalidades activas (sin expandir copias). */
export const cardsFor = (deck: DeckId, packs: string[]): CardDef[] =>
  CARDS.filter((c) => c.deck === deck && packs.includes(c.pack));

/** Cuántas copias entran realmente al mazo. */
export const copiesOf = (c: CardDef): number => c.copies ?? 1;

/** Ids del mazo ya expandidos por copias: lo que se baraja de verdad. */
export const deckIds = (deck: DeckId, packs: string[]): string[] =>
  cardsFor(deck, packs).flatMap((c) => Array.from({ length: copiesOf(c) }, () => c.id));

/** Cuántas cartas aporta una modalidad, contando copias (para el panel). */
export const packSize = (pack: string): number =>
  CARDS.filter((c) => c.pack === pack).reduce((n, c) => n + copiesOf(c), 0);

/** Mazos que aportan cartas con estas modalidades activas. */
export const activeDecks = (packs: string[]): DeckId[] =>
  (Object.keys(DECKS) as DeckId[]).filter((d) => cardsFor(d, packs).length > 0);

/** Sustituye `{m}` por el símbolo de moneda de la partida. */
export const cardText = (c: CardDef, sym: string): string => c.text.replace(/\{m\}/g, sym);

/**
 * ¿El motor puede mover el dinero de esta carta por sí solo?
 * Las instructivas requieren que el jugador mueva su ficha en el tablero físico.
 */
export function isAutomatic(e: CardEffect): boolean {
  switch (e.kind) {
    case 'bank_pay':
    case 'bank_charge':
    case 'collect_each':
    case 'pay_each':
    case 'repairs':
    case 'pay_percent':
    case 'pay_per_property':
    case 'collect_per_property':
    case 'collect_richest':
    case 'pay_richest':
    case 'pot_add':
    case 'pot_take':
    case 'limo':
    case 'jail_free':
      return true;
    case 'goto':
      return e.bonus != null; // "Avance a Salida (cobre 200)": el cobro sí es automático
    default:
      return false;
  }
}

// ═══════════════════ 🎡 RULETA (Parada Libre) ═══════════════════
// Ocho sectores que alternan castigo (rojo → el dinero engorda el bote) y
// premio (verde). Girar cuesta una ficha de giro y aplica la cara que salga.

export interface WheelFace {
  id: string;
  label: string;
  /** Texto corto para escribirlo dentro del sector de la ruleta. */
  short: string;
  emoji: string;
  /** rojo = pierdes dinero (va al bote); verde = premio. */
  tone: 'bad' | 'good';
  effect: CardEffect;
}

export const WHEEL: WheelFace[] = [
  { id: 'w-50', short: '−{m}50', label: 'Pierdes {m}50', emoji: '💸', tone: 'bad', effect: { kind: 'pot_add', amount: 50 } },
  { id: 'w-limo', short: 'LIMUSINA', label: 'La limusina: cambia tu ficha; las propiedades y la renta son gratis', emoji: '🚘', tone: 'good', effect: { kind: 'limo' } },
  { id: 'w-100', short: '−{m}100', label: 'Pierdes {m}100', emoji: '💸', tone: 'bad', effect: { kind: 'pot_add', amount: 100 } },
  { id: 'w-casa', short: 'CASA GRATIS', label: 'Casa gratis en cualquiera de tus propiedades', emoji: '🏠', tone: 'good', effect: { kind: 'free_house' } },
  { id: 'w-150', short: '−{m}150', label: 'Pierdes {m}150', emoji: '💸', tone: 'bad', effect: { kind: 'pot_add', amount: 150 } },
  { id: 'w-compra', short: 'PROPIEDAD', label: 'Compra 1 propiedad sin dueño', emoji: '🏘️', tone: 'good', effect: { kind: 'free_property' } },
  { id: 'w-200', short: '−{m}200', label: 'Pierdes {m}200', emoji: '💸', tone: 'bad', effect: { kind: 'pot_add', amount: 200 } },
  { id: 'w-premio', short: 'GRAN PREMIO', label: '¡GRAN PREMIO! Te llevas todo el dinero acumulado', emoji: '🎰', tone: 'good', effect: { kind: 'pot_take', share: 1 } },
];

export const getWheelFace = (id: string): WheelFace | undefined => WHEEL.find((f) => f.id === id);

/** Texto de una cara con el símbolo de moneda de la partida. */
export const wheelText = (f: WheelFace, sym: string): string => f.label.replace(/\{m\}/g, sym);

/** Etiqueta corta (la que va escrita en el sector). */
export const wheelShort = (f: WheelFace, sym: string): string => f.short.replace(/\{m\}/g, sym);
