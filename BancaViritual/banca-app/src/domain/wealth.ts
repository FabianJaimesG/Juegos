import { BOARD, getProperty, groupProperties } from './board';
import { GAME_CONFIG } from './config';
import type { ColorGroup } from './types';

/** Tenencia de una propiedad por un jugador dentro de una partida. */
export interface Holding {
  propertyId: string;
  houses: number; // 0..4; 5 = hotel
  mortgaged: boolean;
}

/** Estado patrimonial de un jugador (efectivo + tenencias). */
export interface PlayerHoldings {
  cash: number;
  holdings: Holding[];
}

const HOTEL_HOUSES = 5;

/** Valor en propiedades (activas por su precio; hipotecadas por su valor de hipoteca). */
export function propertiesValue(h: PlayerHoldings): number {
  return h.holdings.reduce((sum, hold) => {
    const p = getProperty(hold.propertyId);
    if (!p) return sum;
    return sum + p.liquidationValue(hold.mortgaged);
  }, 0);
}

/** Valor invertido en casas/hoteles: casas × costo de casa del grupo. */
export function housesValue(h: PlayerHoldings): number {
  return h.holdings.reduce((sum, hold) => {
    const p = getProperty(hold.propertyId);
    if (!p || !p.isBuildable) return sum;
    return sum + hold.houses * p.houseCost;
  }, 0);
}

/** Patrimonio (sin efectivo): propiedades + casas. */
export function equity(h: PlayerHoldings): number {
  return propertiesValue(h) + housesValue(h);
}

/** Patrimonio total = efectivo + patrimonio. */
export function netWorth(h: PlayerHoldings): number {
  return h.cash + equity(h);
}

/** Conteo de casas (excluyendo hoteles) y de hoteles ("castillos"). */
export function buildingCounts(h: PlayerHoldings): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const hold of h.holdings) {
    if (hold.houses >= HOTEL_HOUSES) hotels += 1;
    else houses += hold.houses;
  }
  return { houses, hotels };
}

/** ¿El jugador posee TODAS las propiedades de un grupo de color? */
export function ownsFullGroup(h: PlayerHoldings, group: ColorGroup): boolean {
  const groupIds = groupProperties(group).map((p) => p.id);
  const owned = new Set(h.holdings.map((x) => x.propertyId));
  return groupIds.length > 0 && groupIds.every((id) => owned.has(id));
}

/**
 * ¿Posee el grupo COMPLETO y con NINGUNA hipotecada? Para la renta activa: si
 * cualquier propiedad del grupo está hipotecada, el bono de set no aplica.
 */
export function ownsFullGroupActive(h: PlayerHoldings, group: ColorGroup): boolean {
  if (!ownsFullGroup(h, group)) return false;
  const mortgaged = new Set(h.holdings.filter((x) => x.mortgaged).map((x) => x.propertyId));
  return groupProperties(group).every((p) => !mortgaged.has(p.id));
}

/** Grupos de color donde el jugador ya puede construir (grupo completo y sin hipotecas). */
export function buildableGroups(h: PlayerHoldings): ColorGroup[] {
  const groups = new Set(
    h.holdings
      .map((x) => getProperty(x.propertyId)?.colorGroup)
      .filter((g): g is ColorGroup => !!g && g !== 'railroad' && g !== 'utility'),
  );
  const mortgagedIds = new Set(h.holdings.filter((x) => x.mortgaged).map((x) => x.propertyId));
  return [...groups].filter((g) => {
    if (!ownsFullGroup(h, g)) return false;
    // Regla clásica: no se puede construir si alguna del grupo está hipotecada.
    return groupProperties(g).every((p) => !mortgagedIds.has(p.id));
  });
}

/** Cuántos ferrocarriles / servicios posee el jugador (para renta). */
export function countByKind(h: PlayerHoldings): { railroads: number; utilities: number } {
  let railroads = 0;
  let utilities = 0;
  for (const hold of h.holdings) {
    const p = getProperty(hold.propertyId);
    if (p?.kind === 'railroad') railroads += 1;
    if (p?.kind === 'utility') utilities += 1;
  }
  return { railroads, utilities };
}

/**
 * Cuenta solo ferrocarriles / servicios NO hipotecados (para la renta activa):
 * una propiedad hipotecada no cuenta para el escalón de renta de las demás.
 */
export function activeCountByKind(h: PlayerHoldings): { railroads: number; utilities: number } {
  let railroads = 0;
  let utilities = 0;
  for (const hold of h.holdings) {
    if (hold.mortgaged) continue;
    const p = getProperty(hold.propertyId);
    if (p?.kind === 'railroad') railroads += 1;
    if (p?.kind === 'utility') utilities += 1;
  }
  return { railroads, utilities };
}

/** Total de casas/hoteles disponibles en el banco (definido en config.ts). */
export const BANK_HOUSES = GAME_CONFIG.bankHouses;
export const BANK_HOTELS = GAME_CONFIG.bankHotels;

/** Casas y hoteles aún disponibles en el banco, dados los ya construidos por todos. */
export function availableBuildings(all: PlayerHoldings[]): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const h of all) {
    const c = buildingCounts(h);
    houses += c.houses;
    hotels += c.hotels;
  }
  return { houses: BANK_HOUSES - houses, hotels: BANK_HOTELS - hotels };
}

/**
 * Verificación para construir en una propiedad. `enforceEven` (por defecto true)
 * aplica la regla clásica de construcción pareja dentro del grupo.
 */
export function canBuildOn(h: PlayerHoldings, propertyId: string, enforceEven = true): boolean {
  const p = getProperty(propertyId);
  if (!p || !p.isBuildable) return false;
  if (!buildableGroups(h).includes(p.colorGroup)) return false;
  const groupHoldings = h.holdings.filter(
    (x) => getProperty(x.propertyId)?.colorGroup === p.colorGroup,
  );
  const target = groupHoldings.find((x) => x.propertyId === propertyId);
  if (!target || target.houses >= HOTEL_HOUSES) return false;
  if (!enforceEven) return true;
  const minHouses = Math.min(...groupHoldings.map((x) => x.houses));
  // Solo se puede construir en la que va a la par o por debajo del mínimo del grupo.
  return target.houses === minHouses;
}

/**
 * Verificación para vender una casa. Con `enforceEven` (por defecto true) solo se
 * puede vender de la propiedad con el MÁXIMO de casas del grupo (venta pareja).
 */
export function canSellOn(h: PlayerHoldings, propertyId: string, enforceEven = true): boolean {
  const p = getProperty(propertyId);
  if (!p || !p.isBuildable) return false;
  const groupHoldings = h.holdings.filter(
    (x) => getProperty(x.propertyId)?.colorGroup === p.colorGroup,
  );
  const target = groupHoldings.find((x) => x.propertyId === propertyId);
  if (!target || target.houses <= 0) return false;
  if (!enforceEven) return true;
  const maxHouses = Math.max(...groupHoldings.map((x) => x.houses));
  // Solo se puede vender de la que va a la par o por encima del máximo del grupo.
  return target.houses === maxHouses;
}

// Reexport para conveniencia.
export { BOARD };
