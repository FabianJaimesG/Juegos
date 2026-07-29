// Verificación rápida del lote de reglas. Ejecutar: npx tsx scripts/test-batch.ts
import { createGame, reducer, type GameState, type Action } from '../src/game/engine';
import { activeCountByKind, ownsFullGroupActive, canSellOn } from '../src/domain/wealth';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
}
const run = (s: GameState, ...as: Action[]) => as.reduce(reducer, s);

// Partida con 3 jugadores y saldo bajo controlado.
let g = createGame('TEST');
g = run(g,
  { type: 'ADD_PLAYER', name: 'Ana', admin: true },
  { type: 'ADD_PLAYER', name: 'Beto' },
  { type: 'ADD_PLAYER', name: 'Caro' },
  { type: 'START_GAME' },
);
const [ana, beto, caro] = g.players.map((p) => p.id);
const setCash = (s: GameState, id: string, cash: number): GameState =>
  ({ ...s, players: s.players.map((p) => (p.id === id ? { ...p, cash } : p)) });

console.log('1) Mínimo 1: no puede quedar en 0');
g = setCash(g, beto, 100);
let g2 = reducer(g, { type: 'PLAYER_TO_BANK', playerId: beto, amount: 100 });
ok(g2.players.find((p) => p.id === beto)!.cash === 100, 'pagar todo al banco se bloquea (queda igual)');
g2 = reducer(g, { type: 'PLAYER_TO_BANK', playerId: beto, amount: 99 });
ok(g2.players.find((p) => p.id === beto)!.cash === 1, 'pagar dejando 1 sí se permite');
// COLLECT: Ana cobra 100 a Beto (que tiene 100) => bloqueado
g2 = reducer(g, { type: 'COLLECT', toId: ana, fromIds: [beto], amount: 100 });
ok(g2.players.find((p) => p.id === beto)!.cash === 100, 'cobrar todo a un pagador se bloquea');

console.log('2) Bancarrota: cash 0, sin propiedades, bankrupt true');
let gb = setCash(g, caro, 500);
gb = reducer(gb, { type: 'BUY_PROPERTY', playerId: caro, propertyId: 'reading' });
ok(gb.players.find((p) => p.id === caro)!.holdings.length === 1, 'Caro compró un ferrocarril');
gb = reducer(gb, { type: 'DECLARE_BANKRUPTCY', playerId: caro });
const c = gb.players.find((p) => p.id === caro)!;
ok(c.bankrupt && c.cash === 0 && c.holdings.length === 0, 'bancarrota libera todo');

console.log('3) Renta consciente de hipoteca');
// Ana compra los 4 ferrocarriles
let gr = setCash(g, ana, 5000);
for (const id of ['reading', 'pennsylvania-rr', 'bo-rr', 'shortline-rr']) {
  gr = reducer(gr, { type: 'BUY_PROPERTY', playerId: ana, propertyId: id });
}
const anaH = () => ({ cash: 0, holdings: gr.players.find((p) => p.id === ana)!.holdings });
ok(activeCountByKind(anaH()).railroads === 4, '4 ferrocarriles activos');
gr = reducer(gr, { type: 'MORTGAGE', playerId: ana, propertyId: 'shortline-rr' });
ok(activeCountByKind(anaH()).railroads === 3, 'al hipotecar uno, cuentan 3 activos');
// Grupo de color completo pero con una hipotecada => no set activo
let gg = setCash(g, ana, 5000);
gg = reducer(gg, { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'mediterranean' });
gg = reducer(gg, { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'baltic' });
const anaHg = () => ({ cash: 0, holdings: gg.players.find((p) => p.id === ana)!.holdings });
ok(ownsFullGroupActive(anaHg(), 'brown'), 'grupo marrón completo y activo');
gg = reducer(gg, { type: 'MORTGAGE', playerId: ana, propertyId: 'baltic' });
ok(!ownsFullGroupActive(anaHg(), 'brown'), 'con una hipotecada el set no está activo');

console.log('4) Venta pareja (even sell)');
// Ana construye desigual (forzando estado) y prueba canSellOn
let gs = setCash(g, ana, 9000);
gs = reducer(gs, { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'mediterranean' });
gs = reducer(gs, { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'baltic' });
// Construye alternando (regla pareja): med, bal, med, bal...
for (let i = 0; i < 4; i++) {
  gs = reducer(gs, { type: 'BUILD_HOUSE', playerId: ana, propertyId: i % 2 === 0 ? 'mediterranean' : 'baltic' });
}
const holds = () => gs.players.find((p) => p.id === ana)!.holdings;
const med = () => holds().find((h) => h.propertyId === 'mediterranean')!;
const bal = () => holds().find((h) => h.propertyId === 'baltic')!;
ok(med().houses === 2 && bal().houses === 2, 'construcción pareja: 2 y 2');
const hv = () => ({ cash: 0, holdings: holds() });
ok(canSellOn(hv(), 'mediterranean', true), 'con 2/2 se puede vender de cualquiera');
gs = reducer(gs, { type: 'SELL_HOUSE', playerId: ana, propertyId: 'mediterranean' });
ok(med().houses === 1, 'vendió una de mediterranean (ahora 1)');
ok(!canSellOn(hv(), 'mediterranean', true), 'con 1/2 NO se puede vender de la de menos');
ok(canSellOn(hv(), 'baltic', true), 'con 1/2 sí se puede vender de la de más');
ok(canSellOn(hv(), 'mediterranean', false), 'con evenBuild off sí se puede vender de la de menos');

console.log('5) Reclamo de identidad');
let gi = run(g, { type: 'CLAIM_PLAYER', playerId: beto, deviceId: 'devB' });
ok(gi.players.find((p) => p.id === beto)!.claimedBy === 'devB', 'Beto reclamado por devB');
// Otro dispositivo reclama a Ana: no toca a Beto
gi = reducer(gi, { type: 'CLAIM_PLAYER', playerId: ana, deviceId: 'devA' });
ok(gi.players.find((p) => p.id === beto)!.claimedBy === 'devB', 'Beto sigue con devB');
// devB reclama a Ana => libera Beto
gi = reducer(gi, { type: 'CLAIM_PLAYER', playerId: ana, deviceId: 'devB' });
ok(gi.players.find((p) => p.id === beto)!.claimedBy === undefined, 'al mover devB a Ana, Beto se libera');
gi = reducer(gi, { type: 'RELEASE_PLAYER', deviceId: 'devB' });
ok(gi.players.every((p) => p.claimedBy !== 'devB'), 'RELEASE_PLAYER limpia el reclamo de devB');

console.log('6) Log de edición de nombre');
let gl = reducer(g, { type: 'EDIT_PLAYER', playerId: ana, name: 'Anita' });
ok(gl.log[0].text.includes('cambió su nombre'), 'edición de nombre se registra en historial');
const before = g.log.length;
gl = reducer(g, { type: 'EDIT_PLAYER', playerId: ana, admin: false });
ok(gl.log.length === before, 'toggle de admin no genera entrada de historial');

console.log('7) Pagar renta (auto y fija)');
// Ana dueña de Av. Oriental (celeste, sin grupo completo). Beto (turno) paga renta base.
let gp = setCash(g, ana, 5000);
gp = reducer(gp, { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'oriental' });
gp = setCash(gp, beto, 1000);
const betoBefore = gp.players.find((p) => p.id === beto)!.cash;
const anaBefore = gp.players.find((p) => p.id === ana)!.cash;
gp = reducer(gp, { type: 'PAY_RENT', fromId: beto, toId: ana, propertyId: 'oriental' });
const betoAfter = gp.players.find((p) => p.id === beto)!.cash;
const anaAfter = gp.players.find((p) => p.id === ana)!.cash;
ok(betoBefore - betoAfter === 6 && anaAfter - anaBefore === 6, 'renta base celeste = 6, transferida de Beto a Ana');
// Servicio sin tirada => bloqueado
let gu = setCash(g, ana, 5000);
gu = reducer(gu, { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'electric' });
gu = setCash(gu, beto, 1000);
let gu2 = reducer(gu, { type: 'PAY_RENT', fromId: beto, toId: ana, propertyId: 'electric' });
ok(gu2.players.find((p) => p.id === beto)!.cash === 1000, 'servicio sin tirada: pago bloqueado');
// Con tirada: renta = (a+b) * 4
gu = { ...gu, dice: { a: 3, b: 4, special: null } };
gu2 = reducer(gu, { type: 'PAY_RENT', fromId: beto, toId: ana, propertyId: 'electric' });
ok(1000 - gu2.players.find((p) => p.id === beto)!.cash === 28, 'servicio con tirada 7 → renta 28 (×4)');
// Propiedad hipotecada: no se paga renta
let gm = setCash(g, ana, 5000);
gm = reducer(gm, { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'oriental' });
gm = reducer(gm, { type: 'MORTGAGE', playerId: ana, propertyId: 'oriental' });
gm = setCash(gm, beto, 1000);
const gm2 = reducer(gm, { type: 'PAY_RENT', fromId: beto, toId: ana, propertyId: 'oriental' });
ok(gm2.players.find((p) => p.id === beto)!.cash === 1000, 'propiedad hipotecada: no genera renta');

console.log('8) Bonificación: girar la ruleta ya no da carta');
// Partida en modo Parada Libre.
let gpl = createGame('PL');
gpl = { ...gpl, settings: { ...gpl.settings, cardPacks: ['base', 'parada-libre'] } };
gpl = run(gpl,
  { type: 'ADD_PLAYER', name: 'Ana', admin: true },
  { type: 'ADD_PLAYER', name: 'Beto' },
  { type: 'START_GAME' },
);
const anaPl = gpl.players[0].id;
const handOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.tokens.length;
// Le damos una ficha de giro y giramos: la mano no debe crecer.
gpl = { ...gpl, players: gpl.players.map((p) => (p.id === anaPl ? { ...p, spins: 1 } : p)) };
const handBeforeSpin = handOf(gpl, anaPl);
let gplSpun = reducer(gpl, { type: 'SPIN_WHEEL', playerId: anaPl });
gplSpun = reducer(gplSpun, { type: 'CLOSE_WHEEL' });
ok(handOf(gplSpun, anaPl) === handBeforeSpin, 'girar la ruleta NO agrega carta de bonificación');
ok(gplSpun.players.find((p) => p.id === anaPl)!.spins === 0, 'girar gasta la ficha de giro');
// Se puede volver a girar aunque quede un resultado en pantalla (wheel set).
let gplMulti = { ...gpl, players: gpl.players.map((p) => (p.id === anaPl ? { ...p, spins: 2 } : p)) };
gplMulti = reducer(gplMulti, { type: 'SPIN_WHEEL', playerId: anaPl });
gplMulti = reducer(gplMulti, { type: 'SPIN_WHEEL', playerId: anaPl }); // sin cerrar el anterior
ok(gplMulti.players.find((p) => p.id === anaPl)!.spins === 0, 'se puede girar de nuevo sin cerrar la ruleta');
// En la cárcel no se puede girar.
let gplJail = { ...gpl, players: gpl.players.map((p) => (p.id === anaPl ? { ...p, spins: 1, jail: 1 } : p)) };
gplJail = reducer(gplJail, { type: 'SPIN_WHEEL', playerId: anaPl });
ok(gplJail.players.find((p) => p.id === anaPl)!.spins === 1, 'en la cárcel no se gasta ficha (giro bloqueado)');

console.log('9) Renta → ficha: se entrega a un dueño elegible (no al turno)');
let grs = { ...gpl };
const [anaR, betoR] = grs.players.map((p) => p.id);
const spinsOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.spins;
// Beto es dueño de una propiedad sin hipotecar → puede recibir la ficha.
grs = { ...grs, players: grs.players.map((p) => (p.id === betoR ? { ...p, spins: 0 } : p)) };
grs = reducer(setCash(grs, betoR, 5000), { type: 'BUY_PROPERTY', playerId: betoR, propertyId: 'oriental' });
const betoSpinsBefore = spinsOf(grs, betoR);
let grs2 = reducer(grs, { type: 'RENT_TO_SPIN', ownerId: betoR });
ok(spinsOf(grs2, betoR) === betoSpinsBefore + 1, 'el dueño (Beto) recibe la ficha de giro');
// Ana no tiene propiedades → no puede recibir.
grs2 = reducer(grs, { type: 'RENT_TO_SPIN', ownerId: anaR });
ok(spinsOf(grs2, anaR) === spinsOf(grs, anaR), 'sin propiedades sin hipotecar, no se entrega la ficha');
// Con la propiedad hipotecada, tampoco.
let grsM = reducer(grs, { type: 'MORTGAGE', playerId: betoR, propertyId: 'oriental' });
const grsM2 = reducer(grsM, { type: 'RENT_TO_SPIN', ownerId: betoR });
ok(spinsOf(grsM2, betoR) === spinsOf(grsM, betoR), 'con la única propiedad hipotecada, no se entrega la ficha');

console.log('10) En la cárcel no se roban cartas de Fortuna/Arca');
let gj = createGame('JAIL');
gj = run(gj,
  { type: 'ADD_PLAYER', name: 'Ana', admin: true },
  { type: 'ADD_PLAYER', name: 'Beto' },
  { type: 'START_GAME' },
);
const anaJ = gj.players[0].id;
gj = { ...gj, players: gj.players.map((p) => (p.id === anaJ ? { ...p, jail: 1 } : p)) };
const gjDraw = reducer(gj, { type: 'DRAW_CARD', deck: 'fortuna', playerId: anaJ });
ok(gjDraw.drawnCard === null, 'en la cárcel, DRAW_CARD no saca carta');

console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
