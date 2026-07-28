import type { ColorGroup, PropertyDef } from './types';
import { Property } from './Property';

/**
 * Metadatos por grupo de color: color visual, costo de casa y emoji temático.
 *
 * ⚠️ Costo de casa (clásico estándar): brown/lightblue=50, pink/orange=100,
 * red/yellow=150, green/darkblue=200. El usuario mencionó 50/100/200 para 3 lados;
 * si tu tablero NO tiene el lado de 150, cambia `houseCost` de red/yellow a 200 aquí.
 */
export const GROUPS: Record<
  ColorGroup,
  { label: string; color: string; houseCost: number; emoji: string }
> = {
  brown: { label: 'Marrón', color: '#955436', houseCost: 50, emoji: '🏚️' },
  lightblue: { label: 'Celeste', color: '#aae0fa', houseCost: 50, emoji: '🏠' },
  pink: { label: 'Rosa', color: '#d93a96', houseCost: 100, emoji: '🏡' },
  orange: { label: 'Naranja', color: '#f7941d', houseCost: 100, emoji: '🏢' },
  red: { label: 'Rojo', color: '#ed1b24', houseCost: 150, emoji: '🏬' },
  yellow: { label: 'Amarillo', color: '#fef200', houseCost: 150, emoji: '🏨' },
  green: { label: 'Verde', color: '#1fb25a', houseCost: 200, emoji: '🏰' },
  darkblue: { label: 'Azul', color: '#0072bb', houseCost: 200, emoji: '🏯' },
  railroad: { label: 'Ferrocarril', color: '#111827', houseCost: 0, emoji: '🚂' },
  utility: { label: 'Servicio', color: '#6b7280', houseCost: 0, emoji: '💡' },
};

// Helper para construir una calle heredando houseCost del grupo.
function street(
  id: string,
  boardIndex: number,
  name: string,
  colorGroup: ColorGroup,
  price: number,
  rent: number[],
  mortgage: number,
  emoji: string,
): PropertyDef {
  return {
    id,
    boardIndex,
    name,
    kind: 'street',
    colorGroup,
    price,
    rent,
    mortgage,
    houseCost: GROUPS[colorGroup].houseCost,
    expansion: 'base',
    emoji,
  };
}

/**
 * Tablero clásico (estándar). Los NOMBRES son los del Monopoly clásico; ajústalos
 * a los de tu tablero cuando confirmes con la foto. La estructura (colores, precios,
 * rentas, hipotecas, costo de casa) es la misma en todas las ediciones clásicas.
 */
export const PROPERTIES: PropertyDef[] = [
  // Marrón
  street('mediterranean', 1, 'Avenida Mediterráneo', 'brown', 60, [2, 10, 30, 90, 160, 250], 30, '🫒'),
  street('baltic', 3, 'Avenida Báltica', 'brown', 60, [4, 20, 60, 180, 320, 450], 30, '⚓'),
  // Celeste
  street('oriental', 6, 'Avenida Oriental', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50, '🏮'),
  street('vermont', 8, 'Avenida Vermont', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50, '🍁'),
  street('connecticut', 9, 'Avenida Connecticut', 'lightblue', 120, [8, 40, 100, 300, 450, 600], 60, '🌊'),
  // Rosa
  street('stcharles', 11, 'Plaza San Carlos', 'pink', 140, [10, 50, 150, 450, 625, 750], 70, '⛪'),
  street('states', 13, 'Avenida Estados', 'pink', 140, [10, 50, 150, 450, 625, 750], 70, '🏛️'),
  street('virginia', 14, 'Avenida Virginia', 'pink', 160, [12, 60, 180, 500, 700, 900], 80, '🌸'),
  // Naranja
  street('stjames', 16, 'Plaza St. James', 'orange', 180, [14, 70, 200, 550, 750, 950], 90, '🎭'),
  street('tennessee', 18, 'Avenida Tennessee', 'orange', 180, [14, 70, 200, 550, 750, 950], 90, '🎸'),
  street('newyork', 19, 'Avenida Nueva York', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100, '🗽'),
  // Rojo
  street('kentucky', 21, 'Avenida Kentucky', 'red', 220, [18, 90, 250, 700, 875, 1050], 110, '🐎'),
  street('indiana', 23, 'Avenida Indiana', 'red', 220, [18, 90, 250, 700, 875, 1050], 110, '🏁'),
  street('illinois', 24, 'Avenida Illinois', 'red', 240, [20, 100, 300, 750, 925, 1100], 120, '🌽'),
  // Amarillo
  street('atlantic', 26, 'Avenida Atlántico', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 130, '🏖️'),
  street('ventnor', 27, 'Avenida Ventnor', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 130, '☀️'),
  street('marvin', 29, 'Jardines Marvin', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 140, '🌻'),
  // Verde
  street('pacific', 31, 'Avenida Pacífico', 'green', 300, [26, 130, 390, 900, 1100, 1275], 150, '🌲'),
  street('northcarolina', 32, 'Avenida Carolina del Norte', 'green', 300, [26, 130, 390, 900, 1100, 1275], 150, '🏞️'),
  street('pennsylvania', 34, 'Avenida Pennsylvania', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 160, '🔔'),
  // Azul
  street('parkplace', 37, 'Plaza Park', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 175, '🌃'),
  street('boardwalk', 39, 'El Muelle', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200, '🎡'),
  // Ferrocarriles (renta según cantidad poseída: [1,2,3,4])
  { id: 'reading', boardIndex: 5, name: 'Ferrocarril Reading', kind: 'railroad', colorGroup: 'railroad', price: 200, rent: [25, 50, 100, 200], mortgage: 100, houseCost: 0, expansion: 'base', emoji: '🚂' },
  { id: 'pennsylvania-rr', boardIndex: 15, name: 'Ferrocarril Pennsylvania', kind: 'railroad', colorGroup: 'railroad', price: 200, rent: [25, 50, 100, 200], mortgage: 100, houseCost: 0, expansion: 'base', emoji: '🚆' },
  { id: 'bo-rr', boardIndex: 25, name: 'Ferrocarril B. & O.', kind: 'railroad', colorGroup: 'railroad', price: 200, rent: [25, 50, 100, 200], mortgage: 100, houseCost: 0, expansion: 'base', emoji: '🚄' },
  { id: 'shortline-rr', boardIndex: 35, name: 'Ferrocarril Short Line', kind: 'railroad', colorGroup: 'railroad', price: 200, rent: [25, 50, 100, 200], mortgage: 100, houseCost: 0, expansion: 'base', emoji: '🚇' },
  // Servicios (renta = dados * [x4 con uno, x10 con ambos])
  { id: 'electric', boardIndex: 12, name: 'Compañía de Electricidad', kind: 'utility', colorGroup: 'utility', price: 150, rent: [4, 10], mortgage: 75, houseCost: 0, expansion: 'base', emoji: '💡' },
  { id: 'water', boardIndex: 28, name: 'Compañía de Agua', kind: 'utility', colorGroup: 'utility', price: 150, rent: [4, 10], mortgage: 75, houseCost: 0, expansion: 'base', emoji: '🚰' },
];

/** Instancias `Property` listas para usar la lógica de renta/hipoteca. */
export const BOARD: Property[] = PROPERTIES.map((d) => new Property(d));

const BY_ID = new Map(BOARD.map((p) => [p.id, p]));
export const getProperty = (id: string): Property | undefined => BY_ID.get(id);

/** Propiedades de un grupo de color. */
export const groupProperties = (group: ColorGroup): Property[] =>
  BOARD.filter((p) => p.colorGroup === group);

/** Cuántas propiedades componen un grupo (para saber si está completo). */
export const groupSize = (group: ColorGroup): number => groupProperties(group).length;
