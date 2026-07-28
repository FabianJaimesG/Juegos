// Motor de juego (puro): estado + acciones. Reutiliza el dominio (board/wealth/config).
import { getProperty } from '../domain/board';
import { GAME_CONFIG } from '../domain/config';
import type { Holding, PlayerHoldings } from '../domain/wealth';
import {
  availableBuildings,
  buildingCounts,
  canBuildOn,
  countByKind,
  equity,
  netWorth,
  ownsFullGroup,
} from '../domain/wealth';

export interface RuntimePlayer {
  id: string;
  name: string;
  icon: string;
  colorIndex: number;
  cash: number;
  bankrupt: boolean;
  holdings: Holding[];
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
}

export interface DiceRoll {
  a: number;
  b: number;
  special: string | null;
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
}

export const DEFAULT_SETTINGS: GameSettings = { dice: true, special: true, sound: true, voice: true };

/** Rellena campos nuevos en estados antiguos (localStorage / remoto). */
export function hydrate(s: GameState): GameState {
  return { ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) }, dice: s.dice ?? null };
}

export type Action =
  | { type: 'ADD_PLAYER'; name: string; icon?: string; colorIndex?: number }
  | { type: 'REMOVE_PLAYER'; playerId: string }
  | { type: 'BANK_TO_PLAYER'; playerId: string; amount: number } // cobrar del banco
  | { type: 'PLAYER_TO_BANK'; playerId: string; amount: number } // pagar al banco
  | { type: 'TRANSFER'; fromId: string; toIds: string[]; amount: number } // a cada uno
  | { type: 'COLLECT'; toId: string; fromIds: string[]; amount: number } // cobro entre jugadores
  | { type: 'SALIDA'; playerId: string }
  | { type: 'BUY_PROPERTY'; playerId: string; propertyId: string; price?: number }
  | { type: 'MORTGAGE'; playerId: string; propertyId: string }
  | { type: 'UNMORTGAGE'; playerId: string; propertyId: string }
  | { type: 'BUILD_HOUSE'; playerId: string; propertyId: string }
  | { type: 'SELL_HOUSE'; playerId: string; propertyId: string }
  | {
      type: 'TRADE';
      aId: string;
      bId: string;
      aCash: number; // dinero que A entrega a B
      bCash: number; // dinero que B entrega a A
      aProps: string[]; // propiedades que A entrega a B
      bProps: string[]; // propiedades que B entrega a A
    }
  | { type: 'ROLL_DICE' }
  | { type: 'SET_SETTINGS'; patch: Partial<GameSettings> }
  | { type: 'NEXT_TURN' }
  | { type: 'REPLACE'; state: GameState }; // para sincronización (Realtime)

const SPECIAL_FACES = ['🎲 dado 1', '🎲 dado 2', '➕ suma', '✖️ dobles', '🔁 relanza', '🚫 pierde turno', '➕6 bonus'];
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
export const bankBuildingsLeft = (s: GameState) => availableBuildings(s.players.map(holdingsOf));

function log(s: GameState, text: string): LogEntry[] {
  return [{ id: uid(), text, ts: Date.now() }, ...s.log].slice(0, 200);
}

function mapPlayer(s: GameState, id: string, fn: (p: RuntimePlayer) => RuntimePlayer): RuntimePlayer[] {
  return s.players.map((p) => (p.id === id ? fn(p) : p));
}

const palette = 10; // colores disponibles (índices 0..9)

export function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'ADD_PLAYER': {
      const colorIndex = a.colorIndex ?? s.players.length % palette;
      const p: RuntimePlayer = {
        id: uid(),
        name: a.name.trim() || `Jugador ${s.players.length + 1}`,
        icon: a.icon ?? '🙂',
        colorIndex,
        cash: GAME_CONFIG.initialBalance,
        bankrupt: false,
        holdings: [],
      };
      return { ...s, players: [...s.players, p], log: log(s, `Se unió ${p.name}`) };
    }

    case 'REMOVE_PLAYER':
      return { ...s, players: s.players.filter((p) => p.id !== a.playerId) };

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
      if (!p || a.amount <= 0 || p.cash < a.amount) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({ ...x, cash: x.cash - a.amount })),
        log: log(s, `${p.name} pagó ${a.amount} al banco`),
      };
    }

    case 'TRANSFER': {
      const from = s.players.find((x) => x.id === a.fromId);
      const recips = s.players.filter((x) => a.toIds.includes(x.id));
      const total = a.amount * recips.length;
      if (!from || a.amount <= 0 || recips.length === 0 || from.cash < total) return s;
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
      const price = a.price ?? prop.price;
      if (p.cash < price) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({
          ...x,
          cash: x.cash - price,
          holdings: [...x.holdings, { propertyId: a.propertyId, houses: 0, mortgaged: false }],
        })),
        log: log(s, `${p.name} compró ${prop.name} por ${price}`),
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
      if (!prop || !p || !h || !h.mortgaged || p.cash < prop.unmortgageCost) return s;
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
      if (!canBuildOn(holdingsOf(p), a.propertyId)) return s;
      if (p.cash < prop.houseCost) return s;
      const h = p.holdings.find((x) => x.propertyId === a.propertyId)!;
      const left = bankBuildingsLeft(s);
      const willBeHotel = h.houses + 1 >= 5;
      if (willBeHotel ? left.hotels <= 0 : left.houses <= 0) return s;
      return {
        ...s,
        players: mapPlayer(s, a.playerId, (x) => ({
          ...x,
          cash: x.cash - prop.houseCost,
          holdings: x.holdings.map((y) =>
            y.propertyId === a.propertyId ? { ...y, houses: y.houses + 1 } : y,
          ),
        })),
        log: log(s, `${p.name} construyó en ${prop.name} (${willBeHotel ? 'hotel' : h.houses + 1 + ' casas'})`),
      };
    }

    case 'SELL_HOUSE': {
      const prop = getProperty(a.propertyId);
      const p = s.players.find((x) => x.id === a.playerId);
      const h = p?.holdings.find((x) => x.propertyId === a.propertyId);
      if (!prop || !p || !h || h.houses <= 0) return s;
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

    case 'TRADE': {
      const A = s.players.find((x) => x.id === a.aId);
      const B = s.players.find((x) => x.id === a.bId);
      if (!A || !B || A.id === B.id) return s;
      if (a.aCash < 0 || a.bCash < 0) return s;
      if (A.cash < a.aCash || B.cash < a.bCash) return s;
      const aSet = new Set(a.aProps);
      const bSet = new Set(a.bProps);
      const aHold = new Map(A.holdings.map((h) => [h.propertyId, h]));
      const bHold = new Map(B.holdings.map((h) => [h.propertyId, h]));
      // A debe poseer aProps (sin casas); B debe poseer bProps (sin casas).
      for (const id of a.aProps) {
        const h = aHold.get(id);
        if (!h || h.houses > 0) return s;
      }
      for (const id of a.bProps) {
        const h = bHold.get(id);
        if (!h || h.houses > 0) return s;
      }
      // Debe haber algo que intercambiar.
      if (a.aCash === 0 && a.bCash === 0 && a.aProps.length === 0 && a.bProps.length === 0) return s;

      const aGives = A.holdings.filter((h) => aSet.has(h.propertyId)); // van a B (tal cual, hipoteca incluida)
      const bGives = B.holdings.filter((h) => bSet.has(h.propertyId)); // van a A
      const newA: RuntimePlayer = {
        ...A,
        cash: A.cash - a.aCash + a.bCash,
        holdings: [...A.holdings.filter((h) => !aSet.has(h.propertyId)), ...bGives],
      };
      const newB: RuntimePlayer = {
        ...B,
        cash: B.cash - a.bCash + a.aCash,
        holdings: [...B.holdings.filter((h) => !bSet.has(h.propertyId)), ...aGives],
      };
      const players = s.players.map((p) => (p.id === A.id ? newA : p.id === B.id ? newB : p));
      const detail = [
        a.aProps.length ? `${A.name} da ${a.aProps.length} prop.` : '',
        a.aCash ? `${A.name} da ${a.aCash}` : '',
        a.bProps.length ? `${B.name} da ${a.bProps.length} prop.` : '',
        a.bCash ? `${B.name} da ${a.bCash}` : '',
      ].filter(Boolean).join(' · ');
      return { ...s, players, log: log(s, `Negociación ${A.name} ↔ ${B.name}: ${detail}`) };
    }

    case 'ROLL_DICE': {
      const a = d6();
      const b = d6();
      const special = s.settings.special ? SPECIAL_FACES[Math.floor(Math.random() * SPECIAL_FACES.length)] : null;
      const txt = `🎲 ${a} + ${b} = ${a + b}${special ? ` · ${special}` : ''}`;
      return { ...s, dice: { a, b, special }, log: log(s, txt) };
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
      return { ...s, turnIndex: idx, dice: null, log: log(s, `Es el turno de ${next.name}`) };
    }

    case 'REPLACE':
      return a.state;

    default:
      return s;
  }
}

// Reexport de utilidades usadas por la UI.
export { ownsFullGroup };
