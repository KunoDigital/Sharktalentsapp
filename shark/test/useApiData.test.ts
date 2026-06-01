import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useApiData, useApiMutation } from '../src/hooks/useApiData';

describe('useApiData', () => {
  it('arranca en loading=true', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ x: 1 }));
    const { result } = renderHook(() => useApiData(fetcher, []));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it('setea data al resolver', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ x: 42 }));
    const { result } = renderHook(() => useApiData(fetcher, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ x: 42 });
    expect(result.current.error).toBeNull();
  });

  it('setea error al rejecter', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useApiData(fetcher, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('refetch dispara nueva llamada', async () => {
    let counter = 0;
    const fetcher = vi.fn(() => Promise.resolve({ count: ++counter }));
    const { result } = renderHook(() => useApiData(fetcher, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ count: 1 });

    result.current.refetch();
    await waitFor(() => expect(result.current.data).toEqual({ count: 2 }));
  });
});

describe('useApiMutation', () => {
  it('mutate corre on demand y retorna el resultado', async () => {
    const mutator = vi.fn((input: { name: string }) => Promise.resolve({ ok: true, name: input.name }));
    const { result } = renderHook(() => useApiMutation(mutator));
    expect(result.current.loading).toBe(false);

    const out = await result.current.mutate({ name: 'María' });
    expect(out).toEqual({ ok: true, name: 'María' });
    expect(mutator).toHaveBeenCalledWith({ name: 'María' });
  });

  it('captura errores en state', async () => {
    const mutator = vi.fn(() => Promise.reject(new Error('fail')));
    const { result } = renderHook(() => useApiMutation(mutator));
    try {
      await result.current.mutate({});
    } catch {
      // expected
    }
    await waitFor(() => expect(result.current.error?.message).toBe('fail'));
  });
});
