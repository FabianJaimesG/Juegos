// Motor de juego (puro): estado + acciones. Reutiliza el dominio (board/wealth/config).
import { getProperty } from '../domain/board';
import { cardText, deckIds, getCard, WHEEL, wheelText, type CardEffect, type DeckId } from '../domain/cards';
import { GAME_CONFIG } from '../domain/config';
import type { Holding, PlayerHoldings } from '../domain/wealth';
import {
  activeCountByKind,
  availableBuildings,
  buildingCounts,
  canBuildOn,
  canSellOn,
  countByKind,
  equity,
  netWorth,
  ownsFullGroup,
  ownsFullGroupActive,
} from '../domain/wealth';

export interface RuntimePlayer {
  id: string;
  name: string;
  icon: string;
  colorIndex: number;
  cash: number;
  bankrupt: boolean;
  holdings: Holding[];
  /** Cartas guardadas en mano (cualquier carta con `keep`). Son negociables. */
  tokens: string[];
  /** Parada Libre: fichas para girar la ruleta. */
  spins: number;
  /** Prisión: turnos que lleva encerrado. 0 = libre. */
  jail: number;
  /** Casas gratis pendientes de colocar (carta o ruleta). */
  freeHouses: number;
  /** Propiedades gratis pendientes de tomar (carta o ruleta). */
  freeProps: number;
  /** Intercambios forzosos pendientes de ejecutar. */
  forceSwaps: number;
  /** Administrador: su dispositivo puede operar a todos los jugadores. */
  admin: boolean;
  /** Id del dispositivo que "reclamó" a este jugador (para no robar identidades). */
  claimedBy?: string;
}

export interface LogEntry {
  id: string;
  text: string;
  ts: number;
}

export interface GameSettings {
  dice: boolean;
  special: boolean;
  sound: boolean;
  voice: boolean;
  /** Dinero inicial por jugador (configurable en la preparación). */
  initialBalance: number;
  /** Construcción/venta pareja de casas (regla clásica de uniformidad). */
  evenBuild: boolean;
  /** Modalidades de cartas activas (ids de `PACKS`). 'base' = las 32 clásicas. */
  cardPacks: string[];
  /**
   * Parada Libre: tope de fichas de giro que un jugador puede acumular.
   * Evita que dos jugadores pacten perdonarse la renta indefinidamente para
   * fabricar fichas gratis del banco. 0 = sin tope.
   */
  maxSpins: number;
}

/** Mazo barajado: `draw` se consume por el frente; al agotarse se rebaraja `discard`. */
export interface DeckState {
  draw: string[];
  discard: string[];
}

/** Carta robada, en pantalla, a la espera de que su jugador la resuelva. */
export interface DrawnCard {
  cardId: string;
  playerId: string;
}

export interface DiceRoll {
  a: number;
  b: number;
  /** Etiqueta legible de la cara especial (o null). */
  special: string | null;
  /** Id de la cara, para saber qué mostrar sin comparar textos. */
  specialId?: string;
}

/** Propuesta de negociación pendiente de que B acepte o rechace. */
export interface PendingTrade {
  id: string;
  aId: string; // proponente
  bId: string; // contraparte que debe responder
  aCash: number;
  bCash: number;
  aProps: string[];
  bProps: string[];
  /** Cartas guardadas que entrega cada lado (ids de carta). */
  aCards?: string[];
  bCards?: string[];
  /** Fichas de Parada Libre que entrega cada lado. */
  aSpins?: number;
  bSpins?: number;
}

export interface GameState {
  id: string;
  code: string;
  currencySymbol: string;
  players: RuntimePlayer[];
  turnIndex: number;
  log: LogEntry[];
  settings: GameSettings;
  dice: DiceRoll | null;
  pendingTrade: PendingTrade | null;
  /** Mazos barajados de la partida (se arman al empezar, según `settings.cardPacks`). */
  decks: Record<DeckId, DeckState>;
  /** Carta robada pendiente de resolver (visible para todos). */
  drawnCard: DrawnCard | null;
  /** Parada Libre: dinero acumulado en la casilla (impuestos, multas, ruleta). */
  pot: number;
  /** Parada Libre: quién lleva la limusina dorada (solo uno a la vez). */
  limoPlayerId: string | null;
  /** Parada Libre: última cara de la ruleta, en pantalla hasta que se cierre. */
  wheel: { faceId: string; playerId: string } | null;
  /** false = pantalla de preparación; true = partida en curso. */
  started: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  dice: true,
  special: true,
  sound: true,
  voice: true,
  initialBalance: GAME_CONFIG.initialBalance,
  evenBuild: true,
  cardPacks: ['base'],
  maxSpins: 3,
};

const emptyDecks = (): Record<DeckId, DeckState> => ({
  arca: { draw: [], discard: [] },
  fortuna: { draw: [], discard: [] },
  bonificacion: { draw: [], discard: [] },
});

/** Rellena campos nuevos en estados antiguos (localStorage / remoto). */
export function hydrate(s: GameState): GameState {
  return {
    ...s,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) },
    dice: s.dice ?? null,
    pendingTrade: s.pendingTrade ?? null,
    decks: { ...emptyDecks(), ...(s.decks ?? {}) },
    drawnCard: s.drawnCard ?? null,
    pot: s.pot ?? 0,
    limoPlayerId: s.limoPlayerId ?? null,
    wheel: s.wheel ?? null,
    // Estados guardados antes de existir la preparación ya estaban "en curso".
    started: s.started ?? true,
    players: (s.players ?? []).map((p) => ({
      ...p,
      admin: p.admin ?? false,
      tokens: p.tokens ?? [],
      spins: p.spins ?? 0,
      jail: p.jail ?? 0,
      freeHouses: p.freeHouses ?? 0,
      freeProps: p.freeProps ?? 0,
      forceSwaps: p.forceSwaps ?? 0,
    })),
  };
}

export type Action =
  | { type: 'ADD_PLAYER'; name: string; icon?: string; colorIndex?: number; admin?: boolean }
  | { type: 'START_GAME' }
  | { type: 'END_GAME' } // vuelve a la preparación conservando sala y jugadores
  | { type: 'REORDER_PLAYER'; playerId: string; dir: -1 | 1 }
  | { type: 'REMOVE_PLAYER'; playerId: string }
  | { type: 'DECLARE_BANKRUPTCY'; playerId: string }
  | { type: 'CLAIM_PLAYER'; playerId: string; deviceId: string }
  | { type: 'RELEASE_PLAYER'; deviceId: string }
  | { type: 'BANK_TO_PLAYER'; playerId: string; amount: number } // cobrar del banco
  | { type: 'PLAYER_TO_BANK'; playerId: string; amount: number } // pagar al banco
  | { type: 'TRANSFER'; fromId: string; toIds: string[]; amount: number } // a cada uno
  | { type: 'COLLECT'; toId: string; fromIds: string[]; amount: number } // cobro entre jugadores
  | { type: 'SALIDA'; playerId: string }
  | { type: 'BUY_PROPERTY'; playerId: string; propertyId: string; price?: number; free?: boolean }
  | { type: 'MORTGAGE'; playerId: string; propertyId: string }
  | { type: 'UNMORTGAGE'; playerId: string; propertyId: string }
  | { type: 'BUILD_HOUSE'; playerId: string; propertyId: string; free?: boolean }
  | { type: 'SELL_HOUSE'; playerId: string; propertyId: string }
  | { type: 'EDIT_PLAYER'; playerId: string; name?: string; icon?: string; colorIndex?: number; admin?: boolean }
  | { type: 'PROPOSE_TRADE'; trade: Omit<PendingTrade, 'id'> }
  | { type: 'ACCEPT_TRADE' }
  | { type: 'REJECT_TRADE' }
  | { type: 'ROLL_DICE' }
  | { type: 'DRAW_CARD'; deck: DeckId; playerId: string }
  | { type: 'RESOLVE_CARD' } // aplica el efecto liquidable y descarta
  | { type: 'CLAIM_GO_BONUS'; playerId: string } // "si pasa por Salida cobre 200"
  | { type: 'USE_CARD'; playerId: string; cardId: string } // gasta una carta guardada
  | { type: 'POT_ADD'; amount: number; playerId?: string } // al bote de Parada Libre
  | { type: 'POT_TAKE'; playerId: string; share?: number } // cobrar el bote
  | { type: 'SET_LIMO'; playerId: string | null } // asignar/quitar la limusina dorada
  | { type: 'SPEND_TOKEN'; playerId: string; token: 'spins'; delta?: number }
  | { type: 'FORCE_SWAP'; aId: string; bId: string; aProp: string; bProp: string }
  | { type: 'SPIN_WHEEL'; playerId: string } // gasta una ficha y gira la ruleta
  | { type: 'CLOSE_WHEEL' }
  | { type: 'RENT_TO_SPIN'; ownerId: string } // perdonas la renta y cobras una ficha de giro
  | { type: 'LAND_FREE_PARKING'; playerId: string } // caes en la casilla: bote + limusina + tarjeta
  | { type: 'GO_TO_JAIL'; playerId: string }
  | { type: 'PAY_BAIL'; playerId: string } // paga la fianza y sale
  | { type: 'LEAVE_JAIL'; playerId: string; reason?: string } // sale gratis (dobles, carta, indulto)
  | { type: 'GRANT_PERK'; playerId: string; perk: 'freeHouses' | 'freeProps' | 'forceSwaps'; delta?: number }
  | { type: 'SET_SETTINGS'; patch: Partial<GameSettings> }
  | { type: 'PAY_RENT'; fromId: string; toId: string; propertyId: string } // el jugador en turno paga renta al dueño
  | { type: 'NEXT_TURN' }
  | { type: 'REPLACE'; state: GameState }; // para sincronización (Realtime)

/**
 * Caras del dado especial (misma probabilidad todas).
 * `say` es lo que se anuncia y se lee en voz alta: importa cuánto mover, no los
 * números sueltos de cada dado, que ya se ven en pantalla.
 */
interface SpecialFace {
  id: string;
  label: string;
  say: (a: number, b: number) => string;
}
const SPECIAL_FACES: SpecialFace[] = [
  { id: 'x2', label: '✖️ dobles (mueve el doble)', say: (a, b) => `${(a + b) * 2}` },
  { id: 'bonus6', label: '➕6 bonus', say: (a, b) => `${a + b + 6}` },
  { id: 'choose', label: '🎲 elige: un dado, el otro o ambos', say: (a, b) => `${a} o ${b} o ${a + b}` },
  { id: 'reroll', label: '🔁 relanza', say: (a, b) => `${a + b}, relanza` },
  { id: 'skip', label: '🚫 pierde turno', say: (a, b) => `${a + b}, pierde turno` },
  { id: 'next', label: '🏠 avanza a la siguiente propiedad', say: (a, b) => `${a + b}, avanza a la siguiente propiedad` },
];
const d6 = () => Math.floor(Math.random() * 6) + 1;

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createGame(code: string, currencySymbol = '$'): GameState {
  return {
    id: uid(),
    code,
    currencySymbol,
    players: [],
    turnIndex: 0,
    log: [],
    settings: { ...DEFAULT_SETTINGS },
    dice: null,
    pendingTrade: null,
    decks: emptyDecks(),
    drawnCard: null,
    pot: 0,
    limoPlayerId: null,
    wheel: null,
    started: false,
  };
}

/** Baraja una copia (Fisher-Yates). */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Arma los mazos barajados con las modalidades activas (expandiendo copias). */
function buildDecks(packs: string[]): Record<DeckId, DeckState> {
  const decks = emptyDecks();
  for (const d of Object.keys(decks) as DeckId[]) {
    decks[d] = { draw: shuffle(deckIds(d, packs)), discard: [] };
  }
  return decks;
}

/** Con qué empieza cada jugador según la modalidad: fichas de giro y cartas en mano. */
const STARTING_TOKENS: Record<string, { spins: number; cards: number }> = {
  'parada-libre': { spins: 2, cards: 2 },
};

/**
 * Saca `n` cartas del mazo indicado y las pone en la mano del jugador.
 * Rebaraja el descarte si el mazo se agota. Se usa para las cartas de
 * Bonificación, que no se roban en el turno: se tienen y se usan cuando el
 * jugador quiera.
 */
function dealToHand(s: GameState, playerId: string, deck: DeckId, n: number): GameState {
  let d = s.decks[deck];
  const dealt: string[] = [];
  for (let i = 0; i < n; i++) {
    if (d.draw.length === 0) {
      if (d.discard.length === 0) break;
      d = { draw: shuffle(d.discard), discard: [] };
    }
    const [card, ...rest] = d.draw;
    dealt.push(card);
    d = { ...d, draw: rest };
  }
  if (dealt.length === 0) return s;
  return {
    ...s,
    decks: { ...s.decks, [deck]: d },
    players: mapPlayer(s, playerId, (x) => ({ ...x, tokens: [...x.tokens, ...dealt] })),
  };
}

/** Vista de tenencias de un jugador para los cálculos de patrimonio. */
export function holdingsOf(p: RuntimePlayer): PlayerHoldings {
  return { cash: p.cash, holdings: p.holdings };
}

// ─── Selectores de patrimonio (reexportan la lógica del dominio) ───
export const playerNetWorth = (p: RuntimePlayer) => netWorth(holdingsOf(p));
export const playerEquity = (p: RuntimePlayer) => equity(holdingsOf(p));
export const playerBuildings = (p: RuntimePlayer) => buildingCounts(holdingsOf(p));
export const playerRailUtil = (p: RuntimePlayer) => countByKind(holdingsOf(p));
export const playerActiveRailUtil = (p: RuntimePlayer) => activeCountByKind(holdingsOf(p));
export const bankBuildingsLeft = (s: GameState) => availableBuildings(s.players.map(holdingsOf));

/**
 * ¿Puede este dispositivo aceptar/rechazar la negociación pendiente?
 *
 * No basta con `canControl`: un administrador NO debe poder responder por otro,
 * y nadie puede aceptar su propia oferta. La excepción es la partida en un solo
 * dispositivo — si el destinatario no ha reclamado ninguno, el admin responde
 * por él; de lo contrario la propuesta quedaría atascada para siempre.
 */
export function canRespondToTrade(s: GameState, meId: string | null, isAdmin: boolean): boolean {
  const t = s.pendingTrade;
  if (!t || !meId) return false;
  if (meId === t.aId) return false; // el proponente, jamás
  if (meId === t.bId) return true; // el destinatario, siempre
  const target = s.players.find((p) => p.id === t.bId);
  return isAdmin && !target?.claimedBy;
}

/** ¿Puede retirar la oferta? Solo quien la hizo (o el admin si ese jugador no tiene dispositivo). */
export function canCancelTrade(s: GameState, meId: string | null, isAdmin: boolean): boolean {
  const t = s.pendingTrade;
  if (!t || !meId) return false;
  if (meId === t.aId) return true;
  const proposer = s.players.find((p) => p.id === t.aId);
  return isAdmin && !proposer?.claimedBy;
}

/**
 * Qué mostrar como resultado de la tirada: exactamente lo mismo que se anuncia
 * en voz alta. `choose` marca la cara que deja elegir entre un dado, el otro o
 * la suma, para destacarla en pantalla.
 */
export function diceSummary(d: DiceRoll): { text: string; choose: boolean } {
  const face = d.specialId ? SPECIAL_FACES.find((f) => f.id === d.specialId) : null;
  if (!face) return { text: `${d.a + d.b}`, choose: false };
  return { text: face.say(d.a, d.b), choose: face.id === 'choose' };
}

/**
 * ¿Tiene sentido usar ahora esta carta guardada? Devuelve el motivo por el que
 * NO se puede, o `null` si se puede.
 *
 * Sin esto, una carta se consumía aunque su efecto no aplicara: gastar el
 * indulto sin estar preso, o el Gran Premio con el bote vacío.
 */
export function whyCannotUseCard(s: GameState, p: RuntimePlayer, cardId: string): string | null {
  const card = getCard(cardId);
  if (!card) return 'Carta desconocida';
  if (!p.tokens.includes(cardId)) return 'No la tienes';
  switch (card.effect.kind) {
    case 'jail_free':
      return p.jail > 0 ? null : 'Solo sirve estando en la cárcel';
    case 'pot_take':
      return s.pot > 0 ? null : 'La Parada Libre está vacía';
    case 'limo':
      return s.limoPlayerId === p.id ? 'Ya llevas la limusina' : null;
    default:
      return null;
  }
}

export const canUseCard = (s: GameState, p: RuntimePlayer, cardId: string): boolean =>
  whyCannotUseCard(s, p, cardId) === null;

/**
 * Ganador de la partida: el único que sigue en pie cuando todos los demás
 * están en bancarrota. `null` mientras queden dos o más jugando.
 */
export function winnerOf(s: GameState): RuntimePlayer | null {
  if (!s.started || s.players.length < 2) return null;
  const alive = s.players.filter((p) => !p.bankrupt);
  return alive.length === 1 ? alive[0] : null;
}

/** Efectivo mínimo que un jugador debe conservar tras un pago (no puede quedar en 0). */
export const MIN_CASH = 1;

function log(s: GameState, text: string): LogEntry[] {
  return [{ id: uid(), text, ts: Date.now() }, ...s.log].slice(0, 200);
}

function mapPlayer(s: GameState, id: string, fn: (p: RuntimePlayer) => RuntimePlayer): RuntimePlayer[] {
  return s.players.map((p) => (p.id === id ? fn(p) : p));
}

const palette = 10; // colores disponibles (índices 0..9)

/** Ejecuta una negociación sobre el arreglo de jugadores; null si es inválida. */
function executeTrade(players: RuntimePlayer[], t: PendingTrade): RuntimePlayer[] | null {
  const A = players.find((x) => x.id === t.aId);
  const B = players.find((x) => x.id === t.bId);
  if (!A || !B || A.id === B.id) return null;
  if (t.aCash < 0 || t.bCash < 0) return null;
  if (A.cash < t.aCash || B.cash < t.bCash) return null;
  const aSet = new Set(t.aProps);
  const bSet = new Set(t.bProps);
  const aHold = new Map(A.holdings.map((h) => [h.propertyId, h]));
  const bHold = new Map(B.holdings.map((h) => [h.propertyId, h]));
  for (const id of t.aProps) {
    const h = aHold.get(id);
    if (!h || h.houses > 0) return null;
  }
  for (const id of t.bProps) {
    const h = bHold.get(id);
    if (!h || h.houses > 0) return null;
  }
  // Cartas guardadas y fichas: cada lado debe tener lo que ofrece.
  const aCards = t.aCards ?? [];
  const bCards = t.bCards ?? [];
  const aSpins = t.aSpins ?? 0;
  const bSpins = t.bSpins ?? 0;
  if (aSpins < 0 || bSpins < 0) return null;
  if (A.spins < aSpins || B.spins < bSpins) return null;
  const takeCards = (owner: RuntimePlayer, wanted: string[]): string[] | null => {
    const rest = [...owner.tokens];
    for (const id of wanted) {
      const i = rest.indexOf(id);
      if (i < 0) return null; // no tiene esa carta (o no le quedan copias)
      rest.splice(i, 1);
    }
    return rest;
  };
  const aRest = takeCards(A, aCards);
  const bRest = takeCards(B, bCards);
  if (!aRest || !bRest) return null;

  const aGives = A.holdings.filter((h) => aSet.has(h.propertyId)); // van a B (hipoteca incluida)
  const bGives = B.holdings.filter((h) => bSet.has(h.propertyId)); // van a A
  const newA: RuntimePlayer = {
    ...A,
    cash: A.cash - t.aCash + t.bCash,
    holdings: [...A.holdings.filter((h) => !aSet.has(h.propertyId)), ...bGives],
    tokens: [...aRest, ...bCards],
    spins: A.spins - aSpins + bSpins,
  };
  const newB: RuntimePlayer = {
    ...B,
    cash: B.cash - t.bCash + t.aCash,
    holdings: [...B.holdings.filter((h) => !bSet.has(h.propertyId)), ...aGives],
    tokens: [...bRest, ...aCards],
    spins: B.spins - bSpins + aSpins,
  };
  return players.map((p) => (p.id === A.id ? newA : p.id === B.id ? newB : p));
}

/** Texto legible del intercambio (para el log de "aceptada"). */
function tradeDetail(s: GameState, t: PendingTrade): string {
  const A = s.players.find((x) => x.id === t.aId);
  const B = s.players.find((x) => x.id === t.bId);
  const nm = (ids: string[]) => ids.map((id) => getProperty(id)?.name ?? id).join(', ');
  const cn = (ids: string[]) => ids.map((id) => getCard(id)?.emoji ?? '🃏').join('');
  const fichas = (spins?: number) => (spins ? `${spins}🎡` : '');
  const parts = [
    t.aProps.length ? `${A?.name} dio ${nm(t.aProps)}` : '',
    t.aCash ? `${A?.name} dio ${t.aCash}` : '',
    t.aCards?.length ? `${A?.name} dio ${cn(t.aCards)}` : '',
    fichas(t.aSpins) ? `${A?.name} dio ${fichas(t.aSpins)}` : '',
    t.bProps.length ? `${B?.name} dio ${nm(t.bProps)}` : '',
    t.bCash ? `${B?.name} dio ${t.bCash}` : '',
    t.bCards?.length ? `${B?.name} dio ${cn(t.bCards)}` : '',
    fichas(t.bSpins) ? `${B?.name} dio ${fichas(t.bSpins)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

const DECK_LABEL: Record<DeckId, string> = {
  arca: '📦 Arca Comunal',
  fortuna: '❓ Fortuna',
  bonificacion: '⭐ Bonificación',
};

/**
 * Traduce el efecto de una carta a la acción de dinero equivalente, para
 * reutilizar las guardas y el log que ya existen. `null` = sin dinero
 * automático (carta instructiva: el jugador mueve su ficha).
 */
function actionFor(s: GameState, e: CardEffect, p: RuntimePlayer): Action | null {
  const others = s.players.filter((x) => x.id !== p.id && !x.bankrupt).map((x) => x.id);
  switch (e.kind) {
    case 'bank_pay':
      return { type: 'BANK_TO_PLAYER', playerId: p.id, amount: e.amount };
    case 'bank_charge':
      return { type: 'PLAYER_TO_BANK', playerId: p.id, amount: e.amount };
    case 'collect_each':
      return others.length ? { type: 'COLLECT', toId: p.id, fromIds: others, amount: e.amount } : null;
    case 'pay_each':
      return others.length ? { type: 'TRANSFER', fromId: p.id, toIds: others, amount: e.amount } : null;
    case 'repairs': {
      const b = buildingCounts(holdingsOf(p));
      const total = b.houses * e.perHouse + b.hotels * e.perHotel;
      return total > 0 ? { type: 'PLAYER_TO_BANK', playerId: p.id, amount: total } : null;
    }
    case 'pay_percent': {
      const base = e.of === 'cash' ? p.cash : netWorth(holdingsOf(p));
      const total = Math.round(base * e.rate);
      return total > 0 ? { type: 'PLAYER_TO_BANK', playerId: p.id, amount: total } : null;
    }
    case 'pay_per_property': {
      const total = p.holdings.length * e.amount;
      return total > 0 ? { type: 'PLAYER_TO_BANK', playerId: p.id, amount: total } : null;
    }
    case 'collect_per_property': {
      const total = p.holdings.length * e.amount;
      return total > 0 ? { type: 'BANK_TO_PLAYER', playerId: p.id, amount: total } : null;
    }
    case 'collect_richest': {
      const rich = richestOther(s, p);
      return rich ? { type: 'COLLECT', toId: p.id, fromIds: [rich.id], amount: e.amount } : null;
    }
    case 'pay_richest': {
      const rich = richestOther(s, p);
      return rich ? { type: 'TRANSFER', fromId: p.id, toIds: [rich.id], amount: e.amount } : null;
    }
    case 'pot_add':
      return { type: 'POT_ADD', playerId: p.id, amount: e.amount };
    case 'pot_take':
      return s.pot > 0 ? { type: 'POT_TAKE', playerId: p.id, share: e.share } : null;
    case 'limo':
      return { type: 'SET_LIMO', playerId: p.id };
    case 'jail_free':
      // Solo hace algo si está preso; si no, la carta se guarda para más tarde.
      return p.jail > 0 ? { type: 'LEAVE_JAIL', playerId: p.id, reason: 'usó su indulto' } : null;
    case 'to_jail':
      // El motor marca el encierro; mover la ficha sigue siendo cosa del jugador.
      return { type: 'GO_TO_JAIL', playerId: p.id };
    case 'free_house':
      // No se coloca aquí: queda a crédito para que elija la propiedad.
      return { type: 'GRANT_PERK', playerId: p.id, perk: 'freeHouses' };
    case 'free_property':
      return { type: 'GRANT_PERK', playerId: p.id, perk: 'freeProps' };
    case 'force_swap':
      return { type: 'GRANT_PERK', playerId: p.id, perk: 'forceSwaps' };
    case 'goto':
      return e.bonus ? { type: 'BANK_TO_PLAYER', playerId: p.id, amount: e.bonus } : null;
    default:
      return null;
  }
}

/** El rival con mayor patrimonio (para las cartas que apuntan "al más rico"). */
function richestOther(s: GameState, p: RuntimePlayer): RuntimePlayer | null {
  const others = s.players.filter((x) => x.id !== p.id && !x.bankrupt);
  if (others.length === 0) return null;
  return others.reduce((best, x) => (netWorth(holdingsOf(x)) > netWorth(holdingsOf(best)) ? x : best));
}

export function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'ADD_PLAYER': {
      const colorIndex = a.colorIndex ?? s.players.length % palette;
      const p: RuntimePlayer = {
        id: uid(),
        name: a.name.trim() || `Jugador ${s.players.length + 1}`,
        icon: a.icon ?? '🙂',
        colorIndex,
        cash: s.settings.initialBalance,
        bankrupt: false,
        holdings: [],
        tokens: [],
        spins: 0,
        jail: 0,
        freeHouses: 0,
        freeProps: 0,
        forceSwaps: 0,
        admin: a.admin ?? false,
      };
      return { ...s, players: [...s.players, p], log: log(s, `Se unió ${p.name}`) };
    }

    case 'REMOVE_PLAYER':
      return { ...s, players: s.players.filter((p) => p.id !== a.playerId) };

    case 'START_GAME': {
      if (s.players.length === 0) return s;
      // Aplica el dinero inicial configurado y comienza en el primer jugador.
      const start = s.settings.cardPacks.reduce(
        (acc, pack) => {
          const t = STARTING_TOKENS[pack];
          return t ? { spins: acc.spins + t.spins, cards: acc.cards + t.cards } : acc;
        },
        { spins: 0, cards: 0 },
      );
      // Empezar es empezar de cero: dinero inicial y nada heredado de una
      // partida anterior (importante tras END_GAME, que conserva a los jugadores).
      const players = s.players.map((p) => ({
        ...p,
        cash: s.settings.initialBalance,
        holdings: [],
        bankrupt: false,
        tokens: [],
        spins: start.spins,
        jail: 0,
        freeHouses: 0,
        freeProps: 0,
        forceSwaps: 0,
      }));
      const fresh: GameState = {
        ...s,
        players,
        started: true,
        turnIndex: 0,
        decks: buildDecks(s.settings.cardPacks),
        drawnCard: null,
        pot: 0,
        limoPlayerId: null,
        wheel: null,
        log: log(s, '¡Empieza la partida!'),
      };
      // Las cartas de Bonificación se reparten de salida: cada jugador ya sabe
      // cuáles tiene y decide en qué turno usarlas.
      return players.reduce((acc, p) => dealToHand(acc, p.id, 'bonificacion', start.cards), fresh);
    }

    case 'END_GAME': {
      if (!s.started) return s;
      // Vuelve al panel de preparación con los mismos jugadores y el mismo código
      // de sala, para poder reconfigurar y volver a empezar. START_GAME repone
      // dinero, mazos y fichas.
      return {
        ...s,
        started: false,
        dice: null,
        drawnCard: null,
        wheel: null,
        pendingTrade: null,
        log: log(s, '🏁 Partida terminada: de vuelta a la preparación'),
      };
    }

    case 'REORDER_PLAYER': {
      const i = s.players.findIndex((p) => p.id === a.playerId);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= s.players.length) return s;
      const players = [...s.players];
      [players[i], players[j]] = [players[j], players[i]];
      return { ...s, players };
    }

    case 'BANK_TO_PLAYER': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || a.amount <= 0) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({ ...x, cash: x.cash + a.amount })),
        log: log(s, `El banco pagó ${a.amount} a ${p.name}`),
      };
    }

    case 'PLAYER_TO_BANK': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || a.amount <= 0 || p.cash - a.amount < MIN_CASH) return s;
      // Parada Libre: "TODO el dinero que pagarías al banco va al Gran Premio".
      // Solo multas/impuestos/cartas; las compras y construcciones no pasan por aquí.
      const toPot = s.settings.cardPacks.includes('parada-libre');
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({ ...x, cash: x.cash - a.amount })),
        pot: toPot ? s.pot + a.amount : s.pot,
        log: log(s, `${p.name} pagó ${a.amount} ${toPot ? `a la Parada Libre (bote: ${s.pot + a.amount})` : 'al banco'}`),
      };
    }

    case 'TRANSFER': {
      const from = s.players.find((x) => x.id === a.fromId);
      const recips = s.players.filter((x) => a.toIds.includes(x.id));
      const total = a.amount * recips.length;
      if (!from || a.amount <= 0 || recips.length === 0 || from.cash - total < MIN_CASH) return s;
      const recipIds = new Set(a.toIds);
      const players = s.players.map((x) => {
        if (x.id === a.fromId) return { ...x, cash: x.cash - total };
        if (recipIds.has(x.id)) return { ...x, cash: x.cash + a.amount };
        return x;
      });
      const names = recips.map((r) => r.name).join(', ');
      return { ...s, players, log: log(s, `${from.name} → ${names}: ${a.amount} c/u`) };
    }

    case 'COLLECT': {
      const to = s.players.find((x) => x.id === a.toId);
      const payers = s.players.filter((x) => a.fromIds.includes(x.id));
      if (!to || a.amount <= 0 || payers.length === 0) return s;
      // Ningún pagador puede quedar por debajo del mínimo.
      if (payers.some((pp) => pp.cash - a.amount < MIN_CASH)) return s;
      const payerIds = new Set(a.fromIds);
      const players = s.players.map((x) => {
        if (x.id === a.toId) return { ...x, cash: x.cash + a.amount * payers.length };
        if (payerIds.has(x.id)) return { ...x, cash: x.cash - a.amount };
        return x;
      });
      const names = payers.map((p) => p.name).join(', ');
      return { ...s, players, log: log(s, `${names} → ${to.name}: ${a.amount} c/u`) };
    }

    case 'SALIDA': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({ ...x, cash: x.cash + GAME_CONFIG.goSalary })),
        log: log(s, `${p.name} pasó por SALIDA (+${GAME_CONFIG.goSalary})`),
      };
    }

    case 'BUY_PROPERTY': {
      const prop = getProperty(a.propertyId);
      const p = s.players.find((x) => x.id === a.playerId);
      if (!prop || !p) return s;
      // No se puede comprar si ya la posee alguien.
      const taken = s.players.some((x) => x.holdings.some((h) => h.propertyId === a.propertyId));
      if (taken) return s;
      // Gratis: con la limusina dorada o gastando un crédito de "propiedad gratis".
      const withLimo = s.limoPlayerId === p.id;
      if (a.free && !withLimo && p.freeProps <= 0) return s;
      const price = a.free ? 0 : a.price ?? prop.price;
      if (p.cash - price < MIN_CASH) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({
          ...x,
          cash: x.cash - price,
          freeProps: a.free && !withLimo ? x.freeProps - 1 : x.freeProps,
          holdings: [...x.holdings, { propertyId: a.propertyId, houses: 0, mortgaged: false }],
        })),
        log: log(s, a.free
          ? `${p.name} se quedó ${prop.name} gratis${withLimo ? ' 🚗 (limusina)' : ''}`
          : `${p.name} compró ${prop.name} por ${price}`),
      };
    }

    case 'MORTGAGE': {
      const prop = getProperty(a.propertyId);
      const p = s.players.find((x) => x.id === a.playerId);
      const h = p?.holdings.find((x) => x.propertyId === a.propertyId);
      if (!prop || !p || !h || h.mortgaged || h.houses > 0) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({
          ...x,
          cash: x.cash + prop.mortgageValue,
          holdings: x.holdings.map((y) =>
            y.propertyId === a.propertyId ? { ...y, mortgaged: true } : y,
          ),
        })),
        log: log(s, `${p.name} hipotecó ${prop.name} (+${prop.mortgageValue})`),
      };
    }

    case 'UNMORTGAGE': {
      const prop = getProperty(a.propertyId);
      const p = s.players.find((x) => x.id === a.playerId);
      const h = p?.holdings.find((x) => x.propertyId === a.propertyId);
      if (!prop || !p || !h || !h.mortgaged || p.cash - prop.unmortgageCost < MIN_CASH) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({
          ...x,
          cash: x.cash - prop.unmortgageCost,
          holdings: x.holdings.map((y) =>
            y.propertyId === a.propertyId ? { ...y, mortgaged: false } : y,
          ),
        })),
        log: log(s, `${p.name} deshipotecó ${prop.name} (-${prop.unmortgageCost})`),
      };
    }

    case 'BUILD_HOUSE': {
      const prop = getProperty(a.propertyId);
      const p = s.players.find((x) => x.id === a.playerId);
      if (!prop || !p) return s;
      const h0 = p.holdings.find((x) => x.propertyId === a.propertyId);
      // "Casa gratis" (Parada Libre): se salta grupo completo, construcción pareja y coste.
      if (a.free) {
        if (p.freeHouses <= 0) return s; // no tiene ninguna casa gratis pendiente
        if (!h0 || !prop.isBuildable || h0.mortgaged || h0.houses >= 5) return s;
      } else {
        if (!canBuildOn(holdingsOf(p), a.propertyId, s.settings.evenBuild)) return s;
        if (p.cash - prop.houseCost < MIN_CASH) return s;
      }
      const h = h0!;
      const left = bankBuildingsLeft(s);
      const willBeHotel = h.houses + 1 >= 5;
      if (willBeHotel ? left.hotels <= 0 : left.houses <= 0) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({
          ...x,
          cash: x.cash - (a.free ? 0 : prop.houseCost),
          freeHouses: a.free ? x.freeHouses - 1 : x.freeHouses,
          holdings: x.holdings.map((y) =>
            y.propertyId === a.propertyId ? { ...y, houses: y.houses + 1 } : y,
          ),
        })),
        log: log(s, `${p.name} construyó${a.free ? ' gratis' : ''} en ${prop.name} (${willBeHotel ? 'hotel' : h.houses + 1 + ' casas'})`),
      };
    }

    case 'SELL_HOUSE': {
      const prop = getProperty(a.propertyId);
      const p = s.players.find((x) => x.id === a.playerId);
      const h = p?.holdings.find((x) => x.propertyId === a.propertyId);
      if (!prop || !p || !h || h.houses <= 0) return s;
      if (!canSellOn(holdingsOf(p), a.propertyId, s.settings.evenBuild)) return s;
      const refund = Math.round(prop.houseCost * GAME_CONFIG.houseSellRefundRate);
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({
          ...x,
          cash: x.cash + refund,
          holdings: x.holdings.map((y) =>
            y.propertyId === a.propertyId ? { ...y, houses: y.houses - 1 } : y,
          ),
        })),
        log: log(s, `${p.name} vendió una casa de ${prop.name} (+${refund})`),
      };
    }

    case 'EDIT_PLAYER': {
      const before = s.players.find((x) => x.id === a.playerId);
      const players = mapPlayer(s, a.playerId, (x) => ({
        ...x,
        name: a.name?.trim() || x.name,
        icon: a.icon ?? x.icon,
        colorIndex: a.colorIndex ?? x.colorIndex,
        admin: a.admin ?? x.admin,
      }));
      // Registrar en historial solo cambios visibles (nombre/icono/color), no el toggle de admin.
      let text = '';
      const newName = a.name?.trim();
      if (before && newName && newName !== before.name) text = `${before.name} cambió su nombre a ${newName}`;
      else if (before && ((a.icon && a.icon !== before.icon) || (a.colorIndex != null && a.colorIndex !== before.colorIndex))) {
        text = `Se editó el personaje de ${newName || before.name}`;
      }
      return { ...s, players, log: text ? log(s, text) : s.log };
    }

    case 'DECLARE_BANKRUPTCY': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || p.bankrupt) return s;
      // Las cartas retenidas vuelven al descarte de su mazo.
      const decks = { ...s.decks };
      for (const cardId of p.tokens) {
        const d = getCard(cardId)?.deck ?? 'arca';
        decks[d] = { ...decks[d], discard: [cardId, ...decks[d].discard] };
      }
      // Su carta sin resolver se descarta con él: si no, quedaría pendiente para
      // siempre y nadie podría robar otra (solo cabe una a la vez).
      const drawn = s.drawnCard?.playerId === p.id ? getCard(s.drawnCard.cardId) : null;
      if (drawn) {
        decks[drawn.deck] = { ...decks[drawn.deck], discard: [drawn.id, ...decks[drawn.deck].discard] };
      }
      // Y una negociación suya a medias se cancela: bloquearía todas las demás.
      const killTrade = !!s.pendingTrade && (s.pendingTrade.aId === p.id || s.pendingTrade.bId === p.id);
      const quebrado: GameState = {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({ ...x, bankrupt: true, cash: 0, holdings: [], tokens: [], spins: 0, freeHouses: 0, freeProps: 0, forceSwaps: 0 })),
        decks,
        drawnCard: s.drawnCard?.playerId === p.id ? null : s.drawnCard,
        wheel: s.wheel?.playerId === p.id ? null : s.wheel,
        pendingTrade: killTrade ? null : s.pendingTrade,
        limoPlayerId: s.limoPlayerId === p.id ? null : s.limoPlayerId,
        log: log(s, `${p.name} se declaró en bancarrota (sus propiedades vuelven al banco)`),
      };
      // Si con esta bancarrota queda uno solo en pie, se proclama ganador.
      const last = quebrado.players.filter((x) => !x.bankrupt);
      if (quebrado.players.length >= 2 && last.length === 1) {
        return { ...quebrado, log: log(quebrado, `🏆 ¡${last[0].name} gana la partida!`) };
      }
      return quebrado;
    }

    case 'CLAIM_PLAYER': {
      // Marca al jugador como reclamado por este dispositivo y libera cualquier otro que tuviera.
      return {
        ...s,
        players: s.players.map((x) => {
          if (x.id === a.playerId) return { ...x, claimedBy: a.deviceId };
          if (x.claimedBy === a.deviceId) return { ...x, claimedBy: undefined };
          return x;
        }),
      };
    }

    case 'RELEASE_PLAYER':
      return {
        ...s,
        players: s.players.map((x) => (x.claimedBy === a.deviceId ? { ...x, claimedBy: undefined } : x)),
      };

    case 'PROPOSE_TRADE': {
      const t = a.trade;
      const A = s.players.find((x) => x.id === t.aId);
      const B = s.players.find((x) => x.id === t.bId);
      if (!A || !B || A.id === B.id) return s;
      // Una propuesta de solo cartas o solo fichas también es válida.
      const empty =
        t.aCash === 0 && t.bCash === 0 &&
        t.aProps.length === 0 && t.bProps.length === 0 &&
        !t.aCards?.length && !t.bCards?.length &&
        !t.aSpins && !t.bSpins;
      if (empty) return s;
      return {
        ...s,
        pendingTrade: { ...t, id: uid() },
        log: log(s, `${A.name} propone una negociación a ${B.name}`),
      };
    }

    case 'ACCEPT_TRADE': {
      const t = s.pendingTrade;
      if (!t) return s;
      const players = executeTrade(s.players, t);
      if (!players) return { ...s, pendingTrade: null, log: log(s, 'Negociación inválida, cancelada') };
      return { ...s, players, pendingTrade: null, log: log(s, `Negociación aceptada — ${tradeDetail(s, t)}`) };
    }

    case 'REJECT_TRADE': {
      const t = s.pendingTrade;
      if (!t) return s;
      const B = s.players.find((x) => x.id === t.bId);
      return { ...s, pendingTrade: null, log: log(s, `${B?.name ?? 'Jugador'} rechazó la negociación`) };
    }

    case 'PAY_RENT': {
      const prop = getProperty(a.propertyId);
      const from = s.players.find((x) => x.id === a.fromId);
      const owner = s.players.find((x) => x.id === a.toId);
      const h = owner?.holdings.find((x) => x.propertyId === a.propertyId);
      if (!prop || !from || !owner || !h || from.id === owner.id || h.mortgaged) return s;
      // Los servicios requieren una tirada (renta = dados × multiplicador).
      if (prop.kind === 'utility' && !s.dice) return s;
      const diceTotal = s.dice ? s.dice.a + s.dice.b : 0;
      const oh = holdingsOf(owner);
      const active = activeCountByKind(oh);
      const rent = prop.rent(
        {
          houses: h.houses,
          ownerHasFullGroup: ownsFullGroupActive(oh, prop.colorGroup),
          railroadsOwned: active.railroads,
          utilitiesOwned: active.utilities,
          diceTotal,
        },
        h.mortgaged,
      );
      if (rent <= 0 || from.cash - rent < MIN_CASH) return s;
      const players = s.players.map((x) => {
        if (x.id === from.id) return { ...x, cash: x.cash - rent };
        if (x.id === owner.id) return { ...x, cash: x.cash + rent };
        return x;
      });
      return { ...s, players, log: log(s, `${from.name} pagó renta de ${prop.name} a ${owner.name} (${rent})`) };
    }

    case 'ROLL_DICE': {
      const a = d6();
      const b = d6();
      const face = s.settings.special ? SPECIAL_FACES[Math.floor(Math.random() * SPECIAL_FACES.length)] : null;
      // Se anuncia el resultado útil (cuánto mover), no "a + b = c":
      // los dados ya se ven en pantalla.
      const txt = `🎲 ${face ? face.say(a, b) : a + b}`;
      return {
        ...s,
        dice: { a, b, special: face ? face.label : null, specialId: face?.id },
        log: log(s, txt),
      };
    }

    case 'DRAW_CARD': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || s.drawnCard) return s; // hay una carta sin resolver
      let d = s.decks[a.deck];
      // Mazo agotado: se rebaraja el descarte (las retenidas no vuelven).
      if (d.draw.length === 0) {
        if (d.discard.length === 0) return s;
        d = { draw: shuffle(d.discard), discard: [] };
      }
      const [cardId, ...rest] = d.draw;
      const card = getCard(cardId);
      return {
        ...s,
        decks: { ...s.decks, [a.deck]: { ...d, draw: rest } },
        drawnCard: { cardId, playerId: a.playerId },
        log: log(s, `${p.name} sacó ${DECK_LABEL[a.deck]}: ${card ? cardText(card, s.currencySymbol) : cardId}`),
      };
    }

    case 'RESOLVE_CARD': {
      const drawn = s.drawnCard;
      if (!drawn) return s;
      const card = getCard(drawn.cardId);
      const p = s.players.find((x) => x.id === drawn.playerId);
      if (!card || !p) return { ...s, drawnCard: null };

      // Cartas que se conservan: no van al descarte, pasan a la mano del jugador.
      if (card.keep) {
        return {
          ...s,
          players: mapPlayer(s, p.id, (x) => ({ ...x, tokens: [...x.tokens, card.id] })),
          drawnCard: null,
          log: log(s, `${p.name} guarda ${card.emoji} ${cardText(card, s.currencySymbol)}`),
        };
      }

      const money = actionFor(s, card.effect, p);
      const applied = money ? reducer(s, money) : s;
      // El pago no cabía (dejaría al jugador sin efectivo mínimo): la carta sigue
      // pendiente para que hipoteque o venda y vuelva a intentarlo.
      if (money && applied === s) {
        return { ...s, log: log(s, `⚠️ ${p.name} no puede pagar la carta: liquida algo e inténtalo de nuevo`) };
      }
      const discard = [card.id, ...applied.decks[card.deck].discard];
      return {
        ...applied,
        decks: { ...applied.decks, [card.deck]: { ...applied.decks[card.deck], discard } },
        drawnCard: null,
      };
    }

    case 'CLAIM_GO_BONUS': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({ ...x, cash: x.cash + GAME_CONFIG.goSalary })),
        log: log(s, `${p.name} pasó por SALIDA con la carta (+${GAME_CONFIG.goSalary})`),
      };
    }

    case 'USE_CARD': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || !p.tokens.includes(a.cardId)) return s;
      const card = getCard(a.cardId);
      if (!card) return s;
      // No se consume una carta que ahora mismo no haría nada.
      if (!canUseCard(s, p, a.cardId)) return s;
      // Gasta solo una copia, aunque tenga varias iguales.
      const i = p.tokens.indexOf(a.cardId);
      const tokens = [...p.tokens.slice(0, i), ...p.tokens.slice(i + 1)];
      // Si al usarse mueve dinero, se aplica igual que al resolverla.
      const money = actionFor(s, card.effect, p);
      const base: GameState = {
        ...s,
        players: mapPlayer(s, p.id, (x) => ({ ...x, tokens })),
        decks: {
          ...s.decks,
          [card.deck]: { ...s.decks[card.deck], discard: [card.id, ...s.decks[card.deck].discard] },
        },
        log: log(s, `${p.name} usó ${card.emoji} ${cardText(card, s.currencySymbol)}`),
      };
      return money ? reducer(base, money) : base;
    }

    case 'POT_ADD': {
      if (a.amount <= 0) return s;
      // Si viene de un jugador, se le descuenta (respetando el mínimo de caja).
      if (a.playerId) {
        const p = s.players.find((x) => x.id === a.playerId);
        if (!p || p.cash - a.amount < MIN_CASH) return s;
        return {
          ...s,
          players: mapPlayer(s, a.playerId, (x) => ({ ...x, cash: x.cash - a.amount })),
          pot: s.pot + a.amount,
          log: log(s, `${p.name} dejó ${a.amount} en la Parada Libre (bote: ${s.pot + a.amount})`),
        };
      }
      return { ...s, pot: s.pot + a.amount, log: log(s, `Al bote de la Parada Libre: +${a.amount} (bote: ${s.pot + a.amount})`) };
    }

    case 'POT_TAKE': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || s.pot <= 0) return s;
      const share = a.share ?? 1;
      const amount = Math.round(s.pot * share);
      if (amount <= 0) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({ ...x, cash: x.cash + amount })),
        pot: s.pot - amount,
        log: log(s, `🎰 ${p.name} se llevó ${amount} de la Parada Libre`),
      };
    }

    case 'SET_LIMO': {
      if (a.playerId === null) {
        if (!s.limoPlayerId) return s;
        const prev = s.players.find((x) => x.id === s.limoPlayerId);
        return { ...s, limoPlayerId: null, log: log(s, `🚗 ${prev?.name ?? 'Alguien'} pierde la limusina dorada`) };
      }
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || s.limoPlayerId === p.id) return s;
      return { ...s, limoPlayerId: p.id, log: log(s, `🚗 ${p.name} se lleva la limusina dorada`) };
    }

    case 'SPIN_WHEEL': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || p.spins <= 0 || s.wheel) return s;
      const face = WHEEL[Math.floor(Math.random() * WHEEL.length)];
      // Gasta la ficha de giro y aplica la cara. La carta de bonificación ya no
      // se gana al girar: se obtiene al caer en Fortuna/Arca (botón dedicado).
      const spun: GameState = {
        ...s,
        players: mapPlayer(s, p.id, (x) => ({ ...x, spins: x.spins - 1 })),
        wheel: { faceId: face.id, playerId: p.id },
        log: log(s, `🎡 ${p.name} giró la ruleta: ${wheelText(face, s.currencySymbol)}`),
      };
      const effect = actionFor(spun, face.effect, spun.players.find((x) => x.id === p.id)!);
      return effect ? reducer(spun, effect) : spun;
    }

    case 'CLOSE_WHEEL':
      return s.wheel ? { ...s, wheel: null } : s;

    case 'RENT_TO_SPIN': {
      const owner = s.players.find((x) => x.id === a.ownerId);
      if (!owner) return s;
      const max = s.settings.maxSpins;
      // Tope anti-abuso: sin él, dos jugadores pactan perdonarse la renta para
      // fabricar fichas gratis (el banco es una fuente infinita).
      if (max > 0 && owner.spins >= max) return s;
      return {
        ...s,
        players: mapPlayer(s, owner.id, (x) => ({ ...x, spins: x.spins + 1 })),
        log: log(s, `${owner.name} perdonó la renta y tomó una ficha de giro 🎡`),
      };
    }

    case 'GRANT_PERK': {
      const p = s.players.find((x) => x.id === a.playerId);
      const delta = a.delta ?? 1;
      if (!p || p[a.perk] + delta < 0) return s;
      const what = a.perk === 'freeHouses' ? '🏠 casa gratis'
        : a.perk === 'freeProps' ? '🎁 propiedad gratis'
        : '🔀 intercambio forzoso';
      return {
        ...s,
        players: mapPlayer(s, p.id, (x) => ({ ...x, [a.perk]: x[a.perk] + delta })),
        log: delta > 0 ? log(s, `${p.name} tiene ${what} por usar`) : s.log,
      };
    }

    case 'GO_TO_JAIL': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || p.jail > 0) return s;
      return {
        ...s,
        players: mapPlayer(s, p.id, (x) => ({ ...x, jail: 1 })),
        // Quien va preso pierde la limusina dorada.
        limoPlayerId: s.limoPlayerId === p.id ? null : s.limoPlayerId,
        log: log(s, `🚔 ${p.name} va a la cárcel`),
      };
    }

    case 'PAY_BAIL': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || p.jail === 0) return s;
      const paid = reducer(s, { type: 'PLAYER_TO_BANK', playerId: p.id, amount: GAME_CONFIG.bail });
      if (paid === s) return s; // no le alcanza
      return {
        ...paid,
        players: mapPlayer(paid, p.id, (x) => ({ ...x, jail: 0 })),
        log: log(paid, `${p.name} pagó la fianza y sale de la cárcel`),
      };
    }

    case 'LEAVE_JAIL': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p || p.jail === 0) return s;
      return {
        ...s,
        players: mapPlayer(s, p.id, (x) => ({ ...x, jail: 0 })),
        log: log(s, `${p.name} sale de la cárcel${a.reason ? ` (${a.reason})` : ''}`),
      };
    }

    case 'LAND_FREE_PARKING': {
      const p = s.players.find((x) => x.id === a.playerId);
      if (!p) return s;
      // La casilla entrega: el Gran Premio, la limusina y una tarjeta de Bonificación.
      const amount = s.pot;
      return dealToHand({
        ...s,
        players: mapPlayer(s, p.id, (x) => ({ ...x, cash: x.cash + amount, spins: x.spins + 1 })),
        pot: 0,
        limoPlayerId: p.id,
        log: log(s, `🅿️ ${p.name} cayó en la Parada Libre: +${amount}, la limusina 🚗, una carta ⭐ y un giro 🎡`),
      }, p.id, 'bonificacion', 1);
    }

    case 'FORCE_SWAP': {
      const A = s.players.find((x) => x.id === a.aId);
      const B = s.players.find((x) => x.id === a.bId);
      if (!A || !B || A.id === B.id || A.forceSwaps <= 0) return s;
      const ha = A.holdings.find((h) => h.propertyId === a.aProp);
      const hb = B.holdings.find((h) => h.propertyId === a.bProp);
      // Como en cualquier traspaso: nada con casas encima.
      if (!ha || !hb || ha.houses > 0 || hb.houses > 0) return s;
      const pa = getProperty(a.aProp);
      const pb = getProperty(a.bProp);
      return {
        ...s,
        players: s.players.map((x) => {
          if (x.id === A.id) {
            return {
              ...x,
              forceSwaps: x.forceSwaps - 1,
              holdings: [...x.holdings.filter((h) => h.propertyId !== a.aProp), hb],
            };
          }
          if (x.id === B.id) {
            return { ...x, holdings: [...x.holdings.filter((h) => h.propertyId !== a.bProp), ha] };
          }
          return x;
        }),
        log: log(s, `🔀 ${A.name} forzó un cambio con ${B.name}: ${pa?.name} ↔ ${pb?.name}`),
      };
    }

    case 'SPEND_TOKEN': {
      const p = s.players.find((x) => x.id === a.playerId);
      const delta = a.delta ?? -1;
      if (!p) return s;
      const next = p[a.token] + delta;
      if (next < 0) return s;
      return { ...s, players: mapPlayer(s, p.id, (x) => ({ ...x, [a.token]: next })) };
    }

    case 'SET_SETTINGS':
      return { ...s, settings: { ...s.settings, ...a.patch } };

    case 'NEXT_TURN': {
      if (s.players.length === 0) return s;
      const active = s.players.filter((p) => !p.bankrupt);
      if (active.length === 0) return s;
      // Avanza al siguiente jugador no en bancarrota.
      let idx = s.turnIndex;
      for (let i = 0; i < s.players.length; i++) {
        idx = (idx + 1) % s.players.length;
        if (!s.players[idx].bankrupt) break;
      }
      const next = s.players[idx];
      // Al empezar su turno, quien está preso cumple uno más; a los 3 sale
      // pagando la fianza (regla clásica), o gratis si no le alcanza.
      if (next.jail > 0) {
        const served = next.jail + 1;
        if (served > GAME_CONFIG.jailTurns) {
          const paid = reducer({ ...s, turnIndex: idx, dice: null }, { type: 'PAY_BAIL', playerId: next.id });
          const out = paid.players.find((x) => x.id === next.id)!.jail === 0
            ? paid
            : reducer({ ...s, turnIndex: idx, dice: null }, { type: 'LEAVE_JAIL', playerId: next.id, reason: 'cumplió su condena' });
          return { ...out, log: log(out, `Es el turno de ${next.name}`) };
        }
        return {
          ...s,
          turnIndex: idx,
          dice: null,
          players: mapPlayer(s, next.id, (x) => ({ ...x, jail: served })),
          log: log(s, `Es el turno de ${next.name} 🚔 (turno ${served} de ${GAME_CONFIG.jailTurns} en la cárcel)`),
        };
      }
      return { ...s, turnIndex: idx, dice: null, log: log(s, `Es el turno de ${next.name}`) };
    }

    case 'REPLACE':
      return a.state;

    default:
      return s;
  }
}

// Reexport de utilidades usadas por la UI.
export { ownsFullGroup, ownsFullGroupActive };
