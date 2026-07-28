import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { PropertyCard } from './components/PropertyCard';
import { WealthChart } from './components/WealthChart';
import { BOARD, getProperty } from './domain/board';
import {
  bankBuildingsLeft,
  createGame,
  type GameSettings,
  type GameState,
  holdingsOf,
  type LogEntry,
  ownsFullGroup,
  type PendingTrade,
  playerBuildings,
  playerEquity,
  playerNetWorth,
  playerRailUtil,
  type RuntimePlayer,
} from './game/engine';
import { canBuildOn } from './domain/wealth';
import type { Property } from './domain/Property';
import { blip, speak } from './game/feedback';
import { useGame } from './game/useGame';
import { useIdentity } from './game/useIdentity';
import { useRealtimeSync } from './game/sync';
import { useWealthHistory } from './game/useWealthHistory';
import { hasSupabase } from './lib/supabase';

const PLAYER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#dc2626', '#4f46e5'];

type Sheet =
  | { kind: 'none' }
  | { kind: 'pay'; playerId: string }
  | { kind: 'collect'; playerId: string }
  | { kind: 'props'; playerId: string }
  | { kind: 'market'; playerId: string }
  | { kind: 'trade'; playerId: string }
  | { kind: 'edit'; playerId: string }
  | { kind: 'settings' }
  | { kind: 'chart' }
  | { kind: 'history' };

const PLAYER_COLOR = (i: number) => PLAYER_COLORS[i % PLAYER_COLORS.length];

const EMOJIS = ['🙂', '😎', '🤠', '👑', '🐶', '🐱', '🦊', '🐸', '🐵', '🦁', '🐯', '🐼', '🚗', '🚀', '⚽', '🎩', '💎', '🍕', '🎸', '🌟'];
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const rand6 = () => Math.floor(Math.random() * 6) + 1;

/** Renta actual de una propiedad según la situación del dueño (grupo completo / casas). */
function currentRentText(me: RuntimePlayer, prop: Property, houses: number): number | string {
  if (prop.kind === 'utility') {
    const { utilities } = playerRailUtil(me);
    return `🎲 ×${utilities >= 2 ? 10 : 4}`;
  }
  const full = ownsFullGroup(holdingsOf(me), prop.colorGroup);
  const { railroads } = playerRailUtil(me);
  return prop.rent({ houses, ownerHasFullGroup: full, railroadsOwned: railroads, utilitiesOwned: 0, diceTotal: 0 });
}

export default function App() {
  const { state, act, undo, redo, reset, canUndo, canRedo } = useGame();
  const { meId, setMe } = useIdentity(state.code);
  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });

  const sym = state.currencySymbol;
  const money = (n: number) => `${sym}${n.toLocaleString('es')}`;

  // Sincronización en vivo (tabla Room + Realtime).
  useRealtimeSync(state.code, state, (s) => act({ type: 'REPLACE', state: s }));

  const join = (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (c && c !== state.code) act({ type: 'REPLACE', state: createGame(c) });
  };

  // Auto-unirse desde ?room=CODE (solo al cargar).
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('room');
    if (r) join(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareLink = `${window.location.origin}${window.location.pathname}?room=${state.code}`;
  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      alert('Enlace de invitación copiado:\n' + shareLink);
    } catch {
      prompt('Copia el enlace de invitación:', shareLink);
    }
  };

  const history = useWealthHistory(state);

  // Feedback: sonido + voz cuando aparece una nueva entrada en el historial.
  const lastLogId = useRef<string | null>(null);
  useEffect(() => {
    const top = state.log[0];
    if (!top) return;
    if (lastLogId.current === null) {
      lastLogId.current = top.id; // no hablar al cargar la página
      return;
    }
    if (top.id === lastLogId.current) return;
    lastLogId.current = top.id;
    if (state.settings.sound) blip();
    if (state.settings.voice) speak(top.text);
  }, [state.log, state.settings.sound, state.settings.voice]);

  // ── Fase de preparación ──
  if (!state.started) {
    return <SetupScreen state={state} act={act} share={share} onJoin={join} />;
  }

  // ── Elegir identidad de este dispositivo ──
  const me = state.players.find((p) => p.id === meId) ?? null;
  if (state.players.length > 0 && !me) {
    return <IdentityPicker players={state.players} onPick={setMe} />;
  }

  const amAdmin = !!me?.admin;
  const canControl = (pid: string) => amAdmin || me?.id === pid;
  const turnPlayer = state.players[state.turnIndex];
  const myTurn = !!turnPlayer && canControl(turnPlayer.id);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          🏦 Banca <span className="code">{hasSupabase ? '🟢' : '⚪'} Sala {state.code}</span>
        </h1>
        <div className="topbar__actions">
          {me && (
            <button onClick={() => setMe(null)} title="Cambiar de jugador">
              {me.icon} {me.name}{amAdmin ? ' 🛡️' : ''}
            </button>
          )}
          {amAdmin && <button onClick={undo} disabled={!canUndo}>↶</button>}
          {amAdmin && <button onClick={redo} disabled={!canRedo}>↷</button>}
          <button onClick={() => setSheet({ kind: 'history' })} title="Historial de movimientos">📜</button>
          <button onClick={() => setSheet({ kind: 'chart' })} title="Gráfico de patrimonio">📈</button>
          <button onClick={() => setSheet({ kind: 'settings' })} title="Ajustes">⚙️</button>
          <button onClick={share} title="Copiar enlace de invitación">Compartir</button>
          {amAdmin && <button onClick={() => { if (confirm('¿Nueva partida? Se borra la actual.')) reset(); }}>Nueva</button>}
        </div>
      </header>

      {turnPlayer && (
        <div className="turnbar">
          <span className="turnbar__who">Turno: <b>{turnPlayer.icon} {turnPlayer.name}</b>{myTurn && ' (tú)'}</span>
          {state.settings.dice && <DiceView dice={state.dice} onRoll={() => act({ type: 'ROLL_DICE' })} canRoll={myTurn} />}
          <span className="turnbar__btns">
            <button onClick={() => act({ type: 'NEXT_TURN' })} disabled={!myTurn} title={myTurn ? '' : 'Solo el jugador en turno'}>
              Siguiente turno →
            </button>
          </span>
        </div>
      )}

      {state.pendingTrade && (
        <PendingTradeBanner trade={state.pendingTrade} players={state.players} act={act} money={money} />
      )}

      <section className="players">
        {state.players.map((p) => (
          <PlayerTile
            key={p.id}
            p={p}
            money={money}
            isCurrent={p.id === turnPlayer?.id}
            canControl={canControl(p.id)}
            canTrade={!state.pendingTrade && state.players.length >= 2}
            onOpen={(k) => setSheet({ kind: k, playerId: p.id })}
            onSalida={() => act({ type: 'SALIDA', playerId: p.id })}
          />
        ))}
      </section>

      {sheet.kind !== 'none' && (
        <div className="overlay" onClick={() => setSheet({ kind: 'none' })}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <SheetContent
              sheet={sheet}
              state={state}
              act={act}
              money={money}
              history={history}
              canControl={canControl}
              close={() => setSheet({ kind: 'none' })}
              goMarket={(playerId) => setSheet({ kind: 'market', playerId })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerTile({
  p, money, isCurrent, canControl, canTrade, onOpen, onSalida,
}: {
  p: RuntimePlayer;
  money: (n: number) => string;
  isCurrent: boolean;
  canControl: boolean;
  canTrade: boolean;
  onOpen: (k: Sheet['kind']) => void;
  onSalida: () => void;
}) {
  const nw = playerNetWorth(p);
  const b = playerBuildings(p);
  const color = PLAYER_COLOR(p.colorIndex);
  return (
    <article className={`ptile ${isCurrent ? 'ptile--current' : ''} ${canControl ? '' : 'ptile--other'}`} style={{ borderTopColor: color }}>
      <div className="ptile__head">
        <span className="ptile__name">{p.icon} {p.name} {isCurrent && '⭐'} {p.admin && '🛡️'}</span>
        {canControl && <button className="ptile__edit" title="Editar personaje" onClick={() => onOpen('edit')}>✏️</button>}
      </div>
      <div className="ptile__cash">{money(p.cash)}</div>
      <div className="ptile__stats">
        <span title="Patrimonio total (efectivo + propiedades + casas)">💎 {money(nw)}</span>
        <span title="Propiedades">🏷️ {p.holdings.length}</span>
        <span title="Casas / Hoteles">🏠 {b.houses} · 🏨 {b.hotels}</span>
      </div>
      <div className="ptile__btns">
        {canControl ? (
          <>
            <button className="b-in" onClick={() => onOpen('collect')}>Cobrar</button>
            <button className="b-out" onClick={() => onOpen('pay')}>Pagar</button>
            <button className="b-prop" onClick={() => onOpen('props')}>Propiedades</button>
            <button className="b-salida" onClick={onSalida}>🟢 Salida</button>
            {isCurrent && canTrade && <button className="b-trade" onClick={() => onOpen('trade')}>Negociar</button>}
          </>
        ) : (
          <button className="b-prop" onClick={() => onOpen('props')}>Ver propiedades</button>
        )}
      </div>
    </article>
  );
}

function SheetContent({
  sheet, state, act, money, history, canControl, close, goMarket,
}: {
  sheet: Sheet;
  state: ReturnType<typeof useGame>['state'];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  history: ReturnType<typeof useWealthHistory>;
  canControl: (pid: string) => boolean;
  close: () => void;
  goMarket: (playerId: string) => void;
}) {
  if (sheet.kind === 'none') return null;

  if (sheet.kind === 'settings') {
    return <SettingsPanel settings={state.settings} setSettings={(patch) => act({ type: 'SET_SETTINGS', patch })} />;
  }

  if (sheet.kind === 'history') {
    return <HistoryPanel log={state.log} />;
  }

  if (sheet.kind === 'chart') {
    const players = state.players.map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: PLAYER_COLOR(p.colorIndex) }));
    return (
      <div className="form">
        <h2>📈 Patrimonio en el tiempo</h2>
        <WealthChart points={history} players={players} money={money} />
        <button className="confirm" onClick={close}>Cerrar</button>
      </div>
    );
  }

  const me = state.players.find((p) => p.id === sheet.playerId);
  if (!me) return null;
  const mine = canControl(me.id);

  if (sheet.kind === 'edit') {
    return <PlayerEditPanel me={me} act={act} close={close} />;
  }

  if (sheet.kind === 'collect') {
    const others = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    return <CollectForm me={me} others={others} act={act} close={close} money={money} />;
  }

  if (sheet.kind === 'pay') {
    const others = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    return <PayForm me={me} others={others} act={act} close={close} money={money} />;
  }

  if (sheet.kind === 'props') {
    return <PropsPanel me={me} act={act} money={money} readOnly={!mine} goMarket={() => goMarket(me.id)} />;
  }

  if (sheet.kind === 'market') {
    return <Market me={me} state={state} act={act} money={money} close={close} />;
  }

  if (sheet.kind === 'trade') {
    const others = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    return <TradePanel me={me} others={others} act={act} money={money} close={close} />;
  }
  return null;
}

type BoolSetting = 'dice' | 'special' | 'sound' | 'voice';

function SettingsPanel({ settings, setSettings }: { settings: GameSettings; setSettings: (patch: Partial<GameSettings>) => void }) {
  const row = (key: BoolSetting, label: string, desc: string) => (
    <label className="setrow">
      <input type="checkbox" checked={settings[key]} onChange={(e) => setSettings({ [key]: e.target.checked })} />
      <span><b>{label}</b><br /><span className="hint">{desc}</span></span>
    </label>
  );
  return (
    <div className="form">
      <h2>⚙️ Ajustes</h2>
      {row('dice', 'Dados', 'Muestra el botón para tirar dados en el turno.')}
      {row('special', 'Dado especial', 'Añade una cara especial al tirar.')}
      {row('sound', 'Sonido', 'Blip de caja al registrar movimientos.')}
      {row('voice', 'Voz', 'Narra los movimientos en español.')}
    </div>
  );
}

const QUICKS = [1, 5, 10, 50, 100, 200];

function CollectForm({
  me, others, act, close, money,
}: {
  me: RuntimePlayer;
  others: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  close: () => void;
  money: (n: number) => string;
}) {
  const [amt, setAmt] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const n = parseInt(amt, 10) || 0;
  const fromBank = sel.length === 0;

  return (
    <div className="form">
      <h2>Cobrar — {me.name}</h2>
      <p className="hint">Sin seleccionar nadie → cobra al <b>banco</b>. Con jugadores → cada uno te paga {money(n)}.</p>
      <input autoFocus inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ''))} placeholder="Monto" />
      <div className="quick">
        {QUICKS.map((q) => (
          <button key={q} onClick={() => setAmt(String(n + q))}>+{q}</button>
        ))}
        <button onClick={() => setAmt('')}>C</button>
      </div>
      <div className="chips">
        {others.map((o) => (
          <button
            key={o.id}
            className={sel.includes(o.id) ? 'chip chip--on' : 'chip'}
            onClick={() => setSel((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]))}
          >
            {o.icon} {o.name}
          </button>
        ))}
      </div>
      {sel.length > 1 && <p className="hint">Total a recibir: {money(n * sel.length)}</p>}
      <button
        className="confirm"
        disabled={n <= 0}
        onClick={() => {
          if (fromBank) act({ type: 'BANK_TO_PLAYER', playerId: me.id, amount: n });
          else act({ type: 'COLLECT', toId: me.id, fromIds: sel, amount: n });
          close();
        }}
      >
        {fromBank ? 'Cobrar al banco' : sel.length > 1 ? `Cobrar a ${sel.length}` : 'Cobrar'}
      </button>
    </div>
  );
}

function PayForm({
  me, others, act, close, money,
}: {
  me: RuntimePlayer;
  others: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  close: () => void;
  money: (n: number) => string;
}) {
  const [amt, setAmt] = useState('');
  const [sel, setSel] = useState<string[]>(others.length === 1 ? [others[0].id] : []);
  const n = parseInt(amt, 10) || 0;
  const total = n * (sel.length || 1);
  const toBank = sel.length === 0;
  const enough = me.cash >= total;

  return (
    <div className="form">
      <h2>Pagar — {me.name}</h2>
      <p className="hint">Sin seleccionar nadie → paga al <b>banco</b>. Con jugadores → transfiere {money(n)} a cada uno.</p>
      <input autoFocus inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ''))} placeholder="Monto" />
      <div className="quick">
        {QUICKS.map((q) => (
          <button key={q} onClick={() => setAmt(String(n + q))}>+{q}</button>
        ))}
        <button onClick={() => setAmt('')}>C</button>
      </div>
      <div className="chips">
        {others.map((o) => (
          <button
            key={o.id}
            className={sel.includes(o.id) ? 'chip chip--on' : 'chip'}
            onClick={() => setSel((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]))}
          >
            {o.icon} {o.name}
          </button>
        ))}
      </div>
      {sel.length > 1 && <p className="hint">Total a pagar: {money(total)}</p>}
      <button
        className="confirm"
        disabled={n <= 0 || !enough}
        onClick={() => {
          if (toBank) act({ type: 'PLAYER_TO_BANK', playerId: me.id, amount: n });
          else act({ type: 'TRANSFER', fromId: me.id, toIds: sel, amount: n });
          close();
        }}
      >
        {toBank ? 'Pagar al banco' : sel.length > 1 ? `Transferir a ${sel.length}` : 'Transferir'}
        {!enough && ' (fondos insuficientes)'}
      </button>
    </div>
  );
}

function PropsPanel({
  me, act, money, readOnly, goMarket,
}: {
  me: RuntimePlayer;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  readOnly?: boolean;
  goMarket: () => void;
}) {
  return (
    <div className="form">
      <h2>Propiedades de {me.name}{readOnly ? ' (solo lectura)' : ''}</h2>
      <div className="wealth">
        <span>💵 {money(me.cash)}</span>
        <span>🏦 {money(playerEquity(me))} en bienes</span>
        <span>💎 {money(playerNetWorth(me))} total</span>
      </div>
      {!readOnly && <button className="confirm" onClick={goMarket}>🛒 Comprar propiedad</button>}
      <div className="ownedgrid">
        {me.holdings.length === 0 && <p className="hint">Aún no tiene propiedades.</p>}
        {me.holdings.map((h) => {
          const prop = getProperty(h.propertyId)!;
          const buildable = canBuildOn({ cash: me.cash, holdings: me.holdings }, h.propertyId);
          return (
            <div key={h.propertyId} className="owned">
              <PropertyCard
                property={prop}
                houses={h.houses}
                mortgaged={h.mortgaged}
                currentRent={h.mortgaged ? 0 : currentRentText(me, prop, h.houses)}
                compact
              />
              {!readOnly && <div className="owned__btns">
                {!h.mortgaged ? (
                  <button disabled={h.houses > 0} onClick={() => act({ type: 'MORTGAGE', playerId: me.id, propertyId: h.propertyId })}>
                    Hipotecar +{money(prop.mortgageValue)}
                  </button>
                ) : (
                  <button disabled={me.cash < prop.unmortgageCost} onClick={() => act({ type: 'UNMORTGAGE', playerId: me.id, propertyId: h.propertyId })}>
                    Deshipotecar -{money(prop.unmortgageCost)}
                  </button>
                )}
                {prop.isBuildable && (
                  <>
                    <button disabled={!buildable || me.cash < prop.houseCost} onClick={() => act({ type: 'BUILD_HOUSE', playerId: me.id, propertyId: h.propertyId })}>
                      +🏠 {money(prop.houseCost)}
                    </button>
                    <button disabled={h.houses <= 0} onClick={() => act({ type: 'SELL_HOUSE', playerId: me.id, propertyId: h.propertyId })}>
                      -🏠
                    </button>
                  </>
                )}
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Market({
  me, state, act, money, close,
}: {
  me: RuntimePlayer;
  state: ReturnType<typeof useGame>['state'];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  close: () => void;
}) {
  const ownedIds = useMemo(
    () => new Set(state.players.flatMap((p) => p.holdings.map((h) => h.propertyId))),
    [state.players],
  );
  const available = BOARD.filter((p) => !ownedIds.has(p.id));
  const left = bankBuildingsLeft(state);

  return (
    <div className="form">
      <h2>🛒 Comprar propiedad — {me.name}</h2>
      <p className="hint">Efectivo: {money(me.cash)} · Casas banco: {left.houses} · Hoteles: {left.hotels}</p>
      <div className="market">
        {available.map((prop) => (
          <div key={prop.id} className="market__item">
            <PropertyCard property={prop} compact />
            <button
              className="buy"
              disabled={me.cash < prop.price}
              onClick={() => { act({ type: 'BUY_PROPERTY', playerId: me.id, propertyId: prop.id }); }}
            >
              Comprar {money(prop.price)}
            </button>
          </div>
        ))}
        {available.length === 0 && <p className="hint">No quedan propiedades libres.</p>}
      </div>
      <button className="confirm" onClick={close}>Listo</button>
    </div>
  );
}

function TradePanel({
  me, others, act, money, close,
}: {
  me: RuntimePlayer;
  others: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  close: () => void;
}) {
  const [otherId, setOtherId] = useState<string>(others[0]?.id ?? '');
  const [aCash, setACash] = useState('');
  const [bCash, setBCash] = useState('');
  const [aProps, setAProps] = useState<string[]>([]);
  const [bProps, setBProps] = useState<string[]>([]);
  const other = others.find((p) => p.id === otherId);

  if (!other) return <div className="form"><h2>Negociar</h2><p className="hint">No hay otros jugadores.</p></div>;

  const tradeable = (p: RuntimePlayer) => p.holdings.filter((h) => h.houses === 0);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const nA = parseInt(aCash, 10) || 0;
  const nB = parseInt(bCash, 10) || 0;
  const nothing = nA === 0 && nB === 0 && aProps.length === 0 && bProps.length === 0;
  const valid = !nothing && me.cash >= nA && other.cash >= nB;

  const column = (
    p: RuntimePlayer,
    cash: string,
    setCash: (v: string) => void,
    sel: string[],
    setSel: (v: string[]) => void,
  ) => (
    <div className="tradecol">
      <h3>{p.icon} {p.name}</h3>
      <label className="tradecash">
        Da dinero:
        <input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} placeholder="0" />
      </label>
      <p className="hint">Efectivo: {money(p.cash)}</p>
      <div className="tradeprops">
        {tradeable(p).length === 0 && <p className="hint">Sin propiedades negociables.</p>}
        {tradeable(p).map((h) => {
          const prop = getProperty(h.propertyId)!;
          const on = sel.includes(h.propertyId);
          return (
            <div key={h.propertyId} className={on ? 'tradeprop tradeprop--on' : 'tradeprop'} onClick={() => toggle(sel, setSel, h.propertyId)}>
              <PropertyCard property={prop} mortgaged={h.mortgaged} compact />
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="form">
      <h2>🤝 Negociación</h2>
      {others.length > 1 && (
        <div className="chips">
          {others.map((o) => (
            <button key={o.id} className={o.id === otherId ? 'chip chip--on' : 'chip'} onClick={() => { setOtherId(o.id); setBProps([]); }}>
              {o.icon} {o.name}
            </button>
          ))}
        </div>
      )}
      <p className="hint">Las propiedades con casas no aparecen. Las hipotecadas se transfieren tal cual (el nuevo dueño las deshipoteca después).</p>
      <div className="tradegrid">
        {column(me, aCash, setACash, aProps, setAProps)}
        {column(other, bCash, setBCash, bProps, setBProps)}
      </div>
      <button
        className="confirm"
        disabled={!valid}
        onClick={() => {
          act({ type: 'PROPOSE_TRADE', trade: { aId: me.id, bId: other.id, aCash: nA, bCash: nB, aProps, bProps } });
          close();
        }}
      >
        {valid ? `Proponer a ${other.name}` : nothing ? 'Selecciona algo para intercambiar' : 'Fondos insuficientes'}
      </button>
    </div>
  );
}

function CharacterPicker({ icon, colorIndex, onIcon, onColor }: {
  icon: string;
  colorIndex: number;
  onIcon: (e: string) => void;
  onColor: (i: number) => void;
}) {
  return (
    <div className="picker">
      <div className="emojirow">
        {EMOJIS.map((e) => (
          <button type="button" key={e} className={`emojibtn ${e === icon ? 'emojibtn--on' : ''}`} onClick={() => onIcon(e)}>{e}</button>
        ))}
      </div>
      <div className="colorrow">
        {PLAYER_COLORS.map((c, i) => (
          <button
            type="button"
            key={c}
            className={`colordot ${i === colorIndex ? 'colordot--on' : ''}`}
            style={{ background: c }}
            onClick={() => onColor(i)}
            aria-label={`color ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

function DiceView({ dice, onRoll, canRoll }: {
  dice: { a: number; b: number; special: string | null } | null;
  onRoll: () => void;
  canRoll: boolean;
}) {
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<[number, number]>([1, 1]);
  const roll = () => {
    if (rolling || !canRoll) return;
    setRolling(true);
    const iv = setInterval(() => setFaces([rand6(), rand6()]), 80);
    setTimeout(() => {
      clearInterval(iv);
      setRolling(false);
      onRoll();
    }, 700);
  };
  const a = rolling ? faces[0] : dice?.a ?? 1;
  const b = rolling ? faces[1] : dice?.b ?? 1;
  return (
    <span className="turnbar__dice">
      <span className={`die ${rolling ? 'die--rolling' : ''}`}>{DICE_FACES[a - 1]}</span>
      <span className={`die ${rolling ? 'die--rolling' : ''}`}>{DICE_FACES[b - 1]}</span>
      {!rolling && dice && <span>= {dice.a + dice.b}{dice.special ? ` · ${dice.special}` : ''}</span>}
      {canRoll && <button onClick={roll} disabled={rolling}>{rolling ? '…' : 'Tirar'}</button>}
    </span>
  );
}

function PendingTradeBanner({ trade, players, act, money }: {
  trade: PendingTrade;
  players: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
}) {
  const A = players.find((p) => p.id === trade.aId);
  const B = players.find((p) => p.id === trade.bId);
  const nm = (ids: string[]) => ids.map((id) => getProperty(id)?.name ?? id).join(', ');
  const side = (cash: number, props: string[]) => {
    const parts = [cash ? money(cash) : '', props.length ? nm(props) : ''].filter(Boolean);
    return parts.length ? parts.join(' + ') : 'nada';
  };
  return (
    <div className="tradebanner">
      <h3>🤝 Negociación en proceso</h3>
      <div className="tradebanner__detail">
        <b>{A?.icon} {A?.name}</b> ofrece: {side(trade.aCash, trade.aProps)}<br />
        <b>{B?.icon} {B?.name}</b> ofrece: {side(trade.bCash, trade.bProps)}
      </div>
      <p className="hint">Debe responder <b>{B?.name}</b>. (Los demás solo ven la negociación en proceso.)</p>
      <div className="tradebanner__btns">
        <button className="t-accept" onClick={() => act({ type: 'ACCEPT_TRADE' })}>✅ {B?.name} acepta</button>
        <button className="t-reject" onClick={() => act({ type: 'REJECT_TRADE' })}>❌ Rechazar</button>
      </div>
    </div>
  );
}

function PlayerEditPanel({ me, act, close }: {
  me: RuntimePlayer;
  act: ReturnType<typeof useGame>['act'];
  close: () => void;
}) {
  const [name, setName] = useState(me.name);
  const [icon, setIcon] = useState(me.icon);
  const [color, setColor] = useState(me.colorIndex);
  return (
    <div className="form">
      <h2>Editar personaje</h2>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} />
      <CharacterPicker icon={icon} colorIndex={color} onIcon={setIcon} onColor={setColor} />
      <button
        className="confirm"
        onClick={() => { act({ type: 'EDIT_PLAYER', playerId: me.id, name, icon, colorIndex: color }); close(); }}
      >
        Guardar
      </button>
      <button
        className="salida"
        style={{ background: '#b91c1c' }}
        onClick={() => { if (confirm(`¿Quitar a ${me.name}?`)) { act({ type: 'REMOVE_PLAYER', playerId: me.id }); close(); } }}
      >
        Quitar jugador
      </button>
    </div>
  );
}

function HistoryPanel({ log }: { log: LogEntry[] }) {
  return (
    <div className="form">
      <h2>📜 Historial de movimientos</h2>
      {log.length === 0 && <p className="hint">Sin movimientos aún.</p>}
      <ul className="histlist">
        {log.map((e) => (
          <li key={e.id}>
            <span className="histtime">{new Date(e.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
            {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IdentityPicker({ players, onPick }: { players: RuntimePlayer[]; onPick: (id: string) => void }) {
  return (
    <div className="setup">
      <h1>¿Quién juega en este dispositivo?</h1>
      <p className="hint">Elige tu jugador: solo podrás mover tu propio dinero. Los administradores 🛡️ pueden operar a todos.</p>
      <div className="idgrid">
        {players.map((p) => (
          <button key={p.id} className="idbtn" style={{ borderColor: PLAYER_COLOR(p.colorIndex) }} onClick={() => onPick(p.id)}>
            <span className="idbtn__icon">{p.icon}</span>
            <span>{p.name} {p.admin && '🛡️'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SetupScreen({ state, act, share, onJoin }: {
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  share: () => void;
  onJoin: (code: string) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(EMOJIS[0]);
  const [color, setColor] = useState(0);
  const [admin, setAdmin] = useState(state.players.length === 0);
  const s = state.settings;
  const setS = (patch: Partial<GameSettings>) => act({ type: 'SET_SETTINGS', patch });

  return (
    <div className="setup">
      <h1>🏦 Banca — Preparación <span className="code">Sala {state.code}</span></h1>
      <div className="setup__top">
        <button onClick={share}>🔗 Compartir enlace</button>
        <button onClick={() => { const c = prompt('Código de sala a la que unirse:'); if (c) onJoin(c); }}>Unirse a otra sala</button>
      </div>

      <h2>Jugadores ({state.players.length}) — orden de juego</h2>
      <ol className="setup__players">
        {state.players.map((p, i) => (
          <li key={p.id}>
            <span className="setup__pname" style={{ color: PLAYER_COLOR(p.colorIndex) }}>{i + 1}. {p.icon} {p.name} {p.admin && '🛡️'}</span>
            <span className="setup__pbtns">
              <button onClick={() => act({ type: 'REORDER_PLAYER', playerId: p.id, dir: -1 })} disabled={i === 0}>▲</button>
              <button onClick={() => act({ type: 'REORDER_PLAYER', playerId: p.id, dir: 1 })} disabled={i === state.players.length - 1}>▼</button>
              <button onClick={() => act({ type: 'EDIT_PLAYER', playerId: p.id, admin: !p.admin })}>{p.admin ? 'Quitar admin' : 'Hacer admin'}</button>
              <button onClick={() => act({ type: 'REMOVE_PLAYER', playerId: p.id })}>✕</button>
            </span>
          </li>
        ))}
        {state.players.length === 0 && <p className="hint">Agrega al menos un jugador.</p>}
      </ol>

      <form
        className="setup__add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          act({ type: 'ADD_PLAYER', name, icon, colorIndex: color, admin });
          setName('');
          setColor((color + 1) % PLAYER_COLORS.length);
          setAdmin(false);
        }}
      >
        <div className="setup__addrow">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del jugador" maxLength={16} />
          <label className="setup__adminchk"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> 🛡️ Admin</label>
          <button type="submit">+ Agregar</button>
        </div>
        <CharacterPicker icon={icon} colorIndex={color} onIcon={setIcon} onColor={setColor} />
      </form>

      <h2>Opciones de la partida</h2>
      <label className="setrow setrow--num">
        <span><b>Dinero inicial</b><br /><span className="hint">Con cuánto empieza cada jugador.</span></span>
        <input type="number" min={0} step={50} value={s.initialBalance} onChange={(e) => setS({ initialBalance: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
      </label>
      <label className="setrow"><input type="checkbox" checked={s.dice} onChange={(e) => setS({ dice: e.target.checked })} /> <span><b>Dados</b></span></label>
      <label className="setrow"><input type="checkbox" checked={s.special} onChange={(e) => setS({ special: e.target.checked })} /> <span><b>Dado especial</b></span></label>
      <label className="setrow"><input type="checkbox" checked={s.sound} onChange={(e) => setS({ sound: e.target.checked })} /> <span><b>Sonido</b></span></label>
      <label className="setrow"><input type="checkbox" checked={s.voice} onChange={(e) => setS({ voice: e.target.checked })} /> <span><b>Voz</b></span></label>

      <button className="confirm setup__start" disabled={state.players.length < 1} onClick={() => act({ type: 'START_GAME' })}>
        ▶ Empezar partida
      </button>
    </div>
  );
}
