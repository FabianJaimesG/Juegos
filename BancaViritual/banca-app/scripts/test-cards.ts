// Verificación de las cartas (Arca Comunal / Fortuna). Ejecutar: npx tsx scripts/test-cards.ts
import { activeDecks, CARDS, cardsFor, copiesOf, deckIds, getCard, isAutomatic, PACKS, packSize, WHEEL } from '../src/domain/cards';
import { createGame, reducer, type Action, type GameState } from '../src/game/engine';
import { GAME_CONFIG } from '../src/domain/config';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
}
const run = (s: GameState, ...as: Action[]) => as.reduce(reducer, s);
const cashOf = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.cash;

console.log('0) Catálogo');
ok(cardsFor('arca', ['base']).length === 16, 'Arca Comunal tiene 16 cartas');
ok(cardsFor('fortuna', ['base']).length === 16, 'Fortuna tiene 16 cartas');
ok(new Set(CARDS.map((c) => c.id)).size === CARDS.length, 'no hay ids duplicados');
ok(cardsFor('arca', []).length === 0, 'sin modalidades activas no hay cartas');

let g = createGame('CART');
g = run(g,
  { type: 'ADD_PLAYER', name: 'Ana', admin: true },
  { type: 'ADD_PLAYER', name: 'Beto' },
  { type: 'ADD_PLAYER', name: 'Caro' },
  { type: 'START_GAME' },
);
const [ana, beto, caro] = g.players.map((p) => p.id);

console.log('1) Mazos barajados al empezar');
ok(g.decks.arca.draw.length === 16 && g.decks.fortuna.draw.length === 16, 'ambos mazos con 16');
ok(g.drawnCard === null, 'no hay carta pendiente al empezar');

// Fuerza una carta concreta al frente del mazo para probar cada efecto.
const stack = (s: GameState, cardId: string): GameState => {
  const d = getCard(cardId)!.deck;
  return { ...s, decks: { ...s.decks, [d]: { ...s.decks[d], draw: [cardId, ...s.decks[d].draw.filter((x) => x !== cardId)] } } };
};
const play = (s: GameState, cardId: string, playerId: string): GameState =>
  run(stack(s, cardId), { type: 'DRAW_CARD', deck: getCard(cardId)!.deck, playerId }, { type: 'RESOLVE_CARD' });

console.log('2) Efectos de dinero');
let g2 = play(g, 'arca-error-bancario', ana);
ok(cashOf(g2, ana) === 1700, 'error bancario: +200 del banco');
ok(g2.drawnCard === null && g2.decks.arca.discard[0] === 'arca-error-bancario', 'la carta va al descarte');

g2 = play(g, 'arca-hospital', ana);
ok(cashOf(g2, ana) === 1400, 'cuenta de hospital: -100 al banco');

g2 = play(g, 'arca-cumpleanos', ana);
ok(cashOf(g2, ana) === 1520, 'cumpleaños: cobra 10 a cada uno de los otros 2');
ok(cashOf(g2, beto) === 1490 && cashOf(g2, caro) === 1490, 'cada jugador pagó 10');

g2 = play(g, 'fortuna-presidente', ana);
ok(cashOf(g2, ana) === 1400, 'presidente: paga 50 a cada uno de los otros 2');
ok(cashOf(g2, beto) === 1550, 'cada jugador recibió 50');

console.log('3) Reparaciones según construcciones');
// Ana compra el grupo marrón completo y construye 2 casas.
let gr = run(g,
  { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'mediterranean' },
  { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'baltic' },
  { type: 'BUILD_HOUSE', playerId: ana, propertyId: 'mediterranean' },
  { type: 'BUILD_HOUSE', playerId: ana, propertyId: 'baltic' },
);
const before = cashOf(gr, ana);
const gRep = play(gr, 'fortuna-reparaciones', ana);
ok(before - cashOf(gRep, ana) === 50, 'reparaciones Fortuna: 2 casas × 25 = 50');
const gRep2 = play(gr, 'arca-reparacion-vial', ana);
ok(before - cashOf(gRep2, ana) === 80, 'reparación vial Arca: 2 casas × 40 = 80');
// Sin construcciones no se cobra nada.
const gRep3 = play(g, 'fortuna-reparaciones', beto);
ok(cashOf(gRep3, beto) === 1500, 'sin casas no paga reparaciones');

console.log('4) Salir de la cárcel: se conserva y se usa');
let gj = run(stack(g, 'arca-salir-carcel'), { type: 'DRAW_CARD', deck: 'arca', playerId: beto }, { type: 'RESOLVE_CARD' });
const betoP = gj.players.find((p) => p.id === beto)!;
ok(betoP.tokens.length === 1, 'la carta queda en la mano del jugador');
ok(gj.decks.arca.discard.length === 0, 'no va al descarte mientras se conserva');
gj = reducer(gj, { type: 'USE_CARD', playerId: beto, cardId: 'arca-salir-carcel' });
ok(gj.players.find((p) => p.id === beto)!.tokens.length === 0, 'al usarla sale de la mano');
ok(gj.decks.arca.discard[0] === 'arca-salir-carcel', 'y vuelve al descarte');

console.log('5) Cartas instructivas (movimiento)');
const gm = play(g, 'fortuna-retroceda-3', ana);
ok(cashOf(gm, ana) === 1500, 'retroceda 3 casillas no mueve dinero');
ok(gm.decks.fortuna.discard[0] === 'fortuna-retroceda-3', 'igual se descarta');
ok(!isAutomatic(getCard('fortuna-retroceda-3')!.effect), 'está marcada como instructiva');
const gGo = play(g, 'arca-avance-salida', ana);
ok(cashOf(gGo, ana) === 1700, 'avance a Salida sí cobra los 200 automáticamente');
// "Si pasa por Salida" es opcional: lo reclama el jugador.
const gGo2 = reducer(play(g, 'fortuna-illinois', ana), { type: 'CLAIM_GO_BONUS', playerId: ana });
ok(cashOf(gGo2, ana) === 1700, 'Illinois: el bono de Salida se cobra al reclamarlo');

console.log('6) Guardas');
let gp = play(g, 'arca-error-bancario', ana);
gp = reducer(gp, { type: 'DRAW_CARD', deck: 'arca', playerId: ana });
const gp2 = reducer(gp, { type: 'DRAW_CARD', deck: 'fortuna', playerId: ana });
ok(gp2 === gp, 'no se puede robar otra carta con una pendiente');
// Pago que dejaría al jugador sin el mínimo: la carta sigue pendiente.
let gLow = { ...g, players: g.players.map((p) => (p.id === caro ? { ...p, cash: 50 } : p)) };
gLow = run(stack(gLow, 'arca-hospital'), { type: 'DRAW_CARD', deck: 'arca', playerId: caro }, { type: 'RESOLVE_CARD' });
ok(gLow.drawnCard !== null, 'sin fondos la carta queda pendiente');
ok(cashOf(gLow, caro) === 50, 'y no se cobra nada');

console.log('7) Mazo agotado: se rebaraja el descarte');
let gd = { ...g, decks: { ...g.decks, arca: { draw: [], discard: ['arca-herencia', 'arca-consultoria'] } } };
gd = reducer(gd, { type: 'DRAW_CARD', deck: 'arca', playerId: ana });
ok(gd.drawnCard !== null && gd.decks.arca.draw.length === 1, 'roba del descarte rebarajado');
const gEmpty = reducer({ ...g, decks: { ...g.decks, arca: { draw: [], discard: [] } } }, { type: 'DRAW_CARD', deck: 'arca', playerId: ana });
ok(gEmpty.drawnCard === null, 'mazo totalmente vacío: no pasa nada');

console.log('8) Bancarrota devuelve las cartas retenidas');
let gb = run(stack(g, 'fortuna-salir-carcel'), { type: 'DRAW_CARD', deck: 'fortuna', playerId: caro }, { type: 'RESOLVE_CARD' });
gb = reducer(gb, { type: 'DECLARE_BANKRUPTCY', playerId: caro });
ok(gb.players.find((p) => p.id === caro)!.tokens.length === 0, 'el jugador en bancarrota no retiene cartas');
ok(gb.decks.fortuna.discard[0] === 'fortuna-salir-carcel', 'la carta vuelve al mazo');

console.log('9) Modalidades');
ok(cardsFor('arca', ['base']).length + cardsFor('fortuna', ['base']).length === 32, 'la modalidad base son 32 cartas');
for (const id of Object.keys(PACKS)) {
  ok(packSize(id) > 0, `la modalidad "${id}" tiene cartas`);
}
for (const c of CARDS) ok(PACKS[c.pack] !== undefined, `la carta ${c.id} apunta a una modalidad registrada`);
const conPrision = createGame('X');
const gp3 = run({ ...conPrision, settings: { ...conPrision.settings, cardPacks: ['base', 'prision'] } },
  { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'START_GAME' });
ok(gp3.decks.arca.draw.length === 16 + cardsFor('arca', ['prision']).length, 'activar Prisión suma sus cartas al mazo');

console.log('10) Efectos nuevos');
const rico = g.players.find((p) => p.id === beto)!.id;
let gRich = { ...g, players: g.players.map((p) => (p.id === rico ? { ...p, cash: 5000 } : p)) };
gRich = play(gRich, 'enr-dedo-pegajoso', ana);
ok(cashOf(gRich, ana) === 1550 && cashOf(gRich, rico) === 4950, 'el más rico te paga 50');
let gPay = { ...g, players: g.players.map((p) => (p.id === rico ? { ...p, cash: 5000 } : p)) };
gPay = play(gPay, 'enr-te-pillaron', ana);
ok(cashOf(gPay, ana) === 1450 && cashOf(gPay, rico) === 5050, 'le pagas 50 al más rico');
// 2 propiedades marrones (60 + 60 = 120 gastados) => patrimonio 1500.
let gProp = run(g,
  { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'mediterranean' },
  { type: 'BUY_PROPERTY', playerId: ana, propertyId: 'baltic' },
);
const gTas = play(gProp, 'ven-tasacion', ana);
ok(cashOf(gTas, ana) - cashOf(gProp, ana) === 100, 'tasación: cobra 50 × 2 propiedades');
const gCom = play(gProp, 'ven-corredor', ana);
ok(cashOf(gProp, ana) - cashOf(gCom, ana) === 50, 'corredor: paga 25 × 2 propiedades');
const gPct = play(gProp, 'ven-plusvalia', ana);
ok(cashOf(gProp, ana) - cashOf(gPct, ana) === 150, 'plusvalía: 10% de un patrimonio de 1500');
const gCash = play(g, 'ban-auditoria', ana);
ok(cashOf(g, ana) - cashOf(gCash, ana) === 150, 'auditoría: 10% de 1500 en efectivo');
const gMan = play(g, 'ban-recesion', ana);
ok(cashOf(gMan, ana) === 1500, 'las cartas manuales no mueven dinero');
ok(gMan.decks.fortuna.discard[0] === 'ban-recesion', 'pero sí se descartan');

console.log('11) Parada Libre: mazo de Bonificación');
const packs = ['base', 'parada-libre'];
ok(deckIds('bonificacion', packs).length === 24, 'el mazo de Bonificación son 24 cartas (con copias)');
ok(cardsFor('bonificacion', packs).length === 7, 'son 7 cartas distintas');
ok(deckIds('bonificacion', ['base']).length === 0, 'sin la modalidad no hay mazo de Bonificación');
ok(copiesOf(CARDS.find((c) => c.id === 'par-gran-premio')!) === 2, 'Gran Premio entra 2 veces');
ok(packSize('parada-libre') === 24, 'el panel cuenta las copias, no los tipos');

let gPL = createGame('PL');
gPL = { ...gPL, settings: { ...gPL.settings, cardPacks: packs } };
gPL = run(gPL, { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'ADD_PLAYER', name: 'Beto' }, { type: 'START_GAME' });
const [pa, pb] = gPL.players.map((p) => p.id);
ok(gPL.decks.bonificacion.draw.length === 24, 'el mazo se baraja al empezar');
ok(gPL.players.every((p) => p.spins === 2 && p.bonus === 2), 'cada jugador recibe 2 fichas de giro y 2 de bonificación');
ok(gPL.pot === 0 && gPL.limoPlayerId === null, 'bote vacío y sin limusina al empezar');

console.log('12) El bote');
let gPot = reducer(gPL, { type: 'POT_ADD', amount: 200 });
ok(gPot.pot === 200, 'un impuesto del banco entra al bote');
gPot = reducer(gPot, { type: 'POT_ADD', amount: 100, playerId: pa });
ok(gPot.pot === 300 && cashOf(gPot, pa) === 1400, 'un jugador paga al bote y se le descuenta');
const gPobre = reducer({ ...gPot, players: gPot.players.map((p) => (p.id === pb ? { ...p, cash: 50 } : p)) },
  { type: 'POT_ADD', amount: 100, playerId: pb });
ok(gPobre.pot === 300, 'no se puede pagar al bote sin fondos');
const gPremio = play(gPot, 'par-gran-premio', pb);
ok(gPremio.pot === 0 && cashOf(gPremio, pb) === 1800, 'Gran Premio vacía el bote al ganador');
const gVacio = play(gPL, 'par-gran-premio', pb);
ok(cashOf(gVacio, pb) === 1500, 'con el bote vacío no cobra nada');

console.log('13) La limusina dorada');
let gLimo = play(gPL, 'par-limusina', pa);
ok(gLimo.limoPlayerId === pa, 'la carta de mejora te da la limusina');
gLimo = reducer(gLimo, { type: 'SET_LIMO', playerId: pb });
ok(gLimo.limoPlayerId === pb, 'otro jugador se la puede llevar');
gLimo = reducer(gLimo, { type: 'SET_LIMO', playerId: null });
ok(gLimo.limoPlayerId === null, 'se pierde al ir a la cárcel');
const gQuiebra = reducer(play(gPL, 'par-limusina', pa), { type: 'DECLARE_BANKRUPTCY', playerId: pa });
ok(gQuiebra.limoPlayerId === null, 'la bancarrota también la suelta');

console.log('14) Casa gratis (se salta las reglas de grupo)');
let gCasa = run(gPL, { type: 'BUY_PROPERTY', playerId: pa, propertyId: 'mediterranean' });
const cashAntes = cashOf(gCasa, pa);
const gNormal = reducer(gCasa, { type: 'BUILD_HOUSE', playerId: pa, propertyId: 'mediterranean' });
ok(gNormal === gCasa, 'sin el grupo completo NO se puede construir normalmente');
gCasa = reducer(gCasa, { type: 'BUILD_HOUSE', playerId: pa, propertyId: 'mediterranean', free: true });
ok(gCasa.players.find((p) => p.id === pa)!.holdings[0].houses === 1, 'con la carta sí se construye');
ok(cashOf(gCasa, pa) === cashAntes, 'y no cuesta nada');

console.log('15) Cartas que se guardan (comportamiento general)');
let gKeep = run(stack(gPL, 'par-sin-renta'), { type: 'DRAW_CARD', deck: 'bonificacion', playerId: pa }, { type: 'RESOLVE_CARD' });
ok(gKeep.players.find((p) => p.id === pa)!.tokens.length === 1, 'la carta de exención se guarda en la mano');
ok(gKeep.decks.bonificacion.discard.length === 0, 'no se descarta mientras se conserva');
gKeep = reducer(gKeep, { type: 'USE_CARD', playerId: pa, cardId: 'par-sin-renta' });
ok(gKeep.players.find((p) => p.id === pa)!.tokens.length === 0, 'al usarla sale de la mano');
ok(gKeep.decks.bonificacion.discard[0] === 'par-sin-renta', 'y vuelve al descarte para volver a salir');
// Con dos copias iguales en mano se gasta solo una.
const dos = { ...gPL, players: gPL.players.map((p) => (p.id === pa ? { ...p, tokens: ['par-sin-renta', 'par-sin-renta'] } : p)) };
const unaMenos = reducer(dos, { type: 'USE_CARD', playerId: pa, cardId: 'par-sin-renta' });
ok(unaMenos.players.find((p) => p.id === pa)!.tokens.length === 1, 'gastar una copia deja la otra');
ok(CARDS.filter((c) => c.keep).length === 5, 'hay 5 tipos de carta que se conservan (2 de cárcel, indulto, exención y renta doble)');

console.log('16) Fichas');
const gGasta = reducer(gPL, { type: 'SPEND_TOKEN', playerId: pa, token: 'bonus' });
ok(gGasta.players.find((p) => p.id === pa)!.bonus === 1, 'gastar una ficha de bonificación');
const gSin = reducer({ ...gPL, players: gPL.players.map((p) => ({ ...p, bonus: 0 })) },
  { type: 'SPEND_TOKEN', playerId: pa, token: 'bonus' });
ok(gSin.players.find((p) => p.id === pa)!.bonus === 0, 'no se puede gastar de más');

console.log('17) La ruleta');
ok(WHEEL.length === 8, 'la ruleta tiene 8 sectores');
ok(WHEEL.filter((f) => f.tone === 'bad').length === 4, '4 sectores de castigo');
ok(WHEEL.filter((f) => f.tone === 'good').length === 4, '4 sectores de premio');
ok(new Set(WHEEL.map((f) => f.id)).size === 8, 'sin ids repetidos');

// Fuerza una cara concreta para probar su efecto.
const spinTo = (st: GameState, playerId: string, faceId: string): GameState => {
  const idx = WHEEL.findIndex((f) => f.id === faceId);
  const real = Math.random;
  Math.random = () => idx / WHEEL.length;
  try { return reducer(st, { type: 'SPIN_WHEEL', playerId }); } finally { Math.random = real; }
};

let gW = spinTo(gPL, pa, 'w-100');
const anaW = gW.players.find((p) => p.id === pa)!;
ok(anaW.spins === 1, 'girar gasta una ficha de giro');
ok(anaW.bonus === 3, 'y entrega una tarjeta de Bonificación');
ok(gW.pot === 100 && cashOf(gW, pa) === 1400, 'el castigo va al bote, no al banco');
ok(gW.wheel?.faceId === 'w-100', 'la cara queda en pantalla hasta cerrarla');
ok(reducer(gW, { type: 'CLOSE_WHEEL' }).wheel === null, 'se cierra');

const gWlimo = spinTo(gPL, pa, 'w-limo');
ok(gWlimo.limoPlayerId === pa, 'el sector de limusina la entrega');
const gWpremio = spinTo({ ...gPL, pot: 500 }, pa, 'w-premio');
ok(gWpremio.pot === 0 && cashOf(gWpremio, pa) === 2000, 'el Gran Premio vacía el bote');
const sinFichas = { ...gPL, players: gPL.players.map((p) => ({ ...p, spins: 0 })) };
ok(reducer(sinFichas, { type: 'SPIN_WHEEL', playerId: pa }) === sinFichas, 'sin fichas no se puede girar');
ok(spinTo(gW, pb, 'w-50') === gW, 'no se gira con una cara sin cerrar');

console.log('18) Pagos al banco → bote (regla de la expansión)');
const gMulta = reducer(gPL, { type: 'PLAYER_TO_BANK', playerId: pa, amount: 200 });
ok(gMulta.pot === 200 && cashOf(gMulta, pa) === 1300, 'con la modalidad activa, la multa engorda el bote');
const gClasico = run(createGame('C2'), { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'START_GAME' });
const soloAna = gClasico.players[0].id;
const gMulta2 = reducer(gClasico, { type: 'PLAYER_TO_BANK', playerId: soloAna, amount: 200 });
ok(gMulta2.pot === 0, 'sin la modalidad, el dinero se va al banco como siempre');
// Comprar no pasa por PLAYER_TO_BANK: no debe inflar el bote.
const gCompra = reducer(gPL, { type: 'BUY_PROPERTY', playerId: pa, propertyId: 'boardwalk' });
ok(gCompra.pot === 0, 'comprar una propiedad no alimenta el bote');
// Una carta de pago también alimenta el bote.
const gCarta = play(gPL, 'arca-hospital', pa);
ok(gCarta.pot === 100, 'las cartas de pago al banco también van al bote');

console.log('19) Canje renta → ficha de giro (con tope anti-alianzas)');
let gCanje = reducer(gPL, { type: 'RENT_TO_SPIN', ownerId: pa });
ok(gCanje.players.find((p) => p.id === pa)!.spins === 3, 'perdonar la renta da una ficha');
gCanje = reducer(gCanje, { type: 'RENT_TO_SPIN', ownerId: pa });
ok(gCanje.players.find((p) => p.id === pa)!.spins === 3, 'el tope (3) corta la acumulación');
const sinTope = { ...gCanje, settings: { ...gCanje.settings, maxSpins: 0 } };
ok(reducer(sinTope, { type: 'RENT_TO_SPIN', ownerId: pa }).players.find((p) => p.id === pa)!.spins === 4,
  'con maxSpins = 0 no hay tope');

console.log('20) Caer en la Parada Libre (bote + limusina + tarjeta)');
const gLand = reducer({ ...gPL, pot: 350 }, { type: 'LAND_FREE_PARKING', playerId: pb });
const betoL = gLand.players.find((p) => p.id === pb)!;
ok(gLand.pot === 0 && betoL.cash === 1850, 'se lleva todo el bote');
ok(gLand.limoPlayerId === pb, 'y la limusina');
ok(betoL.bonus === 3, 'y una tarjeta de Bonificación');

console.log('21) Negociar cartas y fichas');
// Ana tiene 2 exenciones; Beto, una de cárcel.
const conCartas: GameState = {
  ...gPL,
  players: gPL.players.map((p) =>
    p.id === pa ? { ...p, tokens: ['par-sin-renta', 'par-sin-renta'], spins: 2, bonus: 2 }
    : { ...p, tokens: ['par-renta-doble'], spins: 0, bonus: 0 }),
};
let gT = reducer(conCartas, {
  type: 'PROPOSE_TRADE',
  trade: { aId: pa, bId: pb, aCash: 0, bCash: 0, aProps: [], bProps: [],
           aCards: ['par-sin-renta'], bCards: ['par-renta-doble'], aSpins: 1, bSpins: 0, aBonus: 0, bBonus: 0 },
});
gT = reducer(gT, { type: 'ACCEPT_TRADE' });
const anaT = gT.players.find((p) => p.id === pa)!;
const betoT = gT.players.find((p) => p.id === pb)!;
ok(anaT.tokens.length === 2 && anaT.tokens.includes('par-renta-doble'), 'Ana entregó una copia y recibió la otra carta');
ok(anaT.tokens.filter((t) => t === 'par-sin-renta').length === 1, 'le queda una sola copia de la suya');
ok(betoT.tokens.includes('par-sin-renta') && !betoT.tokens.includes('par-renta-doble'), 'Beto recibió la exención y entregó la suya');
ok(anaT.spins === 1 && betoT.spins === 1, 'la ficha de giro cambió de dueño');

// No se puede ofrecer lo que no se tiene.
const falso = reducer(conCartas, {
  type: 'PROPOSE_TRADE',
  trade: { aId: pa, bId: pb, aCash: 0, bCash: 0, aProps: [], bProps: [],
           aCards: ['arca-salir-carcel'], bCards: [], aSpins: 0, bSpins: 0, aBonus: 0, bBonus: 0 },
});
const falsoOk = reducer(falso, { type: 'ACCEPT_TRADE' });
ok(falsoOk.players.find((p) => p.id === pb)!.tokens.length === 1, 'ofrecer una carta que no tienes no transfiere nada');
const muchas = reducer(conCartas, {
  type: 'PROPOSE_TRADE',
  trade: { aId: pa, bId: pb, aCash: 0, bCash: 0, aProps: [], bProps: [],
           aCards: [], bCards: [], aSpins: 99, bSpins: 0, aBonus: 0, bBonus: 0 },
});
ok(reducer(muchas, { type: 'ACCEPT_TRADE' }).players.find((p) => p.id === pa)!.spins === 2,
  'ofrecer más fichas de las que tienes no se ejecuta');

console.log('22) Mazo de Bonificación tras el ajuste');
ok(cardsFor('bonificacion', packs).length === 7, 'quedan 7 cartas distintas');
ok(deckIds('bonificacion', packs).length === 24, 'y siguen siendo 24 con copias');
ok(!CARDS.some((c) => c.id === 'par-compra-gratis'), 'se eliminó la carta que exigía caer en la propiedad');

console.log('23) La cárcel');
const jailOf = (st: GameState, id: string) => st.players.find((p) => p.id === id)!.jail;
let gJ = reducer(g, { type: 'GO_TO_JAIL', playerId: ana });
ok(jailOf(gJ, ana) === 1, 'entrar en la cárcel');
ok(reducer(gJ, { type: 'GO_TO_JAIL', playerId: ana }) === gJ, 'no se entra dos veces');
// Fianza
const gBail = reducer(gJ, { type: 'PAY_BAIL', playerId: ana });
ok(jailOf(gBail, ana) === 0, 'la fianza libera');
ok(cashOf(gBail, ana) === 1500 - GAME_CONFIG.bail, `y cuesta ${GAME_CONFIG.bail}`);
const pobre = { ...gJ, players: gJ.players.map((p) => (p.id === ana ? { ...p, cash: 10 } : p)) };
ok(jailOf(reducer(pobre, { type: 'PAY_BAIL', playerId: ana }), ana) === 1, 'sin dinero no se paga la fianza');
// Salir gratis
ok(jailOf(reducer(gJ, { type: 'LEAVE_JAIL', playerId: ana }), ana) === 0, 'se puede salir gratis (dobles)');
// La carta de indulto libera al usarla
const conIndulto = { ...gJ, players: gJ.players.map((p) => (p.id === ana ? { ...p, tokens: ['arca-salir-carcel'] } : p)) };
const gLibre = reducer(conIndulto, { type: 'USE_CARD', playerId: ana, cardId: 'arca-salir-carcel' });
ok(jailOf(gLibre, ana) === 0, 'usar el indulto saca de la cárcel');
ok(gLibre.decks.arca.discard[0] === 'arca-salir-carcel', 'y la carta vuelve al mazo');
// La carta "ve a la cárcel" encierra sola
const gCarta2 = play(g, 'arca-a-la-carcel', ana);
ok(jailOf(gCarta2, ana) === 1, 'la carta de ir a la cárcel encierra');
// Ir preso cuesta la limusina
const conLimo = { ...gPL, limoPlayerId: pa };
ok(reducer(conLimo, { type: 'GO_TO_JAIL', playerId: pa }).limoPlayerId === null, 'el preso pierde la limusina');

console.log('24) Condena por turnos');
let gT2 = reducer(g, { type: 'GO_TO_JAIL', playerId: ana });
// Da la vuelta a la mesa hasta que a Ana le toque otra vez.
const vuelta = (st: GameState): GameState => {
  let out = st;
  for (let i = 0; i < st.players.length; i++) out = reducer(out, { type: 'NEXT_TURN' });
  return out;
};
gT2 = vuelta(gT2);
ok(jailOf(gT2, ana) === 2, 'al volver su turno cumple el segundo');
gT2 = vuelta(gT2);
ok(jailOf(gT2, ana) === 3, 'y el tercero');
const cashAntesJ = cashOf(gT2, ana);
gT2 = vuelta(gT2);
ok(jailOf(gT2, ana) === 0, `a los ${GAME_CONFIG.jailTurns} turnos sale`);
ok(cashAntesJ - cashOf(gT2, ana) === GAME_CONFIG.bail, 'pagando la fianza obligatoria');

console.log('25) Terminar la partida y volver a la preparación');
let gEnd = run(createGame('SALA'),
  { type: 'ADD_PLAYER', name: 'Ana', admin: true },
  { type: 'ADD_PLAYER', name: 'Beto' },
  { type: 'START_GAME' },
);
const [ea] = gEnd.players.map((p) => p.id);
gEnd = run(gEnd,
  { type: 'BUY_PROPERTY', playerId: ea, propertyId: 'boardwalk' },
  { type: 'ROLL_DICE' },
);
ok(gEnd.started && gEnd.dice !== null, 'partida en curso');
const gBack = reducer(gEnd, { type: 'END_GAME' });
ok(!gBack.started, 'END_GAME devuelve al panel de preparación');
ok(gBack.code === 'SALA', 'conserva el código de sala');
ok(gBack.players.length === 2, 'y conserva los jugadores');
ok(gBack.dice === null && gBack.drawnCard === null && gBack.wheel === null && gBack.pendingTrade === null,
  'limpia dados, cartas y negociaciones a medias');
ok(reducer(gBack, { type: 'END_GAME' }) === gBack, 'terminar dos veces no hace nada');
// Se puede volver a empezar: START_GAME repone dinero y mazos.
const gAgain = reducer(gBack, { type: 'START_GAME' });
ok(gAgain.started && cashOf(gAgain, ea) === gAgain.settings.initialBalance, 'volver a empezar repone el dinero');
ok(gAgain.players.find((p) => p.id === ea)!.holdings.length === 0, 'y devuelve las propiedades al banco');
ok(gAgain.decks.arca.draw.length === 16, 'y se rebarajan los mazos');

console.log('26) Jugar sin cartas (todas las modalidades apagadas)');
ok(Object.values(PACKS).every((pk) => !('fixed' in pk)), 'ninguna modalidad es obligatoria');
let gNo = createGame('NOCARD');
gNo = { ...gNo, settings: { ...gNo.settings, cardPacks: [] } };
gNo = run(gNo, { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'ADD_PLAYER', name: 'Beto' }, { type: 'START_GAME' });
const na = gNo.players[0].id;
ok(gNo.started, 'la partida empieza igual');
ok(gNo.decks.arca.draw.length === 0 && gNo.decks.fortuna.draw.length === 0, 'los mazos quedan vacíos');
ok(activeDecks([]).length === 0, 'no se ofrece ningún mazo en la barra de turno');
ok(reducer(gNo, { type: 'DRAW_CARD', deck: 'arca', playerId: na }) === gNo, 'robar no hace nada');
// El resto del juego sigue funcionando con normalidad.
const gCompraNo = reducer(gNo, { type: 'BUY_PROPERTY', playerId: na, propertyId: 'boardwalk' });
ok(gCompraNo.players[0].holdings.length === 1, 'comprar propiedades funciona sin cartas');
ok(reducer(gNo, { type: 'PLAYER_TO_BANK', playerId: na, amount: 100 }).pot === 0,
  'y sin Parada Libre el dinero va al banco, no a un bote');
// Solo una modalidad de expansión, sin las clásicas.
let gSolo = createGame('SOLO');
gSolo = { ...gSolo, settings: { ...gSolo.settings, cardPacks: ['enredos'] } };
gSolo = run(gSolo, { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'START_GAME' });
ok(gSolo.decks.arca.draw.length === cardsFor('arca', ['enredos']).length,
  'se puede jugar con una expansión y sin las clásicas');
ok(!gSolo.decks.arca.draw.includes('arca-error-bancario'), 'no se cuela ninguna carta clásica');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ok, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
