import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { GameState } from './engine';

/** Id de dispositivo estable (para ignorar el eco de los propios cambios). */
function deviceOrigin(): string {
  try {
    let o = localStorage.getItem('banca:origin');
    if (!o) {
      o = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('banca:origin', o);
    }
    return o;
  } catch {
    return 'anon';
  }
}

/**
 * Sincroniza el estado de la partida con Supabase (tabla Room + Realtime).
 * - Al entrar a una sala, recupera el estado guardado (late-join).
 * - Escucha cambios remotos y los aplica (ignora el propio eco por `origin`).
 * - Publica los cambios locales (debounced), con guardas anti-bucle.
 */
export function useRealtimeSync(
  code: string,
  state: GameState,
  applyRemote: (s: GameState) => void,
  onDeleted?: () => void,
) {
  const origin = useRef(deviceOrigin());
  const lastRemote = useRef<string>(''); // último JSON venido/enviado (anti-eco)
  const applyRef = useRef(applyRemote);
  applyRef.current = applyRemote;
  const deletedRef = useRef(onDeleted);
  deletedRef.current = onDeleted;

  // Suscripción + recuperación inicial cuando cambia la sala.
  useEffect(() => {
    const sb = supabase;
    if (!sb || !code) return;
    let cancelled = false;

    (async () => {
      const { data } = await sb
        .from('Room')
        .select('state, origin')
        .eq('code', code)
        .maybeSingle();
      if (cancelled || !data?.state) return;
      const js = JSON.stringify(data.state);
      lastRemote.current = js;
      if (data.origin !== origin.current) applyRef.current(data.state as GameState);
    })();

    const channel = sb
      .channel(`room-${code}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'Room', filter: `code=eq.${code}` },
        (payload) => {
          // La sala fue eliminada por alguien: avisar para salir a un estado limpio.
          if (payload.eventType === 'DELETE') {
            lastRemote.current = '';
            deletedRef.current?.();
            return;
          }
          const row = payload.new as { state?: GameState; origin?: string } | null;
          if (!row?.state || row.origin === origin.current) return;
          const js = JSON.stringify(row.state);
          if (js === lastRemote.current) return;
          lastRemote.current = js;
          applyRef.current(row.state);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [code]);

  // Publicar cambios locales (debounced), evitando reenviar lo que vino remoto.
  useEffect(() => {
    const sb = supabase;
    if (!sb || !code) return;
    const js = JSON.stringify(state);
    if (js === lastRemote.current) return; // vino de remoto: no reenviar
    const t = setTimeout(() => {
      lastRemote.current = js;
      sb
        .from('Room')
        .upsert({ code, state, origin: origin.current, updatedAt: new Date().toISOString() })
        .then(({ error }) => {
          if (error) console.warn('[Banca] push falló:', error.message);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [state, code]);
}
