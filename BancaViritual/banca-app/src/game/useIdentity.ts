import { useCallback, useEffect, useState } from 'react';

/** Id estable de ESTE dispositivo (persistido; usado para reclamar jugadores). */
function getDeviceId(): string {
  const k = 'banca:device';
  try {
    let id = localStorage.getItem(k);
    if (!id) {
      id = `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return 'd_anon';
  }
}

/**
 * Identidad LOCAL de este dispositivo dentro de una sala: qué jugador representa.
 * No se sincroniza (cada dispositivo tiene la suya). Se guarda por código de sala.
 * `deviceId` sí es estable y se usa para el reclamo sincronizado de jugadores.
 */
export function useIdentity(code: string) {
  const key = `banca:me:${code}`;
  const [deviceId] = useState(getDeviceId);
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

  return { meId, setMe, deviceId };
}
