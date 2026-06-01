# Runbook — Sospecha de cross-tenant leak

**Severidad:** 🔴 CRÍTICA. Es el peor incidente posible para una app multi-tenant.

## Detección

Indicadores:
- User del tenant A reporta ver un job/candidato/reporte que NO le pertenece.
- Logs muestran un `tenant_id` distinto al esperado en la respuesta.
- `audit-log` tiene una acción de admin con `actor_user` de un tenant pero `resource_id`
  de otro.
- Soporte recibe email tipo "vi datos que no son míos".

## Acciones inmediatas (primeros 30 minutos)

### 1. Confirmar el incidente (NO entrar en pánico, NO publicar nada todavía)

```bash
# Reproducir con el user afectado, si está colaborando
# Pedirle un screenshot de la URL + lo que ve
# NO pedirle que mande data sensible
```

Verificar si es:
- **Real:** el sistema sirvió data del tenant equivocado.
- **Falso positivo:** el user pertenece a múltiples orgs y se confundió con el OrgSwitcher.

### 2. Si es REAL: contener

Opciones de contención según severidad:

**Containment opción A — leak limitado (1 user vio data ajena):**
- Identificar el endpoint donde pasó. Bajar el endpoint o devolver 503 temporalmente.
- Revisar `git log` últimos commits de ese endpoint para encontrar el bug.
- Hotfix → deploy → re-habilitar.

**Containment opción B — leak amplio (varios users posibles):**
- Marcar el tenant ofensor con `Tenants.status = 'suspended'`. Eso bloquea todos sus reads.
- Comunicar a Cris: hay que parar operaciones del tenant ofensor hasta entender el alcance.

**Containment opción C — bug de framework / sistémico (ej: middleware tenant.ts roto):**
- Bajar TODO el backend (rollback al commit anterior).
- `catalyst deploy --rollback` o `git revert <commit> && deploy`.

### 3. Investigar alcance

```bash
# Cuántas requests cruzaron tenants en el período afectado
# Suponiendo el bug está desde commit X (timestamp Y):
grep "AUDIT_LOG\|cross.tenant" /catalyst/logs | head -100

# Buscar audit-log con actor_user que no pertenezca al tenant del resource_id
# (esto es un query manual, no hay endpoint built-in)
```

Verificar `multiTenantIsolation.test.ts` — el test structural debería haber atrapado esto.
Si NO lo hizo, hay un agujero en los tests structurales: agregar el caso.

### 4. Preservar evidencia

ANTES de hacer cleanup:
- Backup de Catalyst (snapshot via Console).
- Capturar logs de la última semana del endpoint afectado.
- Lista de users afectados (con timestamps).

## Notificación

Si confirmaste leak real:

### A los users afectados (legalmente requerido en LATAM/EU)

Email transparente dentro de 72hs (GDPR-style):
- Qué pasó (sin tecnicismos)
- Qué data fue expuesta
- Qué hicimos para arreglarlo
- Qué pueden hacer (cambiar passwords, etc.)

### Internamente (Kuno Digital)

Cris decide si comunicar a clientes externos o no según severidad.

## Causas raíz comunes (debug)

1. **Falta filtro `tenant_id`** en una query. Buscar `SELECT FROM <table> WHERE` sin
   `tenant_id`. El test structural lo atrapa para tablas conocidas.

2. **`getByIdScoped` reemplazado por `getById`** sin filtro. Atrapado por test structural
   (verifica que cada handler con ID en path use helper con scope).

3. **Token reusado entre tenants:** un token kind=test del tenant A acepta data del
   tenant B porque el handler no validó ownership después de verificar el token.

4. **Cache inválido en `lib/clientReportsCache.ts`** — `cache_key` no incluyó `tenant_id`,
   colisión.

5. **Webhook de Clerk procesado con tenant equivocado** — `org.id` mal mapeado.

## Prevención post-incidente

- Agregar test structural específico al caso.
- ADR documentando el bug y el fix.
- Revisar otros endpoints que tengan el mismo patrón.
- Considerar agregar runtime check: si en una respuesta el `tenant_id` del payload no
  coincide con `ctx.tenantId`, log error CRÍTICO + tirar 500 antes de devolver.

## Métricas de cierre

- 0 instancias del bug en últimas 7 días.
- Test structural cubriendo el caso.
- Audit log limpio en queries cross-tenant.
- Comunicación a users afectados completada.
