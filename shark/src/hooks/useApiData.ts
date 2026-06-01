/**
 * Hook genérico para cargar data del backend con loading/error/refetch.
 *
 * Uso:
 *   const { data, loading, error, refetch } = useApiData(() => api.jobs.list());
 *
 * Se invalida y re-fetch automáticamente cuando cambia el `key` (similar a deps de useEffect).
 *
 * Para uso futuro: cuando el código crezca, reemplazar por React Query / SWR
 * que dan caching + revalidación + dedup automáticamente.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';

export type ApiDataState<T> = {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  refetch: () => void;
};

export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): ApiDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [tick, setTick] = useState(0);
  const cancelledRef = useRef(false);

  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (cancelledRef.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setLoading(false);
      });

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, refetch };
}

/**
 * Variante: ejecuta una mutación (POST/PATCH/DELETE) on demand.
 * No corre en mount.
 *
 * Uso:
 *   const { mutate, loading, error } = useApiMutation((input) => api.jobs.create(input));
 *   await mutate({ title: 'New job', company: 'Acme' });
 */
export function useApiMutation<TInput, TOutput>(
  mutator: (input: TInput) => Promise<TOutput>,
): {
  mutate: (input: TInput) => Promise<TOutput>;
  loading: boolean;
  error: ApiError | Error | null;
  reset: () => void;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TOutput> => {
      setLoading(true);
      setError(null);
      try {
        const result = await mutator(input);
        setLoading(false);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setLoading(false);
        throw e;
      }
    },
    [mutator],
  );

  const reset = useCallback(() => {
    setError(null);
    setLoading(false);
  }, []);

  return { mutate, loading, error, reset };
}
