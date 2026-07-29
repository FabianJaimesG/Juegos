import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { PropertyCard } from './components/PropertyCard';
import { WealthChart } from './components/WealthChart';
import { BOARD, getProperty, GROUPS } from './domain/board';
import { activeDecks, CARDS, cardText, DECKS, getCard, getWheelFace, isAutomatic, PACKS, packSize, WHEEL, wheelShort, wheelText, type DeckId } from './domain/cards';
import {
  bankBuildingsLeft,
  canCancelTrade,
  canRespondToTrade,
  createGame,
  diceSummary,
  whyCannotUseCard,
  winnerOf,
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
  | { kind: 'history' }
  | { kind: 'hand'; playerId: string }
  | { kind: 'forceswap'; playerId: string };

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
  // Oculta la carta/ruleta en ESTE dispositivo sin resolverla (sigue pendiente
  // para todos). Evita que una carta que no puedes pagar bloquee la pantalla.
  const [hiddenCard, setHiddenCard] = useState<string | null>(null);
  // El anuncio de victoria se puede cerrar para seguir mirando el tablero.
  const [winnerSeen, setWinnerSeen] = useState<string | null>(null);

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

  const winner = winnerOf(state);

  // Responder una negociación NO va por `canControl` (ver engine).
  const canRespondTrade = canRespondToTrade(state, me?.id ?? null, amAdmin);

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
            {activeDecks(state.settings.cardPacks)
              // Bonificación no se roba en el turno: se reparte al empezar o al
              // caer en la Parada Libre, y va directo a la mano.
              .filter((d) => d !== 'bonificacion')
              // En Parada Libre las cartas vienen de la ruleta/Bonificación:
              // no se roban Fortuna ni Arca en el turno.
              .filter((d) => !state.settings.cardPacks.includes('parada-libre') || (d !== 'arca' && d !== 'fortuna'))
              .map((d) => (
                <button
                  key={d}
                  className="deckbtn"
                  style={{ ['--deck-color' as string]: DECKS[d].color }}
                  disabled={!myTurn || !!state.drawnCard || deckLeft(state, d) === 0 || turnPlayer.jail > 0}
                  title={turnPlayer.jail > 0 ? 'En la cárcel no te mueves: no se roban cartas' : `${DECKS[d].label} — ${deckLeft(state, d)} cartas`}
                  onClick={() => act({ type: 'DRAW_CARD', deck: d, playerId: turnPlayer.id })}
                >
                  {DECKS[d].emoji} <small>{deckLeft(state, d)}</small>
                </button>
              ))}
          </span>
          <span className="turnbar__btns">
            <button onClick={() => act({ type: 'NEXT_TURN' })} disabled={!myTurn} title={myTurn ? '' : 'Solo el jugador en turno puede pasar'}>
              {myTurn ? 'Siguiente turno →' : '🔒 Siguiente turno'}
            </button>
          </span>
        </div>
      )}

      {state.settings.cardPacks.includes('parada-libre') && (
        <ParadaLibreBar state={state} act={act} money={money} me={me} canControl={canControl} revealWheel={() => setHiddenCard(null)} />
      )}

      {winner && winnerSeen !== winner.id && (
        <WinnerBanner
          winner={winner}
          money={money}
          onClose={() => setWinnerSeen(winner.id)}
          onEnd={amAdmin ? () => { setWinnerSeen(winner.id); act({ type: 'END_GAME' }); } : undefined}
        />
      )}

      {state.wheel && hiddenCard !== 'wheel' && (
        <WheelModal
          state={state}
          act={act}
          canAct={canControl(state.wheel.playerId)}
          onHide={() => setHiddenCard('wheel')}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      )}

      {state.drawnCard && hiddenCard === state.drawnCard.cardId && (
        <button className="pendingcard" onClick={() => setHiddenCard(null)}>
          📩 Carta pendiente de {state.players.find((p) => p.id === state.drawnCard!.playerId)?.name} — ver
        </button>
      )}

      {state.drawnCard && hiddenCard !== state.drawnCard.cardId && (
        <CardModal
          drawn={state.drawnCard}
          state={state}
          act={act}
          money={money}
          canAct={canControl(state.drawnCard.playerId)}
          onHide={() => setHiddenCard(state.drawnCard!.cardId)}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      )}

      {state.pendingTrade && (
        <PendingTradeBanner
          trade={state.pendingTrade}
          players={state.players}
          act={act}
          money={money}
          canRespond={canRespondTrade}
          canCancel={canCancelTrade(state, me?.id ?? null, amAdmin)}
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
            onJail={() => act({ type: 'GO_TO_JAIL', playerId: p.id })}
            onPayBail={() => act({ type: 'PAY_BAIL', playerId: p.id })}
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
              goForceSwap={(playerId) => setSheet({ kind: 'forceswap', playerId })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerTile({
  p, money, isCurrent, canControl, canTrade, isSelf, onOpen, onSalida, onBankrupt,
  onJail, onPayBail, hasLimo, bailText, jailTurns,
}: {
  p: RuntimePlayer;
  money: (n: number) => string;
  isCurrent: boolean;
  canControl: boolean;
  canTrade: boolean;
  isSelf: boolean;
  onOpen: (k: Sheet['kind']) => void;
  onSalida: () => void;
  onBankrupt: () => void;
  onJail: () => void;
  onPayBail: () => void;
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
        <span className="ptile__name">{p.icon} {p.name} {isCurrent && '⭐'} {p.admin && '🛡️'} {hasLimo && <span className="limo" title="Limusina dorada">🚗</span>} {p.jail > 0 && '🚔'} {p.bankrupt && '💀'}</span>
        {canControl && <button className="ptile__edit" title="Editar personaje" onClick={() => onOpen('edit')}>✏️</button>}
      </div>
      <div className="ptile__cash">{money(p.cash)}</div>
      <div className="ptile__stats">
        <span title="Patrimonio total (efectivo + propiedades + casas)">💎 {money(nw)}</span>
        <span title="Propiedades">🏷️ {p.holdings.length}</span>
        <span title="Casas / Hoteles">🏠 {b.houses} · 🏨 {b.hotels}</span>
        {p.spins > 0 && <span title="Fichas para girar la ruleta">🎡 {p.spins}</span>}
      </div>
      {p.jail > 0 && (
        <div className="ptile__jail">
          <span>🚔 En la cárcel · turno {p.jail}/{jailTurns} · sales solo al {jailTurns}.º</span>
          {canControl && (
            <span className="ptile__jailbtns">
              <button onClick={onPayBail} title={`Pagar la fianza (${bailText}) y salir ya`}>Fianza {bailText}</button>
            </span>
          )}
        </div>
      )}
      {p.tokens.length > 0 && (
        <button className="ptile__hand" onClick={() => onOpen('hand')} title="Ver tus cartas y decidir cuándo usarlas">
          {p.tokens.slice(0, 6).map((cardId, i) => (
            <span key={`${cardId}-${i}`} className="ptile__card">{getCard(cardId)?.emoji ?? '🃏'}</span>
          ))}
          <span className="ptile__handmore">{p.tokens.length} carta{p.tokens.length > 1 ? 's' : ''} ›</span>
        </button>
      )}
      <div className="ptile__btns">
        {canControl ? (
          <>
            <button className="b-in" onClick={() => onOpen('collect')}>Cobrar</button>
            <button className="b-out" onClick={() => onOpen('pay')}>Pagar</button>
            <button className="b-prop" onClick={() => onOpen('props')}>Propiedades</button>
            <button className="b-salida" onClick={onSalida} disabled={p.jail > 0} title={p.jail > 0 ? 'En la cárcel no pasas por SALIDA' : ''}>🟢 Salida</button>
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
  sheet, state, act, money, history, canControl, canEditRules, close, goMarket, goForceSwap,
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
  goForceSwap: (playerId: string) => void;
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

  if (sheet.kind === 'forceswap') {
    const others = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    return <ForceSwapPanel me={me} others={others} act={act} close={close} />;
  }

  if (sheet.kind === 'hand') {
    return <HandPanel me={me} state={state} act={act} sym={state.currencySymbol} readOnly={!mine} close={close} />;
  }

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
    const canPayRent = !!turnPlayer && !turnPlayer.bankrupt && turnPlayer.jail === 0 && canControl(turnPlayer.id) && turnPlayer.id !== me.id;
    const diceTotal = state.dice ? state.dice.a + state.dice.b : null;
    return (
      <PropsPanel
        me={me}
        act={act}
        money={money}
        readOnly={!mine}
        evenBuild={state.settings.evenBuild}
        goMarket={() => goMarket(me.id)}
        goForceSwap={() => goForceSwap(me.id)}
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
  me, act, money, readOnly, evenBuild, goMarket, goForceSwap, onPayRent, payerName, diceTotal,
}: {
  me: RuntimePlayer;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  readOnly?: boolean;
  evenBuild: boolean;
  goMarket: () => void;
  goForceSwap: () => void;
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
      {!readOnly && me.freeHouses > 0 && (
        <p className="perk">🏠 Tienes <b>{me.freeHouses}</b> casa{me.freeHouses > 1 ? 's' : ''} gratis: elige abajo dónde colocarla{me.freeHouses > 1 ? 's' : ''}.</p>
      )}
      {!readOnly && me.forceSwaps > 0 && (
        <p className="perk">
          🔀 Tienes <b>{me.forceSwaps}</b> intercambio{me.forceSwaps > 1 ? 's' : ''} forzoso{me.forceSwaps > 1 ? 's' : ''}:
          <button className="perk__btn" onClick={goForceSwap}>elegir propiedades</button>
        </p>
      )}
      {!readOnly && me.freeProps > 0 && (
        <p className="perk">🎁 Tienes <b>{me.freeProps}</b> propiedad{me.freeProps > 1 ? 'es' : ''} gratis: tómala en 🛒 Comprar propiedad.</p>
      )}
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
                    <button disabled={!buildable || me.cash - prop.houseCost < 1} onClick={() => act({ type: 'BUILD_HOUSE', playerId: me.id, propertyId: h.propertyId })}>
                      +🏠 {money(prop.houseCost)}
                    </button>
                    {/* Casa gratis pendiente: se coloca donde el jugador elija,
                        saltándose grupo completo y construcción pareja. */}
                    {me.freeHouses > 0 && !h.mortgaged && h.houses < 5 && (
                      <button
                        className="owned__free"
                        title="Colocar aquí tu casa gratis (no necesitas el grupo completo)"
                        onClick={() => act({ type: 'BUILD_HOUSE', playerId: me.id, propertyId: h.propertyId, free: true })}
                      >
                        +🏠 gratis
                      </button>
                    )}
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
  // "Gratis" aparece solo si el jugador tiene derecho AHORA: un crédito de
  // "propiedad gratis" sin gastar, o la limusina dorada.
  const withLimo = state.limoPlayerId === me.id;
  const freebie = me.freeProps > 0 || withLimo;

  return (
    <div className="form">
      <h2>🛒 Comprar propiedad — {me.name}</h2>
      <p className="hint">Efectivo: {money(me.cash)} · Casas banco: {left.houses} · Hoteles: {left.hotels}</p>
      {me.jail > 0 && <p className="gcard__warn">🚔 Estás en la cárcel: no te mueves, así que no puedes comprar propiedades hasta salir.</p>}
      {freebie && (
        <p className="hint">
          🎁 Puedes quedarte una propiedad <b>gratis</b>
          {withLimo ? ' mientras lleves la limusina dorada.' : ` (te quedan ${me.freeProps}).`}
        </p>
      )}
      <div className="market">
        {available.map((prop) => (
          <div key={prop.id} className="market__item">
            <PropertyCard property={prop} compact />
            <button
              className="buy"
              disabled={me.cash - prop.price < 1 || me.jail > 0}
              onClick={() => { act({ type: 'BUY_PROPERTY', playerId: me.id, propertyId: prop.id }); }}
            >
              Comprar {money(prop.price)}
            </button>
            {/* "Propiedad gratis" (carta o ruleta de Parada Libre): se queda sin pagar. */}
            {freebie && (
              <button
                className="market__free"
                disabled={me.jail > 0}
                title="Usar tu carta de propiedad gratis: te la quedas sin pagar"
                onClick={() => { act({ type: 'BUY_PROPERTY', playerId: me.id, propertyId: prop.id, free: true }); close(); }}
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

/**
 * Cartas guardadas de un jugador: se ven enteras y se usan cuando él decide.
 * Las de Bonificación se acumulan aquí en vez de aplicarse al robarlas.
 */
function HandPanel({ me, state, act, sym, readOnly, close }: {
  me: RuntimePlayer;
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  sym: string;
  readOnly: boolean;
  close: () => void;
}) {
  return (
    <div className="form">
      <h2>🃏 Cartas de {me.name}</h2>
      <p className="hint">
        Guárdalas el tiempo que quieras y úsalas en el momento que te convenga.
        También se pueden intercambiar en una negociación.
      </p>
      {me.tokens.length === 0 && <p className="hint">No tiene cartas guardadas.</p>}
      <div className="hand">
        {me.tokens.map((cardId, i) => {
          const c = getCard(cardId);
          if (!c) return null;
          const deck = DECKS[c.deck];
          const why = whyCannotUseCard(state, me, cardId);
          return (
            <article key={`${cardId}-${i}`} className="handcard" style={{ ['--deck-color' as string]: deck.color }}>
              <header className="handcard__band">{deck.emoji} {deck.label}</header>
              <div className="handcard__emoji">{c.emoji}</div>
              <p className="handcard__text">{cardText(c, sym)}</p>
              {!readOnly && (
                <>
                  <button
                    className="confirm"
                    disabled={!!why}
                    title={why ?? ''}
                    onClick={() => { act({ type: 'USE_CARD', playerId: me.id, cardId }); }}
                  >
                    Usar ahora
                  </button>
                  {why && <p className="handcard__why">{why}</p>}
                </>
              )}
            </article>
          );
        })}
      </div>
      <button className="confirm" onClick={close}>Cerrar</button>
    </div>
  );
}

/**
 * Intercambio forzoso: misma mecánica de elegir propiedades que una
 * negociación, pero sin dinero y sin que la otra parte tenga que aceptar.
 * Lo habilita la carta 🔀 de Bonificación.
 */
function ForceSwapPanel({ me, others, act, close }: {
  me: RuntimePlayer;
  others: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  close: () => void;
}) {
  const [otherId, setOtherId] = useState<string>(others[0]?.id ?? '');
  const [mine, setMine] = useState<string>('');
  const [theirs, setTheirs] = useState<string>('');
  const other = others.find((p) => p.id === otherId);

  if (!other) return <div className="form"><h2>🔀 Intercambio forzoso</h2><p className="hint">No hay otros jugadores.</p></div>;

  const swappable = (p: RuntimePlayer) => p.holdings.filter((h) => h.houses === 0);
  const valid = !!mine && !!theirs;

  const column = (p: RuntimePlayer, sel: string, setSel: (v: string) => void, label: string) => (
    <div className="tradecol">
      <h3>{label}: {p.icon} {p.name}</h3>
      <div className="tradeprops">
        {swappable(p).length === 0 && <p className="hint">Sin propiedades sin casas.</p>}
        {swappable(p).map((h) => {
          const prop = getProperty(h.propertyId)!;
          return (
            <div
              key={h.propertyId}
              className={sel === h.propertyId ? 'tradeprop tradeprop--on' : 'tradeprop'}
              onClick={() => setSel(sel === h.propertyId ? '' : h.propertyId)}
            >
              <PropertyCard property={prop} mortgaged={h.mortgaged} compact />
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="form">
      <h2>🔀 Intercambio forzoso</h2>
      <p className="hint">
        Elige <b>tú</b> qué propiedad das y cuál te llevas. No se negocia dinero y
        <b> el otro jugador no tiene que aceptar</b>. Solo propiedades sin casas.
      </p>
      {others.length > 1 && (
        <div className="chips">
          {others.map((o) => (
            <button key={o.id} className={o.id === otherId ? 'chip chip--on' : 'chip'} onClick={() => { setOtherId(o.id); setTheirs(''); }}>
              {o.icon} {o.name}
            </button>
          ))}
        </div>
      )}
      <div className="tradegrid">
        {column(me, mine, setMine, 'Das')}
        {column(other, theirs, setTheirs, 'Te llevas')}
      </div>
      <button
        className="confirm"
        disabled={!valid}
        onClick={() => {
          act({ type: 'FORCE_SWAP', aId: me.id, bId: other.id, aProp: mine, bProp: theirs });
          close();
        }}
      >
        {valid ? `Forzar el cambio con ${other.name}` : 'Elige una propiedad de cada lado'}
      </button>
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
    aSpins === 0 && bSpins === 0;
  const valid =
    !nothing && me.cash >= nA && other.cash >= nB &&
    me.spins >= aSpins && other.spins >= bSpins;

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
        {column(me, aCash, setACash, aProps, setAProps, aCards, setACards, aSpins, setASpins)}
        {column(other, bCash, setBCash, bProps, setBProps, bCards, setBCards, bSpins, setBSpins)}
      </div>
      <button
        className="confirm"
        disabled={!valid}
        onClick={() => {
          act({
            type: 'PROPOSE_TRADE',
            trade: {
              aId: me.id, bId: other.id, aCash: nA, bCash: nB, aProps, bProps,
              aCards: aCardIds, bCards: bCardIds, aSpins, bSpins,
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
    // Tirada más larga y visible antes de mostrar el resultado.
    const iv = setInterval(() => setFaces([rand6(), rand6()]), 70);
    setTimeout(() => {
      clearInterval(iv);
      setRolling(false);
      onRoll();
    }, 1100);
  };
  const a = rolling ? faces[0] : dice?.a ?? 1;
  const b = rolling ? faces[1] : dice?.b ?? 1;
  return (
    <span className="turnbar__dice">
      <span className={`die ${rolling ? 'die--rolling' : ''}`}>{DICE_FACES[a - 1]}</span>
      <span className={`die ${rolling ? 'die--rolling' : ''}`}>{DICE_FACES[b - 1]}</span>
      {!rolling && dice && (() => {
        // Lo que se muestra es lo mismo que se dice: con dobles, el doble ya
        // hecho; con +6, el total; y al elegir, "x o y o z" bien visible.
        const out = diceSummary(dice);
        return (
          <>
            <span className={`turnbar__total ${out.choose ? 'turnbar__total--choose' : ''}`}>
              = {out.text}
            </span>
            {dice.special && <span className="turnbar__sp">{dice.special}</span>}
          </>
        );
      })()}
      {canRoll && <button onClick={roll} disabled={rolling}>{rolling ? '…' : 'Tirar'}</button>}
    </span>
  );
}

/**
 * Barra de la modalidad Parada Libre: el bote acumulado y quién lleva la
 * limusina dorada. El bote se alimenta a mano (impuestos, multas, ruleta)
 * porque la app no sabe en qué casilla cae cada ficha.
 */
function ParadaLibreBar({ state, act, money, me, canControl, revealWheel }: {
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  me: RuntimePlayer | null;
  canControl: (pid: string) => boolean;
  revealWheel: () => void;
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
            title="Cuánto paga el jugador en turno al bote"
          />
          <button
            onClick={() => act({ type: 'POT_ADD', amount, playerId: turn.id })}
            title={`${turn.name} deja este dinero en el bote`}
          >
            + {turn.icon} al bote
          </button>
          <button
            className="parada__take"
            disabled={state.pot <= 0 || turn.jail > 0}
            onClick={() => act({ type: 'POT_TAKE', playerId: turn.id })}
            title={turn.jail > 0 ? 'En la cárcel no puedes caer en la Parada Libre' : 'El jugador en turno se lleva el Gran Premio (todo el bote)'}
          >
            🎰 Gran Premio
          </button>
        </span>
      )}

      <span className={`parada__limo ${limo ? 'parada__limo--on' : ''}`} title="La limusina dorada: te quedas gratis las propiedades libres y no pagas renta">
        <span className="limo">🚗</span> {limo ? `${limo.icon} ${limo.name}` : 'sin dueño'}
      </span>
      {me && (
        <button
          className="parada__land"
          disabled={me.jail > 0}
          title={me.jail > 0 ? 'En la cárcel no puedes caer en la Parada Libre' : 'Caíste en la casilla: te llevas el Gran Premio, la limusina y una tarjeta de Bonificación'}
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
          disabled={me.spins <= 0 || me.jail > 0}
          title={
            me.jail > 0 ? 'No puedes girar en la cárcel'
              : me.spins > 0 ? 'Gasta una ficha y gira la ruleta'
                : 'No te quedan fichas de giro'
          }
          onClick={() => { revealWheel(); act({ type: 'SPIN_WHEEL', playerId: me.id }); }}
        >
          🎡 Girar ({me.spins})
        </button>
      )}
      {canAct && <RentToSpin state={state} act={act} turnName={turn.name} />}
    </div>
  );
}

/**
 * Acción del turno: el jugador cayó en una propiedad ajena y decidió no cobrar
 * la renta. En vez de eso, entrega una ficha de giro 🎡 al DUEÑO de esa
 * propiedad. Solo aparecen los dueños que están jugando, tienen alguna
 * propiedad sin hipotecar y no superan el tope de fichas configurado.
 */
function RentToSpin({ state, act, turnName }: {
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  turnName: string;
}) {
  const [open, setOpen] = useState(false);
  const max = state.settings.maxSpins;
  const turnInJail = (state.players[state.turnIndex]?.jail ?? 0) > 0;
  const eligible = state.players.filter(
    (p) =>
      !p.bankrupt &&
      p.holdings.some((h) => !h.mortgaged) &&
      (max === 0 || p.spins < max),
  );

  return (
    <span className="rent2spin">
      <button
        className="parada__claim"
        disabled={eligible.length === 0 || turnInJail}
        title={
          turnInJail
            ? 'En la cárcel no caes en propiedades: no hay renta que perdonar'
            : eligible.length === 0
              ? 'Nadie puede recibir la ficha: sin propiedades sin hipotecar o ya llegaron al tope'
              : `${turnName} cayó en una propiedad y no cobra la renta: entrega una ficha de giro a su dueño${max > 0 ? ` (tope: ${max})` : ''}`
        }
        onClick={() => setOpen((v) => !v)}
      >
        🤝 Renta → ficha ▾
      </button>
      {open && (
        <span className="rent2spin__menu">
          {eligible.map((p) => (
            <button
              key={p.id}
              className="rent2spin__opt"
              title={`Entregar una ficha de giro a ${p.name} (tiene ${p.spins})`}
              onClick={() => {
                act({ type: 'RENT_TO_SPIN', ownerId: p.id });
                setOpen(false);
              }}
            >
              {p.icon} {p.name} · 🎡 {p.spins}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** Anuncio de victoria: queda un solo jugador sin bancarrota. */
function WinnerBanner({ winner, money, onClose, onEnd }: {
  winner: RuntimePlayer;
  money: (n: number) => string;
  onClose: () => void;
  onEnd?: () => void;
}) {
  return (
    <div className="overlay overlay--card">
      <div className="winner">
        <div className="winner__cup">🏆</div>
        <h2 className="winner__name">{winner.icon} {winner.name}</h2>
        <p className="winner__sub">¡Gana la partida!</p>
        <p className="winner__worth">
          Patrimonio final: <b>{money(playerNetWorth(winner))}</b>
          <br />
          <span className="hint">
            {money(winner.cash)} en efectivo · {winner.holdings.length} propiedades
          </span>
        </p>
        <div className="gcard__btns">
          {onEnd && <button className="confirm" onClick={onEnd}>🏁 Terminar y volver a preparación</button>}
          <button className="gcard__later" onClick={onClose}>Seguir viendo el tablero</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Liquidar sin salir de la carta: hipotecar o vender casas para reunir el pago.
 * Aparece dentro del modal cuando el jugador no tiene efectivo suficiente.
 */
function LiquidateBox({ me, act, money }: {
  me: RuntimePlayer;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
}) {
  const rows = [...me.holdings].sort((a, b) => holdingSortKey(a.propertyId) - holdingSortKey(b.propertyId));
  if (rows.length === 0) return <p className="gcard__hint">No tienes nada que liquidar.</p>;
  return (
    <div className="liq">
      <p className="liq__title">🏦 Liquidar para pagar</p>
      {rows.map((h) => {
        const prop = getProperty(h.propertyId)!;
        return (
          <div key={h.propertyId} className="liq__row">
            <span className="liq__name">{prop.name}{h.houses > 0 && ` · ${h.houses >= 5 ? '🏨' : '🏠'.repeat(h.houses)}`}</span>
            {h.houses > 0 ? (
              <button onClick={() => act({ type: 'SELL_HOUSE', playerId: me.id, propertyId: h.propertyId })}>
                Vender casa +{money(Math.round(prop.houseCost * 0.5))}
              </button>
            ) : !h.mortgaged ? (
              <button onClick={() => act({ type: 'MORTGAGE', playerId: me.id, propertyId: h.propertyId })}>
                Hipotecar +{money(prop.mortgageValue)}
              </button>
            ) : (
              <span className="liq__done">hipotecada</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Ruleta a pantalla completa: gira de verdad hasta dejar el sector ganador bajo
 * el puntero. Los ocho sectores llevan escrito lo que dan.
 */
function WheelModal({ state, act, canAct, onHide, undo, redo, canUndo, canRedo }: {
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  canAct: boolean;
  onHide: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const w = state.wheel!;
  const face = getWheelFace(w.faceId);
  const idx = WHEEL.findIndex((f) => f.id === w.faceId);
  const player = state.players.find((p) => p.id === w.playerId);
  const [spinning, setSpinning] = useState(true);

  // Ángulo final: centra el sector ganador arriba (donde está el puntero),
  // tras varias vueltas completas para que se vea el giro.
  const seg = 360 / WHEEL.length;
  const target = 360 * 5 - (idx * seg + seg / 2);

  useEffect(() => {
    setSpinning(true);
    const t = setTimeout(() => setSpinning(false), 3200);
    return () => clearTimeout(t);
  }, [w.faceId, w.playerId]);

  if (!face || !player) return null;
  const good = face.tone === 'good';
  const R = 130;

  // Un sector = arco entre dos radios.
  const sector = (i: number) => {
    const a0 = ((i * seg - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
    const x0 = 150 + R * Math.cos(a0), y0 = 150 + R * Math.sin(a0);
    const x1 = 150 + R * Math.cos(a1), y1 = 150 + R * Math.sin(a1);
    return `M150,150 L${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
  };

  return (
    <div className="overlay overlay--card">
      <div className="wheel" style={{ ['--tone' as string]: good ? '#16a34a' : '#dc2626' }}>
        <header className="wheel__band">🎡 LA RULETA</header>
        <HistoryControls undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />

        <div className="wheel__stage">
          <span className="wheel__pointer" />
          <svg
            viewBox="0 0 300 300"
            className={`wheel__svg ${spinning ? 'is-spinning' : ''}`}
            style={{ ['--spin' as string]: `${target}deg` }}
          >
            {WHEEL.map((f, i) => {
              const mid = ((i * seg + seg / 2 - 90) * Math.PI) / 180;
              const tx = 150 + R * 0.66 * Math.cos(mid);
              const ty = 150 + R * 0.66 * Math.sin(mid);
              const rot = i * seg + seg / 2;
              return (
                <g key={f.id}>
                  <path d={sector(i)} fill={f.tone === 'good' ? '#16a34a' : '#dc2626'} stroke="#0b1f17" strokeWidth="1.5" />
                  <text
                    x={tx} y={ty}
                    transform={`rotate(${rot} ${tx} ${ty})`}
                    textAnchor="middle" dominantBaseline="middle"
                    fill="#fff" fontSize="13" fontWeight="700"
                  >
                    {wheelShort(f, state.currencySymbol)}
                  </text>
                </g>
              );
            })}
            <circle cx="150" cy="150" r="26" fill="#0b1f17" stroke="#eab308" strokeWidth="3" />
          </svg>
        </div>

        {!spinning && (
          <>
            <p className="wheel__text">{face.emoji} {wheelText(face, state.currencySymbol)}</p>
            <div className="wheel__who">{player.icon} <b>{player.name}</b></div>
          </>
        )}
        {spinning && <p className="wheel__text">Girando…</p>}

        <div className="gcard__btns">
          {canAct
            ? <button className="confirm" disabled={spinning} onClick={() => act({ type: 'CLOSE_WHEEL' })}>Continuar</button>
            : <p className="gcard__hint">Girando para {player.name}…</p>}
          <button className="gcard__later" onClick={onHide}>Ocultar</button>
        </div>
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
 * Deshacer/rehacer dentro de un modal (carta o ruleta). El modal cubre la
 * cabecera, así que sin esto no se podría seguir deshaciendo un error hecho en
 * una carta. Nunca se bloquea por la animación: solo por el historial.
 */
function HistoryControls({ undo, redo, canUndo, canRedo }: {
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
}) {
  return (
    <div className="modalhist">
      <button onClick={undo} disabled={!canUndo} title="Deshacer">↶ Deshacer</button>
      <button onClick={redo} disabled={!canRedo} title="Rehacer">↷ Rehacer</button>
    </div>
  );
}

/**
 * Carta robada, a pantalla completa y visible para toda la sala.
 * Solo quien controla al jugador puede resolverla.
 */
function CardModal({ drawn, state, act, money, canAct, onHide, undo, redo, canUndo, canRedo }: {
  drawn: NonNullable<GameState['drawnCard']>;
  state: GameState;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  canAct: boolean;
  onHide: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
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
  let owed = 0; // lo que la carta le va a cobrar (para avisar si no le alcanza)
  if (e.kind === 'bank_charge') owed = e.amount;
  if (e.kind === 'pay_each') owed = e.amount * state.players.filter((p) => p.id !== player.id && !p.bankrupt).length;
  if (e.kind === 'pay_percent') owed = Math.round((e.of === 'cash' ? player.cash : playerNetWorth(player)) * e.rate);
  if (e.kind === 'pay_per_property') owed = player.holdings.length * e.amount;
  if (e.kind === 'pay_richest') owed = e.amount;
  if (e.kind === 'repairs') {
    const b = playerBuildings(player);
    const total = b.houses * e.perHouse + b.hotels * e.perHotel;
    owed = total;
    action = total > 0
      ? `Pagar ${money(total)} (${b.houses}🏠 · ${b.hotels}🏨)`
      : 'Sin construcciones: no pagas nada';
  }
  // No le alcanza: el botón no haría nada. Hay que decirlo y dar salida real.
  const short = owed > 0 && player.cash - owed < 1;
  // Cartas que cobran a los demás: puede que sea OTRO el que no puede pagar.
  const debtors = e.kind === 'collect_each'
    ? state.players.filter((p) => p.id !== player.id && !p.bankrupt && p.cash - e.amount < 1)
    : [];
  const blocked = short || debtors.length > 0;
  if (card.keep) action = 'Guardar carta';

  return (
    <div className="overlay overlay--card">
      <div className="gcard" style={{ ['--deck-color' as string]: deck.color }}>
        <header className="gcard__band">{deck.emoji} {deck.label}</header>
        <HistoryControls undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
        <div className="gcard__emoji">{card.emoji}</div>
        <p className="gcard__text">{cardText(card, state.currencySymbol)}</p>
        <div className="gcard__who">Para {player.icon} <b>{player.name}</b></div>

        {!auto && <p className="gcard__hint">Mueve tu ficha en el tablero. La app no cambia dinero por esta carta.</p>}

        {short && (
          <p className="gcard__warn">
            ⚠️ No te alcanza: debes {money(owed)} y tienes {money(player.cash)}.
            Hipoteca o vende aquí abajo hasta reunirlo. Si no puedes, declárate en bancarrota.
          </p>
        )}
        {debtors.length > 0 && (
          <p className="gcard__warn">
            ⏳ {debtors.map((d) => d.name).join(', ')} no {debtors.length > 1 ? 'pueden' : 'puede'} pagar.
            Deben liquidar algo desde su dispositivo (o declararse en bancarrota) para poder cobrar.
          </p>
        )}

        {canAct ? (
          <div className="gcard__btns">
            {e.kind === 'goto' && e.collectGo && (
              <button className="gcard__go" onClick={() => act({ type: 'CLAIM_GO_BONUS', playerId: player.id })}>
                🟢 Pasé por SALIDA
              </button>
            )}
            <button className="confirm" disabled={blocked} onClick={() => act({ type: 'RESOLVE_CARD' })}>{action}</button>
            {/* Liquidar sin salir de la carta: se resuelve ahora, no se aplaza. */}
            {short && <LiquidateBox me={player} act={act} money={money} />}
            {short && (
              <button
                className="gcard__bankrupt"
                onClick={() => { if (confirm(`¿Declararte en bancarrota, ${player.name}? Tus propiedades vuelven al banco.`)) act({ type: 'DECLARE_BANKRUPTCY', playerId: player.id }); }}
              >
                💀 Declararme en bancarrota
              </button>
            )}
          </div>
        ) : (
          <div className="gcard__btns">
            <p className="gcard__hint">Esperando a {player.name}…</p>
            {/* Los demás sí pueden apartarla: si les toca liquidar para que
                puedan cobrarles, no deben quedarse bloqueados. */}
            <button className="gcard__later" onClick={onHide}>Ocultar y seguir jugando</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingTradeBanner({ trade, players, act, money, canRespond, canCancel }: {
  trade: PendingTrade;
  players: RuntimePlayer[];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  canRespond: boolean;
  canCancel: boolean;
}) {
  const A = players.find((p) => p.id === trade.aId);
  const B = players.find((p) => p.id === trade.bId);
  const nm = (ids: string[]) => ids.map((id) => getProperty(id)?.name ?? id).join(', ');
  const side = (cash: number, props: string[], cards: string[] = [], spins = 0) => {
    const parts = [
      cash ? money(cash) : '',
      props.length ? nm(props) : '',
      cards.length ? cards.map((id) => getCard(id)?.emoji ?? '🃏').join('') : '',
      spins ? `${spins}🎡` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' + ') : 'nada';
  };
  return (
    <div className="tradebanner">
      <h3>🤝 Negociación en proceso</h3>
      <div className="tradebanner__detail">
        <b>{A?.icon} {A?.name}</b> ofrece: {side(trade.aCash, trade.aProps, trade.aCards, trade.aSpins)}<br />
        <b>{B?.icon} {B?.name}</b> ofrece: {side(trade.bCash, trade.bProps, trade.bCards, trade.bSpins)}
      </div>
      <div className="tradebanner__btns">
        {/* Solo responde a quien va dirigida. Al resto se le muestran los
            botones desactivados para que se entienda por qué no puede. */}
        <button
          className="t-accept"
          disabled={!canRespond}
          title={canRespond ? '' : `Solo ${B?.name} puede responder`}
          onClick={() => act({ type: 'ACCEPT_TRADE' })}
        >
          ✅ Aceptar
        </button>
        <button
          className="t-reject"
          disabled={!canRespond}
          title={canRespond ? '' : `Solo ${B?.name} puede responder`}
          onClick={() => act({ type: 'REJECT_TRADE' })}
        >
          ❌ Rechazar
        </button>
        {/* El proponente puede retirarla: si no, una oferta a alguien ausente
            bloquearía cualquier otra negociación. */}
        {canCancel && !canRespond && (
          <button className="t-cancel" onClick={() => act({ type: 'REJECT_TRADE' })}>↩️ Retirar oferta</button>
        )}
      </div>
      {!canRespond && <p className="hint">Esperando la respuesta de <b>{B?.name}</b>…</p>}
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
        Los mazos se arman al empezar la partida con las modalidades marcadas.
        Ahora mismo: <b>{total} cartas</b> en juego.
      </p>
      {total === 0 && (
        <p className="pack__todo">
          🚫 Sin modalidades activas se juega <b>sin cartas</b>: no aparecerán los botones de
          robar en la barra de turno. Puedes volver a activarlas antes de empezar.
        </p>
      )}
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
                    title={on ? 'Quitar del juego' : 'Añadir al juego'}
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

/** Una sala tal como se lista desde la base de datos. */
type RoomRow = { code: string; players: number; started: boolean; updatedAt: string | null };

/**
 * Explorador de salas: lista todas las salas creadas en la base de datos, con
 * cuántos jugadores tienen y cuándo se actualizaron, y permite unirse o
 * eliminarlas. Solo aparece cuando hay Supabase configurado.
 */
function RoomsBrowser({ currentCode, onJoin }: {
  currentCode: string;
  onJoin: (code: string) => void;
}) {
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('Room')
      .select('code, state, updatedAt')
      .order('updatedAt', { ascending: false });
    setLoading(false);
    if (error) { alert('No se pudieron cargar las salas: ' + error.message); return; }
    setRooms(
      (data ?? []).map((r) => {
        const st = r.state as GameState | null;
        return {
          code: r.code as string,
          players: st?.players?.length ?? 0,
          started: !!st?.started,
          updatedAt: (r.updatedAt as string | null) ?? null,
        };
      }),
    );
  }, []);

  // Cargar al abrir el panel por primera vez.
  useEffect(() => {
    if (open && rooms === null) void load();
  }, [open, rooms, load]);

  const remove = async (code: string) => {
    if (!supabase) return;
    if (!confirm(`¿Eliminar la sala ${code}? No se puede deshacer.`)) return;
    const { error } = await supabase.from('Room').delete().eq('code', code);
    if (error) { alert('No se pudo eliminar: ' + error.message); return; }
    setRooms((rs) => (rs ?? []).filter((r) => r.code !== code));
  };

  const when = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  };

  return (
    <div className="rooms">
      <button className="rooms__toggle" onClick={() => setOpen((v) => !v)}>
        🗂️ Salas en la base de datos {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="rooms__body">
          <div className="rooms__bar">
            <button onClick={() => void load()} disabled={loading}>
              {loading ? 'Cargando…' : '🔄 Actualizar'}
            </button>
            {rooms && <span className="hint">{rooms.length} sala{rooms.length === 1 ? '' : 's'}</span>}
          </div>
          {rooms && rooms.length === 0 && <p className="hint">No hay salas creadas.</p>}
          <ul className="rooms__list">
            {(rooms ?? []).map((r) => (
              <li key={r.code} className={`rooms__item ${r.code === currentCode ? 'rooms__item--current' : ''}`}>
                <span className="rooms__code">
                  <b>{r.code}</b>{r.code === currentCode && ' (actual)'}
                  <span className="hint"> · 👤 {r.players} · {r.started ? '▶ en juego' : '⏸ preparación'} · {when(r.updatedAt)}</span>
                </span>
                <span className="rooms__btns">
                  <button onClick={() => onJoin(r.code)} disabled={r.code === currentCode}>Unirse</button>
                  <button className="rooms__del" onClick={() => void remove(r.code)} title="Eliminar esta sala">🗑️</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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

      {hasSupabase && <RoomsBrowser currentCode={state.code} onJoin={onJoin} />}

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
