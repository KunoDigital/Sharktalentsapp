# ADR-004 — Tokens firmados propios vs JWT estándar

**Fecha:** 2026-05-02
**Status:** Aceptado

## Contexto

Para los endpoints públicos (test del candidato, reporte cliente, portal cliente) necesitamos
tokens en URL que el sistema pueda verificar sin Clerk auth. Tres opciones:

- **(A) JWT estándar** con librería como `jsonwebtoken`
- **(B) Tokens firmados propios** con HMAC-SHA256 sobre payload JSON (lo que hicimos)
- **(C) Random opaque tokens** con lookup en BD

## Decisión

**Opción B: tokens firmados propios** (`lib/urlSigning.ts`).

Format: `base64url(payload).base64url(signature)`. Payload = JSON con `kind`, `ref`, `exp`,
y claims extra opcionales.

## Por qué no JWT

- **Dependencia adicional:** `jsonwebtoken` agrega 50KB al bundle. Catalyst Cloud Scale
  cobra por tamaño de function.
- **Headers innecesarios:** JWT tiene un header con `alg`/`typ` que en nuestro caso no
  varía nunca (siempre HS256). Es ruido.
- **Vulnerabilidades históricas:** ataques de algorithm confusion (alg=none, RS256→HS256
  swap) requieren que la lib esté actualizada y configurada estrictamente. Implementación
  propia con un solo algoritmo (HMAC-SHA256) elimina esa superficie.
- **Verificación cross-language no es un requisito:** Nuestro backend (Node) y nuestros
  helpers tests (Node/vitest) son los únicos consumidores. No necesitamos interop con Java
  o Go.

## Por qué no opaque tokens con DB lookup

- **Latencia extra:** cada GET `/test/<token>` requeriría una query a una tabla `Tokens`.
- **Tabla extra:** una más para Cris crear en Catalyst.
- **Solo gana revocación granular**, que en v1 no es prioridad (TTL corto + rotación de
  secret cubre el caso). Cuando sea prioridad, se migra (ver ADR-003 para portal).

## Implementación

```ts
function sign(payload: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

export function signToken(claims: TokenClaims, secret?: string): string {
  const key = secret ?? env().URL_SIGNING_SECRET;
  const payloadJson = JSON.stringify(claims);
  const payloadB64 = b64urlEncode(payloadJson);
  const signature = sign(payloadB64, key);
  return `${payloadB64}.${signature}`;
}
```

`verifyToken(token, expectedKind, secret?)` requiere `expectedKind` para prevenir token
confusion (un token de tipo `report` no debe pasar como `test`). Tests structurales en
`test/multiTenantIsolation.test.ts` verifican que `expectedKind` sea required (no opcional).

## Consecuencias

**Positivas:**
- Cero dependencias externas para esta función crítica.
- 110 líneas auditables en `lib/urlSigning.ts`.
- Performance: la verificación es una hash + comparación timing-safe, no lookup.

**Negativas:**
- Si descubrimos un bug en nuestra implementación, somos los únicos responsables (no hay
  CVE database). Mitigación: tests cobertura alta (ver `test/urlSigning.test.ts`),
  comparación timing-safe explícita (`timingSafeEqual`), validación estricta de `kind`.
- No se pueden revocar tokens individuales — solo rotando `URL_SIGNING_SECRET`. Mitigación:
  TTLs cortos (test=7d, report=7d, portal=90d).

## Referencias

- `functions/api/src/lib/urlSigning.ts`
- `test/urlSigning.test.ts` (7 tests)
- `test/multiTenantIsolation.test.ts` (verifica expectedKind required)
- ADR-003 para portal tokens autocontenidos (decisión relacionada)
