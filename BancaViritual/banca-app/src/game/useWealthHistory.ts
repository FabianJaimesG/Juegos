import { useEffect, useState } from 'react';
import { type GameState, playerNetWorth } from './engine';

export interface HistoryPoint {
  t: number;
  nw: Record<string, number>; // patrimonio por jugador
}

const load = (key: string): HistoryPoint[] => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]') as HistoryPoint[];
  } catch {
    return [];
  }
};

/** Registra el patrimonio de cada jugador a lo largo del tiempo (local, por sala). */
export function useWealthHistory(state: GameState): HistoryPoint[] {
  const key = `banca:hist:${state.code}`;
  const [points, setPoints] = useState<HistoryPoint[]>(() => load(key));

  // Al cambiar de sala, recarga el historial de esa sala.
  useEffect(() => {
    setPoints(load(key));
  }, [key]);

  // Añade un punto cuando cambia el patrimonio de alguien.
  useEffect(() => {
    if (state.players.length === 0) return;
    const nw: Record<string, number> = {};
    for (const p of state.players) nw[p.id] = playerNetWorth(p);
    setPoints((prev) => {
      const last = prev[prev.length - 1];
      if (last && JSON.stringify(last.nw) === JSON.stringify(nw)) return prev;
      const next = [...prev, { t: Date.now(), nw }].slice(-150);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* almacenamiento no disponible */
      }
      return next;
    });
  }, [state.players, key]);

  return points;
}
