# Integrations

Documentación operativa de cada integración externa: cómo está configurada, qué env vars usa, cómo debugar problemas, cómo rotar credenciales.

Una doc por integración. Convención: `<provider>.md` en minúsculas.

## Integraciones planeadas

| Provider | Estado | Doc destino |
|---|---|---|
| Anthropic (Claude Haiku 4.5) | TBD | `anthropic.md` |
| Clerk (auth + orgs) | TBD | `clerk.md` |
| Catalyst File Store | TBD | `catalyst-file-store.md` |
| Zoho Recruit | TBD | `zoho-recruit.md` |
| Zoho Meeting + Zia | TBD | `zoho-meeting.md` |
| Zoho Bookings | TBD | `zoho-bookings.md` |
| Zoho Sign | TBD | `zoho-sign.md` |
| OpenAI Whisper | TBD | `openai-whisper.md` |
| HeyReach | TBD | `heyreach.md` |
| WhatsApp (Twilio/WATI/Meta) | TBD | `whatsapp.md` |

Cada doc se crea cuando la integración se implementa. La spec arquitectónica vive en [docs/master-plan/](../master-plan/) — esta carpeta es la **operativa** (cómo opera en runtime, cómo debugar, cómo rotar).

## Template

```markdown
# <Provider>

## Resumen
<qué hace, en qué docs del master plan se especifica>

## Auth
<cómo se obtienen credenciales, qué scopes, qué rotation>

## Env vars usadas
- `XXX_API_KEY` — ...
- ...

## Endpoints / SDK
<qué endpoints llamamos, qué SDK usamos, versión>

## Webhooks entrantes
<URL, verificación HMAC/token, idempotencia>

## Limits conocidos
<rate limits, payload size, etc.>

## Modos de falla y recovery
- Falla A: <qué pasa> → <qué hacer>

## Cómo debugar
<dashboard, logs, comandos útiles>

## Last updated
<fecha + autor>
```
