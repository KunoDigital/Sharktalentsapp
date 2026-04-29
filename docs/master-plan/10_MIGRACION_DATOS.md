# 10 — Migración de datos

**Objetivo:** mover la data del schema viejo (god-object `Results.score`, `pipeline_stage` libre, etc.) al schema nuevo normalizado sin downtime y con rollback posible.

**Tiempo estimado:** 1 semana (incluye dev + prod runs).
**Dependencias:** Fase 2 (schema nuevo creado).
**Riesgo:** muy alto. Si la migración corrompe data, no hay undo fácil. Hacer backup antes.

**Referencias teóricas:** [03_DATABASE_DESIGN.md](../aprendizajes/03_DATABASE_DESIGN.md) sección "Migrar de god-object a relacional".

---

## Contexto

**Situación de partida:**
- Instalación de Catalyst **nueva** (el usuario borró `catalyst.json` y creará un nuevo proyecto Catalyst con proyecto y datastore **virginal**).
- La data del sistema viejo vive en el **proyecto Catalyst original** (que no se borra, solo se reemplaza el archivo de config).
- Necesitamos: exportar data vieja → transformar → importar al schema nuevo.

**Opción alternativa:** si el usuario decide empezar de cero sin migrar data histórica (aceptable si son pocos candidatos reales), esta fase se simplifica a "crear tablas nuevas y listo". Decisión del usuario antes de arrancar.

---

## Deliverables

- [ ] Export completo del DataStore viejo (CSVs por tabla)
- [ ] Scripts de transformación (JS/Node) que leen CSVs y generan los nuevos CSVs del schema normalizado
- [ ] Import al DataStore nuevo en ambiente dev
- [ ] Validación post-import (counts, muestreo de integridad referencial)
- [ ] Plan de ejecución en prod con window de downtime mínimo
- [ ] Rollback plan

---

## 1. Decisión previa — ¿migrar o empezar de cero?

### A favor de migrar

- Preservar candidatos históricos para análisis
- Clientes ya tienen reportes publicados — si se pierden los URLs rompen
- Auditoría histórica

### A favor de empezar de cero

- Data de prueba, no reales → no vale la migración
- Ahorra 1 semana de trabajo
- Refactor + migración juntos = mucho riesgo

### Recomendación

**Si hay < 20 candidatos reales procesados:** empezar de cero. Preservar los 2-3 reportes publicados copiando manualmente.

**Si hay > 20 candidatos reales:** migrar. Vale la pena el trabajo.

**Si es solo test data:** borrar y arrancar limpio.

---

## 2. Export del DataStore viejo

Catalyst permite exportar tablas a CSV desde la Console:

1. **Datastore → tabla → Export → CSV**
2. Descargar las 8 tablas:
   - Jobs.csv
   - Assessments.csv
   - AssessmentQuestions.csv
   - Candidates.csv
   - Results.csv
   - ClientReports.csv
   - ReportCandidates.csv
   - TechLibrary.csv
3. Guardar en `migration/exports-YYYY-MM-DD/`

### Backup completo

Catalyst no expone un "export de todo el proyecto". El backup es el conjunto de CSVs. Guardar también:
- Config de env vars (manual, copiar a un archivo encriptado)
- Schema detail (capturas de pantalla de cada tabla)
- File Store: `migration/filestore-backup/` con los archivos descargados

---

## 3. Transformación

### Estructura de scripts

```
migration/
├── exports-YYYY-MM-DD/          ← CSVs del viejo
│   ├── Jobs.csv
│   ├── Results.csv
│   └── ...
├── transform/                    ← scripts JS
│   ├── transformJobs.js
│   ├── transformResults.js
│   ├── index.js                  ← orquestador
│   └── helpers.js
├── imports-YYYY-MM-DD/           ← CSVs para el schema nuevo
│   ├── Jobs.csv
│   ├── DiscScores.csv
│   └── ...
└── validate.js                   ← script de validación post-import
```

### `migration/transform/index.js`

Orquestador:

```javascript
// migration/transform/index.js
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const EXPORT_DIR = process.argv[2] || 'exports-2026-05-01';
const IMPORT_DIR = process.argv[3] || 'imports-2026-05-01';

function readCsv(name) {
  const file = path.join(__dirname, '..', EXPORT_DIR, name);
  const content = fs.readFileSync(file, 'utf-8');
  return csv.parse(content, { columns: true, skip_empty_lines: true });
}

function writeCsv(name, data) {
  const file = path.join(__dirname, '..', IMPORT_DIR, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringify(data, { header: true }));
  console.log(`✓ ${name}: ${data.length} rows`);
}

// Run transformers
const transformJobs = require('./transformJobs');
const transformAssessments = require('./transformAssessments');
const transformCandidates = require('./transformCandidates');
const transformResults = require('./transformResults');
const transformReports = require('./transformReports');

const jobs = readCsv('Jobs.csv');
const assessments = readCsv('Assessments.csv');
const assessmentQuestions = readCsv('AssessmentQuestions.csv');
const candidates = readCsv('Candidates.csv');
const results = readCsv('Results.csv');
const clientReports = readCsv('ClientReports.csv');
const reportCandidates = readCsv('ReportCandidates.csv');
const techLibrary = readCsv('TechLibrary.csv');

// 1. Jobs → Jobs + JobProfiles + JobCompetencias + JobCostConfig
const { newJobs, jobProfiles, jobCompetencias, jobCostConfig } = transformJobs(jobs);
writeCsv('Jobs.csv', newJobs);
writeCsv('JobProfiles.csv', jobProfiles);
writeCsv('JobCompetencias.csv', jobCompetencias);
writeCsv('JobCostConfig.csv', jobCostConfig);

// 2. Assessments + AssessmentQuestions — pass through (sin cambio estructural mayor)
writeCsv('Assessments.csv', transformAssessments(assessments));
writeCsv('AssessmentQuestions.csv', assessmentQuestions);

// 3. Candidates — pass through
writeCsv('Candidates.csv', transformCandidates(candidates));

// 4. Results — explosión: scores JSON → 7 tablas + ScreenExits + PipelineTransitions
const {
  newResults,
  discScores, cognitiveScores, emotionalScores,
  integrityScores, integrityDimensions,
  technicalScores, competenciaScores,
  screenExits, pipelineTransitions,
} = transformResults(results);
writeCsv('Results.csv', newResults);
writeCsv('DiscScores.csv', discScores);
writeCsv('CognitiveScores.csv', cognitiveScores);
writeCsv('EmotionalScores.csv', emotionalScores);
writeCsv('IntegrityScores.csv', integrityScores);
writeCsv('IntegrityDimensions.csv', integrityDimensions);
writeCsv('TechnicalScores.csv', technicalScores);
writeCsv('CompetenciaScores.csv', competenciaScores);
writeCsv('ScreenExits.csv', screenExits);
writeCsv('PipelineTransitions.csv', pipelineTransitions);

// 5. ClientReports + ReportCandidates — explosión menor
const { newReports, newReportCandidates } = transformReports(clientReports, reportCandidates);
writeCsv('ClientReports.csv', newReports);
writeCsv('ReportCandidates.csv', newReportCandidates);

// 6. TechLibrary — pass through
writeCsv('TechLibrary.csv', techLibrary);

console.log('✓ Transformation complete');
```

### `migration/transform/transformJobs.js`

Explota el `ideal_profile` mega-blob:

```javascript
// migration/transform/transformJobs.js
module.exports = function transformJobs(jobs) {
  const newJobs = [];
  const jobProfiles = [];
  const jobCompetencias = [];
  const jobCostConfig = [];

  for (const old of jobs) {
    // Parse ideal_profile blob
    let ip = {};
    try {
      ip = old.ideal_profile ? JSON.parse(old.ideal_profile) : {};
    } catch (err) {
      console.warn(`Job ${old.ROWID}: failed to parse ideal_profile. Skipping profile.`);
    }

    let ic = [];
    try {
      ic = old.ideal_competencias ? JSON.parse(old.ideal_competencias) : [];
    } catch { ic = []; }

    // 1. Jobs (limpio)
    newJobs.push({
      ROWID: old.ROWID,
      title: old.title,
      company: old.company,
      tech_prompt: old.tech_prompt || '',
      cognitive_level: old.cognitive_level || 'basic',
      is_active: old.is_active === '1' || old.is_active === 'true' ? 'true' : 'false',
      company_context: ip.company_context || '',
      created_by: old.created_by || '',
      created_at: old.created_at,
      updated_at: old.updated_at,
    });

    // 2. JobProfiles
    if (ip.disc) {
      jobProfiles.push({
        job_id: old.ROWID,
        disc_d: ip.disc.D || 50,
        disc_i: ip.disc.I || 50,
        disc_s: ip.disc.S || 50,
        disc_c: ip.disc.C || 50,
        disc_b_d: ip.disc_b?.D || '',
        disc_b_i: ip.disc_b?.I || '',
        disc_b_s: ip.disc_b?.S || '',
        disc_b_c: ip.disc_b?.C || '',
        cog_verbal: ip.cognitive?.verbal || 50,
        cog_espacial: ip.cognitive?.espacial || 50,
        cog_logica: ip.cognitive?.logica || 50,
        cog_numerica: ip.cognitive?.numerica || 50,
        cog_abstracta: ip.cognitive?.abstracta || 50,
        min_technical_score: ip.min_technical_score || 60,
      });
    }

    // 3. JobCompetencias
    ic.forEach((comp, i) => {
      jobCompetencias.push({
        job_id: old.ROWID,
        competencia_id: comp.id,
        nivel_esperado: comp.nivel_esperado || 60,
        sort_order: i,
      });
    });

    // 4. JobCostConfig
    if (ip.cost_config) {
      jobCostConfig.push({
        job_id: old.ROWID,
        client_type: ip.cost_config.client_type || 'normal',
        salary: ip.cost_config.salary || 0,
        advertising: ip.cost_config.advertising || 0,
        hours: ip.cost_config.hours || 0,
      });
    }
  }

  return { newJobs, jobProfiles, jobCompetencias, jobCostConfig };
};
```

### `migration/transform/transformResults.js`

El más complejo — explota `score` JSON blob:

```javascript
// migration/transform/transformResults.js
const { calculateCompetencias } = require('../../functions/api/src/data/competencias'); // o re-implementarlo

module.exports = function transformResults(results) {
  const newResults = [];
  const discScores = [];
  const cognitiveScores = [];
  const emotionalScores = [];
  const integrityScores = [];
  const integrityDimensions = [];
  const technicalScores = [];
  const competenciaScores = [];
  const screenExits = [];
  const pipelineTransitions = [];

  for (const old of results) {
    const resultId = old.ROWID;

    // 1. Results (sin score JSON)
    newResults.push({
      ROWID: resultId,
      assessment_id: old.assessment_id,
      candidate_id: old.candidate_id,
      answers: old.answers || '{}',
      report_downloaded_at: old.report_downloaded_at || '',
      pipeline_stage: old.pipeline_stage || '',
      started_at: old.started_at,
      completed_at: old.completed_at || '',
      idempotency_key: '',  // nuevo, no había
    });

    // 2. Parse score JSON
    let score = null;
    try {
      score = old.score ? JSON.parse(old.score) : null;
    } catch { continue; }
    if (!score) continue;

    // 3. DiscScores
    if (score.disc) {
      const d = score.disc;
      const sum = (d.D || 0) + (d.I || 0) + (d.S || 0) + (d.C || 0);
      const isRaw = sum <= 100;  // heuristic: si sum es bajo, es raw
      discScores.push({
        result_id: resultId,
        raw_d: isRaw ? d.D : Math.round(d.D / 5),
        raw_i: isRaw ? d.I : Math.round(d.I / 5),
        raw_s: isRaw ? d.S : Math.round(d.S / 5),
        raw_c: isRaw ? d.C : Math.round(d.C / 5),
        normalized_d: isRaw ? Math.min(100, d.D * 5) : d.D,
        normalized_i: isRaw ? Math.min(100, d.I * 5) : d.I,
        normalized_s: isRaw ? Math.min(100, d.S * 5) : d.S,
        normalized_c: isRaw ? Math.min(100, d.C * 5) : d.C,
        perfil_dominante: d.perfil_dominante || '',
        pk_id: '',  // a calcular si hace falta
      });
    }

    // 4. CognitiveScores
    if (score.cognitive) {
      const c = score.cognitive;
      cognitiveScores.push({
        result_id: resultId,
        verbal: c.verbal || 0,
        espacial: c.espacial || 0,
        logica: c.logica || 0,
        numerica: c.numerica || 0,
        abstracta: c.abstracta || 0,
        total: c.total || 0,
        max: c.max || 0,
        indice: c.max > 0 ? Math.round((c.total / c.max) * 100) : 0,
      });
    }

    // 5. EmotionalScores
    if (score.emotional) {
      emotionalScores.push({
        result_id: resultId,
        score: score.emotional.score,
        perfil: score.emotional.perfil,
      });
    }

    // 6. IntegrityScores + IntegrityDimensions
    if (score.overall !== undefined) {  // si es result de integrity
      integrityScores.push({
        result_id: resultId,
        overall: score.overall,
        overall_pct: score.overall_pct,
        recomendacion: score.recomendacion || '',
        buena_impresion: score.buena_impresion || '',
        buena_impresion_pct: score.buena_impresion_pct || 0,
      });
      if (score.dimensiones) {
        for (const [dim, d] of Object.entries(score.dimensiones)) {
          integrityDimensions.push({
            result_id: resultId,
            dimension: dim,
            nivel: d.nivel,
            pct: d.pct,
          });
        }
      }
    }

    // 7. TechnicalScores
    if (score.total !== undefined && score.max !== undefined && !score.dimensiones) {
      // technical (no emotional)
      const pct = Math.round((score.total / score.max) * 100);
      technicalScores.push({
        result_id: resultId,
        score_pct: pct,
        total_correct: score.total,
        total_questions: score.max,
        passed: pct >= 60,  // default min
      });
    }

    // 8. CompetenciaScores (si existe competencias calculadas)
    if (score.competencias && Array.isArray(score.competencias)) {
      for (const comp of score.competencias) {
        competenciaScores.push({
          result_id: resultId,
          competencia_id: comp.id,
          nombre: comp.nombre,
          score: comp.score,
        });
      }
    }

    // 9. ScreenExits (desde screen_exits blob)
    try {
      let rawExits = old.screen_exits || '0';
      if (rawExits.startsWith('{')) {
        const parsed = JSON.parse(rawExits);
        for (const log of parsed.log || []) {
          screenExits.push({
            result_id: resultId,
            section: log.section || '',
            question_idx: log.questionIdx || '',
            question_id: log.questionId || '',
            exit_type: log.type || '',
            left_at: log.leftAt ? new Date(log.leftAt).toISOString() : '',
            returned_at: log.returnedAt ? new Date(log.returnedAt).toISOString() : '',
            duration_sec: log.duration || '',
          });
        }
      }
    } catch { /* ignore malformed */ }

    // 10. PipelineTransitions — inferir desde el estado actual
    if (old.pipeline_stage) {
      pipelineTransitions.push({
        result_id: resultId,
        from_stage: '',
        to_stage: old.pipeline_stage,
        actor: 'migration',
        reason: 'Migrated from legacy schema',
        transitioned_at: old.completed_at || old.started_at,
      });
    }
  }

  return {
    newResults, discScores, cognitiveScores, emotionalScores,
    integrityScores, integrityDimensions, technicalScores,
    competenciaScores, screenExits, pipelineTransitions,
  };
};
```

### `migration/transform/transformReports.js`

Los `explanation_*` → File Store (no van a columnas). Lo más simple: si el `report_file_id` está vacío y hay data en `explanation_summary`, se mantiene la columna (pero llamamos la atención en validación).

**Solución:** en esta fase, **no migrar los explanation_* viejos**. Los reportes nuevos usan File Store. Los viejos que tengan ya `report_file_id` pasan OK. Los que no... los regeneramos.

```javascript
module.exports = function transformReports(reports, reportCandidates) {
  const newReports = reports.map(r => ({
    ROWID: r.ROWID,
    job_id: r.job_id,
    company_slug: r.company_slug,
    job_slug: r.job_slug,
    status: r.status,
    published_at: r.published_at || '',
    comparison_file_id: r.comparison_file_id || '',
    en_comparison_file_id: r.en_comparison_file_id || '',
    access_token: '',  // populate en script aparte para reportes published
    created_at: r.created_at,
  }));

  const newReportCandidates = reportCandidates.map(rc => ({
    ROWID: rc.ROWID,
    report_id: rc.report_id,
    candidate_id: rc.candidate_id,
    references_json: rc.references_json || '[]',
    curriculum_file_id: rc.curriculum_file_id || '',
    report_file_id: rc.report_file_id || '',
    sort_order: rc.sort_order || 0,
  }));

  return { newReports, newReportCandidates };
};
```

### Post-transform: populate `access_token` en ClientReports published

Script aparte:

```javascript
// migration/transform/addAccessTokens.js
const crypto = require('crypto');
const fs = require('fs');

const csvPath = 'imports-2026-05-01/ClientReports.csv';
const raw = fs.readFileSync(csvPath, 'utf-8');
const rows = require('csv-parse/sync').parse(raw, { columns: true });

for (const r of rows) {
  if (r.status === 'published' && !r.access_token) {
    r.access_token = crypto.randomBytes(32).toString('hex');
  }
}

fs.writeFileSync(csvPath, require('csv-stringify/sync').stringify(rows, { header: true }));
console.log(`✓ Tokens added to ${rows.filter(r => r.access_token).length} reports`);
```

**Comunicar a clientes:** los URLs públicos viejos dejan de funcionar. Hay que regenerar los URLs con el nuevo token y enviarlos.

---

## 4. Import al schema nuevo

Catalyst permite import CSV desde la Console:

1. Datastore → tabla → Import → CSV
2. Importar en el orden de dependencias (igual que la creación):
   - Config → TechLibrary → Jobs → JobProfiles → ... (ver [Fase 2](03_FASE2_BASE_DATOS.md#tablas-en-el-orden-recomendado))

### ⚠ Preservar ROWIDs

Si los ROWIDs del CSV no se preservan, todas las FKs se rompen.

**Catalyst por defecto reasigna ROWIDs al importar.** Para preservar:
- Crear columna temporal `legacy_rowid` en cada tabla y populate con el valor viejo
- Después de importar, corregir las FKs en memoria mapeando legacy_rowid → nuevo ROWID
- Esto requiere un pass adicional

**Más simple:** si la app está cerrada durante migración (downtime 2-4h), se pueden preservar los ROWIDs si Catalyst lo permite — verificar con soporte. Si no, es viable manualmente:

1. Import Jobs → obtener mapping legacy_rowid → new_rowid (lo hace Catalyst)
2. Update en memoria del CSV de Assessments: `job_id` pasa de legacy a new
3. Import Assessments → mapping
4. Repetir para cada tabla
5. Updatear FKs cuando corresponda

---

## 5. Validación post-import

### Script `migration/validate.js`

```javascript
// migration/validate.js
// Conecta al backend nuevo deployado y corre queries de sanity check

const axios = require('axios');

const API_BASE = 'https://sharktalents-dev.catalystserverless.com/server/api/api';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

async function apiGet(path) {
  const res = await axios.get(`${API_BASE}${path}`, {
    headers: { 'x-api-key': INTERNAL_API_KEY }
  });
  return res.data;
}

async function validate() {
  console.log('▶ Validating migration...');

  // 1. Counts match
  const counts = await apiGet('/internal/migration-counts');
  console.log('Counts:', counts);
  // Expected: jobs == legacy jobs count, candidates == legacy candidates count, etc.

  // 2. FKs válidas
  const orphans = await apiGet('/internal/migration-orphans');
  if (orphans.results_without_candidate > 0) {
    console.error('✗ Results without candidate:', orphans.results_without_candidate);
  }
  if (orphans.scores_without_result > 0) {
    console.error('✗ Scores without result:', orphans.scores_without_result);
  }
  // ... más checks

  // 3. Muestreo: 5 candidatos al azar, comparar DiscScores con Results.score original
  const sample = await apiGet('/internal/migration-sample');
  for (const item of sample) {
    // Comparar que los valores normalizados coinciden
    if (Math.abs(item.new_score - item.legacy_score) > 1) {
      console.error(`Mismatch: result ${item.result_id} legacy=${item.legacy_score} new=${item.new_score}`);
    }
  }

  console.log('✓ Validation complete');
}

validate().catch(err => { console.error(err); process.exit(1); });
```

Requiere agregar endpoints internos `/internal/migration-*` que devuelvan data para validar. Protegidos con `INTERNAL_API_KEY`.

### Validación manual

Además del script:
- Abrir el panel admin → verificar que se ven los jobs
- Elegir 1 candidato → verificar que su DISC/cognitive/integridad coinciden con lo viejo
- Abrir 1 reporte publicado → verificar que se ve correcto

---

## 6. Plan de ejecución en prod

### Pre-migration (T-2 días)

- [ ] Export CSVs del prod viejo
- [ ] Correr transformación local
- [ ] Import al prod nuevo en **schema vacío** (test del flow completo)
- [ ] Validar

### Migration day (T=0)

Window: **domingo 10pm–2am** (baja actividad).

- [ ] Comunicar al equipo "mantenimiento en curso"
- [ ] **Parar prod viejo:** Catalyst Console → Functions → disable
- [ ] Export final CSVs
- [ ] Transformación
- [ ] Import al prod nuevo
- [ ] Validación completa
- [ ] Actualizar DNS (si aplica) al nuevo proyecto Catalyst
- [ ] Smoke tests completos
- [ ] Comunicar "restored"

### Post-migration (T+1 semana)

- [ ] Monitor intensivo de logs
- [ ] Revisar costos Catalyst
- [ ] Confirmar que reports existentes siguen accesibles con nuevos tokens

---

## 7. Rollback plan

Si algo sale catastrófico:

1. **Re-enable prod viejo** en Catalyst Console.
2. **Revertir DNS** (si se cambió).
3. **Comunicar:** hubo rollback, la versión vieja sigue funcionando.
4. Investigar qué falló antes del próximo intento.

**Ventana de rollback:** primeras 24h. Después de eso, la data que se haya creado en el sistema nuevo se pierde al volver al viejo.

---

## 8. Checklist de cierre Fase 9 (migración)

- [ ] Decisión tomada: migrar o arrancar de cero
- [ ] Si migrar:
  - [ ] Export de CSVs del sistema viejo
  - [ ] Scripts de transformación escritos y probados en dev
  - [ ] Validación ejecutada en dev
  - [ ] Runbook `docs/RUNBOOKS/migration-day.md` escrito con el paso-a-paso
  - [ ] Plan de comunicación a clientes (URLs viejos dejan de funcionar)
  - [ ] Window de mantenimiento agendado
  - [ ] Execute en prod
  - [ ] Validación exitosa
  - [ ] Monitoring por 7 días post-migration
- [ ] Si empezar de cero:
  - [ ] Data crítica identificada y copiada manualmente
  - [ ] Tablas vacías + anuncio "reset del sistema"

---

## Siguiente paso

→ [11_CHECKLIST_PROD.md](11_CHECKLIST_PROD.md) — checklist consolidada para pre/post cada release.
