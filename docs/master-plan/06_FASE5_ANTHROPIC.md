# 06 — Fase 5: Integración Anthropic

**Objetivo:** endurecer la integración con Claude. Prompt caching para ahorrar 60–90% de tokens, timeouts explícitos, retry con backoff, circuit breaker, tracking real de tokens, feature flags.

**Tiempo estimado:** 1 semana.
**Dependencias:** Fase 4 (backend modularizado, tabla `TokenUsage`, `CircuitBreakers`).
**Riesgo:** medio. Cambios en prompts pueden alterar outputs; probar regresión con candidatos reales.

**Referencias teóricas:** [05_RELIABILITY.md](../aprendizajes/05_RELIABILITY.md), [08_INTEGRACIONES_EXTERNAS.md](../aprendizajes/08_INTEGRACIONES_EXTERNAS.md). Skill [/claude-api](~/.claude/skills/claude-api) del skill oficial — invocarlo explícitamente cuando editemos este archivo.

---

## Deliverables

- [ ] Todos los wrappers de Anthropic con timeout explícito
- [ ] Prompt caching habilitado en los system prompts largos
- [ ] Retry con backoff exponencial en errores transitorios
- [ ] Circuit breaker para proteger ante caída de Anthropic
- [ ] Feature flag `ANTHROPIC_ENABLED` para desactivar rápido
- [ ] Token tracking real en tabla `TokenUsage`
- [ ] Sanitización de inputs de usuario (complementa [Fase 3](04_FASE3_SEGURIDAD.md#6-sanitización-de-prompts-a-anthropic))
- [ ] Validación de shape en responses
- [ ] Documentación en `docs/INTEGRATIONS/anthropic.md`
- [ ] Runbook `docs/RUNBOOKS/anthropic-caido.md`

---

## 1. Inventario de llamadas a Anthropic

Hay 7 llamadas distintas al modelo hoy:

| # | Función | Archivo | Usage típico |
|---|---|---|---|
| 1 | `generateTechnicalQuestions` | [anthropic.ts](../../functions/sharktalents/src/services/anthropic.ts) | Al generar/regenerar técnica — 2 calls paralelas (12 tech + 13 sit) |
| 2 | `generateProfileDescription` | [clientReportGenerator.ts](../../functions/sharktalents/src/services/clientReportGenerator.ts) | 1×/reporte al generar explicaciones |
| 3 | `generateClientExplanations` | idem | N×/reporte (una por candidato, típicamente 3) |
| 4 | `generateInterviewQuestions` | idem | N×/reporte |
| 5 | `analyzeInterviewTranscript` | idem | 1×/candidato cuando se analiza entrevista |
| 6 | `generateCandidateComparison` | idem | 1×/reporte |
| 7 | `translateToEnglish` | idem | N+1 veces al publicar (una por candidato + comparison) |
| 8 | `suggestProfile` (inline en adminJobs) | [adminJobs.ts:158](../../functions/sharktalents/src/routes/adminJobs.ts#L158) | 1× por click en "Sugerir perfil ideal" |

Total: en un flujo completo reporte de 3 candidatos con entrevistas + publicación → **~15–20 llamadas** a Anthropic.

---

## 2. Prompt caching — oportunidad grande

Claude soporta prompt caching. Los system prompts largos (>1024 tokens) pueden cachearse por 5 min con una ventana extendida opcional de 1h. Costo:
- Cache write: 25% extra del costo input.
- Cache read: **90% más barato** que input normal.

### Dónde aplicarlo

Los system prompts de SharkTalents son largos y se repiten:

1. **`generateTechnicalQuestions`** — system prompt de ~2000 tokens. Se llama 2× por cada regenerate. Ideal para caching.
2. **`generateClientExplanations`** — system prompt ~1200 tokens. Se llama N× por reporte (3–5 veces).
3. **`analyzeInterviewTranscript`** — ~1500 tokens. Se llama 1× por entrevista, pero si hay varias entrevistas en el día, beneficia.

### Implementación

SDK de Anthropic soporta `cache_control` en los content blocks:

```typescript
// integrations/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function generateTechnicalQuestions(
  techPrompt: string,
  jobTitle: string,
  opts: { count: number; kind: 'technical' | 'situational'; idPrefix: string }
): Promise<{ questions: TechnicalQuestion[]; usage: TokenUsage }> {
  const safePrompt = sanitizePromptInput(techPrompt);
  const safeTitle = sanitizePromptInput(jobTitle).substring(0, 200);

  const response = await client.messages.create({
    model: getEnv('ANTHROPIC_MODEL'),
    max_tokens: 8000,
    system: [
      {
        type: 'text',
        text: TECHNICAL_QUESTIONS_SYSTEM_PROMPT,  // ~2000 tokens, constante
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildUserPrompt({ jobTitle: safeTitle, techPrompt: safePrompt, ...opts }),
      },
    ],
  }, {
    timeout: parseInt(getEnv('ANTHROPIC_TIMEOUT_MS'), 10),
  });

  return parseAndValidateResponse(response, opts.count);
}

const TECHNICAL_QUESTIONS_SYSTEM_PROMPT = `Eres un psicómetra industrial experto...
[... todo el system prompt actual ...]`;
```

**Requisito:** los system prompts deben ser **estáticos** — no interpolar con variables del usuario. Si el prompt cambia, el cache se invalida.

Verificar cada wrapper: todos los system prompts actuales son estáticos ✓.

### Tracking de cached tokens

La respuesta del SDK incluye `usage.cache_creation_input_tokens` y `usage.cache_read_input_tokens`. Persistir en tabla `TokenUsage`:

```typescript
await db.tokenUsage.insert(req, {
  job_id: jobId,
  action: 'generate_technical',
  model: getEnv('ANTHROPIC_MODEL'),
  input_tokens: response.usage.input_tokens,
  output_tokens: response.usage.output_tokens,
  cached_tokens: response.usage.cache_read_input_tokens || 0,
  duration_ms: Date.now() - startTime,
  created_at: db.now(),
});
```

### Beneficio esperado

Para un flow típico de generación de reporte con 3 candidatos:
- Antes: 5 llamadas × 1200 tokens de system prompt = 6000 tokens input pagados full price.
- Después: 1 cache write (1500 tokens @ 1.25×) + 4 cache reads (4800 tokens @ 0.1×) = 1875 + 480 = 2355 tokens efectivos.
- **Ahorro: ~60% de input tokens** en ese flow.

---

## 3. Timeouts explícitos

**Problema actual:** ninguna llamada tiene `timeout`. Si Anthropic responde lento, la function de Catalyst muere a los 30s y pierde toda la operación.

**Fix**: timeout < 30s (Catalyst function limit).

Anthropic SDK soporta timeout por request:

```typescript
const response = await client.messages.create({
  // ... params
}, {
  timeout: parseInt(getEnv('ANTHROPIC_TIMEOUT_MS'), 10),  // default 25000ms (25s)
});
```

Si el timeout se alcanza, el SDK tira un error que podemos atrapar y retryar (ver siguiente sección).

### Timeouts por tipo de call

No todas las calls tardan lo mismo. Configurar timeouts apropiados:

| Función | Timeout recomendado | Razón |
|---|---|---|
| `generateTechnicalQuestions` (12–13 preguntas) | 25s | Output grande (~8000 tokens) |
| `generateProfileDescription` | 15s | Output corto |
| `generateClientExplanations` | 20s | Output medio (~2000 tokens) |
| `generateInterviewQuestions` | 15s | Output medio |
| `analyzeInterviewTranscript` | 25s | Input grande (transcript) |
| `generateCandidateComparison` | 25s | Output grande |
| `translateToEnglish` | 20s | Input + output |
| `suggestProfile` | 10s | Output muy corto |

Env vars separadas o un default global con overrides por función:

```typescript
const TIMEOUTS: Record<string, number> = {
  generate_technical: 25000,
  generate_profile_description: 15000,
  generate_client_explanations: 20000,
  generate_interview_questions: 15000,
  analyze_interview_transcript: 25000,
  generate_candidate_comparison: 25000,
  translate_to_english: 20000,
  suggest_profile: 10000,
};

function getTimeout(action: string): number {
  return TIMEOUTS[action] || parseInt(getEnv('ANTHROPIC_TIMEOUT_MS'), 10);
}
```

---

## 4. Retry con backoff exponencial

Errores transitorios a retryar:
- HTTP 5xx (server errors)
- HTTP 429 (rate limit)
- Network errors (ECONNRESET, ETIMEDOUT)
- Timeouts del SDK

Errores a **NO** retryar:
- 400 (bad request — tu request está mal)
- 401 (key inválida — retry no ayuda)
- 403 (permission)
- 404

### `lib/retry.ts`

```typescript
interface RetryOpts {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  retryIf?: (err: any) => boolean;
}

const DEFAULT_OPTS: RetryOpts = {
  maxRetries: parseInt(process.env.ANTHROPIC_MAX_RETRIES || '3', 10),
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

function isTransientError(err: any): boolean {
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
  if (err.status >= 500 && err.status < 600) return true;
  if (err.status === 429) return true;
  // Anthropic SDK throws APITimeoutError / APIConnectionError
  if (err.name === 'APITimeoutError' || err.name === 'APIConnectionError') return true;
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: Partial<RetryOpts> = {}): Promise<T> {
  const config = { ...DEFAULT_OPTS, ...opts };
  const retryIf = config.retryIf || isTransientError;

  let lastErr;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt >= config.maxRetries || !retryIf(err)) throw err;

      const delay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,  // jitter
        config.maxDelayMs || Infinity
      );
      console.warn(`[RETRY] Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
```

### Aplicación

```typescript
// integrations/anthropic.ts
import { withRetry } from '../lib/retry';

export async function generateTechnicalQuestions(...): Promise<...> {
  return await withRetry(async () => {
    const response = await client.messages.create({...}, { timeout: getTimeout(...) });
    return parseAndValidate(response);
  });
}
```

---

## 5. Circuit breaker

**Problema:** si Anthropic está caído (ej. incident), nuestras retries siguen mandando requests que fallan en timeout, consumiendo tiempo de function y potencialmente saturando. Además, cada intento cuenta si paga por failed requests.

**Solución:** circuit breaker. Si hay N fallos seguidos, abrir el circuito y rechazar requests por M segundos sin intentar.

### `lib/circuitBreaker.ts`

```typescript
import * as db from '../db/circuitBreakers';
import { AppError } from './errors';

interface BreakerOpts {
  threshold: number;       // fallos para abrir
  cooldownMs: number;      // tiempo abierto
}

export async function callWithBreaker<T>(
  req: any,
  service: string,
  fn: () => Promise<T>,
  opts: Partial<BreakerOpts> = {}
): Promise<T> {
  const threshold = opts.threshold || parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10);
  const cooldownMs = opts.cooldownMs || parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || '60000', 10);

  const breaker = await db.get(req, service);
  if (breaker && breaker.open_until > Date.now()) {
    const reopenInSec = Math.round((breaker.open_until - Date.now()) / 1000);
    throw new AppError(
      `Circuit open for ${service} — retry in ${reopenInSec}s`,
      503
    );
  }

  try {
    const result = await fn();

    // Éxito → reset si había fallos
    if (breaker && breaker.failure_count > 0) {
      await db.reset(req, service);
    }

    return result;
  } catch (err: any) {
    const failCount = (breaker?.failure_count || 0) + 1;
    const openUntil = failCount >= threshold ? Date.now() + cooldownMs : 0;

    await db.recordFailure(req, service, {
      failure_count: failCount,
      open_until: openUntil,
      last_error: err.message.substring(0, 500),
    });

    if (failCount >= threshold) {
      console.error(`[BREAKER] ${service} OPEN for ${cooldownMs}ms after ${failCount} failures`);
    }

    throw err;
  }
}
```

### Uso

```typescript
// integrations/anthropic.ts
import { callWithBreaker } from '../lib/circuitBreaker';
import { withRetry } from '../lib/retry';

export async function generateTechnicalQuestions(req: any, ...): Promise<...> {
  return await callWithBreaker(req, 'anthropic', async () => {
    return await withRetry(async () => {
      // ... call real
    });
  });
}
```

**Nota:** el breaker usa la tabla `CircuitBreakers`, comparte estado entre todas las invocaciones de la function. Si 10 requests simultáneas ven el breaker abierto, todas rechazan sin llamar al API.

---

## 6. Feature flag `ANTHROPIC_ENABLED`

Escape hatch para desactivar llamadas rápidamente si hay problema.

```typescript
// integrations/anthropic.ts
export async function generateTechnicalQuestions(req: any, ...): Promise<...> {
  if (process.env.ANTHROPIC_ENABLED === 'false') {
    throw new ServiceUnavailableError('Anthropic integration disabled by config');
  }
  // ...
}
```

Setear en Catalyst Console sin redeploy para apagar. Los endpoints fallan con 503, el frontend puede mostrar un mensaje user-friendly.

---

## 7. Token tracking real

Hoy [tokenTracker.ts:1-3](../../functions/sharktalents/src/services/tokenTracker.ts#L1-L3) solo hace `console.log`. Persistir en tabla `TokenUsage`.

### `services/tokenTracker.ts` nuevo

```typescript
// services/tokenTracker.ts
import * as db from '../db/tokenUsage';

export async function trackTokens(
  req: any,
  opts: {
    jobId: string | null;
    action: string;
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    durationMs: number;
  }
): Promise<void> {
  try {
    await db.insert(req, {
      job_id: opts.jobId || '',
      action: opts.action,
      model: opts.model,
      input_tokens: opts.usage.input_tokens,
      output_tokens: opts.usage.output_tokens,
      cached_tokens: opts.usage.cache_read_input_tokens || 0,
      duration_ms: opts.durationMs,
      created_at: db.now(),
    });
  } catch (err: any) {
    // No hacer tirar el flow principal por tracking
    console.error(`[TOKENS] Failed to persist: ${err.message}`);
  }
}

// Agregación para endpoint /admin/jobs/costs (reemplaza estimación actual)
export async function getUsageByJob(req: any, jobIds: string[]): Promise<Map<string, Aggregate>> {
  if (jobIds.length === 0) return new Map();
  const list = jobIds.map(db.esc).join(',');
  const rows = await db.queryAll(req, `
    SELECT job_id,
           SUM(input_tokens) AS total_input,
           SUM(output_tokens) AS total_output,
           SUM(cached_tokens) AS total_cached,
           COUNT(*) AS call_count
    FROM TokenUsage
    WHERE job_id IN (${list})
    GROUP BY job_id
  `, 'TokenUsage');
  return new Map(rows.map(r => [r.job_id, { ... }]));
}
```

**Nota ZCQL:** soporta `GROUP BY` y funciones de agregación (`SUM`, `COUNT`). Si alguna feature no está soportada, fallback a agregación en memoria.

### Actualizar `Costos.tsx` en frontend

Hoy el frontend estima tokens. Pasar a usar data real. Backend devuelve `tokens_input`, `tokens_output`, `tokens_cached` reales — frontend solo renderiza.

---

## 8. Validación de response shape

El modelo a veces devuelve JSON malformado o con campos faltantes. Validar explícitamente:

```typescript
// integrations/anthropic.ts
import { z } from 'zod';  // opcional, si agregamos zod
// O bien, checks manuales:

function validateQuestion(q: any, idPrefix: string): TechnicalQuestion {
  if (!q || typeof q !== 'object') throw new Error('Question must be object');
  if (typeof q.id !== 'string' || !q.id.startsWith(idPrefix)) throw new Error(`Invalid id: ${q.id}`);
  if (typeof q.text !== 'string' || q.text.length < 10 || q.text.length > 2000) {
    throw new Error(`Invalid text length: ${q.text?.length}`);
  }
  if (!Array.isArray(q.options) || q.options.length !== 4) throw new Error('Must have 4 options');
  if (q.options.some((o: any) => typeof o !== 'string' || o.length < 1 || o.length > 500)) {
    throw new Error('Invalid option format');
  }
  if (typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) {
    throw new Error(`Invalid correct: ${q.correct}`);
  }
  return { id: q.id, text: q.text, options: q.options, correct: q.correct };
}
```

Si la validación falla, **no reintentamos automáticamente** (no es un error transitorio de red — es el modelo dando output raro). Tiramos error al admin con la causa.

---

## 9. Migración entre modelos

SDK soporta pasar cualquier model. Para migrar (ej. Haiku 4.5 → Haiku 4.6):

1. Cambiar `ANTHROPIC_MODEL` env var en Catalyst Console.
2. Redeploy.
3. Smoke test: generar técnica, generar explicaciones, verificar quality.
4. Si algo cambia mal, rollback del env var.

**No hardcodees el modelo en código.** Siempre leer de `getEnv('ANTHROPIC_MODEL')`.

Invocar skill `/claude-api` cuando:
- Agreguemos features nuevas (batch, citations, thinking).
- Migremos modelo (incluye detalles específicos de breaking changes entre versiones).

---

## 10. Documentación `docs/INTEGRATIONS/anthropic.md`

```markdown
# Integración Anthropic (Claude)

## Base
- SDK: `@anthropic-ai/sdk` v0.52+
- API: https://api.anthropic.com
- Modelo actual: `claude-haiku-4-5-20251001` (configurable vía `ANTHROPIC_MODEL`)

## Auth
- `ANTHROPIC_API_KEY` (env var)
- Obtener en https://console.anthropic.com/settings/keys

## Funciones wrappers
Todas en [functions/api/src/integrations/anthropic.ts](../../functions/api/src/integrations/anthropic.ts):

| Función | Propósito | Timeout | Max retries |
|---|---|---|---|
| `generateTechnicalQuestions` | Generar preguntas técnicas (12 tech + 13 sit) | 25s | 3 |
| `generateProfileDescription` | Describir perfil ideal del puesto | 15s | 3 |
| `generateClientExplanations` | Explicaciones por candidato en reporte | 20s | 3 |
| `generateInterviewQuestions` | Sugerir preguntas de entrevista | 15s | 3 |
| `analyzeInterviewTranscript` | Analizar transcripción | 25s | 3 |
| `generateCandidateComparison` | Comparativa final de finalistas | 25s | 3 |
| `translateToEnglish` | Traducción ES → EN | 20s | 3 |

## Prompt caching
Habilitado cuando `ANTHROPIC_CACHING_ENABLED=true`. Ahorra ~60% de input tokens en prompts repetidos.

## Feature flag
`ANTHROPIC_ENABLED=false` desactiva toda integración. Útil para incidents.

## Circuit breaker
Después de 5 fallos seguidos (threshold por defecto), el breaker abre por 60s.
Estado persistido en tabla `CircuitBreakers`.

## Rate limits de Anthropic (Haiku 4.5)
- 50 req/min por default key
- 40k output tokens/min
- Si llegás al límite, el SDK devuelve 429 y nuestro retry lo maneja.

## Errores comunes

| Status | Causa | Qué hace el sistema |
|---|---|---|
| 400 | Invalid request (shape malo, model no existe) | No retry; log + tirar a admin |
| 401 | Invalid API key | No retry; log crítico, alerta |
| 429 | Rate limit | Retry con backoff hasta 3× |
| 500, 502, 503 | Server error | Retry |
| Timeout | Anthropic lento | Retry; si persiste, circuit breaker |

## Tracking de tokens
Cada llamada se registra en tabla `TokenUsage`:
- `input_tokens`, `output_tokens`, `cached_tokens`
- `duration_ms`
- Por job y acción

Dashboard de costos en `/admin/costos` lee de acá.

## Runbook
- Caído: [docs/RUNBOOKS/anthropic-caido.md](../RUNBOOKS/anthropic-caido.md)
- Rate limit sostenido: subir tier de Anthropic
- Quality degradada: considerar migrar modelo
```

---

## 11. Runbook `docs/RUNBOOKS/anthropic-caido.md`

```markdown
# Runbook: Anthropic caído o degradado

## Síntomas
- Timeouts en generación de reportes
- Error 503 "Circuit open for anthropic"
- Logs con `[ANTHROPIC] FAIL` repetidos
- Frontend muestra "Error al generar" en operaciones con IA

## Diagnóstico

1. **Verificar status de Anthropic:** https://status.anthropic.com/
2. **Ver estado del circuit breaker:**
   ```sql
   SELECT * FROM CircuitBreakers WHERE service = 'anthropic'
   ```
3. **Últimos errores en TokenUsage:** (no se registran los fallidos; mirar logs de Catalyst)

## Remediación

### Si Anthropic confirmó incident
- **Comunicar al equipo:** las operaciones con IA están paradas.
- **Activar feature flag:** `ANTHROPIC_ENABLED=false` en Catalyst Console.
- **Frontend puede mostrar:** "La generación con IA está temporalmente desactivada. Reintentar en X minutos."
- **Esperar resolución de Anthropic.**
- **Reactivar:** cuando Anthropic normalice, `ANTHROPIC_ENABLED=true` + esperar que el circuit breaker se cierre solo (1 min).

### Si Anthropic está OK pero igual falla
1. **Verificar env var `ANTHROPIC_API_KEY`** — ¿está válida?
2. **Verificar rate limits:** en Anthropic Console, ver uso vs tier.
3. **Modelo deprecated:** ¿alguna mention de que el modelo actual está obsoleto?
4. **Reset manual del breaker:**
   ```sql
   UPDATE CircuitBreakers SET failure_count = 0, open_until = 0 WHERE service = 'anthropic'
   ```
   (en realidad, via endpoint admin / console de Datastore)

## Prevención
- Monitor de `TokenUsage`: si en 1h no hay inserts pero los usuarios intentan, algo está mal.
- Alert en circuit breaker abierto por > 10 min → avisar al equipo.
```

---

## 12. Checklist de cierre Fase 5

- [ ] `integrations/anthropic.ts` con 8 wrappers (los 7 + suggestProfile movido desde adminJobs)
- [ ] Cada wrapper con: timeout, retry, breaker, caching, validación, tracking
- [ ] System prompts extraídos a constantes (para caching)
- [ ] `lib/retry.ts` implementado
- [ ] `lib/circuitBreaker.ts` implementado usando tabla CircuitBreakers
- [ ] `lib/sanitize.ts` sanitizePromptInput aplicado en todos los inputs dinámicos
- [ ] `services/tokenTracker.ts` persiste en DB
- [ ] Feature flag `ANTHROPIC_ENABLED` leído en cada wrapper
- [ ] `/admin/jobs/costs` lee de `TokenUsage` real (no estimación)
- [ ] `docs/INTEGRATIONS/anthropic.md` escrito
- [ ] `docs/RUNBOOKS/anthropic-caido.md` escrito
- [ ] Smoke tests:
  - [ ] Generar técnica → preguntas válidas
  - [ ] Generar explicaciones → JSON válido
  - [ ] Desactivar `ANTHROPIC_ENABLED` → 503 graceful
  - [ ] Simular timeout (reducir timeout a 100ms) → retry + circuit breaker
- [ ] Medición: comparar factura Anthropic antes vs después del caching (esperar ~1 semana para data)

---

## Siguiente paso

→ [07_FASE6_OBSERVABILITY.md](07_FASE6_OBSERVABILITY.md) — logs, health, audit log, runbooks, alertas.
