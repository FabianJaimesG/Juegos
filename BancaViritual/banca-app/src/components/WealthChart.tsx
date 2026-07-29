import type { HistoryPoint } from '../game/useWealthHistory';

interface PlayerRef {
  id: string;
  name: string;
  icon: string;
  color: string;
}

interface Props {
  points: HistoryPoint[];
  players: PlayerRef[];
  money: (n: number) => string;
}

const W = 640;
const H = 260;
const PAD = 36;

/** Gráfico de líneas del patrimonio de cada jugador (SVG, sin librerías). */
export function WealthChart({ points, players, money }: Props) {
  if (points.length < 2) {
    return <p className="hint">Aún no hay suficientes movimientos para el gráfico.</p>;
  }

  const allValues = points.flatMap((p) => players.map((pl) => p.nw[pl.id] ?? 0));
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const n = points.length;

  const x = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: '100%' }}>
        {/* ejes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#1e4d3c" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#1e4d3c" />
        <text x={PAD - 6} y={PAD + 4} fill="#8fb8a4" fontSize="10" textAnchor="end">{money(max)}</text>
        <text x={PAD - 6} y={H - PAD} fill="#8fb8a4" fontSize="10" textAnchor="end">{money(min)}</text>

        {players.map((pl) => {
          const d = points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.nw[pl.id] ?? 0).toFixed(1)}`)
            .join(' ');
          return <path key={pl.id} d={d} fill="none" stroke={pl.color} strokeWidth="2.5" />;
        })}
      </svg>
      <div className="chartlegend">
        {(() => {
          const last = points[points.length - 1].nw;
          // Ordenados por capital actual, de mayor a menor.
          const ranked = [...players].sort((a, b) => (last[b.id] ?? 0) - (last[a.id] ?? 0));
          // Medallas al podio solo si hay al menos 3 jugadores.
          const medals = ranked.length >= 3 ? ['🥇', '🥈', '🥉'] : [];
          return ranked.map((pl, i) => (
            <span key={pl.id} className="legenditem">
              <span className="dot" style={{ background: pl.color }} />
              {medals[i] ? `${medals[i]} ` : ''}{pl.icon} {pl.name}: {money(last[pl.id] ?? 0)}
            </span>
          ));
        })()}
      </div>
    </div>
  );
}
