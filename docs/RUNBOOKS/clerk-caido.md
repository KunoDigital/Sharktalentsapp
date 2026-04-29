# Clerk caído / problemas de auth

## Síntomas
- Todos los endpoints autenticados devuelven 401 con `Invalid token`.
- Frontend muestra "Cargando…" indefinidamente o redirige loop a sign-in.
- Webhooks `/api/webhooks/clerk` devuelven 401 `Invalid webhook signature`.
- Status page Clerk: https://status.clerk.com/

## Causa probable
1. **Clerk caído** — comprobar status page primero.
2. **Secret rotado fuera de banda** — alguien cambió `CLERK_SECRET_KEY` o `CLERK_WEBHOOK_SECRET` sin redeploy.
3. **Publishable key desincronizada** entre frontend y backend (raro pero posible).
4. **JWKS no accesible** — bloqueo de red desde Catalyst hacia clerk.com (raro).

## Verificación rápida

```bash
# Status Clerk
curl -s https://status.clerk.com/api/v2/status.json | jq '.status.indicator'

# Verificar que el secret en env coincide con dashboard
# (no se puede hacer remoto, pero podés probar con un token de test)

# Probar verifyToken local
cd functions/api
node -e "
const { verifyToken } = require('@clerk/backend');
verifyToken('<token-de-prueba>', { secretKey: process.env.CLERK_SECRET_KEY })
  .then(p => console.log('OK', p.sub))
  .catch(e => console.error('FAIL', e.message));
"
```

## Mitigación inmediata

### Si Clerk está down
1. Confirmar en status page.
2. Notificar a usuarios afectados (banner en frontend, Slack interno).
3. **No hay workaround** — el sistema depende de Clerk para verify. Esperar restablecimiento.
4. Mientras tanto, webhooks Clerk se reintentan automáticamente cuando vuelva.

### Si secret rotado fuera de banda
1. Volver a Clerk dashboard → API Keys → copiar key actual.
2. Update env var en Catalyst Console → Functions → api → Env Variables.
3. Redeploy: `./scripts/deploy-backend.sh prod`.
4. Verificar con un endpoint test: `curl -H "Authorization: Bearer <token>" https://.../server/api/api/health` (debe pasar auth si agregás `requireAuth` a `/health` para test).

### Si webhook secret rotado
1. Eventos no procesados quedan en cola Svix; replay manual cuando se restaure.
2. Update `CLERK_WEBHOOK_SECRET` en Catalyst Console.
3. Redeploy.
4. Replay events: Clerk Dashboard → Webhooks → endpoint → Recent → "Replay".

## Fix permanente
- Documentar **siempre** rotation procedure en CHANGELOG y avisar al equipo antes.
- Considerar tener `CLERK_SECRET_KEY_OLD` durante 48h post-rotation para soft-cutover (ver `scripts/rotate-secret.sh`).
- Alerta en monitoring cuando rate de 401 sube anormalmente.

## Postmortem checklist
- [ ] Root cause identificado
- [ ] Tiempo desde detección a recovery
- [ ] Comunicación a usuarios (cuándo / cómo)
- [ ] Secret rotation procedure actualizada si aplica
- [ ] Runbook actualizado con lo aprendido

## Last updated
2026-04-29 — Skeleton inicial.
