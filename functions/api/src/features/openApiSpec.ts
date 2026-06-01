/**
 * OpenAPI 3.1 spec mínima para clientes externos. Endpoint público (no requiere auth).
 *
 *   GET /api/v1/openapi.json  → JSON con la spec
 *   GET /docs                 → HTML simple con Scalar/Swagger reference
 *
 * Esta es la base; cuando se quiera doc completa por endpoint, agregar campos por handler.
 */
import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';

const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'SharkTalents API',
    version: '1.0.0',
    description: 'API pública de SharkTalents para integraciones (Zapier, Make, MCP, etc.). Auth: Bearer API key.',
    contact: {
      name: 'SharkTalents',
      email: 'cris@kunodigital.com',
    },
  },
  servers: [
    { url: 'https://sharktalentsapp-883996440.development.catalystserverless.com/server/api', description: 'Development' },
  ],
  components: {
    securitySchemes: {
      apiKey: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'st_live_<32 chars>',
        description: 'API key del tenant. Crear en Settings → API keys.',
      },
    },
    schemas: {
      Job: {
        type: 'object',
        properties: {
          ROWID: { type: 'string' },
          tenant_id: { type: 'string' },
          title: { type: 'string' },
          company: { type: 'string' },
          tech_prompt: { type: 'string', nullable: true },
          cognitive_level: { type: 'string', enum: ['basic', 'mid', 'senior'] },
          is_active: { type: 'boolean' },
          ideal_profile: { type: 'string', nullable: true, description: 'JSON con disc/velna/competencias' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Candidate: {
        type: 'object',
        properties: {
          ROWID: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string', nullable: true },
          age: { type: 'integer', nullable: true },
        },
      },
      Application: {
        type: 'object',
        properties: {
          ROWID: { type: 'string' },
          assessment_id: { type: 'string', description: 'Job ROWID' },
          candidate_id: { type: 'string' },
          pipeline_stage: { type: 'string' },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
          },
          trace_id: { type: 'string' },
        },
      },
    },
  },
  security: [{ apiKey: [] }],
  paths: {
    '/api/v1/jobs': {
      get: {
        summary: 'Lista jobs del tenant',
        tags: ['Jobs'],
        parameters: [
          { name: 'include_inactive', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobs: { type: 'array', items: { $ref: '#/components/schemas/Job' } },
                  },
                },
              },
            },
          },
          '401': { description: 'API key inválida o ausente', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        summary: 'Crear job',
        tags: ['Jobs'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'company'],
                properties: {
                  title: { type: 'string', maxLength: 255 },
                  company: { type: 'string', maxLength: 255 },
                  cognitive_level: { type: 'string', enum: ['basic', 'mid', 'senior'] },
                  tech_prompt: { type: 'string', nullable: true },
                  company_context: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Job creado', content: { 'application/json': { schema: { type: 'object', properties: { job: { $ref: '#/components/schemas/Job' } } } } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/v1/jobs/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { summary: 'Get job by ID', tags: ['Jobs'], responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } } },
      patch: { summary: 'Update job', tags: ['Jobs'], responses: { '200': { description: 'Updated' } } },
      delete: { summary: 'Archive job (soft delete)', tags: ['Jobs'], responses: { '200': { description: 'Archived' } } },
    },
    '/api/v1/candidates': {
      get: { summary: 'Lista candidates del tenant', tags: ['Candidates'], responses: { '200': { description: 'OK' } } },
      post: { summary: 'Crear candidate (upsert por email)', tags: ['Candidates'], responses: { '200': { description: 'OK' } } },
    },
    '/api/v1/applications': {
      get: { summary: 'Lista applications del tenant', tags: ['Applications'], responses: { '200': { description: 'OK' } } },
      post: { summary: 'Crear application (asocia candidate a job)', tags: ['Applications'], responses: { '200': { description: 'OK' } } },
    },
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['Meta'],
        security: [],
        responses: { '200': { description: 'Healthy' }, '503': { description: 'Degraded' } },
      },
    },
    '/test/{token}/mindset/submit': {
      post: {
        summary: 'Submit del test de Mentalidades del candidato',
        description: 'Endpoint público token-signed. El candidato envía sus respuestas, el backend computa adaptability_score_pct y persiste en MindsetScores.',
        tags: ['Candidate Tests'],
        security: [],
        responses: {
          '200': { description: 'Score computado y persistido' },
          '401': { description: 'Token inválido o expirado' },
          '503': { description: 'Tabla MindsetScores no creada en Catalyst' },
        },
      },
    },
    '/test/{token}/english/submit': {
      post: {
        summary: 'Submit completo del test de Inglés del candidato',
        description: 'Endpoint público token-signed. Recibe respuestas multiple-choice + listening + texto del writing. Llama a Claude para analizar el writing, computa score ponderado, persiste en EnglishTestSessions, devuelve passed: true/false.',
        tags: ['Candidate Tests'],
        security: [],
        responses: {
          '200': { description: 'Score computado y persistido. passed=true/false según threshold del nivel' },
          '401': { description: 'Token inválido o expirado' },
          '503': { description: 'Tabla EnglishTestSessions no creada en Catalyst' },
        },
      },
    },
    '/api/applications/{id}/mindset': {
      get: {
        summary: 'Score de mentalidades del candidato (vista del recruiter)',
        description: 'Devuelve el score de adaptabilidad + perfil 14 polos del candidato si ya completó el test.',
        tags: ['Candidate Tests'],
        responses: {
          '200': { description: 'Score encontrado' },
          '404': { description: 'El candidato no completó el test todavía' },
          '503': { description: 'Tabla MindsetScores no creada' },
        },
      },
    },
    '/api/applications/{id}/english': {
      get: {
        summary: 'Sesión de inglés del candidato (vista del recruiter)',
        description: 'Devuelve la sesión completa: scores parciales, score total, nivel solicitado, passed, writing del candidato + análisis IA.',
        tags: ['Candidate Tests'],
        responses: {
          '200': { description: 'Sesión encontrada' },
          '404': { description: 'El candidato no completó el test todavía' },
          '503': { description: 'Tabla EnglishTestSessions no creada' },
        },
      },
    },
  },
};

export async function getOpenApiSpec(ctx: RequestContext): Promise<void> {
  sendJson(ctx.res, 200, SPEC);
}

const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>SharkTalents API — Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/server/api/api/v1/openapi.json"
      data-configuration='{"theme":"deepSpace","layout":"modern"}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

export async function getApiDocs(ctx: RequestContext): Promise<void> {
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
  ctx.res.end(DOCS_HTML);
}
