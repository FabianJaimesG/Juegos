import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { PropertyCard } from './components/PropertyCard';
import { WealthChart } from './components/WealthChart';
import { BOARD, getProperty, GROUPS } from './domain/board';
import { activeDecks, CARDS, cardText, DECKS, getCard, getWheelFace, isAutomatic, PACKS, packSize, WHEEL, wheelText, type DeckId } from './domain/cards';
import {
  bankBuildingsLeft,
  createGame,
  type GameSettings,
  type GameState,
  holdingsOf,
  type LogEntry,
  ownsFullGroupActive,
  type PendingTrade,
  playerActiveRailUtil,
  playerBuildings,
  playerEquity,
  playerNetWorth,
  type RuntimePlayer,
} from './game/engine';
import { canBuildOn, canSellOn } from './domain/wealth';
import { GAME_CONFIG } from './domain/config';
import type { Property } from './domain/Property';
import { blip, speak } from './game/feedback';
import { useGame } from './game/useGame';
import { useIdentity } from './game/useIdentity';
import { useRealtimeSync } from './game/sync';
import { useWealthHistory } from './game/useWealthHistory';
import { hasSupabase, supabase } from './lib/supabase';

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
  | { kind: 'board' }
  | { kind: 'history' };

const PLAYER_COLOR = (i: number) => PLAYER_COLORS[i % PLAYER_COLORS.length];

/** Identidad especial: dispositivo "solo ver" (TV / pantalla de la mesa). */
const VIEWER = '__viewer__';

// Personajes disponibles. Nota: no existe emoji de "pegaso"; se cubre con 🦄 (unicornio/pony).
const EMOJIS = [
  '🙂', '😎', '🤠', '👑', '🐶', '🐱', '🦊', '🐸', '🐵', '🦁', '🐯', '🐼',
  '🚗', '🚀', '⚽', '🎩', '💎', '🍕', '🎸', '🌟',
  '👟', '👞', '🦕', '🦖', '🦄', '🐴', '♟️', '♞', '🐉', '🥷', '🍥', '🪄', '🦉', '⚡', '🧙',
];
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const rand6 = () => Math.floor(Math.random() * 6) + 1;

/**
 * Renta actual de una propiedad según la situación del dueño. Consciente de hipoteca:
 * las hipotecadas no cuentan para el bono de set ni para el escalón de renta.
 */
function currentRentText(me: RuntimePlayer, prop: Property, houses: number): number | string {
  if (prop.kind === 'utility') {
    const { utilities } = playerActiveRailUtil(me);
    return `🎲 ×${utilities >= 2 ? 10 : 4}`;
  }
  const full = ownsFullGroupActive(holdingsOf(me), prop.colorGroup);
  const { railroads } = playerActiveRailUtil(me);
  return prop.rent({ houses, ownerHasFullGroup: full, railroadsOwned: railroads, utilitiesOwned: 0, diceTotal: 0 });
}

/** Orden de tablero: ferrocarriles y servicios primero, luego calles por índice de tablero. */
function holdingSortKey(propertyId: string): number {
  const p = getProperty(propertyId);
  if (!p) return 9999;
  if (p.kind === 'railroad') return -2000 + p.def.boardIndex;
  if (p.kind === 'utility') return -1000 + p.def.boardIndex;
  return p.def.boardIndex;
}

export default function App() {
  const { state, act, undo, redo, reset, canUndo, canRedo } = useGame();
  const { meId, setMe, deviceId } = useIdentity(state.code);
  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });

  const sym = state.currencySymbol;
  const money = (n: number) => `${sym}${n.toLocaleString('es')}`;

  // Sincronización en vivo (tabla Room + Realtime). Si otro elimina la sala, salimos a una nueva.
  useRealtimeSync(
    state.code,
    state,
    (s) => act({ type: 'REPLACE', state: s }),
    () => { setMe(null); reset(true); alert('La sala fue eliminada. Se creó una sala nueva.'); },
  );

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

  // Mantener ?room= sincronizado con la sala actual. Sin esto, tras crear una
  // sala nueva el enlace viejo seguía en la barra y al recargar volvías a la
  // sala anterior (o la resucitabas después de eliminarla).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('room') === state.code) return;
    url.searchParams.set('room', state.code);
    window.history.replaceState(null, '', url.toString());
  }, [state.code]);

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

  // Salida propia: este dispositivo se va a una sala nueva (no afecta a los demás).
  const newRoom = () => {
    if (!confirm('¿Salir a una sala nueva?\n\nSe crea otra sala con un código nuevo solo para este dispositivo.')) return;
    setMe(null);
    reset(true);
  };

  // ── Fase de preparación ──
  if (!state.started) {
    return <SetupScreen state={state} act={act} share={share} onJoin={join} onNewRoom={newRoom} />;
  }

  // Elegir jugador: reclama la identidad en el estado compartido (evita robos entre dispositivos).
  const pickIdentity = (id: string) => {
    if (id !== VIEWER) act({ type: 'CLAIM_PLAYER', playerId: id, deviceId });
    setMe(id);
  };
  // Salir de la sala: libera el reclamo de este dispositivo y vuelve al selector.
  const leaveRoom = () => {
    act({ type: 'RELEASE_PLAYER', deviceId });
    setMe(null);
  };
  // Reinicia la partida de ESTA sala para todos (mismo código, se propaga por sync).
  const newGame = () => {
    if (confirm('¿Reiniciar la partida de esta sala? Se borra para todos los dispositivos.')) reset(false);
  };
  // Termina la partida y devuelve a TODOS al panel de preparación, conservando
  // sala y jugadores (para reconfigurar y volver a empezar).
  const endGame = () => {
    if (confirm('¿Terminar la partida?\n\nTodos vuelven al panel de preparación. Se conservan los jugadores y el código de sala.')) {
      act({ type: 'END_GAME' });
    }
  };
  // Elimina la sala compartida: borra la fila en Supabase y todos salen a una sala nueva.
  const deleteRoom = async () => {
    if (!confirm('¿Eliminar esta sala para todos? No se puede deshacer.')) return;
    const code = state.code;
    setMe(null);
    reset(true); // este dispositivo salta a una sala nueva (código nuevo)
    if (supabase) {
      const { error } = await supabase.from('Room').delete().eq('code', code);
      if (error) alert('No se pudo eliminar en el servidor: ' + error.message);
    }
  };

  // ── Elegir identidad de este dispositivo ──
  const isViewer = meId === VIEWER;
  const me = isViewer ? null : state.players.find((p) => p.id === meId) ?? null;
  if (state.players.length > 0 && !me && !isViewer) {
    return <IdentityPicker players={state.players} onPick={pickIdentity} deviceId={deviceId} code={state.code} onNewRoom={newRoom} />;
  }

  const amAdmin = !!me?.admin;
  const canControl = (pid: string) => !isViewer && (amAdmin || me?.id === pid);
  const canEditRules = amAdmin || isViewer;
  const turnPlayer = state.players[state.turnIndex];
  const myTurn = !!turnPlayer && canControl(turnPlayer.id);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          🏦 Banca <span className="code">{hasSupabase ? '🟢' : '⚪'} Sala {state.code}</span>
        </h1>
        <div className="topbar__actions">
          {(me || isViewer) && (
            <button onClick={leaveRoom} title="Salir de la sala (volver a elegir jugador / modo)">
              {isViewer ? '📺 TV' : `${me!.icon} ${me!.name}${amAdmin ? ' 🛡️' : ''}`} 🚪
            </button>
          )}
          <button onClick={undo} disabled={!canUndo} title="Deshacer">↶</button>
          <button onClick={redo} disabled={!canRedo} title="Rehacer">↷</button>
          <button onClick={() => setSheet({ kind: 'board' })} title="Vista de tablero (todas las propiedades)">🗺️</button>
          <button onClick={() => setSheet({ kind: 'history' })} title="Historial de movimientos">📜</button>
          <button onClick={() => setSheet({ kind: 'chart' })} title="Gráfico de patrimonio">📈</button>
          <button onClick={() => setSheet({ kind: 'settings' })} title="Ajustes">⚙️</button>
          <button onClick={share} title="Copiar enlace de invitación">Compartir</button>
          {amAdmin && <button onClick={endGame} title="Terminar la partida: todos vuelven al panel de preparación">🏁 Terminar</button>}
          {amAdmin && <button onClick={newGame} title="Reiniciar la partida de esta sala (mismo código, borra jugadores)">Nueva</button>}
          <button onClick={newRoom} title="Salir a una sala nueva (solo este dispositivo)">➕ Sala nueva</button>
          {amAdmin && <button onClick={deleteRoom} title="Eliminar la sala para todos">🗑️</button>}
        </div>
      </header>

      {turnPlayer && (
        <div className="turnbar">
          <span className="turnbar__who">Turno: <b>{turnPlayer.icon} {turnPlayer.name}</b>{myTurn && ' (tú)'}</span>
          {state.settings.dice && <DiceView dice={state.dice} onRoll={() => act({ type: 'ROLL_DICE' })} canRoll={myTurn} />}
          <span className="turnbar__decks">
            {activeDecks(state.settings.cardPacks).map((d) => {
              // El mazo de Bonificación se paga con una ficha del jugador en turno.
              const needsToken = d === 'bonificacion';
              const hasToken = !needsToken || turnPlayer.bonus > 0;
              return (
                <button
                  key={d}
                  className="deckbtn"
                  style={{ ['--deck-color' as string]: DECKS[d].color }}
                  disabled={!myTurn || !!state.drawnCard || deckLeft(state, d) === 0 || !hasToken}
                  title={needsToken
                    ? `${DECKS[d].label} — cuesta 1 ficha (tienes ${turnPlayer.bonus})`
                    : `${DECKS[d].label} — ${deckLeft(state, d)} cartas`}
                  onClick={() => {
                    if (needsToken) act({ type: 'SPEND_TOKEN', playerId: turnPlayer.id, token: 'bonus' });
                    act({ type: 'DRAW_CARD', deck: d, playerId: turnPlayer.id });
                  }}
                >
                  {DECKS[d].emoji} <small>{needsToken ? turnPlayer.bonus : deckLeft(state, d)}</small>
                </button>
              );
            })}
          </span>
          <span className="turnbar__btns">
            <button onClick={() => act({ type: 'NEXT_TURN' })} disabled={!myTurn} title={myTurn ? '' : 'Solo el jugador en turno puede pasar'}>
              {myTurn ? 'Siguiente turno →' : '🔒 Siguiente turno'}
            </button>
          </span>
        </div>
      )}

      {state.settings.cardPacks.includes('parada-libre') && (
        <ParadaLibreBar state={state} act={act} money={money} me={me} canControl={canControl} />
      )}

      {state.wheel && (
        <WheelModal state={state} act={act} canAct={canControl(state.wheel.playerId)} />
      )}

      {state.drawnCard && (
        <CardModal
          drawn={state.drawnCard}
          state={state}
          act={act}
          money={money}
          canAct={canControl(state.drawnCard.playerId)}
        />
      )}

      {state.pendingTrade && (
        <PendingTradeBanner
          trade={state.pendingTrade}
          players={state.players}
          act={act}
          money={money}
          canRespond={canControl(state.pendingTrade.bId)}
        />
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
            isSelf={me?.id === p.id}
            onOpen={(k) => setSheet({ kind: k, playerId: p.id })}
            onSalida={() => act({ type: 'SALIDA', playerId: p.id })}
            onUseCard={(cardId) => act({ type: 'USE_CARD', playerId: p.id, cardId })}
            onJail={() => act({ type: 'GO_TO_JAIL', playerId: p.id })}
            onPayBail={() => act({ type: 'PAY_BAIL', playerId: p.id })}
            onLeaveJail={() => act({ type: 'LEAVE_JAIL', playerId: p.id })}
            sym={state.currencySymbol}
            hasLimo={state.limoPlayerId === p.id}
            bailText={money(GAME_CONFIG.bail)}
            jailTurns={GAME_CONFIG.jailTurns}
            onBankrupt={() => { if (confirm(`¿Declararte en bancarrota, ${p.name}? Tus propiedades vuelven al banco.`)) act({ type: 'DECLARE_BANKRUPTCY', playerId: p.id }); }}
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
              canEditRules={canEditRules}
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
  p, money, isCurrent, canControl, canTrade, isSelf, onOpen, onSalida, onUseCard, onBankrupt,
  onJail, onPayBail, onLeaveJail, sym, hasLimo, bailText, jailTurns,
}: {
  p: RuntimePlayer;
  money: (n: number) => string;
  isCurrent: boolean;
  canControl: boolean;
  canTrade: boolean;
  isSelf: boolean;
  onOpen: (k: Sheet['kind']) => void;
  onSalida: () => void;
  onUseCard: (cardId: string) => void;
  onBankrupt: () => void;
  onJail: () => void;
  onPayBail: () => void;
  onLeaveJail: () => void;
  sym: string;
  hasLimo: boolean;
  bailText: string;
  jailTurns: number;
}) {
  const nw = playerNetWorth(p);
  const b = playerBuildings(p);
  const color = PLAYER_COLOR(p.colorIndex);
  return (
    <article className={`ptile ${isCurrent ? 'ptile--current' : ''} ${canControl ? '' : 'ptile--other'} ${p.bankrupt ? 'ptile--bankrupt' : ''}`} style={{ borderTopColor: color }}>
      <div className="ptile__head">
        <span className="ptile__name">{p.icon} {p.name} {isCurrent && '⭐'} {p.admin && '🛡️'} {hasLimo && '🚘'} {p.jail > 0 && '🚔'} {p.bankrupt && '💀'}</span>
        {canControl && <button className="ptile__edit" title="Editar personaje" onClick={() => onOpen('edit')}>✏️</button>}
      </div>
      <div className="ptile__cash">{money(p.cash)}</div>
      <div className="ptile__stats">
        <span title="Patrimonio total (efectivo + propiedades + casas)">💎 {money(nw)}</span>
        <span title="Propiedades">🏷️ {p.holdings.length}</span>
        <span title="Casas / Hoteles">🏠 {b.houses} · 🏨 {b.hotels}</span>
        {p.spins > 0 && <span title="Fichas para girar la ruleta">🎡 {p.spins}</span>}
        {p.bonus > 0 && <span title="Fichas para robar del mazo de Bonificación">⭐ {p.bonus}</span>}
      </div>
      {p.jail > 0 && (
        <div className="ptile__jail">
          <span>🚔 En la cárcel · turno {p.jail}/{jailTurns}</span>
          {canControl && (
            <span className="ptile__jailbtns">
              <button onClick={onPayBail} title={`Pagar la fianza (${bailText})`}>Fianza {bailText}</button>
              <button onClick={onLeaveJail} title="Sacaste dobles o te liberan">Salir</button>
            </span>
          )}
        </div>
      )}
      {p.tokens.length > 0 && (
        <div className="ptile__hand">
          {p.tokens.map((cardId, i) => {
            const c = getCard(cardId);
            if (!c) return null;
            return canControl ? (
              <button
                key={`${cardId}-${i}`}
                className="ptile__card"
                title={`Usar: ${cardText(c, sym)}`}
                onClick={() => { if (confirm(`Usar esta carta?\n\n${cardText(c, sym)}`)) onUseCard(cardId); }}
              >
                {c.emoji} usar
              </button>
            ) : (
              <span key={`${cardId}-${i}`} className="ptile__card ptile__card--ro" title={cardText(c, sym)}>{c.emoji}</span>
            );
          })}
        </div>
      )}
      <div className="ptile__btns">
        {canControl ? (
          <>
            <button className="b-in" onClick={() => onOpen('collect')}>Cobrar</button>
            <button className="b-out" onClick={() => onOpen('pay')}>Pagar</button>
            <button className="b-prop" onClick={() => onOpen('props')}>Propiedades</button>
            <button className="b-salida" onClick={onSalida}>🟢 Salida</button>
            {p.jail === 0 && <button className="b-jail" onClick={onJail} title="Ve a la cárcel">🚔</button>}
            {isCurrent && canTrade && <button className="b-trade" onClick={() => onOpen('trade')}>Negociar</button>}
          </>
        ) : (
          <button className="b-prop" onClick={() => onOpen('props')}>Ver propiedades</button>
        )}
      </div>
      {/* La bancarrota solo la declara el propio jugador desde su dispositivo. */}
      {isSelf && !p.bankrupt && (
        <button className="b-bankrupt" onClick={onBankrupt}>💀 Declararme en bancarrota</button>
      )}
    </article>
  );
}

function SheetContent({
  sheet, state, act, money, history, canControl, canEditRules, close, goMarket,
}: {
  sheet: Sheet;
  state: ReturnType<typeof useGame>['state'];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  history: ReturnType<typeof useWealthHistory>;
  canControl: (pid: string) => boolean;
  canEditRules: boolean;
  close: () => void;
  goMarket: (playerId: string) => void;
}) {
  if (sheet.kind === 'none') return null;

  if (sheet.kind === 'settings') {
    return <SettingsPanel settings={state.settings} canEditRules={canEditRules} setSettings={(patch) => act({ type: 'SET_SETTINGS', patch })} />;
  }

  if (sheet.kind === 'board') {
    return <BoardOverview state={state} money={money} close={close} />;
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
    // Pagar renta: solo el jugador en turno (o su admin) puede pagar renta a OTRO dueño.
    const turnPlayer = state.players[state.turnIndex];
    const canPayRent = !!turnPlayer && !turnPlayer.bankrupt && canControl(turnPlayer.id) && turnPlayer.id !== me.id;
    const diceTotal = state.dice ? state.dice.a + state.dice.b : null;
    return (
      <PropsPanel
        me={me}
        act={act}
        money={money}
        readOnly={!mine}
        evenBuild={state.settings.evenBuild}
        goMarket={() => goMarket(me.id)}
        onPayRent={canPayRent ? (propertyId) => { act({ type: 'PAY_RENT', fromId: turnPlayer.id, toId: me.id, propertyId }); close(); } : undefined}
        payerName={turnPlayer?.name}
        diceTotal={diceTotal}
      />
    );
  }

  if (sheet.kind === 'market') {
    return <Market me={me} state={state} act={act} money={money} close={close} />;
  }

  if (sheet.kind === 'trade') {
    const others = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    return <TradePanel me={me} others={others} act={act} money={money} close={close} sym={state.currencySymbol} />;
  }
  return null;
}

type BoolSetting = 'dice' | 'special' | 'sound' | 'voice' | 'evenBuild';

function SettingsPanel({ settings, canEditRules, setSettings }: { settings: GameSettings; canEditRules: boolean; setSettings: (patch: Partial<GameSettings>) => void }) {
  const row = (key: BoolSetting, label: string, desc: string, disabled = false) => (
    <label className={`setrow ${disabled ? 'setrow--locked' : ''}`}>
      <input type="checkbox" checked={settings[key]} disabled={disabled} onChange={(e) => setSettings({ [key]: e.target.checked })} />
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
      {row('evenBuild', 'Construcción/venta pareja', canEditRules
        ? 'Casas uniformes por grupo: no se puede tener un hotel y otra propiedad sin casas.'
        : 'Casas uniformes por grupo. Solo un admin 🛡️ o la pantalla 📺 puede cambiar esta regla.', !canEditRules)}
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
  // Ningún pagador seleccionado puede quedar en 0.
  const payerShort = others.some((o) => sel.includes(o.id) && o.cash - n < 1);

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
      {payerShort && <p className="hint">Un jugador no puede pagar sin quedar en 0. Debería declararse en bancarrota.</p>}
      <button
        className="confirm"
        disabled={n <= 0 || payerShort}
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
  // Por defecto: banco (nadie seleccionado), aunque quede un solo jugador.
  const [sel, setSel] = useState<string[]>([]);
  const n = parseInt(amt, 10) || 0;
  const total = n * (sel.length || 1);
  const toBank = sel.length === 0;
  // No puede quedar en 0: debe conservar al menos 1.
  const enough = me.cash - total >= 1;

  return (
    <div className="form">
      <h2>Pagar — {me.name}</h2>
      <p className="hint">Sin seleccionar nadie → paga al <b>banco</b>. Con jugadores → transfiere {money(n)} a cada uno. Debes conservar al menos {money(1)}.</p>
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
  me, act, money, readOnly, evenBuild, goMarket, onPayRent, payerName, diceTotal,
}: {
  me: RuntimePlayer;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  readOnly?: boolean;
  evenBuild: boolean;
  goMarket: () => void;
  onPayRent?: (propertyId: string) => void;
  payerName?: string;
  diceTotal?: number | null;
}) {
  return (
    <div className="form">
      <h2>Propiedades de {me.name}{readOnly ? ' (solo lectura)' : ''}</h2>
      {onPayRent && <p className="hint">💸 Como jugador en turno ({payerName}) puedes pagar la renta de una propiedad de {me.name}.</p>}
      <div className="wealth">
        <span>💵 {money(me.cash)}</span>
        <span>🏦 {money(playerEquity(me))} en bienes</span>
        <span>💎 {money(playerNetWorth(me))} total</span>
      </div>
      {!readOnly && <button className="confirm" onClick={goMarket}>🛒 Comprar propiedad</button>}
      <div className="ownedgrid">
        {me.holdings.length === 0 && <p className="hint">Aún no tiene propiedades.</p>}
        {[...me.holdings].sort((a, b) => holdingSortKey(a.propertyId) - holdingSortKey(b.propertyId)).map((h) => {
          const prop = getProperty(h.propertyId)!;
          const buildable = canBuildOn({ cash: me.cash, holdings: me.holdings }, h.propertyId, evenBuild);
          const sellable = canSellOn({ cash: me.cash, holdings: me.holdings }, h.propertyId, evenBuild);
          // Renta a pagar (auto y fija). Los servicios necesitan una tirada.
          const activeRU = playerActiveRailUtil(me);
          const needsDice = prop.kind === 'utility' && (diceTotal == null);
          const rentAmount = h.mortgaged ? 0 : prop.rent({
            houses: h.houses,
            ownerHasFullGroup: ownsFullGroupActive(holdingsOf(me), prop.colorGroup),
            railroadsOwned: activeRU.railroads,
            utilitiesOwned: activeRU.utilities,
            diceTotal: diceTotal ?? 0,
          }, h.mortgaged);
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
                    <button disabled={!sellable} onClick={() => act({ type: 'SELL_HOUSE', playerId: me.id, propertyId: h.propertyId })}>
                      -🏠
                    </button>
                  </>
                )}
              </div>}
              {onPayRent && !h.mortgaged && (
                <button
                  className="b-payrent"
                  disabled={needsDice}
                  title={needsDice ? 'Tira los dados primero (renta del servicio depende de la tirada)' : ''}
                  onClick={() => onPayRent(h.propertyId)}
                >
                  {needsDice ? '💸 Pagar renta (tira los dados)' : `💸 Pagar renta ${money(rentAmount)}`}
                </button>
              )}
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
  // La toma gratuita solo tiene sentido con Parada Libre en juego.
  const freebie = state.settings.cardPacks.includes('parada-libre');

  return (
    <div className="form">
      <h2>🛒 Comprar propiedad — {me.name}</h2>
      <p className="hint">Efectivo: {money(me.cash)} · Casas banco: {left.houses} · Hoteles: {left.hotels}</p>
      {freebie && <p className="hint">🎁 <b>Gratis</b> aparece por la modalidad Parada Libre: úsalo solo si tienes la carta o el sector de la ruleta.</p>}
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
            {/* "Propiedad gratis" (carta o ruleta de Parada Libre): se queda sin pagar. */}
            {freebie && (
              <button
                className="market__free"
                title="Usar tu carta de propiedad gratis: te la quedas sin pagar"
                onClick={() => { act({ type: 'BUY_PROPERTY', playerId: me.id, propertyId: prop.id, price: 0 }); }}
              >
                🎁 Gratis
              </button>
            )}
          </div>
        ))}
        {available.length === 0 && <p className="hint">No quedan propiedades libres.</p>}
      </div>
      <button className="confirm" onClick={close}>Listo</button>
    </div>
  );
}

function TradePanel({
  me, others, act, money, close, sym,
}: {
  me: RuntimePlayer;
  others: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  close: () => void;
  sym: string;
}) {
  const [otherId, setOtherId] = useState<string>(others[0]?.id ?? '');
  const [aCash, setACash] = useState('');
  const [bCash, setBCash] = useState('');
  const [aProps, setAProps] = useState<string[]>([]);
  const [bProps, setBProps] = useState<string[]>([]);
  // Índices (no ids) para poder ofrecer una de varias copias iguales.
  const [aCards, setACards] = useState<number[]>([]);
  const [bCards, setBCards] = useState<number[]>([]);
  const [aSpins, setASpins] = useState(0);
  const [bSpins, setBSpins] = useState(0);
  const [aBonus, setABonus] = useState(0);
  const [bBonus, setBBonus] = useState(0);
  const other = others.find((p) => p.id === otherId);

  if (!other) return <div className="form"><h2>Negociar</h2><p className="hint">No hay otros jugadores.</p></div>;

  const tradeable = (p: RuntimePlayer) => p.holdings.filter((h) => h.houses === 0);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const nA = parseInt(aCash, 10) || 0;
  const nB = parseInt(bCash, 10) || 0;
  const aCardIds = aCards.map((i) => me.tokens[i]).filter(Boolean);
  const bCardIds = bCards.map((i) => other.tokens[i]).filter(Boolean);
  const nothing =
    nA === 0 && nB === 0 && aProps.length === 0 && bProps.length === 0 &&
    aCardIds.length === 0 && bCardIds.length === 0 &&
    aSpins === 0 && bSpins === 0 && aBonus === 0 && bBonus === 0;
  const valid =
    !nothing && me.cash >= nA && other.cash >= nB &&
    me.spins >= aSpins && other.spins >= bSpins &&
    me.bonus >= aBonus && other.bonus >= bBonus;

  const toggleIdx = (list: number[], set: (v: number[]) => void, i: number) =>
    set(list.includes(i) ? list.filter((x) => x !== i) : [...list, i]);

  /** Selector de fichas (giro / bonificación) con tope en las que posee. */
  const tokenRow = (label: string, emoji: string, has: number, value: number, set: (n: number) => void) =>
    has > 0 && (
      <label className="tradetok">
        <span>{emoji} {label} <small>({has})</small></span>
        <input type="number" min={0} max={has} value={value}
          onChange={(e) => set(Math.max(0, Math.min(has, parseInt(e.target.value, 10) || 0)))} />
      </label>
    );

  const column = (
    p: RuntimePlayer,
    cash: string,
    setCash: (v: string) => void,
    sel: string[],
    setSel: (v: string[]) => void,
    cardSel: number[],
    setCardSel: (v: number[]) => void,
    spins: number,
    setSpins: (n: number) => void,
    bonus: number,
    setBonus: (n: number) => void,
  ) => (
    <div className="tradecol">
      <h3>{p.icon} {p.name}</h3>
      <label className="tradecash">
        Da dinero:
        <input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} placeholder="0" />
      </label>
      <p className="hint">Efectivo: {money(p.cash)}</p>

      {p.tokens.length > 0 && (
        <div className="tradecards">
          {p.tokens.map((cardId, i) => {
            const c = getCard(cardId);
            if (!c) return null;
            return (
              <button
                key={`${cardId}-${i}`}
                className={cardSel.includes(i) ? 'tradecard tradecard--on' : 'tradecard'}
                title={cardText(c, sym)}
                onClick={() => toggleIdx(cardSel, setCardSel, i)}
              >
                {c.emoji}
              </button>
            );
          })}
        </div>
      )}
      {tokenRow('fichas de giro', '🎡', p.spins, spins, setSpins)}
      {tokenRow('de bonificación', '⭐', p.bonus, bonus, setBonus)}
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
      <p className="hint">Las propiedades con casas no aparecen. Las hipotecadas se transfieren tal cual (el nuevo dueño las deshipoteca después). También puedes intercambiar cartas guardadas 🃏 y fichas 🎡⭐.</p>
      <div className="tradegrid">
        {column(me, aCash, setACash, aProps, setAProps, aCards, setACards, aSpins, setASpins, aBonus, setABonus)}
        {column(other, bCash, setBCash, bProps, setBProps, bCards, setBCards, bSpins, setBSpins, bBonus, setBBonus)}
      </div>
      <button
        className="confirm"
        disabled={!valid}
        onClick={() => {
          act({
            type: 'PROPOSE_TRADE',
            trade: {
              aId: me.id, bId: other.id, aCash: nA, bCash: nB, aProps, bProps,
              aCards: aCardIds, bCards: bCardIds, aSpins, bSpins, aBonus, bBonus,
            },
          });
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

/**
 * Barra de la modalidad Parada Libre: el bote acumulado y quién lleva la
 * limusina dorada. El bote se alimenta a mano (impuestos, multas, ruleta)
 * porque la app no sabe en qué casilla cae cada ficha.
 */
function ParadaLibreBar({ state, act, money, me, canControl }: {
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  me: RuntimePlayer | null;
  canControl: (pid: string) => boolean;
}) {
  const [amount, setAmount] = useState(100);
  const limo = state.players.find((p) => p.id === state.limoPlayerId) ?? null;
  const turn = state.players[state.turnIndex];
  const canAct = !!turn && canControl(turn.id);

  return (
    <div className="parada">
      <span className="parada__pot" title="Dinero acumulado en la Parada Libre">
        🅿️ Bote: <b>{money(state.pot)}</b>
      </span>

      {canAct && (
        <span className="parada__add">
          <input
            type="number"
            min={0}
            step={25}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value, 10) || 0))}
            title="Cuánto entra al bote"
          />
          <button onClick={() => act({ type: 'POT_ADD', amount })} title="El banco recibe un impuesto: va al bote">
            + Banco
          </button>
          <button
            onClick={() => act({ type: 'POT_ADD', amount, playerId: turn.id })}
            title={`${turn.name} paga al bote`}
          >
            + {turn.icon}
          </button>
          <button
            className="parada__take"
            disabled={state.pot <= 0}
            onClick={() => act({ type: 'POT_TAKE', playerId: turn.id })}
            title="El jugador en turno se lleva el bote"
          >
            🎰 Cobrar
          </button>
        </span>
      )}

      <span className="parada__limo" title="La limusina dorada: propiedades libres gratis y no pagas renta">
        🚘 {limo ? `${limo.icon} ${limo.name}` : '—'}
      </span>
      {me && (
        <button
          className="parada__land"
          title="Caíste en la casilla: te llevas el Gran Premio, la limusina y una tarjeta de Bonificación"
          onClick={() => {
            if (confirm('¿Caíste en la Parada Libre?\n\nTe llevas el bote, la limusina 🚘 y una tarjeta de Bonificación ⭐.')) {
              act({ type: 'LAND_FREE_PARKING', playerId: me.id });
            }
          }}
        >
          🅿️ ¡Caí aquí!
        </button>
      )}
      {limo && canControl(limo.id) && (
        <button className="parada__claim" onClick={() => act({ type: 'SET_LIMO', playerId: null })} title="Vas a la cárcel: pierdes la limusina">
          Soltar
        </button>
      )}

      {me && (
        <button
          className="parada__spin"
          disabled={me.spins <= 0 || !!state.wheel}
          title={me.spins > 0 ? 'Gasta una ficha y gira (ganas una tarjeta de Bonificación)' : 'No te quedan fichas de giro'}
          onClick={() => act({ type: 'SPIN_WHEEL', playerId: me.id })}
        >
          🎡 Girar ({me.spins})
        </button>
      )}
      {me && (
        <button
          className="parada__claim"
          disabled={state.settings.maxSpins > 0 && me.spins >= state.settings.maxSpins}
          title={`Perdonas la renta a quien cayó en tu propiedad y tomas una ficha de giro${state.settings.maxSpins > 0 ? ` (tope: ${state.settings.maxSpins})` : ''}`}
          onClick={() => act({ type: 'RENT_TO_SPIN', ownerId: me.id })}
        >
          🤝 Renta → ficha
        </button>
      )}
    </div>
  );
}

/** Resultado de la ruleta, a pantalla completa para toda la sala. */
function WheelModal({ state, act, canAct }: {
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  canAct: boolean;
}) {
  const w = state.wheel!;
  const face = getWheelFace(w.faceId);
  const player = state.players.find((p) => p.id === w.playerId);
  if (!face || !player) return null;
  const good = face.tone === 'good';
  return (
    <div className="overlay overlay--card">
      <div className="wheel" style={{ ['--tone' as string]: good ? '#16a34a' : '#dc2626' }}>
        <header className="wheel__band">🎡 LA RULETA</header>
        <div className="wheel__dial">
          {WHEEL.map((f) => (
            <span key={f.id} className={`wheel__seg ${f.id === face.id ? 'wheel__seg--hit' : ''} ${f.tone === 'good' ? 'is-good' : 'is-bad'}`} />
          ))}
          <span className="wheel__emoji">{face.emoji}</span>
        </div>
        <p className="wheel__text">{wheelText(face, state.currencySymbol)}</p>
        <div className="wheel__who">{player.icon} <b>{player.name}</b> · +1 ⭐ tarjeta de Bonificación</div>
        {canAct
          ? <button className="confirm" onClick={() => act({ type: 'CLOSE_WHEEL' })}>Continuar</button>
          : <p className="gcard__hint">Esperando a {player.name}…</p>}
      </div>
    </div>
  );
}

/** Cartas que quedan por robar en un mazo (contando el descarte, que se rebaraja). */
function deckLeft(state: GameState, d: DeckId): number {
  const deck = state.decks[d];
  return deck.draw.length + deck.discard.length;
}

/**
 * Carta robada, a pantalla completa y visible para toda la sala.
 * Solo quien controla al jugador puede resolverla.
 */
function CardModal({ drawn, state, act, money, canAct }: {
  drawn: NonNullable<GameState['drawnCard']>;
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  canAct: boolean;
}) {
  const card = getCard(drawn.cardId);
  const player = state.players.find((p) => p.id === drawn.playerId);
  if (!card || !player) return null;

  const deck = DECKS[card.deck];
  const e = card.effect;
  const auto = isAutomatic(e);

  // Qué dice el botón principal según el efecto.
  let action = auto ? 'Aplicar' : 'Entendido';
  if (e.kind === 'bank_pay') action = `Cobrar ${money(e.amount)}`;
  if (e.kind === 'bank_charge') action = `Pagar ${money(e.amount)}`;
  if (e.kind === 'collect_each') action = `Cobrar ${money(e.amount)} a cada uno`;
  if (e.kind === 'pay_each') action = `Pagar ${money(e.amount)} a cada uno`;
  if (card.keep) action = 'Guardar carta';
  if (e.kind === 'goto' && e.bonus) action = `Mover y cobrar ${money(e.bonus)}`;
  if (e.kind === 'repairs') {
    const b = playerBuildings(player);
    const total = b.houses * e.perHouse + b.hotels * e.perHotel;
    action = total > 0
      ? `Pagar ${money(total)} (${b.houses}🏠 · ${b.hotels}🏨)`
      : 'Sin construcciones: no pagas nada';
  }

  return (
    <div className="overlay overlay--card">
      <div className="gcard" style={{ ['--deck-color' as string]: deck.color }}>
        <header className="gcard__band">{deck.emoji} {deck.label}</header>
        <div className="gcard__emoji">{card.emoji}</div>
        <p className="gcard__text">{cardText(card, state.currencySymbol)}</p>
        <div className="gcard__who">Para {player.icon} <b>{player.name}</b></div>

        {!auto && <p className="gcard__hint">Mueve tu ficha en el tablero. La app no cambia dinero por esta carta.</p>}

        {canAct ? (
          <div className="gcard__btns">
            {e.kind === 'goto' && e.collectGo && (
              <button className="gcard__go" onClick={() => act({ type: 'CLAIM_GO_BONUS', playerId: player.id })}>
                🟢 Pasé por SALIDA
              </button>
            )}
            <button className="confirm" onClick={() => act({ type: 'RESOLVE_CARD' })}>{action}</button>
          </div>
        ) : (
          <p className="gcard__hint">Esperando a {player.name}…</p>
        )}
      </div>
    </div>
  );
}

function PendingTradeBanner({ trade, players, act, money, canRespond }: {
  trade: PendingTrade;
  players: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  canRespond: boolean;
}) {
  const A = players.find((p) => p.id === trade.aId);
  const B = players.find((p) => p.id === trade.bId);
  const nm = (ids: string[]) => ids.map((id) => getProperty(id)?.name ?? id).join(', ');
  const side = (cash: number, props: string[], cards: string[] = [], spins = 0, bonus = 0) => {
    const parts = [
      cash ? money(cash) : '',
      props.length ? nm(props) : '',
      cards.length ? cards.map((id) => getCard(id)?.emoji ?? '🃏').join('') : '',
      spins ? `${spins}🎡` : '',
      bonus ? `${bonus}⭐` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' + ') : 'nada';
  };
  return (
    <div className="tradebanner">
      <h3>🤝 Negociación en proceso</h3>
      <div className="tradebanner__detail">
        <b>{A?.icon} {A?.name}</b> ofrece: {side(trade.aCash, trade.aProps, trade.aCards, trade.aSpins, trade.aBonus)}<br />
        <b>{B?.icon} {B?.name}</b> ofrece: {side(trade.bCash, trade.bProps, trade.bCards, trade.bSpins, trade.bBonus)}
      </div>
      {canRespond ? (
        <div className="tradebanner__btns">
          <button className="t-accept" onClick={() => act({ type: 'ACCEPT_TRADE' })}>✅ Aceptar</button>
          <button className="t-reject" onClick={() => act({ type: 'REJECT_TRADE' })}>❌ Rechazar</button>
        </div>
      ) : (
        <p className="hint">Esperando la respuesta de <b>{B?.name}</b>…</p>
      )}
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

const GROUP_ORDER: (keyof typeof GROUPS)[] = ['railroad', 'utility', 'brown', 'lightblue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkblue'];
type BoardSort = 'board' | 'price' | 'group';
type BoardOwn = { player: RuntimePlayer; mortgaged: boolean; houses: number };

/** Resumen breve de renta para la fila del tablero (consciente de hipoteca). */
function rentSummary(prop: Property, own: BoardOwn | undefined, money: (n: number) => string): string {
  if (prop.kind === 'utility') {
    const util = own ? playerActiveRailUtil(own.player).utilities : 1;
    return `🎲×${util >= 2 ? 10 : 4}`;
  }
  if (own) {
    const r = currentRentText(own.player, prop, own.houses);
    return typeof r === 'number' ? money(r) : String(r);
  }
  return money(prop.def.rent[0]); // sin dueño: renta base
}

function BoardOverview({ state, money, close }: {
  state: GameState;
  money: (n: number) => string;
  close: () => void;
}) {
  const [filter, setFilter] = useState<string>('all'); // 'all' | 'unsold' | playerId
  const [sortBy, setSortBy] = useState<BoardSort>('board');

  // Dueño (y estado de hipoteca) por propiedad.
  const ownerOf = new Map<string, BoardOwn>();
  for (const p of state.players) {
    for (const h of p.holdings) ownerOf.set(h.propertyId, { player: p, mortgaged: h.mortgaged, houses: h.houses });
  }
  const sinVender = BOARD.filter((p) => !ownerOf.has(p.id)).length;
  const hipotecadas = BOARD.filter((p) => ownerOf.get(p.id)?.mortgaged).length;
  const left = bankBuildingsLeft(state);

  const sortFns: Record<BoardSort, (a: Property, b: Property) => number> = {
    board: (a, b) => a.def.boardIndex - b.def.boardIndex,
    price: (a, b) => a.price - b.price,
    group: (a, b) => GROUP_ORDER.indexOf(a.colorGroup) - GROUP_ORDER.indexOf(b.colorGroup) || a.def.boardIndex - b.def.boardIndex,
  };
  const board = BOARD
    .filter((p) => {
      if (filter === 'all') return true;
      if (filter === 'unsold') return !ownerOf.has(p.id);
      return ownerOf.get(p.id)?.player.id === filter; // por jugador
    })
    .sort(sortFns[sortBy]);

  return (
    <div className="form">
      <h2>🗺️ Tablero — propiedades</h2>
      <div className="boardsummary">
        <span>🏷️ Sin vender: <b>{sinVender}</b></span>
        <span>🏦 Hipotecadas: <b>{hipotecadas}</b></span>
        <span>🏠 Casas disp.: <b>{left.houses}</b></span>
        <span>🏨 Hoteles disp.: <b>{left.hotels}</b></span>
      </div>

      <div className="chips">
        <button className={filter === 'all' ? 'chip chip--on' : 'chip'} onClick={() => setFilter('all')}>Todas</button>
        <button className={filter === 'unsold' ? 'chip chip--on' : 'chip'} onClick={() => setFilter('unsold')}>Sin vender</button>
        {state.players.map((p) => (
          <button key={p.id} className={filter === p.id ? 'chip chip--on' : 'chip'} onClick={() => setFilter(p.id)}>
            {p.icon} {p.name}
          </button>
        ))}
      </div>
      <div className="chips">
        <span className="hint" style={{ alignSelf: 'center' }}>Orden:</span>
        <button className={sortBy === 'board' ? 'chip chip--on' : 'chip'} onClick={() => setSortBy('board')}>Tablero</button>
        <button className={sortBy === 'price' ? 'chip chip--on' : 'chip'} onClick={() => setSortBy('price')}>Precio</button>
        <button className={sortBy === 'group' ? 'chip chip--on' : 'chip'} onClick={() => setSortBy('group')}>Grupo</button>
      </div>

      <ul className="boardlist">
        {board.length === 0 && <p className="hint">Sin propiedades para este filtro.</p>}
        {board.map((prop) => {
          const own = ownerOf.get(prop.id);
          const g = GROUPS[prop.colorGroup].color;
          return (
            <li key={prop.id} className={`boardrow ${own?.mortgaged ? 'boardrow--mortgaged' : ''}`}>
              <span className="boardrow__band" style={{ background: g }} />
              <span className="boardrow__main">
                <span className="boardrow__name">{prop.def.emoji} {prop.name}</span>
                <span className="boardrow__meta">💰 {money(prop.price)} · 🏠 {rentSummary(prop, own, money)} · 🏦 {money(prop.mortgageValue)}</span>
              </span>
              <span className="boardrow__owner">
                {own ? (
                  <span style={{ color: PLAYER_COLOR(own.player.colorIndex) }}>
                    {own.player.icon} {own.player.name}
                    {own.houses > 0 && ` · ${own.houses >= 5 ? '🏨' : '🏠'.repeat(own.houses)}`}
                    {own.mortgaged && ' · 🏦'}
                  </span>
                ) : (
                  <span className="hint">sin dueño</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <button className="confirm" onClick={close}>Cerrar</button>
    </div>
  );
}

function IdentityPicker({ players, onPick, deviceId, code, onNewRoom }: {
  players: RuntimePlayer[];
  onPick: (id: string) => void;
  deviceId: string;
  code: string;
  onNewRoom: () => void;
}) {
  return (
    <div className="setup">
      <h1>¿Quién usa este dispositivo? <span className="code">Sala {code}</span></h1>
      <p className="hint">Elige tu jugador: solo podrás mover tu propio dinero. Los administradores 🛡️ pueden operar a todos.</p>
      <div className="idgrid">
        {players.map((p) => {
          // Un jugador tomado por OTRO dispositivo no puede robarse (sí re-confirmar el propio).
          const taken = !!p.claimedBy && p.claimedBy !== deviceId;
          return (
            <button
              key={p.id}
              className={`idbtn ${taken ? 'idbtn--taken' : ''}`}
              style={{ borderColor: PLAYER_COLOR(p.colorIndex) }}
              disabled={taken}
              title={taken ? 'En uso en otro dispositivo' : ''}
              onClick={() => onPick(p.id)}
            >
              <span className="idbtn__icon">{p.icon}</span>
              <span>{p.name} {p.admin && '🛡️'} {taken && '🔒'}</span>
            </button>
          );
        })}
      </div>
      <h2>O como pantalla</h2>
      <p className="hint">Ideal para un móvil/TV en la mesa que muestre la partida a todos, sin jugar.</p>
      <button className="idbtn idbtn--tv" onClick={() => onPick(VIEWER)}>
        <span className="idbtn__icon">📺</span>
        <span>Solo ver (modo TV)</span>
      </button>

      <h2>¿No es tu partida?</h2>
      <p className="hint">Sal de esta sala y crea una nueva para empezar de cero.</p>
      <button className="confirm" onClick={onNewRoom}>➕ Crear una sala nueva</button>
    </div>
  );
}

/**
 * Selector de modalidades de cartas: un desplegable por modalidad, con el
 * interruptor en la cabecera y el listado completo de sus cartas dentro.
 */
function CardPacksPanel({ packs, setPacks, sym }: {
  packs: string[];
  setPacks: (packs: string[]) => void;
  sym: string;
}) {
  const total = CARDS.filter((c) => packs.includes(c.pack)).length;
  const toggle = (id: string, on: boolean) =>
    setPacks(on ? [...packs, id] : packs.filter((x) => x !== id));

  return (
    <>
      <h2>Cartas — modalidades de juego</h2>
      <p className="hint">
        Los mazos de 📦 Arca Comunal y ❓ Fortuna se arman al empezar la partida.
        Ahora mismo: <b>{total} cartas</b> en juego.
      </p>
      <div className="packs">
        {Object.entries(PACKS).map(([id, pack]) => {
          const on = packs.includes(id);
          const cards = CARDS.filter((c) => c.pack === id);
          return (
            <details key={id} className={`pack ${on ? 'pack--on' : ''}`} style={{ ['--pack-color' as string]: pack.color }}>
              <summary className="pack__head">
                <span className="pack__emoji">{pack.emoji}</span>
                <span className="pack__body">
                  <b>{pack.label}</b> <small>{packSize(id)} cartas</small>
                  <br /><span className="hint">{pack.desc}</span>
                </span>
                <span className="pack__toggle" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={pack.fixed}
                    title={pack.fixed ? 'Siempre activa' : on ? 'Quitar del juego' : 'Añadir al juego'}
                    onChange={(e) => toggle(id, e.target.checked)}
                  />
                </span>
              </summary>
              {pack.todo && <p className="pack__todo">⚠️ {pack.todo}</p>}
              <ul className="pack__cards">
                {cards.map((c) => (
                  <li key={c.id}>
                    <span className="pack__cardemoji">{c.emoji}</span>
                    <span className="pack__cardtext">{cardText(c, sym)}</span>
                    <span className={`pack__tag ${isAutomatic(c.effect) ? 'pack__tag--auto' : ''}`}>
                      {DECKS[c.deck].emoji} {isAutomatic(c.effect) ? 'automática' : 'manual'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </>
  );
}

function SetupScreen({ state, act, share, onJoin, onNewRoom }: {
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  share: () => void;
  onJoin: (code: string) => void;
  onNewRoom: () => void;
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
        <button onClick={onNewRoom} title="Empezar de cero en una sala con código nuevo">➕ Sala nueva</button>
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

      <CardPacksPanel packs={s.cardPacks} setPacks={(cardPacks) => setS({ cardPacks })} sym={state.currencySymbol} />
      {s.cardPacks.includes('parada-libre') && (
        <label className="setrow setrow--num">
          <span>
            <b>Tope de fichas de giro</b><br />
            <span className="hint">
              Máximo que se puede acumular perdonando rentas. Evita que dos jugadores pacten
              no cobrarse para fabricar fichas gratis del banco. 0 = sin tope.
            </span>
          </span>
          <input type="number" min={0} max={9} value={s.maxSpins}
            onChange={(e) => setS({ maxSpins: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
        </label>
      )}

      <button className="confirm setup__start" disabled={state.players.length < 1} onClick={() => act({ type: 'START_GAME' })}>
        ▶ Empezar partida
      </button>
    </div>
  );
}
