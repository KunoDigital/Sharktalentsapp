/**
 * Definición de tools del MCP server.
 *
 * Cada tool tiene:
 *   - name: identificador único (kebab-case con prefijo de área)
 *   - description: lo que verá Claude para decidir cuándo usarlo
 *   - inputSchema: JSON schema (subconjunto) del input
 *   - handler: función async que recibe el client y los args
 */
import type { SharkTalentsClient } from './apiClient.js';

export type ToolHandler = (client: SharkTalentsClient, args: Record<string, unknown>) => Promise<unknown>;

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  handler: ToolHandler;
};

export const TOOLS: ToolDef[] = [
  // ===== Jobs =====
  {
    name: 'jobs_list',
    description: 'Lista los puestos abiertos del tenant. Por defecto solo activos.',
    inputSchema: {
      type: 'object',
      properties: {
        include_inactive: { type: 'boolean', description: 'Si true, incluye archivados' },
      },
    },
    handler: async (client, args) => client.listJobs({ includeInactive: args.include_inactive === true }),
  },
  {
    name: 'jobs_get',
    description: 'Devuelve un puesto por ID con todos sus campos (incluye ideal_profile JSON).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Job ROWID' },
      },
      required: ['id'],
    },
    handler: async (client, args) => client.getJob(String(args.id)),
  },
  {
    name: 'jobs_create',
    description: 'Crea un puesto nuevo. Después se puede editar para agregar perfil ideal y técnica.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título del puesto' },
        company: { type: 'string', description: 'Empresa cliente' },
        cognitive_level: { type: 'string', enum: ['basic', 'mid', 'senior'] },
        tech_prompt: { type: 'string', description: 'Descripción de qué evaluar técnicamente' },
        company_context: { type: 'string', description: 'Contexto del puesto/empresa para IA' },
      },
      required: ['title', 'company'],
    },
    handler: async (client, args) => client.createJob({
      title: String(args.title),
      company: String(args.company),
      cognitive_level: (args.cognitive_level as 'basic' | 'mid' | 'senior') ?? 'mid',
      tech_prompt: typeof args.tech_prompt === 'string' ? args.tech_prompt : null,
      company_context: typeof args.company_context === 'string' ? args.company_context : null,
    }),
  },
  {
    name: 'jobs_archive',
    description: 'Archiva un puesto (soft delete). No borra data.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async (client, args) => client.archiveJob(String(args.id)),
  },

  // ===== Candidates =====
  {
    name: 'candidates_list',
    description: 'Lista candidatos del tenant. Útil para buscar a quién mandar un test, etc.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Default 100, máx 500' } },
    },
    handler: async (client, args) => client.listCandidates({
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    }),
  },
  {
    name: 'candidates_get',
    description: 'Devuelve un candidato por ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async (client, args) => client.getCandidate(String(args.id)),
  },

  // ===== Applications (results) =====
  {
    name: 'applications_list',
    description: 'Lista aplicaciones (un candidato aplicando a un puesto). Filtrable por job_id.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job ROWID para filtrar' },
        limit: { type: 'number' },
      },
    },
    handler: async (client, args) => client.listApplications({
      jobId: typeof args.job_id === 'string' ? args.job_id : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    }),
  },
  {
    name: 'applications_get',
    description: 'Devuelve una aplicación + su histórico de transiciones de pipeline.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async (client, args) => client.getApplication(String(args.id)),
  },
  {
    name: 'applications_get_with_scores',
    description: 'Devuelve una aplicación + scores completos (DISC, VELNA, técnica, integridad, emocional). Útil para análisis.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async (client, args) => {
      const id = String(args.id);
      const [app, scores] = await Promise.all([
        client.getApplication(id),
        client.readApplicationScores(id),
      ]);
      return { ...app, scores: scores.scores, integrity_dimensions: scores.integrity_dimensions };
    },
  },
  {
    name: 'applications_transition',
    description: 'Cambia el stage del pipeline de una aplicación. Valida transición permitida.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Application ROWID' },
        to_stage: { type: 'string', description: 'Stage destino (ej: finalist, rejected_by_admin)' },
        reason: { type: 'string', description: 'Razón opcional' },
      },
      required: ['id', 'to_stage'],
    },
    handler: async (client, args) => client.transitionApplication(
      String(args.id),
      String(args.to_stage),
      typeof args.reason === 'string' ? args.reason : undefined,
    ),
  },

  // ===== Bot review queue =====
  {
    name: 'bot_review_queue_list',
    description: 'Lista la cola de revisión del bot decisor (casos donde la IA recomendó pero faltó confianza). Si la tabla no existe en Catalyst, devuelve error 503.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (client) => client.listReviewQueue(),
  },
  {
    name: 'bot_review_queue_decide',
    description: 'Resuelve un item de la cola: confirma la sugerencia del bot u override con otro stage. La decisión queda como training example.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ReviewQueue ROWID' },
        action: { type: 'string', enum: ['confirm', 'override'] },
        override_stage: { type: 'string', description: 'Solo si action=override' },
        rationale: { type: 'string', description: 'Razón opcional (queda como training example)' },
      },
      required: ['id', 'action'],
    },
    handler: async (client, args) => client.decideReviewQueueItem(String(args.id), {
      action: args.action as 'confirm' | 'override',
      override_stage: typeof args.override_stage === 'string' ? args.override_stage : undefined,
      rationale: typeof args.rationale === 'string' ? args.rationale : undefined,
    }),
  },
];

export async function dispatchTool(
  client: SharkTalentsClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool no encontrada: ${name}. Tools disponibles: ${TOOLS.map((t) => t.name).join(', ')}`);
  return tool.handler(client, args);
}
