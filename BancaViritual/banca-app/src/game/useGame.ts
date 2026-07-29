import { useCallback, useEffect, useReducer, useRef } from 'react';
import { type Action, createGame, type GameState, hydrate, reducer } from './engine';

const STORAGE_KEY = 'banca:v2';

function genCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
}

function init(): GameState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return hydrate(JSON.parse(raw) as GameState);
  } catch {
    /* ignora */
  }
  return createGame(genCode());
}

/** Estado del juego + acciones + historial (undo/redo) con persistencia local. */
export function useGame() {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const past = useRef<GameState[]>([]);
  const future = useRef<GameState[]>([]);

  // Persistir en cada cambio (offline-first). La sincronización en vivo se añade aparte.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* almacenamiento lleno o no disponible */
    }
  }, [state]);

  const act = useCallback(
    (action: Action) => {
      // Guarda snapshot para undo (salvo REPLACE de sync y ops de identidad).
      const skipHistory = action.type === 'REPLACE' || action.type === 'CLAIM_PLAYER' || action.type === 'RELEASE_PLAYER';
      if (!skipHistory) {
        past.current = [state, ...past.current].slice(0, 50);
        future.current = [];
      }
      dispatch(action);
    },
    [state],
  );

  const undo = useCallback(() => {
    const [prev, ...rest] = past.current;
    if (!prev) return;
    past.current = rest;
    future.current = [state, ...future.current];
    dispatch({ type: 'REPLACE', state: prev });
  }, [state]);

  const redo = useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    future.current = rest;
    past.current = [state, ...past.current];
    dispatch({ type: 'REPLACE', state: next });
  }, [state]);

  /**
   * Reinicia la partida. Por defecto CONSERVA el código de sala (para propagar el
   * reinicio a todos los dispositivos de esa sala); con `newCode` genera una sala
   * nueva (p. ej. tras eliminar la sala compartida).
   */
  const reset = useCallback(
    (newCode = false) => {
      past.current = [];
      future.current = [];
      dispatch({ type: 'REPLACE', state: createGame(newCode ? genCode() : state.code) });
    },
    [state.code],
  );

  return {
    state,
    act,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
