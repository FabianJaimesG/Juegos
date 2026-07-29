// Verificación de las cartas (Arca Comunal / Fortuna). Ejecutar: npx tsx scripts/test-cards.ts
import { activeDecks, CARDS, cardsFor, copiesOf, deckIds, getCard, isAutomatic, PACKS, packSize, WHEEL } from '../src/domain/cards';
import { canCancelTrade, canRespondToTrade, canUseCard, createGame, reducer, whyCannotUseCard, winnerOf, type Action, type GameState } from '../src/game/engine';
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
/** Roba una carta que se guarda y la usa en el acto (para probar su efecto). */
const playKeep = (s: GameState, cardId: string, playerId: string): GameState =>
  reducer(play(s, cardId, playerId), { type: 'USE_CARD', playerId, cardId });

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
// Solo se puede usar estando preso: si no, no se consume.
ok(reducer(gj, { type: 'USE_CARD', playerId: beto, cardId: 'arca-salir-carcel' }) === gj,
  'estando libre, la carta no se gasta');
gj = reducer(gj, { type: 'GO_TO_JAIL', playerId: beto });
gj = reducer(gj, { type: 'USE_CARD', playerId: beto, cardId: 'arca-salir-carcel' });
ok(gj.players.find((p) => p.id === beto)!.tokens.length === 0, 'estando preso sí sale de la mano');
ok(gj.players.find((p) => p.id === beto)!.jail === 0, 'y lo saca de la cárcel');
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
ok(gPL.decks.bonificacion.draw.length === 24 - 2 * gPL.players.length, 'el mazo se baraja y se reparte al empezar');
ok(gPL.players.every((p) => p.spins === 2), 'cada jugador recibe 2 fichas de giro');
ok(gPL.players.every((p) => p.tokens.length === 2), 'y 2 cartas de Bonificación repartidas en la mano');
ok(gPL.decks.bonificacion.draw.length === 24 - 2 * gPL.players.length, 'que salen del mazo');
ok(gPL.pot === 0 && gPL.limoPlayerId === null, 'bote vacío y sin limusina al empezar');

console.log('12) El bote');
let gPot = reducer(gPL, { type: 'POT_ADD', amount: 200 });
ok(gPot.pot === 200, 'un impuesto del banco entra al bote');
gPot = reducer(gPot, { type: 'POT_ADD', amount: 100, playerId: pa });
ok(gPot.pot === 300 && cashOf(gPot, pa) === 1400, 'un jugador paga al bote y se le descuenta');
const gPobre = reducer({ ...gPot, players: gPot.players.map((p) => (p.id === pb ? { ...p, cash: 50 } : p)) },
  { type: 'POT_ADD', amount: 100, playerId: pb });
ok(gPobre.pot === 300, 'no se puede pagar al bote sin fondos');
const gPremio = playKeep(gPot, 'par-gran-premio', pb);
ok(gPremio.pot === 0 && cashOf(gPremio, pb) === 1800, 'Gran Premio vacía el bote al ganador');
const gVacio = playKeep(gPL, 'par-gran-premio', pb);
ok(cashOf(gVacio, pb) === 1500, 'con el bote vacío no cobra nada');

console.log('13) La limusina dorada');
let gLimo = playKeep(gPL, 'par-limusina', pa);
ok(gLimo.limoPlayerId === pa, 'la carta de mejora te da la limusina');
gLimo = reducer(gLimo, { type: 'SET_LIMO', playerId: pb });
ok(gLimo.limoPlayerId === pb, 'otro jugador se la puede llevar');
gLimo = reducer(gLimo, { type: 'SET_LIMO', playerId: null });
ok(gLimo.limoPlayerId === null, 'se pierde al ir a la cárcel');
const gQuiebra = reducer(playKeep(gPL, 'par-limusina', pa), { type: 'DECLARE_BANKRUPTCY', playerId: pa });
ok(gQuiebra.limoPlayerId === null, 'la bancarrota también la suelta');

console.log('14) Casa gratis (se salta las reglas de grupo)');
let gCasa = run(gPL, { type: 'BUY_PROPERTY', playerId: pa, propertyId: 'mediterranean' });
const cashAntes = cashOf(gCasa, pa);
const gNormal = reducer(gCasa, { type: 'BUILD_HOUSE', playerId: pa, propertyId: 'mediterranean' });
ok(gNormal === gCasa, 'sin el grupo completo NO se puede construir normalmente');
gCasa = reducer(gCasa, { type: 'GRANT_PERK', playerId: pa, perk: 'freeHouses' });
gCasa = reducer(gCasa, { type: 'BUILD_HOUSE', playerId: pa, propertyId: 'mediterranean', free: true });
ok(gCasa.players.find((p) => p.id === pa)!.holdings[0].houses === 1, 'con la carta sí se construye');
ok(cashOf(gCasa, pa) === cashAntes, 'y no cuesta nada');

console.log('15) Cartas que se guardan (comportamiento general)');
const manoInicial = gPL.players.find((p) => p.id === pa)!.tokens.length;
let gKeep = run(stack(gPL, 'par-sin-renta'), { type: 'DRAW_CARD', deck: 'bonificacion', playerId: pa }, { type: 'RESOLVE_CARD' });
ok(gKeep.players.find((p) => p.id === pa)!.tokens.length === manoInicial + 1, 'la carta de exención se guarda en la mano');
ok(gKeep.decks.bonificacion.discard.length === 0, 'no se descarta mientras se conserva');
gKeep = reducer(gKeep, { type: 'USE_CARD', playerId: pa, cardId: 'par-sin-renta' });
ok(gKeep.players.find((p) => p.id === pa)!.tokens.length === manoInicial, 'al usarla sale de la mano');
ok(gKeep.decks.bonificacion.discard[0] === 'par-sin-renta', 'y vuelve al descarte para volver a salir');
// Con dos copias iguales en mano se gasta solo una.
const dos = { ...gPL, players: gPL.players.map((p) => (p.id === pa ? { ...p, tokens: ['par-sin-renta', 'par-sin-renta'] } : p)) };
const unaMenos = reducer(dos, { type: 'USE_CARD', playerId: pa, cardId: 'par-sin-renta' });
ok(unaMenos.players.find((p) => p.id === pa)!.tokens.length === 1, 'gastar una copia deja la otra');
ok(CARDS.filter((c) => c.keep).length === 3 + cardsFor('bonificacion', ['parada-libre']).length,
  'se conservan las 3 de cárcel/indulto más todas las de Bonificación');

console.log('16) Fichas');
const gGasta = reducer(gPL, { type: 'SPEND_TOKEN', playerId: pa, token: 'spins' });
ok(gGasta.players.find((p) => p.id === pa)!.spins === 1, 'gastar una ficha de giro');
const gSin = reducer({ ...gPL, players: gPL.players.map((p) => ({ ...p, spins: 0 })) },
  { type: 'SPEND_TOKEN', playerId: pa, token: 'spins' });
ok(gSin.players.find((p) => p.id === pa)!.spins === 0, 'no se puede gastar de más');

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
ok(anaW.tokens.length === 3, 'y entrega una carta de Bonificación a la mano');
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
ok(betoL.tokens.length === 3, 'y una carta de Bonificación a la mano');

console.log('21) Negociar cartas y fichas');
// Ana tiene 2 exenciones; Beto, una de cárcel.
const conCartas: GameState = {
  ...gPL,
  players: gPL.players.map((p) =>
    p.id === pa ? { ...p, tokens: ['par-sin-renta', 'par-sin-renta'], spins: 2 }
    : { ...p, tokens: ['par-renta-doble'], spins: 0 }),
};
let gT = reducer(conCartas, {
  type: 'PROPOSE_TRADE',
  trade: { aId: pa, bId: pb, aCash: 0, bCash: 0, aProps: [], bProps: [],
           aCards: ['par-sin-renta'], bCards: ['par-renta-doble'], aSpins: 1, bSpins: 0 },
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
           aCards: ['arca-salir-carcel'], bCards: [], aSpins: 0, bSpins: 0 },
});
const falsoOk = reducer(falso, { type: 'ACCEPT_TRADE' });
ok(falsoOk.players.find((p) => p.id === pb)!.tokens.length === 1, 'ofrecer una carta que no tienes no transfiere nada');
const muchas = reducer(conCartas, {
  type: 'PROPOSE_TRADE',
  trade: { aId: pa, bId: pb, aCash: 0, bCash: 0, aProps: [], bProps: [],
           aCards: [], bCards: [], aSpins: 99, bSpins: 0 },
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

console.log('27) Créditos: casa y propiedad gratis se eligen al usarlas');
const bonif = ['base', 'parada-libre'];
let gP = createGame('PERK');
gP = { ...gP, settings: { ...gP.settings, cardPacks: bonif } };
gP = run(gP, { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'ADD_PLAYER', name: 'Beto' }, { type: 'START_GAME' });
const [qa] = gP.players.map((p) => p.id);
const perks = (st: GameState, id: string) => st.players.find((p) => p.id === id)!;

// Todas las de Bonificación se guardan en la mano.
ok(cardsFor('bonificacion', bonif).every((c) => c.keep), 'todas las de Bonificación se conservan');
let gH = run(stack(gP, 'par-casa-gratis'), { type: 'DRAW_CARD', deck: 'bonificacion', playerId: qa }, { type: 'RESOLVE_CARD' });
ok(perks(gH, qa).tokens.filter((t) => t === 'par-casa-gratis').length >= 1, 'robarla la guarda en la mano, no la aplica');
ok(perks(gH, qa).freeHouses === 0, 'todavía no hay casa gratis pendiente');
gH = reducer(gH, { type: 'USE_CARD', playerId: qa, cardId: 'par-casa-gratis' });
ok(perks(gH, qa).freeHouses === 1, 'al usarla queda un crédito de casa gratis');

// Sin el grupo completo, pero con crédito, sí se puede construir donde elija.
gH = reducer(gH, { type: 'BUY_PROPERTY', playerId: qa, propertyId: 'mediterranean' });
const cashPrev = cashOf(gH, qa);
const gBuilt = reducer(gH, { type: 'BUILD_HOUSE', playerId: qa, propertyId: 'mediterranean', free: true });
ok(gBuilt.players.find((p) => p.id === qa)!.holdings[0].houses === 1, 'coloca la casa donde elige');
ok(cashOf(gBuilt, qa) === cashPrev, 'sin coste');
ok(perks(gBuilt, qa).freeHouses === 0, 'y consume el crédito');
ok(reducer(gBuilt, { type: 'BUILD_HOUSE', playerId: qa, propertyId: 'mediterranean', free: true }) === gBuilt,
  'sin crédito no se puede volver a construir gratis');

// Propiedad gratis: hace falta crédito o limusina.
ok(reducer(gP, { type: 'BUY_PROPERTY', playerId: qa, propertyId: 'boardwalk', free: true }) === gP,
  'sin crédito ni limusina no hay propiedad gratis');
let gF = reducer(gP, { type: 'GRANT_PERK', playerId: qa, perk: 'freeProps' });
gF = reducer(gF, { type: 'BUY_PROPERTY', playerId: qa, propertyId: 'boardwalk', free: true });
ok(perks(gF, qa).holdings.length === 1 && cashOf(gF, qa) === 1500, 'con crédito se queda la propiedad sin pagar');
ok(perks(gF, qa).freeProps === 0, 'y consume el crédito');
// Con limusina no se gasta crédito (vale mientras la lleve).
let gL = { ...gP, limoPlayerId: qa };
gL = reducer(gL, { type: 'BUY_PROPERTY', playerId: qa, propertyId: 'parkplace', free: true });
ok(perks(gL, qa).holdings.length === 1 && perks(gL, qa).freeProps === 0, 'la limusina no consume créditos');

console.log('28) Caer en la Parada Libre da también un giro');
const gLand2 = reducer({ ...gP, pot: 100 }, { type: 'LAND_FREE_PARKING', playerId: qa });
const anaL = perks(gLand2, qa);
ok(anaL.spins === 3, 'suma una ficha de giro');
ok(anaL.tokens.length === 3, 'y una carta de Bonificación a la mano');
ok(gLand2.limoPlayerId === qa && cashOf(gLand2, qa) === 1600, 'más la limusina y el bote');

console.log('29) La ruleta lleva sus etiquetas');
ok(WHEEL.every((f) => f.short.length > 0), 'todos los sectores tienen texto corto');
ok(WHEEL.some((f) => f.short.includes('GRAN PREMIO')), 'incluye el Gran Premio');

console.log('30) Intercambio forzoso: elegido y sin aprobación');
let gS = createGame('SWAP');
gS = { ...gS, settings: { ...gS.settings, cardPacks: ['base', 'parada-libre'] } };
gS = run(gS, { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'ADD_PLAYER', name: 'Beto' }, { type: 'START_GAME' });
const [sa, sb] = gS.players.map((p) => p.id);
gS = run(gS,
  { type: 'BUY_PROPERTY', playerId: sa, propertyId: 'mediterranean' },
  { type: 'BUY_PROPERTY', playerId: sb, propertyId: 'boardwalk' },
);
const own = (st: GameState, id: string) => st.players.find((p) => p.id === id)!.holdings.map((h) => h.propertyId);
// Sin crédito no se puede forzar nada.
ok(reducer(gS, { type: 'FORCE_SWAP', aId: sa, bId: sb, aProp: 'mediterranean', bProp: 'boardwalk' }) === gS,
  'sin la carta no hay intercambio forzoso');
let gSw = reducer(gS, { type: 'GRANT_PERK', playerId: sa, perk: 'forceSwaps' });
gSw = reducer(gSw, { type: 'FORCE_SWAP', aId: sa, bId: sb, aProp: 'mediterranean', bProp: 'boardwalk' });
ok(own(gSw, sa).includes('boardwalk') && !own(gSw, sa).includes('mediterranean'), 'Ana se lleva la que eligió');
ok(own(gSw, sb).includes('mediterranean') && !own(gSw, sb).includes('boardwalk'), 'y entrega la suya');
ok(gSw.pendingTrade === null, 'no queda ninguna propuesta pendiente: no hace falta aprobación');
ok(perks(gSw, sa).forceSwaps === 0, 'consume el crédito');
// Con casas encima no se puede (igual que en una negociación).
let gCasas = reducer(gS, { type: 'GRANT_PERK', playerId: sa, perk: 'forceSwaps' });
gCasas = run(gCasas,
  { type: 'BUY_PROPERTY', playerId: sa, propertyId: 'baltic' },
  { type: 'BUILD_HOUSE', playerId: sa, propertyId: 'mediterranean' },
);
ok(reducer(gCasas, { type: 'FORCE_SWAP', aId: sa, bId: sb, aProp: 'mediterranean', bProp: 'boardwalk' }).players
  .find((p) => p.id === sb)!.holdings.some((h) => h.propertyId === 'boardwalk'),
  'una propiedad con casas no se puede forzar');
// La carta deja el crédito al usarla.
const gCarta3 = playKeep(gS, 'par-intercambio', sa);
ok(perks(gCarta3, sa).forceSwaps === 1, 'la carta 🔀 deja un intercambio pendiente');

console.log('31) Anuncio de los dados (lo que se lee en voz alta)');
const rollWith = (faceIdx: number | null): string => {
  const base = faceIdx === null
    ? { ...g, settings: { ...g.settings, special: false } }
    : { ...g, settings: { ...g.settings, special: true } };
  const real = Math.random;
  let call = 0;
  // 1º y 2º valores = dados (3 y 4); 3º = elección de cara especial.
  Math.random = () => (call++ < 2 ? [0.4, 0.6][call - 1] : (faceIdx ?? 0) / 6);
  try { return reducer(base, { type: 'ROLL_DICE' }).log[0].text; } finally { Math.random = real; }
};
const sinEsp = rollWith(null);
ok(/^🎲 \d+$/.test(sinEsp), `sin dado especial solo se dice el total (${sinEsp})`);
ok(!sinEsp.includes('+'), 'no se leen los dados por separado');
const x2 = rollWith(0);
ok(/^🎲 \d+$/.test(x2), `dobles: solo el resultado final (${x2})`);
const b6 = rollWith(1);
ok(/^🎲 \d+$/.test(b6), `+6: solo el total (${b6})`);
const elige = rollWith(2);
ok(/^🎲 \d+ o \d+ o \d+$/.test(elige), `elegir: x o y o z (${elige})`);
const especial = rollWith(5);
ok(especial.includes('avanza a la siguiente propiedad') && /🎲 \d+,/.test(especial),
  `las demás: suma + el efecto (${especial})`);

console.log('32) Quién puede responder una negociación');
let gN = run(createGame('NEG'),
  { type: 'ADD_PLAYER', name: 'Ana', admin: true },
  { type: 'ADD_PLAYER', name: 'Beto' },
  { type: 'ADD_PLAYER', name: 'Caro' },
  { type: 'START_GAME' },
);
const [ja, jb, jc] = gN.players.map((p) => p.id);
// Todos con su propio dispositivo.
gN = run(gN,
  { type: 'CLAIM_PLAYER', playerId: ja, deviceId: 'd-ana' },
  { type: 'CLAIM_PLAYER', playerId: jb, deviceId: 'd-beto' },
  { type: 'CLAIM_PLAYER', playerId: jc, deviceId: 'd-caro' },
  { type: 'BUY_PROPERTY', playerId: ja, propertyId: 'boardwalk' },
);
// Ana (admin) le propone a Beto.
gN = reducer(gN, { type: 'PROPOSE_TRADE', trade: { aId: ja, bId: jb, aCash: 0, bCash: 100, aProps: ['boardwalk'], bProps: [] } });
ok(canRespondToTrade(gN, jb, false), 'el destinatario puede responder');
ok(!canRespondToTrade(gN, ja, true), 'el proponente NO puede, aunque sea admin');
ok(!canRespondToTrade(gN, jc, false), 'un tercero no puede');
ok(!canRespondToTrade(gN, null, true), 'el modo TV no puede');
// Un admin que no es parte tampoco responde por el destinatario si este tiene dispositivo.
const gAdmin3 = { ...gN, players: gN.players.map((p) => (p.id === jc ? { ...p, admin: true } : p)) };
ok(!canRespondToTrade(gAdmin3, jc, true), 'un admin ajeno no responde por el destinatario');
// Partida en un solo dispositivo: el destinatario no ha reclamado ninguno.
const gSolo2 = { ...gN, players: gN.players.map((p) => (p.id === jb ? { ...p, claimedBy: undefined } : p)) };
ok(canRespondToTrade(gSolo2, jc, true), 'si el destinatario no tiene dispositivo, un admin responde por él');
ok(!canRespondToTrade(gSolo2, ja, true), 'pero el proponente sigue sin poder');
// Retirar la oferta.
ok(canCancelTrade(gN, ja, false), 'el proponente puede retirar su oferta');
ok(!canCancelTrade(gN, jb, false), 'el destinatario no la retira: la rechaza');
ok(!canCancelTrade(gN, jc, false), 'un tercero tampoco');
// Y sin propuesta, nadie puede nada.
const gLimpio = reducer(gN, { type: 'REJECT_TRADE' });
ok(!canRespondToTrade(gLimpio, jb, false) && !canCancelTrade(gLimpio, ja, false), 'sin propuesta no hay nada que responder');

console.log('33) La bancarrota limpia lo que dejaría atascado');
// Caro roba una carta que no puede pagar y se declara en bancarrota.
let gQ = { ...g, players: g.players.map((p) => (p.id === caro ? { ...p, cash: 20 } : p)) };
gQ = run(stack(gQ, 'arca-hospital'), { type: 'DRAW_CARD', deck: 'arca', playerId: caro }, { type: 'RESOLVE_CARD' });
ok(gQ.drawnCard !== null, 'la carta queda pendiente porque no le alcanza');
ok(reducer(gQ, { type: 'DRAW_CARD', deck: 'fortuna', playerId: ana }) === gQ, 'y nadie más puede robar');
const gQuit = reducer(gQ, { type: 'DECLARE_BANKRUPTCY', playerId: caro });
ok(gQuit.drawnCard === null, 'al declararse en bancarrota, su carta pendiente desaparece');
ok(gQuit.decks.arca.discard.includes('arca-hospital'), 'y vuelve al descarte');
ok(reducer(gQuit, { type: 'DRAW_CARD', deck: 'fortuna', playerId: ana }).drawnCard !== null,
  'el mazo vuelve a estar libre para los demás');
// La carta pendiente de OTRO no se toca.
let gOtro = run(stack(g, 'arca-hospital'), { type: 'DRAW_CARD', deck: 'arca', playerId: ana });
gOtro = reducer(gOtro, { type: 'DECLARE_BANKRUPTCY', playerId: caro });
ok(gOtro.drawnCard?.playerId === ana, 'la carta de otro jugador sigue en pie');
// Ruleta y negociación suyas también se limpian.
const gRul = reducer({ ...gPL, wheel: { faceId: 'w-100', playerId: pa } }, { type: 'DECLARE_BANKRUPTCY', playerId: pa });
ok(gRul.wheel === null, 'su tirada de ruleta se cierra');
let gTr = reducer(g, { type: 'PROPOSE_TRADE', trade: { aId: ana, bId: caro, aCash: 50, bCash: 0, aProps: [], bProps: [] } });
ok(gTr.pendingTrade !== null, 'hay una negociación en curso');
gTr = reducer(gTr, { type: 'DECLARE_BANKRUPTCY', playerId: caro });
ok(gTr.pendingTrade === null, 'la negociación en la que participaba se cancela');
// Una negociación ajena sobrevive.
let gTr2 = run(g,
  { type: 'ADD_PLAYER', name: 'Dani' },
  { type: 'PROPOSE_TRADE', trade: { aId: ana, bId: beto, aCash: 50, bCash: 0, aProps: [], bProps: [] } },
);
gTr2 = reducer(gTr2, { type: 'DECLARE_BANKRUPTCY', playerId: caro });
ok(gTr2.pendingTrade !== null, 'una negociación entre otros no se cancela');

console.log('34) Ganador: el último en pie');
let gW2 = run(createGame('WIN'),
  { type: 'ADD_PLAYER', name: 'Ana' },
  { type: 'ADD_PLAYER', name: 'Beto' },
  { type: 'ADD_PLAYER', name: 'Caro' },
  { type: 'START_GAME' },
);
const [wa, wb, wc] = gW2.players.map((p) => p.id);
ok(winnerOf(gW2) === null, 'con tres jugando no hay ganador');
gW2 = reducer(gW2, { type: 'DECLARE_BANKRUPTCY', playerId: wb });
ok(winnerOf(gW2) === null, 'con dos en pie tampoco');
gW2 = reducer(gW2, { type: 'DECLARE_BANKRUPTCY', playerId: wc });
ok(winnerOf(gW2)?.id === wa, 'al quedar uno solo, ese es el ganador');
ok(gW2.log[0].text.includes('gana la partida'), 'se anuncia en el historial (y la voz lo lee)');
ok(gW2.log[0].text.includes('Ana'), 'con su nombre');
// No se proclama ganador antes de empezar ni en solitario.
const gPrep = run(createGame('W2'), { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'ADD_PLAYER', name: 'Beto' });
ok(winnerOf(gPrep) === null, 'en la preparación no hay ganador');
const gUno = run(createGame('W3'), { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'START_GAME' });
ok(winnerOf(gUno) === null, 'con un solo jugador en la partida, tampoco');
// Volver a empezar borra la victoria.
const gOtra = reducer(reducer(gW2, { type: 'END_GAME' }), { type: 'START_GAME' });
ok(winnerOf(gOtra) === null, 'al reiniciar ya no hay ganador (vuelven todos)');

console.log('35) Una carta no se gasta si ahora no haría nada');
const conCarta = (st: GameState, id: string, cardId: string): GameState =>
  ({ ...st, players: st.players.map((p) => (p.id === id ? { ...p, tokens: [cardId] } : p)) });

// Indulto: solo estando preso.
const libre = conCarta(g, ana, 'arca-salir-carcel');
ok(!canUseCard(libre, libre.players.find((p) => p.id === ana)!, 'arca-salir-carcel'), 'sin estar preso no se puede usar');
ok(whyCannotUseCard(libre, libre.players.find((p) => p.id === ana)!, 'arca-salir-carcel')
  === 'Solo sirve estando en la cárcel', 'y dice por qué');
const gGasto = reducer(libre, { type: 'USE_CARD', playerId: ana, cardId: 'arca-salir-carcel' });
ok(gGasto === libre, 'usarla fuera de la cárcel no la consume');
const preso = reducer(libre, { type: 'GO_TO_JAIL', playerId: ana });
ok(canUseCard(preso, preso.players.find((p) => p.id === ana)!, 'arca-salir-carcel'), 'estando preso sí');
const gSale = reducer(preso, { type: 'USE_CARD', playerId: ana, cardId: 'arca-salir-carcel' });
ok(gSale.players.find((p) => p.id === ana)!.jail === 0, 'y sale de la cárcel');
ok(gSale.players.find((p) => p.id === ana)!.tokens.length === 0, 'gastando la carta');

// Gran Premio con el bote vacío: no se malgasta.
const sinBote = conCarta({ ...gPL, pot: 0 }, pa, 'par-gran-premio');
ok(!canUseCard(sinBote, sinBote.players.find((p) => p.id === pa)!, 'par-gran-premio'), 'no se usa con el bote vacío');
ok(reducer(sinBote, { type: 'USE_CARD', playerId: pa, cardId: 'par-gran-premio' }) === sinBote, 'y no se consume');
const conBote = { ...sinBote, pot: 300 };
ok(canUseCard(conBote, conBote.players.find((p) => p.id === pa)!, 'par-gran-premio'), 'con bote sí se puede');

// Limusina: no se gasta si ya la llevas.
const yaLimo = { ...conCarta(gPL, pa, 'par-limusina'), limoPlayerId: pa };
ok(!canUseCard(yaLimo, yaLimo.players.find((p) => p.id === pa)!, 'par-limusina'), 'no se gasta si ya la tienes');

// Las demás no tienen restricción.
const casa = conCarta(gPL, pa, 'par-casa-gratis');
ok(canUseCard(casa, casa.players.find((p) => p.id === pa)!, 'par-casa-gratis'), 'la casa gratis se puede usar siempre');

console.log('36) Salida automática de la cárcel');
let gAuto = run(createGame('JAIL'),
  { type: 'ADD_PLAYER', name: 'Ana' }, { type: 'ADD_PLAYER', name: 'Beto' }, { type: 'START_GAME' });
const [ka] = gAuto.players.map((p) => p.id);
gAuto = reducer(gAuto, { type: 'GO_TO_JAIL', playerId: ka });
const turnos = (st: GameState): GameState => reducer(reducer(st, { type: 'NEXT_TURN' }), { type: 'NEXT_TURN' });
gAuto = turnos(gAuto);
ok(gAuto.players.find((p) => p.id === ka)!.jail === 2, 'segunda ronda: sigue preso');
gAuto = turnos(gAuto);
ok(gAuto.players.find((p) => p.id === ka)!.jail === 3, 'tercera: sigue preso');
gAuto = turnos(gAuto);
ok(gAuto.players.find((p) => p.id === ka)!.jail === 0, 'a la cuarta sale solo, sin tocar ningún botón');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ok, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
