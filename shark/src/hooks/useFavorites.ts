import { useEffect, useState, useCallback, useRef } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('USE_FAVORITES');

type FavType = 'job' | 'candidate' | 'draft' | 'client';

type Favorite = {
  ROWID: string;
  resource_type: FavType;
  resource_id: string;
  label: string | null;
  created_at: string;
};

/**
 * Hook global de favoritos. Carga 1 vez por sesión, dedupe.
 * Cualquier componente que llame useFavorites comparte el mismo cache.
 *
 * Para invalidar después de un add/remove, los handlers internamente refrescan.
 */
let cachedFavs: Favorite[] | null = null;
const subscribers = new Set<(favs: Favorite[]) => void>();

function notifyAll(favs: Favorite[]) {
  cachedFavs = favs;
  for (const s of subscribers) s(favs);
}

export function useFavorites() {
  const api = useApi();
  const [favs, setFavs] = useState<Favorite[]>(cachedFavs ?? []);
  const [loading, setLoading] = useState(cachedFavs == null);

  useEffect(() => {
    subscribers.add(setFavs);
    return () => { subscribers.delete(setFavs); };
  }, []);

  useEffect(() => {
    if (cachedFavs !== null) return;
    api.favorites.list().then((res) => {
      notifyAll(res.favorites);
    }).catch((err) => {
      log.debug('favs load failed', { error: (err as Error).message });
      notifyAll([]);
    }).finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.favorites.list();
      notifyAll(res.favorites);
    } catch { /* keep current */ }
  }, [api]);

  const toggle = useCallback(async (type: FavType, resourceId: string, label?: string) => {
    const isCurrentlyFav = favs.some((f) => f.resource_type === type && f.resource_id === resourceId);
    try {
      if (isCurrentlyFav) {
        await api.favorites.remove(type, resourceId);
        notifyAll(cachedFavs!.filter((f) => !(f.resource_type === type && f.resource_id === resourceId)));
      } else {
        await api.favorites.add(type, resourceId, label);
        await refresh();
      }
    } catch (err) {
      log.warn('toggle favorite failed', { error: (err as Error).message });
    }
  }, [api, favs, refresh]);

  const isFavorite = useCallback((type: FavType, resourceId: string) =>
    favs.some((f) => f.resource_type === type && f.resource_id === resourceId),
    [favs]);

  return { favorites: favs, loading, toggle, isFavorite, refresh };
}

/**
 * Hook que registra atajo "f" para toggle favorite del recurso actual.
 *
 * Skip si el target del keypress es input/textarea (para no interferir con typing).
 */
export function useFavoriteShortcut(type: FavType, resourceId: string | null | undefined, label?: string) {
  const { toggle } = useFavorites();
  const ref = useRef({ type, resourceId, label });
  ref.current = { type, resourceId, label };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      const { type, resourceId, label } = ref.current;
      if (!resourceId) return;
      e.preventDefault();
      void toggle(type, resourceId, label);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}
