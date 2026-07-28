import { useMemo, useState } from 'react';
import './App.css';
import { PropertyCard } from './components/PropertyCard';
import { BOARD, getProperty } from './domain/board';
import {
  bankBuildingsLeft,
  playerBuildings,
  playerEquity,
  playerNetWorth,
  type RuntimePlayer,
} from './game/engine';
import { canBuildOn } from './domain/wealth';
import { useGame } from './game/useGame';

const PLAYER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#dc2626', '#4f46e5'];

type Sheet =
  | { kind: 'none' }
  | { kind: 'pay'; playerId: string }
  | { kind: 'collect'; playerId: string }
  | { kind: 'props'; playerId: string }
  | { kind: 'market'; playerId: string }
  | { kind: 'trade'; playerId: string };

export default function App() {
  const { state, act, undo, redo, reset, canUndo, canRedo } = useGame();
  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });
  const [newName, setNewName] = useState('');

  const sym = state.currencySymbol;
  const money = (n: number) => `${sym}${n.toLocaleString('es')}`;
  const player = (id: string) => state.players.find((p) => p.id === id);

  return (
    <div className="app">
      <header className="topbar">
        <h1>🏦 Banca <span className="code">Sala {state.code}</span></h1>
        <div className="topbar__actions">
          <button onClick={undo} disabled={!canUndo}>↶</button>
          <button onClick={redo} disabled={!canRedo}>↷</button>
          <button onClick={() => { if (confirm('¿Nueva partida? Se borra la actual.')) reset(); }}>Nueva</button>
        </div>
      </header>

      <section className="players">
        {state.players.map((p) => (
          <PlayerTile key={p.id} p={p} money={money} onOpen={(k) => setSheet({ kind: k, playerId: p.id })} />
        ))}
        {state.players.length === 0 && <p className="empty">Agrega jugadores para empezar.</p>}
      </section>

      <form
        className="addplayer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          act({ type: 'ADD_PLAYER', name: newName });
          setNewName('');
        }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre del jugador" maxLength={16} />
        <button type="submit">+ Agregar</button>
      </form>

      {sheet.kind !== 'none' && player(sheet.playerId) && (
        <div className="overlay" onClick={() => setSheet({ kind: 'none' })}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <SheetContent
              sheet={sheet}
              state={state}
              act={act}
              money={money}
              close={() => setSheet({ kind: 'none' })}
              goMarket={(playerId) => setSheet({ kind: 'market', playerId })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerTile({ p, money, onOpen }: { p: RuntimePlayer; money: (n: number) => string; onOpen: (k: Sheet['kind']) => void }) {
  const nw = playerNetWorth(p);
  const b = playerBuildings(p);
  const color = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
  return (
    <article className="ptile" style={{ borderTopColor: color }}>
      <div className="ptile__head">
        <span className="ptile__name">{p.icon} {p.name}</span>
      </div>
      <div className="ptile__cash">{money(p.cash)}</div>
      <div className="ptile__stats">
        <span title="Patrimonio total (efectivo + propiedades + casas)">💎 {money(nw)}</span>
        <span title="Propiedades">🏷️ {p.holdings.length}</span>
        <span title="Casas / Hoteles">🏠 {b.houses} · 🏨 {b.hotels}</span>
      </div>
      <div className="ptile__btns">
        <button className="b-in" onClick={() => onOpen('collect')}>Cobrar</button>
        <button className="b-out" onClick={() => onOpen('pay')}>Pagar</button>
        <button className="b-prop" onClick={() => onOpen('props')}>Propiedades</button>
        <button className="b-trade" onClick={() => onOpen('trade')}>Negociar</button>
      </div>
    </article>
  );
}

function SheetContent({
  sheet, state, act, money, close, goMarket,
}: {
  sheet: Sheet;
  state: ReturnType<typeof useGame>['state'];
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  close: () => void;
  goMarket: (playerId: string) => void;
}) {
  if (sheet.kind === 'none') return null;
  const me = state.players.find((p) => p.id === sheet.playerId)!;

  if (sheet.kind === 'collect') {
    return (
      <AmountForm
        title={`Cobrar del banco → ${me.name}`}
        confirmLabel="Cobrar"
        onConfirm={(amount) => { act({ type: 'BANK_TO_PLAYER', playerId: me.id, amount }); close(); }}
        extra={
          <button className="salida" onClick={() => { act({ type: 'SALIDA', playerId: me.id }); close(); }}>
            🟢 Salida (+cobra al pasar)
          </button>
        }
      />
    );
  }

  if (sheet.kind === 'pay') {
    const others = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    return <PayForm me={me} others={others} act={act} close={close} money={money} />;
  }

  if (sheet.kind === 'props') {
    return <PropsPanel me={me} act={act} money={money} goMarket={() => goMarket(me.id)} />;
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

function AmountForm({
  title, confirmLabel, onConfirm, extra,
}: {
  title: string;
  confirmLabel: string;
  onConfirm: (amount: number) => void;
  extra?: React.ReactNode;
}) {
  const [amt, setAmt] = useState('');
  const n = parseInt(amt, 10) || 0;
  return (
    <div className="form">
      <h2>{title}</h2>
      <input autoFocus inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ''))} placeholder="Monto" />
      <div className="quick">
        {[10, 50, 100, 200, 500].map((q) => (
          <button key={q} onClick={() => setAmt(String(n + q))}>+{q}</button>
        ))}
        <button onClick={() => setAmt('')}>C</button>
      </div>
      {extra}
      <button className="confirm" disabled={n <= 0} onClick={() => onConfirm(n)}>{confirmLabel}</button>
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
      <h2>Pagar / Transferir — {me.name}</h2>
      <p className="hint">Sin seleccionar nadie → paga al <b>banco</b>. Con jugadores → transfiere {money(n)} a cada uno.</p>
      <input autoFocus inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ''))} placeholder="Monto" />
      <div className="quick">
        {[10, 50, 100, 200, 500].map((q) => (
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
  me, act, money, goMarket,
}: {
  me: RuntimePlayer;
  act: ReturnType<typeof useGame>['act'];
  money: (n: number) => string;
  goMarket: () => void;
}) {
  return (
    <div className="form">
      <h2>Propiedades de {me.name}</h2>
      <div className="wealth">
        <span>💵 {money(me.cash)}</span>
        <span>🏦 {money(playerEquity(me))} en bienes</span>
        <span>💎 {money(playerNetWorth(me))} total</span>
      </div>
      <button className="confirm" onClick={goMarket}>🛒 Comprar propiedad</button>
      <div className="ownedgrid">
        {me.holdings.length === 0 && <p className="hint">Aún no tiene propiedades.</p>}
        {me.holdings.map((h) => {
          const prop = getProperty(h.propertyId)!;
          const buildable = canBuildOn({ cash: me.cash, holdings: me.holdings }, h.propertyId);
          return (
            <div key={h.propertyId} className="owned">
              <PropertyCard property={prop} houses={h.houses} mortgaged={h.mortgaged} compact />
              <div className="owned__btns">
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
              </div>
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
          act({ type: 'TRADE', aId: me.id, bId: other.id, aCash: nA, bCash: nB, aProps, bProps });
          close();
        }}
      >
        {valid ? 'Confirmar intercambio' : nothing ? 'Selecciona algo para intercambiar' : 'Fondos insuficientes'}
      </button>
    </div>
  );
}
