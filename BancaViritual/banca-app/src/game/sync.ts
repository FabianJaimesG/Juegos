import { useEffect, useRef, useState } from 'react';
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
  // Estado actual sin meterlo en las dependencias del efecto de recuperación.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Sala cuya recuperación ya terminó. Hasta entonces NO se publica nada: si no,
  // el estado recién creado (vacío) pisaba la partida guardada en el servidor.
  const [loaded, setLoaded] = useState('');

  // Suscripción + recuperación inicial cuando cambia la sala.
  useEffect(() => {
    const sb = supabase;
    if (!sb || !code) return;
    let cancelled = false;
    setLoaded('');

    (async () => {
      const { data, error } = await sb
        .from('Room')
        .select('state, origin')
        .eq('code', code)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Sin saber qué hay guardado no se publica nada: subir el estado local
        // podría borrar la partida de la sala.
        console.warn('[Banca] no se pudo leer la sala:', error.message);
        return;
      }
      if (data?.state) {
        const js = JSON.stringify(data.state);
        lastRemote.current = js;
        // Al unirse a una sala, el estado local es una partida recién creada y
        // vacía: hay que adoptar SIEMPRE lo guardado, aunque el último cambio lo
        // hubiera hecho este mismo dispositivo (volver a una sala propia).
        // Si en cambio ya hay una partida local en curso (recarga en la misma
        // sala), se respeta el eco propio para no revivir un estado rezagado.
        const local = stateRef.current;
        const localVacio = !local.started && local.players.length === 0;
        if (localVacio || data.origin !== origin.current) {
          applyRef.current(data.state as GameState);
        }
      }
      setLoaded(code); // a partir de aquí ya se puede publicar
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
    if (loaded !== code) return; // aún recuperando la sala: no pisar lo guardado
    // Nunca mandar a TODOS de vuelta a la preparación por accidente (un jugador
    // que deshace de más, o que vuelve a la pantalla de bienvenida). Solo se
    // acepta si es un regreso deliberado: crear/reiniciar la sala o terminar la
    // partida, que sellan `resetAt` con la hora actual.
    if (!state.started && lastRemote.current) {
      try {
        const remoto = JSON.parse(lastRemote.current) as GameState;
        if (remoto.started && (state.resetAt ?? 0) <= (remoto.resetAt ?? 0)) {
          console.warn('[Banca] cambio descartado: intentaba devolver la sala a preparación');
          return;
        }
      } catch {
        /* si no se puede leer el último remoto, se publica igual */
      }
    }
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
  }, [state, code, loaded]);
}
