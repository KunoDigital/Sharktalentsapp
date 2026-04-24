# SharkTalents

Plataforma de evaluación de talento con inteligencia artificial. Construida sobre Zoho Catalyst (backend + hosting) y React (frontend).

## Arquitectura

### Backend
- Zoho Catalyst Advanced I/O Function (Node 20)
- TypeScript compilado a JavaScript
- Almacenamiento: Catalyst Datastore (ZCQL) + Catalyst File Store
- IA: Claude Haiku 4.5 (Anthropic)

### Frontend
- React 18 + TypeScript + Vite
- React Router (HashRouter)
- Chart.js para dashboards

## Estructura del proyecto

```
sharktalentsapp/
├── catalyst.json              Configuración de Catalyst (proyecto)
├── functions/sharktalents/    Backend TypeScript
│   ├── src/
│   │   ├── index.ts           Entry point del handler
│   │   ├── router.ts          Routing simple con patterns
│   │   ├── db.ts              Helpers de Catalyst Datastore
│   │   ├── auth.ts            JWT signing/verification
│   │   ├── helpers.ts         Utilidades HTTP
│   │   ├── routes/            Endpoints REST organizados por área
│   │   ├── services/          Lógica de negocio (scoring, IA, File Store)
│   │   ├── seeds/             Preguntas preestablecidas (DISC, VELNA, integridad)
│   │   └── data/              Datos estáticos (competencias, perfiles PK)
│   ├── catalyst-config.json   Config de la función (env vars REEMPLAZAR)
│   └── package.json
├── frontend/                  React + Vite
│   ├── src/
│   │   ├── pages/admin/       Panel de reclutador
│   │   ├── pages/candidate/   Pruebas del candidato
│   │   ├── pages/public/      Reporte público para cliente
│   │   ├── services/api.ts    Cliente HTTP
│   │   └── components/        UI compartida
│   └── package.json
```

## Variables de entorno (Catalyst)

En `functions/sharktalents/catalyst-config.json` hay 4 variables que se deben configurar en la consola de Catalyst antes del primer deploy:

- `ANTHROPIC_API_KEY` — clave de Anthropic para Claude Haiku
- `ADMIN_USER` — usuario admin para login
- `ADMIN_PASS_HASH` — hash SHA256 con salt del password
- `JWT_SECRET` — secreto para firmar tokens JWT de sesión

## Tablas de Catalyst Datastore

El schema no vive en este repo (se define en la consola de Catalyst). Tablas usadas:

- **Jobs** — puestos de trabajo
- **Assessments** — pruebas (Kudert, Integridad, Técnica)
- **AssessmentQuestions** — preguntas técnicas (una fila por pregunta)
- **Candidates** — candidatos
- **Results** — resultados de pruebas
- **ClientReports** — reportes para cliente
- **ReportCandidates** — candidatos incluidos en cada reporte
- **TechLibrary** — biblioteca de prompts técnicos

## Desarrollo

### Instalar dependencias
```bash
cd functions/sharktalents && npm install
cd ../../frontend && npm install
```

### Build
```bash
cd functions/sharktalents && npm run build
cd ../../frontend && npm run build
```

### Deploy
```bash
catalyst deploy
```

## File Store

Los reportes grandes (explicaciones con IA, traducciones EN, comparativos, transcripciones de entrevistas) se almacenan como JSON en una carpeta `reports` de Catalyst File Store. Las referencias (file_id) se guardan en las columnas correspondientes de las tablas.

## Dimensiones de evaluación

1. **Conducta** (DISC)
2. **Cognición** (VELNA: Verbal, Espacial, Lógica, Numérica, Abstracta)
3. **Técnica** (preguntas generadas por IA contextualizadas al puesto)
4. **Emoción** (reactividad emocional: espontáneo, equilibrado, reflexivo)
5. **Integridad** (multidimensional con detector de deseabilidad social)
