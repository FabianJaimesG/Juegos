// Tipos base del dominio de "Banca" (Monopoly clásico).

export type PropertyKind = 'street' | 'railroad' | 'utility';

/** Grupos de color del tablero clásico + los dos grupos especiales. */
export type ColorGroup =
  | 'brown'
  | 'lightblue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'darkblue'
  | 'railroad'
  | 'utility';

/**
 * Definición inmutable de una propiedad del tablero (catálogo).
 * `rent` cambia de significado según `kind`:
 *  - street:   [base, 1 casa, 2, 3, 4, hotel]
 *  - railroad: [1 ferrocarril, 2, 3, 4]  (renta según cuántos posea el dueño)
 *  - utility:  [multiplicadorConUno, multiplicadorConDos]  (renta = dados * multiplicador)
 */
export interface PropertyDef {
  /** slug estable, p. ej. "boardwalk". */
  id: string;
  boardIndex: number;
  name: string;
  kind: PropertyKind;
  colorGroup: ColorGroup;
  price: number;
  mortgage: number;
  /** Costo por casa (0 en ferrocarriles y servicios). */
  houseCost: number;
  rent: number[];
  expansion: string;
  /** Emoji temático para la visualización de la tarjeta. */
  emoji: string;
}

/** Contexto necesario para calcular la renta de una propiedad en una jugada. */
export interface RentContext {
  /** Casas construidas (0..4; 5 = hotel). Solo aplica a calles. */
  houses: number;
  /** ¿El dueño posee TODAS las propiedades de este grupo de color? (renta doble sin casas). */
  ownerHasFullGroup: boolean;
  /** Cuántos ferrocarriles posee el dueño (para renta de ferrocarril). */
  railroadsOwned: number;
  /** Cuántos servicios posee el dueño (para renta de servicio). */
  utilitiesOwned: number;
  /** Suma de los dados de la última tirada (para servicios). */
  diceTotal: number;
}
