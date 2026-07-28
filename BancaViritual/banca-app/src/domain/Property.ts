import { GAME_CONFIG } from './config';
import type { ColorGroup, PropertyDef, PropertyKind, RentContext } from './types';

/**
 * Clase reutilizable que envuelve la definición de una propiedad y expone la
 * lógica del Monopoly clásico: renta según casas / cantidad / dados, hipoteca,
 * y si es construible.
 */
export class Property {
  readonly def: PropertyDef;

  constructor(def: PropertyDef) {
    this.def = def;
  }

  get id(): string {
    return this.def.id;
  }
  get name(): string {
    return this.def.name;
  }
  get kind(): PropertyKind {
    return this.def.kind;
  }
  get colorGroup(): ColorGroup {
    return this.def.colorGroup;
  }
  get price(): number {
    return this.def.price;
  }
  get mortgageValue(): number {
    return this.def.mortgage;
  }
  /** Costo para deshipotecar: hipoteca + recargo (config; clásico 10%). */
  get unmortgageCost(): number {
    return Math.round(this.def.mortgage * (1 + GAME_CONFIG.unmortgageSurchargeRate));
  }
  get houseCost(): number {
    return this.def.houseCost;
  }
  get isBuildable(): boolean {
    return this.def.kind === 'street' && this.def.houseCost > 0;
  }

  /** Renta a cobrar dada la situación de la partida. Hipotecada => 0. */
  rent(ctx: RentContext, mortgaged = false): number {
    if (mortgaged) return 0;
    switch (this.def.kind) {
      case 'street':
        return this.streetRent(ctx);
      case 'railroad':
        return this.railroadRent(ctx.railroadsOwned);
      case 'utility':
        return this.utilityRent(ctx.utilitiesOwned, ctx.diceTotal);
    }
  }

  private streetRent(ctx: RentContext): number {
    const r = this.def.rent;
    const houses = Math.max(0, Math.min(ctx.houses, r.length - 1));
    if (houses === 0) {
      // Solar sin construir: renta doble si se posee el grupo completo.
      return ctx.ownerHasFullGroup ? r[0] * 2 : r[0];
    }
    return r[houses];
  }

  private railroadRent(owned: number): number {
    const r = this.def.rent; // [1rr, 2, 3, 4]
    const idx = Math.max(1, Math.min(owned, r.length)) - 1;
    return r[idx];
  }

  private utilityRent(owned: number, diceTotal: number): number {
    const [mulOne, mulBoth] = this.def.rent; // [x4, x10]
    const mul = owned >= 2 ? mulBoth : mulOne;
    return diceTotal * mul;
  }

  /** Valor de liquidación que aporta al patrimonio (sin contar casas). */
  liquidationValue(mortgaged = false): number {
    // Hipotecada vale su valor de hipoteca; activa, su precio de compra.
    return mortgaged ? this.def.mortgage : this.def.price;
  }
}
