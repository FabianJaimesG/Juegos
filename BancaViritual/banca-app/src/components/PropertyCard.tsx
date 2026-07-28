import { GROUPS } from '../domain/board';
import { Property } from '../domain/Property';
import './PropertyCard.css';

interface Props {
  property: Property;
  houses?: number; // 0..4; 5 = hotel
  mortgaged?: boolean;
  /** Nombre del dueño (opcional, para mostrar la banda de propietario). */
  owner?: string;
  compact?: boolean;
  onClick?: () => void;
}

const RENT_LABELS: Record<Property['kind'], string[]> = {
  street: ['Renta', '1 🏠', '2 🏠', '3 🏠', '4 🏠', 'Hotel 🏨'],
  railroad: ['1 🚂', '2 🚂', '3 🚂', '4 🚂'],
  utility: ['×4 🎲', '×10 🎲🎲'],
};

/** Tarjeta visual de una propiedad. Reutilizable en tablero, info de jugador y negociación. */
export function PropertyCard({ property, houses = 0, mortgaged = false, owner, compact, onClick }: Props) {
  const g = GROUPS[property.colorGroup];
  const labels = RENT_LABELS[property.kind];

  return (
    <article
      className={`pcard ${compact ? 'pcard--compact' : ''} ${mortgaged ? 'pcard--mortgaged' : ''}`}
      style={{ ['--pc-color' as string]: g.color }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <header className="pcard__band">
        <span className="pcard__emoji">{property.def.emoji}</span>
        <span className="pcard__group">{g.label}</span>
      </header>

      <h3 className="pcard__name">{property.name}</h3>

      {!compact && (
        <table className="pcard__rents">
          <tbody>
            {labels.map((label, i) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="pcard__rentval">{property.def.rent[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="pcard__foot">
        <span>💰 {property.price}</span>
        {property.isBuildable && <span>🏠 {property.houseCost}</span>}
        <span>🏦 {property.mortgageValue}</span>
      </footer>

      {houses > 0 && (
        <div className="pcard__houses">
          {houses >= 5 ? '🏨 Hotel' : '🏠'.repeat(houses)}
        </div>
      )}
      {mortgaged && <div className="pcard__badge">HIPOTECADA</div>}
      {owner && <div className="pcard__owner">{owner}</div>}
    </article>
  );
}
