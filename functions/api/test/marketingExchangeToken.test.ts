/**
 * Tests del exchange-token (Opción B del marketing funnel).
 *
 * El endpoint POST /api/marketing/exchange-token cambia un session_token corto
 * (5 min, kind='exchange') por el JWT real del test (7 días, kind='test') envuelto
 * en `test_start_url`. Probamos la lógica pura `_verifyExchangeAndBuildTestUrl`,
 * que es el corazón del handler — el wrapper HTTP solo agrega site-key + sendJson.
 *
 * Casos cubiertos:
 *   1. session_token válido → devuelve test_start_url con kind=test válido
 *   2. session_token expirado → 410
 *   3. session_token con firma inválida → 401
 *   4. session_token con kind != 'exchange' (cross-kind attack) → 401
 *   5. body sin session_token → 400 (ValidationError)
 *   6. multi-use: mismo token válido funciona dos veces dentro del TTL
 *   7. token con ref vacío → 401
 */
import { describe, it, expect } from 'vitest';
import { _verifyExchangeAndBuildTestUrl } from '../src/features/marketing';
import { signToken, verifyToken, expiresIn } from '../src/lib/urlSigning';
import { AppError, ValidationError } from '../src/lib/errors';

const SECRET = 'test-secret-exchange-token';
const APP_BASE_URL = 'https://example.test';

describe('exchange-token (Opción B)', () => {
  it('session_token válido devuelve test_start_url con JWT kind=test', async () => {
    const sessionToken = signToken(
      { kind: 'exchange', ref: 'res_abc123', exp: expiresIn(300) },
      SECRET,
    );

    const out = await _verifyExchangeAndBuildTestUrl(sessionToken, {
      secret: SECRET,
      appBaseUrl: APP_BASE_URL,
    });

    expect(out.test_start_url).toMatch(/^https:\/\/example\.test\/app\/index\.html#\/test\//);
    expect(out.result_id).toBe('res_abc123');

    // El JWT embebido en la URL tiene que ser un kind=test válido.
    const testJwt = out.test_start_url.split('#/test/')[1];
    const claims = verifyToken(testJwt, 'test', SECRET);
    expect(claims.ref).toBe('res_abc123');
    expect(claims.kind).toBe('test');
  });

  it('session_token expirado → AppError(410)', async () => {
    const sessionToken = signToken(
      { kind: 'exchange', ref: 'res_xyz', exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
    );

    await expect(
      _verifyExchangeAndBuildTestUrl(sessionToken, { secret: SECRET, appBaseUrl: APP_BASE_URL }),
    ).rejects.toMatchObject({
      status: 410,
      code: 'session_expired',
    });
  });

  it('session_token con firma inválida (secret distinto) → AppError(401)', async () => {
    const sessionToken = signToken(
      { kind: 'exchange', ref: 'res_xyz', exp: expiresIn(300) },
      'otro-secret',
    );

    await expect(
      _verifyExchangeAndBuildTestUrl(sessionToken, { secret: SECRET, appBaseUrl: APP_BASE_URL }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid_session_token',
    });
  });

  it('token con kind != exchange (cross-kind attack) → AppError(401)', async () => {
    // Un atacante intenta reusar un token kind=test (que tiene 7 días de TTL)
    // como session_token. Debe rechazarse aunque la firma sea válida.
    const testToken = signToken(
      { kind: 'test', ref: 'res_attacker', exp: expiresIn(300) },
      SECRET,
    );

    await expect(
      _verifyExchangeAndBuildTestUrl(testToken, { secret: SECRET, appBaseUrl: APP_BASE_URL }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid_session_token',
    });
  });

  it('session_token vacío → ValidationError(400)', async () => {
    await expect(
      _verifyExchangeAndBuildTestUrl('', { secret: SECRET, appBaseUrl: APP_BASE_URL }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('session_token malformado (sin ".") → AppError(401)', async () => {
    await expect(
      _verifyExchangeAndBuildTestUrl('garbage-no-dot', { secret: SECRET, appBaseUrl: APP_BASE_URL }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid_session_token',
    });
  });

  it('multi-use: el mismo token funciona dos veces dentro del TTL', async () => {
    const sessionToken = signToken(
      { kind: 'exchange', ref: 'res_multi', exp: expiresIn(300) },
      SECRET,
    );

    const first = await _verifyExchangeAndBuildTestUrl(sessionToken, {
      secret: SECRET,
      appBaseUrl: APP_BASE_URL,
    });
    const second = await _verifyExchangeAndBuildTestUrl(sessionToken, {
      secret: SECRET,
      appBaseUrl: APP_BASE_URL,
    });

    expect(first.result_id).toBe('res_multi');
    expect(second.result_id).toBe('res_multi');
    // Ambos producen URLs con kind=test válido (los JWT pueden diferir en exp
    // por timing, pero ambos deben verificar OK).
    const jwt1 = first.test_start_url.split('#/test/')[1];
    const jwt2 = second.test_start_url.split('#/test/')[1];
    expect(verifyToken(jwt1, 'test', SECRET).ref).toBe('res_multi');
    expect(verifyToken(jwt2, 'test', SECRET).ref).toBe('res_multi');
  });

  it('payload con ref vacío → AppError(401)', async () => {
    const sessionToken = signToken(
      { kind: 'exchange', ref: '', exp: expiresIn(300) },
      SECRET,
    );

    await expect(
      _verifyExchangeAndBuildTestUrl(sessionToken, { secret: SECRET, appBaseUrl: APP_BASE_URL }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('test_start_url no contiene el session_token (separación de tokens)', async () => {
    // Garantía de seguridad: la URL final NO debe contener el session_token.
    // El session_token es solo para el exchange; el JWT del test es independiente.
    const sessionToken = signToken(
      { kind: 'exchange', ref: 'res_sep', exp: expiresIn(300) },
      SECRET,
    );

    const out = await _verifyExchangeAndBuildTestUrl(sessionToken, {
      secret: SECRET,
      appBaseUrl: APP_BASE_URL,
    });

    expect(out.test_start_url).not.toContain(sessionToken);
  });
});
