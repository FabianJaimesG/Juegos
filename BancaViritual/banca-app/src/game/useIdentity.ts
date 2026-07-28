import { useCallback, useEffect, useState } from 'react';

/**
 * Identidad LOCAL de este dispositivo dentro de una sala: qué jugador representa.
 * No se sincroniza (cada dispositivo tiene la suya). Se guarda por código de sala.
 */
export function useIdentity(code: string) {
  const key = `banca:me:${code}`;
  const [meId, setMeId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      setMeId(localStorage.getItem(key));
    } catch {
      setMeId(null);
    }
  }, [key]);

  const setMe = useCallback(
    (id: string | null) => {
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {
        /* almacenamiento no disponible */
      }
      setMeId(id);
    },
    [key],
  );

  return { meId, setMe };
}
