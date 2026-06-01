# Cómo agregar un nuevo test al flow del candidato

Doc para Cristian (o quien implemente). Patrón validado con DISC, VELNA, Integridad, Emocional, Técnica, Mindset, Inglés. Hay 6 capas que tocás.

## Capas de un test del candidato

```
┌─────────────────────────────────────────────────────────┐
│  1. BANCO DE PREGUNTAS (shark/src/data/questions/)      │ ← contenido curado
├─────────────────────────────────────────────────────────┤
│  2. SCORING LIB (functions/api/src/lib/)                │ ← pure function, testeable
├─────────────────────────────────────────────────────────┤
│  3. TABLA CATALYST (docs/master-plan/MIGRATIONS_*.csv)  │ ← persistencia
├─────────────────────────────────────────────────────────┤
│  4. ENDPOINT BACKEND (functions/api/src/features/)      │ ← receives + scores + persists
├─────────────────────────────────────────────────────────┤
│  5. UI CANDIDATO (shark/src/pages/Candidate*Test.tsx)   │ ← flow del candidato
├─────────────────────────────────────────────────────────┤
│  6. UI RECRUITER (shark/src/components/*Panel.tsx)      │ ← vista del recruiter
└─────────────────────────────────────────────────────────┘
```

Cada capa es independiente. Si agregás solo 1-3, el test sigue funcionando con UI mock. Eso permite iterar el contenido antes de hacer la UI.

## Paso 1 — Banco de preguntas

Ubicación: `shark/src/data/questions/<test-name>.json`

Formato (copiá la estructura de uno existente):

```json
[
  {
    "id": "tn_001",
    "type": "vocab",            // o lo que defina la dimensión
    "text": "Pregunta para el candidato",
    "options": ["A", "B", "C", "D"],
    "correct": 1                // índice 0-3 si hay respuesta correcta
                                // null si es psicométrico (ej DISC, mindset)
  }
]
```

**Convenciones:**
- IDs únicos con prefijo del test: `tn_001`, `tn_002`...
- `correct: null` para tests psicométricos (sin "respuesta correcta")
- `correct: number` (índice) para tests con respuesta correcta (técnica, inglés, prefilter)
- En español neutral con **tú** (no vos)

**Tests adicionales:** crear `shark/test/questionBanks.test.ts` y agregar validaciones para tu banco nuevo (estructura, IDs únicos, índices válidos).

## Paso 2 — Scoring lib

Ubicación: `functions/api/src/lib/<testName>Scoring.ts`

**Patrón obligatorio: pure function.** Sin dependencias de DB ni network. Solo math.

```typescript
export type MyTestAnswer = {
  question_id: string;
  chosen_value: number; // o lo que defina la respuesta
};

export type MyTestResult = {
  score_pct: number;
  // ... otros agregados
};

export function scoreMyTest(answers: MyTestAnswer[]): MyTestResult {
  // computar score, throw si input inválido
  // NUNCA hacer I/O acá
}
```

Tests obligatorios en `functions/api/test/<testName>Scoring.test.ts`:
- Caso 100% correcto / 100% incorrecto
- Mixto (40-60%)
- Threshold borderline
- Input vacío → throws
- Input inválido → throws

Modelo de referencia: [mindsetScoring.ts](../../functions/api/src/lib/mindsetScoring.ts) o [englishScoring.ts](../../functions/api/src/lib/englishScoring.ts).

## Paso 3 — Tabla Catalyst

**Schema:** documentar en `docs/master-plan/MIGRATIONS_BLOCK2_REMAINING.csv` (o crear CSV nuevo).

**Columnas estándar:**
- `tenant_id` (Var Char 40, mandatory)
- `result_id` (Var Char 40, mandatory) — FK a Results
- `started_at` (DateTime, mandatory)
- `completed_at` (DateTime)
- ... campos del scoring agregado
- `answers_json` (Text) — para auditoría / training data futuro

**verifyTables EXPECTED:** agregar el schema en `functions/api/src/features/admin.ts` para que verify-tables detecte si Cris la creó.

**Cris crea la tabla** siguiendo el CSV — tu rol es solo dar el schema.

## Paso 4 — Endpoint backend

Ubicación: `functions/api/src/features/<testName>.ts`

**Patrón típico:**

```typescript
const TABLE = 'MyTestTable';
const TABLE_NOT_READY = new AppError(503, 'service_unavailable', 'Tabla MyTestTable no creada');

let tableReady: boolean | null = null;
async function isTableReady(req: IncomingMessage): Promise<boolean> {
  if (tableReady !== null) return tableReady;
  try {
    await zcql(req).executeZCQLQuery(`SELECT ROWID FROM ${TABLE} LIMIT 1`);
    tableReady = true;
  } catch {
    tableReady = false;
  }
  return tableReady;
}

// POST /test/<token>/<testname>/submit (público token-signed)
export async function submitMyTest(ctx: RequestContext): Promise<void> {
  const token = ctx.req.url?.match(/^\/test\/([^/?]+)/)?.[1];
  // ... verifyToken('test')
  // ... readJsonBody → answers
  // ... scoreMyTest(answers)
  // ... persist en MyTestTable
  // ... auditLog + publishOutboxEvent + metrics.incrementCounter
}

// GET /api/applications/:id/<testname> (tenant-side, recruiter view)
export async function getMyTestForApplication(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);
  // ... fetch row + scope check
}
```

**Wire al router:** `functions/api/src/router.ts`:

```typescript
{ method: 'POST', pattern: /^\/test\/[^/]+\/<testname>\/submit\/?$/, handler: submitMyTest, auth: 'public' },
{ method: 'GET', pattern: /^\/api\/applications\/[^/]+\/<testname>\/?$/, handler: getMyTestForApplication, auth: 'tenant' },
```

**Recordá:**
- Truncate JSON con `stringifyAndTruncate` antes de insertar (Catalyst row 32KB limit)
- Audit log + outbox event + metrics counter al final
- Errores no rompen el flow del candidato (try/catch + log warn)

## Paso 5 — UI candidato

Ubicación: `shark/src/pages/Candidate<TestName>Test.tsx`

**Patrón típico (mira CandidateMindsetTest.tsx cuando exista, o usá las páginas DISC/VELNA como referencia):**

```typescript
export default function CandidateMyTest() {
  const { token } = useParams<{ token: string }>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Cargar banco desde shark/src/data/questions/<test>.json
    // Randomizar orden si aplica
  }, []);

  function handleAnswer(value: number) {
    setAnswers((curr) => ({ ...curr, [questions[currentIndex].id]: value }));
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      handleSubmit();
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    await submitMyTest(token!, Object.entries(answers).map(/* mapping */));
    // navegar al siguiente bloque del flow
  }

  return (/* UI */);
}
```

**Considerar:**
- Barra de progreso (X / Y)
- Randomización de orden (mitiga learning effect)
- Anti-cheat si aplica (`useAntiPaste` para writing tests)
- Validación: no avanzar si no respondió la pregunta actual
- Loader mientras carga banco

## Paso 6 — UI recruiter (panel del candidato)

Ubicación: `shark/src/components/Candidate<TestName>Panel.tsx`

**Patrón típico** (mira [CandidateMindsetPanel.tsx](../../shark/src/components/CandidateMindsetPanel.tsx)):

```typescript
export default function CandidateMyTestPanel({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<MyTestScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    fetch(`${config.apiBase}/api/applications/${applicationId}/<testname>`)
      .then(/* maneja 200/404/503 separadamente */);
  }, [applicationId]);

  if (loading) return <Loader />;
  if (tableMissing) return <TableNotReadyMessage />;
  if (!data) return <PendingMessage />;

  return (/* render scores */);
}
```

**Wire en CandidateDetail.tsx:** importar el componente y agregarlo en la lista de paneles.

## Checklist para un nuevo test

- [ ] Banco JSON en `shark/src/data/questions/`
- [ ] Tests del banco agregados a `shark/test/questionBanks.test.ts`
- [ ] Scoring lib en `functions/api/src/lib/`
- [ ] Tests del scoring (cubre edge cases)
- [ ] Schema documentado en `MIGRATIONS_BLOCK2_REMAINING.csv` (Cris la creará)
- [ ] verifyTables EXPECTED extendido en `admin.ts`
- [ ] Endpoint backend `submitMyTest` + `getMyTestForApplication`
- [ ] Wire al router (POST público + GET tenant)
- [ ] Audit log + outbox event + metrics counter
- [ ] OpenAPI spec actualizado
- [ ] UI candidato (página dedicada con flow + progress)
- [ ] UI recruiter (panel en CandidateDetail)
- [ ] Frontend tests (renderizado básico)
- [ ] Smoke test endpoint añadido a `scripts/smoke-test.sh`
- [ ] Doc del test en `docs/master-plan/N_TEST_*.md` (con marco teórico + diseño)

## Decisiones recurrentes

**¿Test obligatorio o opcional por puesto?**
- Obligatorio: DISC, VELNA, Integridad, Emocional (siempre se corren)
- Opcional con flag en Job: Técnica (`tech_prompt`), Inglés (`english_required`), Mentalidades (`mindset_test_enabled`)

**¿IA o banco fijo?**
- Banco fijo: cuando el contenido es estandar y no depende del puesto (DISC, VELNA, mindset, inglés). Sin costo recurrente.
- IA-generated: cuando depende del puesto (técnica, videos dinámicos). Costo $0.05-0.10 por candidato.

**¿Random selection?**
- Sí cuando el banco es grande (40+ preguntas) y querés variar entre candidatos
- Reusar lib `questionSelector.ts` (`pickRandom`, `pickStratified`)

**¿Anti-cheat?**
- Solo writing tests necesitan anti-paste (`useAntiPaste` hook)
- Multiple-choice: trackear `AntiCheatEvents` (focus loss, copy, etc.) si querés flag manual al recruiter

## Cuando algo se complica

- Si necesitás OAuth (Zoho) → consultá [docs/master-plan/23_INTEGRACIONES_ZOHO.md](../master-plan/23_INTEGRACIONES_ZOHO.md)
- Si la persistencia es JSON grande → usar `stringifyAndTruncate` con `FIELD_LIMITS` ([dbLimits.ts](../../functions/api/src/lib/dbLimits.ts))
- Si necesitás un nuevo evento outbox → agregar dispatch en [outbox.ts](../../functions/api/src/features/outbox.ts)
- Si dudás de UX → preguntar a Cris (no improvisar)
