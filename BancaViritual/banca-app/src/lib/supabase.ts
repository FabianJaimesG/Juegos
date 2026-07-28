import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // No detenemos la app: sin credenciales, funciona en modo local (sin partida en vivo).
  console.warn(
    '[Banca] Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY: la sincronización en vivo estará desactivada.',
  );
}

/** Cliente Supabase (o null si no hay credenciales → modo offline/local). */
export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        realtime: { params: { eventsPerSecond: 10 } },
      })
    : null;

export const hasSupabase = supabase !== null;
