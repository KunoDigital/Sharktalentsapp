import { useEffect, useState } from 'react';
import { publicApi } from '../lib/publicApi';
import { ApiError } from '../lib/api';
import { logger } from '../lib/logger';
import { config } from '../config';

const log = logger('TEST_TOKEN_GUARD');

export type TokenGuardStatus =
  | { state: 'loading' }
  | { state: 'ok'; applicationId: string; pipelineStage: string; jobTitle?: string; candidateName?: string }
  | { state: 'expired' }
  | { state: 'invalid'; reason: string };

/**
 * Validates a test token against the backend BEFORE showing test questions.
 *
 * Without this, a candidate can complete a test against a broken/expired token
 * and the submit fails silently — they think they finished, but no data was
 * saved. This hook fails fast so the candidate sees a clear error.
 *
 * In dev (config.useApi=false) returns `ok` without backend roundtrip.
 */
export function useTestTokenGuard(token: string | undefined): TokenGuardStatus {
  const [status, setStatus] = useState<TokenGuardStatus>({ state: 'loading' });

  useEffect(() => {
    if (!token) {
      setStatus({ state: 'invalid', reason: 'No hay token en el link' });
      return;
    }
    if (!config.useApi) {
      // Dev: skip backend roundtrip
      setStatus({ state: 'ok', applicationId: 'dev', pipelineStage: 'dev' });
      return;
    }

    let cancelled = false;
    publicApi.getTestStatus(token).then((res) => {
      if (cancelled) return;
      if (!res) {
        setStatus({ state: 'invalid', reason: 'No pudimos validar el link' });
        return;
      }
      if (res.expired) {
        setStatus({ state: 'expired' });
        return;
      }
      if (!res.application_id) {
        setStatus({ state: 'invalid', reason: 'El link no tiene una aplicación asociada' });
        return;
      }
      setStatus({
        state: 'ok',
        applicationId: res.application_id,
        pipelineStage: res.pipeline_stage,
        jobTitle: res.job?.title,
        candidateName: res.candidate?.name,
      });
    }).catch((err: unknown) => {
      if (cancelled) return;
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 404) {
          setStatus({ state: 'invalid', reason: 'El link es inválido o ya fue revocado' });
          return;
        }
        log.warn('token guard transient error', { status: err.status, code: err.code });
        setStatus({ state: 'invalid', reason: 'No pudimos validar el link en este momento' });
        return;
      }
      log.warn('token guard unknown error', { error: (err as Error).message });
      setStatus({ state: 'invalid', reason: 'No pudimos validar el link en este momento' });
    });

    return () => { cancelled = true; };
  }, [token]);

  return status;
}

/**
 * Componente compartido para mostrar estado del guard. Renderiza loading / error
 * según el status. Devuelve `null` si está OK — el caller renderiza el test.
 */
export function renderTokenGuardError(
  status: TokenGuardStatus,
  recruiterEmail = 'proyectos@kunodigital.com',
): React.ReactNode | null {
  if (status.state === 'ok') return null;
  if (status.state === 'loading') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>Validando tu link…</h1>
            <p>Un segundo, estamos verificando que todo esté en orden.</p>
          </div>
        </main>
      </div>
    );
  }
  const isExpired = status.state === 'expired';
  return (
    <div className="ct-root">
      <main className="ct-main">
        <div className="ct-thanks">
          <h1>{isExpired ? 'Tu link expiró' : 'Hubo un problema con tu link'}</h1>
          <p>
            {isExpired
              ? 'El acceso a esta prueba ya no está disponible.'
              : status.state === 'invalid' ? status.reason : 'Algo no anda bien con el link que recibiste.'}
          </p>
          <p style={{ marginTop: 24 }}>
            Escribinos a <a href={`mailto:${recruiterEmail}`}>{recruiterEmail}</a> y te enviamos un link nuevo.
          </p>
        </div>
      </main>
    </div>
  );
}
