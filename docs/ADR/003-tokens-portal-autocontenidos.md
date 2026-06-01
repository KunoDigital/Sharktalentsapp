# ADR-003 — Tokens del portal cliente: autocontenidos vs tabla

**Fecha:** 2026-05-01
**Status:** Aceptado

## Contexto

El portal del cliente externo (la empresa que contrata a Cris, ej: Banco Pacífico)
necesita un link único firmado para acceder sin Clerk auth.

Dos opciones:
- **(A)** Crear tabla `ClientPortals` con `portal_id`, `tenant_id`, `client_email`, etc., y
  el token sería un signed payload con `ref=portal_id`.
- **(B)** Token "autocontenido" que firma directamente todos los datos del cliente
  (`tenant_id`, `company`, `client_name`, `client_email`, `agency_name`) — sin tabla.

## Decisión

Adoptar **opción (B)** para v1. El token es 100% autocontenido.

Helper: `lib/clientPortalTokens.ts`. Schema del payload:
```
{ kind: 'portal', ref: <tenant_id>, company, client_name, client_email, agency_name, exp }
```

## Consecuencias

**Positivas:**
- Zero state — no hay tabla `ClientPortals` que mantener, ni risk de drift entre token
  y row de BD.
- Cris emite portales sin entrar a Console: solo `POST /api/portals/issue` (Clerk auth).
- Velocidad de implementación: no requiere tabla nueva.

**Negativas (importantes):**
- **Revocación granular imposible.** Para revocar UN link puntual hay que rotar
  `URL_SIGNING_SECRET` (afecta TODOS los tokens). Mitigación: tokens cortos (default 90d
  de TTL).
- Si el cliente cambia de email/nombre, el token viejo lo sigue mostrando con el dato viejo.
  Mitigación: regenerar el token cuando hay cambio.
- Cualquier persona con el token puede compartirlo. Sin auditoría de "quién abrió cuándo".
  Esto no es problema en v1 (Cris emite manualmente, sabe a quién le mandó cada link).

## Migración futura

Cuando exista la tabla `ClientPortals` (planeada en BLOCK2 §future), migrar a:
```
{ kind: 'portal', ref: <client_portal_id>, exp }
```
y el resto se lee de la tabla. Esto da revocación por ROWID + tracking de aperturas.
La interfaz pública del helper no cambia — solo la implementación interna.

## Referencias

- `functions/api/src/lib/clientPortalTokens.ts`
- `functions/api/src/features/clientPortal.ts`
