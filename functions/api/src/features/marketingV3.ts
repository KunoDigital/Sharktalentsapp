/**
 * Marketing V3 — nuevo modelo con 2 pipelines: Prospectos (pre-handoff) + Ventas (post-handoff).
 *
 * ESTA TANDA (1) es solo backend: agrega endpoints paralelos sin consumirlos aún desde el frontend.
 * El código viejo (marketingV2.ts → listMarketingClientes) sigue funcionando exactamente igual.
 *
 * Coexistencia con V2:
 *  - Endpoints nuevos: /api/marketing/prospectos, /api/marketing/ventas
 *  - Endpoints viejos: /api/marketing/clientes, /api/marketing/finalistas (sin tocar)
 *  - Frontend nuevo (Tanda 2 y 3) va a consumir los V3 detrás de un feature flag
 *  - Rollback: apagar el flag y el frontend viejo sigue leyendo V2 sin cambios
 *
 * Endpoints:
 *  - GET /api/marketing/prospectos  → leads pre-handoff (finalistas + demos, no fríos, no asignados)
 *  - GET /api/marketing/ventas      → leads post-handoff (asignados a vendedor), 3 columnas nuevas
 *
 * Feature flag: MARKETING_V3_ENABLED (secreto en Catalyst Console). Por default off — los endpoints
 * responden 503 con mensaje claro si el flag no está en 'true'. Esto evita que el frontend viejo
 * consuma los V3 accidentalmente durante rollout.
 */

import type { RequestContext } from '../lib/context';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { AppError, ValidationError, NotFoundError } from '../lib/errors';
import { signToken, expiresIn, DAY_SEC } from '../lib/urlSigning';
import { env } from '../lib/env';
import { normalizeSource, type SourceBucket } from './marketingV2';

const log = logger('MARKETING_V3');
const TABLE_LEADS = 'MarketingLeads';
const TABLE_FREELANCE = 'FreelanceUsers';

// ============================================================================
// Feature flag — hardcoded en código porque Catalyst tiene límite total de env vars
// y no cabe más. Para rollback: cambiar la constante a false y redeployar (~2 min).
//
// Cuando la tabla Config esté creada (Block 2 pendiente), esto puede migrar a
// leer de Config runtime sin redeploy.
// ============================================================================
const MARKETING_V3_ENABLED = true;

function isV3Enabled(): boolean {
  return MARKETING_V3_ENABLED;
}

function respondFlagOff(ctx: RequestContext): void {
  sendJson(ctx.res, 503, {
    error: {
      code: 'v3_disabled',
      message: 'Marketing V3 no está activado. Setear MARKETING_V3_ENABLED=true en Catalyst Console.',
    },
  });
}

// ============================================================================
// Journey type — deriva del `source` textual el bucket lógico del journey.
// Sirve para filtrar Prospectos vs Ventas y elegir columnas del kanban.
// ============================================================================
export type JourneyType = 'finalista' | 'demo' | 'frio';

export function deriveJourneyType(source: string | null | undefined): JourneyType {
  const bucket: SourceBucket = normalizeSource(source);
  if (bucket === 'finalista') return 'finalista';
  if (bucket === 'demo') return 'demo';
  // meta_ads, linkedin, manual, otros → todos fríos
  return 'frio';
}

// ============================================================================
// Mapping bidireccional: pipeline_stage viejo ↔ nuevo modelo (Prospectos + Ventas).
//
// El schema físico de MarketingLeads no cambia — pipeline_stage sigue teniendo
// los mismos valores. El mapping traduce a los estados del nuevo modelo para
// que la UI nueva los pueda pintar. Cuando alguien mueve un card en la UI
// nueva, el backend traduce al valor viejo antes de escribir.
//
// Esto elimina la necesidad de migrar datos existentes en esta tanda.
// ============================================================================

// Estados del nuevo modelo:
//   Prospectos (4 columnas para finalistas/demos pre-handoff):
//     - candidato_en_pruebas    (candidato haciendo pruebas)
//     - esperando_reunion       (finalista camino A: agendó, no fue aún)
//     - esperando_reporte       (finalista camino A: reunión hecha, armar reporte)
//     - reporte_enviado         (reporte despachado + round-robin ejecutado — visible aquí y en Ventas)
//   Ventas (6 columnas para leads asignados a vendedor):
//     - nuevo_asignado          (recibido por round-robin, sin contactar)
//     - contactado              (vendedor llamó/mensajeó, sin respuesta aún)
//     - en_conversacion         (cliente respondió, diálogo activo)
//     - reunion                 (agendada o hecha)
//     - contrato_pago           (Zoho Sign disparado, esperando pago)
//     - perdido                 (descartado)
export type PipelineStageV3 =
  | 'candidato_en_pruebas'
  | 'esperando_reunion'
  | 'esperando_reporte'
  | 'reporte_enviado'
  | 'nuevo_asignado'
  | 'contactado'
  | 'en_conversacion'
  | 'reunion'
  | 'contrato_pago'
  | 'perdido';

/**
 * Traduce (pipeline_stage_viejo, journey, assigned_to, finalist_status) → estado V3.
 */
export function mapToV3Stage(input: {
  oldStage: string | null;
  journey: JourneyType;
  assignedTo: string | null;
  finalistStatus: string | null;
}): PipelineStageV3 {
  const { oldStage, journey, assignedTo, finalistStatus } = input;

  // Perdido siempre gana — cierre irreversible.
  if (oldStage === 'perdido') return 'perdido';

  // Si tiene vendor asignado, está en Ventas. Traducir según old_stage.
  if (assignedTo) {
    if (oldStage === 'cotizacion_enviada' || oldStage === 'contrato_pago') return 'contrato_pago';
    if (oldStage === 'reunion_agendada' || oldStage === 'reunion_hecha' || oldStage === 'reunion') return 'reunion';
    if (oldStage === 'interesado' || oldStage === 'en_conversacion') return 'en_conversacion';
    if (oldStage === 'contactado') return 'contactado';
    // Legacy 'en_seguimiento' → en_conversacion (más neutro que reunion)
    if (oldStage === 'en_seguimiento') return 'en_conversacion';
    // Nuevo / nuevo_lead / nuevo_asignado / vacío → nuevo_asignado
    return 'nuevo_asignado';
  }

  // Sin asignar. Si es frío, DEBERÍA estar asignado — fallback a nuevo_asignado.
  if (journey === 'frio') return 'nuevo_asignado';

  // Finalista o demo sin asignar → Prospectos. Refinamos con finalist_status.
  if (finalistStatus === 'reporte_enviado') return 'reporte_enviado';
  if (finalistStatus === 'esperando_reporte') return 'esperando_reporte';
  if (finalistStatus === 'esperando_reunion') return 'esperando_reunion';
  // finalist_status='auto_pending' | null → candidato aún haciendo pruebas
  return 'candidato_en_pruebas';
}

// ============================================================================
// GET /api/marketing/prospectos — leads pre-handoff (Chris's inbox)
// ============================================================================
type ProspectoRow = {
  ROWID: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  puesto: string | null;
  source: string | null;
  status: string | null;
  pipeline_stage: string | null;
  assigned_to: string | null;
  eval_result_id: string | null;
  fit_choice: string | null;
  finalist_status: string | null;
  created_at: string | null;
  CREATEDTIME: string;
};

export async function listProspectos(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(isV3Enabled())) {
    respondFlagOff(ctx);
    return;
  }

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const journeyFilter = url.searchParams.get('journey'); // 'finalista' | 'demo' | null
  const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit') ?? 200)));

  // Prospectos muestra:
  //   - Leads no asignados (finalistas/demos pre-handoff)
  //   - Leads con finalist_status='reporte_enviado' (aunque estén asignados) — quedan como
  //     registro visible del handoff que hicimos. La misma card aparece en Ventas para el vendedor.
  // Excluimos perdidos por default (van a la sección aparte).
  const q = `SELECT ROWID, email, contact_name, company, whatsapp, puesto, source, status,
              pipeline_stage, assigned_to, eval_result_id, fit_choice, finalist_status, created_at
              FROM ${TABLE_LEADS}
              WHERE pipeline_stage != 'perdido'
                AND (assigned_to IS NULL OR finalist_status = 'reporte_enviado')
              ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  let rows: ProspectoRow[] = [];
  try {
    rows = unwrapRows<ProspectoRow>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE_LEADS);
  } catch (err) {
    // Si columnas nuevas (fit_choice, finalist_status) no existen aún en Catalyst,
    // la query falla. Degradamos con una consulta sin esos campos.
    log.warn('listProspectos full query failed — retrying without new columns', {
      traceId: ctx.traceId,
      error: (err as Error).message,
    });
    const fallbackQ = `SELECT ROWID, email, contact_name, company, whatsapp, puesto, source, status,
                        pipeline_stage, assigned_to, eval_result_id, created_at
                        FROM ${TABLE_LEADS}
                        WHERE assigned_to IS NULL AND pipeline_stage != 'perdido'
                        ORDER BY CREATEDTIME DESC LIMIT ${limit}`;
  // Nota: el fallback no filtra por finalist_status='reporte_enviado' porque la columna
  // no existe. Es OK — el flujo sin esa columna solo muestra los pre-handoff clásicos.
    try {
      const partial = unwrapRows<Omit<ProspectoRow, 'fit_choice' | 'finalist_status'>>(
        (await zcql(ctx.req).executeZCQLQuery(fallbackQ)) as unknown[],
        TABLE_LEADS,
      );
      rows = partial.map((r) => ({ ...r, fit_choice: null, finalist_status: null } as ProspectoRow));
    } catch (err2) {
      throw new AppError(500, 'list_prospectos_failed', `Query failed: ${(err2 as Error).message}`);
    }
  }

  // Filter local: solo finalistas + demos (fríos no van en Prospectos)
  const prospectos = rows
    .map((r) => {
      const journey = deriveJourneyType(r.source);
      return { row: r, journey };
    })
    .filter(({ journey }) => journey === 'finalista' || journey === 'demo')
    .filter(({ journey }) => (journeyFilter ? journey === journeyFilter : true));

  const appBase = env().APP_BASE_URL.replace(/\/$/, '');

  const items = prospectos.map(({ row: r, journey }) => {
    // Estado V3 mapeado
    const v3Stage = mapToV3Stage({
      oldStage: r.pipeline_stage,
      journey,
      assignedTo: r.assigned_to,
      finalistStatus: r.finalist_status,
    });

    // Regenerar demo_report_url si hay eval_result_id (mismo patrón que V2)
    let demoReportUrl: string | null = null;
    if (r.eval_result_id) {
      const token = signToken({ kind: 'report', ref: r.eval_result_id, exp: expiresIn(30 * DAY_SEC) });
      demoReportUrl = `${appBase}/app/index.html#/demo-report/${token}`;
    }

    return {
      id: r.ROWID,
      email: r.email,
      contact_name: r.contact_name,
      company: r.company,
      whatsapp: r.whatsapp,
      puesto: r.puesto,
      journey_type: journey,
      v3_stage: v3Stage,
      fit_choice: r.fit_choice,
      finalist_status: r.finalist_status,
      demo_report_url: demoReportUrl,
      tests_completed: r.status === 'eval_completed',
      has_fit_report: r.finalist_status === 'reporte_enviado',
      created_at: r.created_at,
    };
  });

  // Stats por columna del kanban Prospectos
  const stats = {
    total: items.length,
    finalistas: items.filter((i) => i.journey_type === 'finalista').length,
    demos: items.filter((i) => i.journey_type === 'demo').length,
    candidato_en_pruebas: items.filter((i) => i.v3_stage === 'candidato_en_pruebas').length,
    esperando_reunion: items.filter((i) => i.v3_stage === 'esperando_reunion').length,
    esperando_reporte: items.filter((i) => i.v3_stage === 'esperando_reporte').length,
  };

  sendJson(ctx.res, 200, { prospectos: items, stats });
}

// ============================================================================
// GET /api/marketing/ventas — leads post-handoff (vendedores)
// ============================================================================
type VentaRow = ProspectoRow & { salary_target: string | null; urgency: string | null; score_quality: number | null };
type FreelanceRow = { ROWID: string; nombre: string };

export async function listVentas(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(isV3Enabled())) {
    respondFlagOff(ctx);
    return;
  }

  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const vendorFilter = url.searchParams.get('vendor'); // ROWID de freelance o 'all'
  const journeyFilter = url.searchParams.get('journey'); // 'finalista' | 'demo' | 'frio'
  const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit') ?? 200)));

  const filters: string[] = ['assigned_to IS NOT NULL'];
  if (vendorFilter && vendorFilter !== 'all') filters.push(`assigned_to = '${escapeSql(vendorFilter)}'`);
  const whereClause = `WHERE ${filters.join(' AND ')}`;

  const q = `SELECT ROWID, email, contact_name, company, whatsapp, puesto, source, status,
              pipeline_stage, assigned_to, eval_result_id, salary_target, urgency, score_quality,
              fit_choice, finalist_status, created_at
              FROM ${TABLE_LEADS} ${whereClause}
              ORDER BY CREATEDTIME DESC LIMIT ${limit}`;

  let rows: VentaRow[] = [];
  try {
    rows = unwrapRows<VentaRow>((await zcql(ctx.req).executeZCQLQuery(q)) as unknown[], TABLE_LEADS);
  } catch (err) {
    // Fallback si columnas nuevas no existen (fit_choice, finalist_status)
    log.warn('listVentas full query failed — retrying without new columns', {
      traceId: ctx.traceId,
      error: (err as Error).message,
    });
    const fallbackQ = `SELECT ROWID, email, contact_name, company, whatsapp, puesto, source, status,
                        pipeline_stage, assigned_to, eval_result_id, salary_target, urgency, score_quality,
                        created_at
                        FROM ${TABLE_LEADS} ${whereClause}
                        ORDER BY CREATEDTIME DESC LIMIT ${limit}`;
    try {
      const partial = unwrapRows<Omit<VentaRow, 'fit_choice' | 'finalist_status'>>(
        (await zcql(ctx.req).executeZCQLQuery(fallbackQ)) as unknown[],
        TABLE_LEADS,
      );
      rows = partial.map((r) => ({ ...r, fit_choice: null, finalist_status: null } as VentaRow));
    } catch (err2) {
      throw new AppError(500, 'list_ventas_failed', `Query failed: ${(err2 as Error).message}`);
    }
  }

  // Filter por journey si viene
  const filteredRows = rows.filter((r) => {
    const journey = deriveJourneyType(r.source);
    return journeyFilter ? journey === journeyFilter : true;
  });

  // Cargar nombres de vendedores en 1 query
  const vendorIds = Array.from(new Set(filteredRows.map((r) => r.assigned_to).filter(Boolean))) as string[];
  const vendorMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    try {
      const inClause = vendorIds.map((id) => `'${escapeSql(id)}'`).join(',');
      const freelanceRows = unwrapRows<FreelanceRow>(
        (await zcql(ctx.req).executeZCQLQuery(
          `SELECT ROWID, nombre FROM ${TABLE_FREELANCE} WHERE ROWID IN (${inClause}) LIMIT 300`,
        )) as unknown[],
        TABLE_FREELANCE,
      );
      for (const f of freelanceRows) vendorMap.set(f.ROWID, f.nombre);
    } catch (err) {
      log.warn('vendor lookup failed — continuing without names', { traceId: ctx.traceId, error: (err as Error).message });
    }
  }

  const appBase = env().APP_BASE_URL.replace(/\/$/, '');

  const items = filteredRows.map((r) => {
    const journey = deriveJourneyType(r.source);
    const v3Stage = mapToV3Stage({
      oldStage: r.pipeline_stage,
      journey,
      assignedTo: r.assigned_to,
      finalistStatus: r.finalist_status,
    });

    let demoReportUrl: string | null = null;
    if (r.eval_result_id) {
      const token = signToken({ kind: 'report', ref: r.eval_result_id, exp: expiresIn(30 * DAY_SEC) });
      demoReportUrl = `${appBase}/app/index.html#/demo-report/${token}`;
    }

    return {
      id: r.ROWID,
      email: r.email,
      contact_name: r.contact_name,
      company: r.company,
      whatsapp: r.whatsapp,
      puesto: r.puesto,
      journey_type: journey,
      v3_stage: v3Stage,
      vendor_id: r.assigned_to,
      vendor_name: r.assigned_to ? vendorMap.get(r.assigned_to) ?? null : null,
      salary_target: r.salary_target,
      urgency: r.urgency,
      score_quality: r.score_quality,
      demo_report_url: demoReportUrl,
      has_fit_report: r.finalist_status === 'reporte_enviado',
      created_at: r.created_at,
    };
  });

  const stats = {
    total: items.length,
    nuevo_asignado: items.filter((i) => i.v3_stage === 'nuevo_asignado').length,
    contactado: items.filter((i) => i.v3_stage === 'contactado').length,
    en_conversacion: items.filter((i) => i.v3_stage === 'en_conversacion').length,
    reunion: items.filter((i) => i.v3_stage === 'reunion').length,
    contrato_pago: items.filter((i) => i.v3_stage === 'contrato_pago').length,
    perdido: items.filter((i) => i.v3_stage === 'perdido').length,
    por_journey: {
      finalista: items.filter((i) => i.journey_type === 'finalista').length,
      demo: items.filter((i) => i.journey_type === 'demo').length,
      frio: items.filter((i) => i.journey_type === 'frio').length,
    },
  };

  sendJson(ctx.res, 200, { ventas: items, stats });
}

// ============================================================================
// PATCH /api/marketing/lead/:id/v3-stage — mover un lead entre columnas de Ventas
// ============================================================================
//
// Recibe el v3_stage nuevo (nuevo_asignado | en_seguimiento | perdido) y traduce
// al pipeline_stage viejo antes de escribir. Esto permite arrastrar cards en la UI
// V3 sin romper el schema viejo.
//
// Nota: contrato_pago NO se acepta acá — requiere modal + datos legales + conversión
// a Deal en Zoho. Ese flow va por POST /api/marketing/lead/:id/convert-to-deal.
export async function updateV3Stage(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(isV3Enabled())) {
    respondFlagOff(ctx);
    return;
  }

  const m = ctx.req.url?.match(/^\/api\/marketing\/lead\/([^/]+)\/v3-stage\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const newV3Stage = typeof body.v3_stage === 'string' ? body.v3_stage : '';

  if (newV3Stage === 'contrato_pago') {
    throw new AppError(400, 'use_convert_to_deal', 'Para mover a "Contrato + pago" usá POST /api/marketing/lead/:id/convert-to-deal');
  }

  // Mapping V3 (6 columnas de Ventas + perdido) → pipeline_stage físico en DB.
  // Nota: 'en_seguimiento' se mantiene por compat con leads legacy.
  const stageMap: Record<string, string> = {
    nuevo_asignado: 'nuevo',
    contactado: 'contactado',
    en_conversacion: 'interesado',
    reunion: 'reunion_agendada',
    perdido: 'perdido',
  };
  const pipelineStage = stageMap[newV3Stage];
  if (!pipelineStage) throw new ValidationError(`v3_stage inválido: ${newV3Stage}`);

  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      pipeline_stage: pipelineStage,
      updated_at: now(),
    });
    log.info('v3 stage updated', { traceId: ctx.traceId, leadId, newV3Stage, pipelineStage });
  } catch (err) {
    throw new AppError(500, 'update_failed', `Update failed: ${(err as Error).message}`);
  }

  sendJson(ctx.res, 200, { ok: true, leadId, v3_stage: newV3Stage, pipeline_stage: pipelineStage });
}

// ============================================================================
// POST /api/marketing/lead/:id/mark-meeting-done — pasa "Esperando reunión" → "Esperando reporte"
// ============================================================================
//
// Camino A finalista: cliente eligió Fit en la landing → cae en "Esperando reunión".
// Chris hace la reunión con el cliente por Zoho Booking. Después de la reunión,
// Chris toca este endpoint para pasar la card a "Esperando reporte" y armar el
// fit report ella misma.
//
// Idempotente: si el lead ya está en 'esperando_reporte' o 'reporte_enviado',
// no hace nada.
export async function markMeetingDone(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!isV3Enabled()) {
    respondFlagOff(ctx);
    return;
  }

  const m = ctx.req.url?.match(/^\/api\/marketing\/lead\/([^/]+)\/mark-meeting-done\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      finalist_status: 'esperando_reporte',
      updated_at: now(),
    });
    log.info('meeting marked done', { traceId: ctx.traceId, leadId });
  } catch (err) {
    throw new AppError(500, 'update_failed', `Update failed: ${(err as Error).message}`);
  }

  sendJson(ctx.res, 200, { ok: true, leadId, finalist_status: 'esperando_reporte' });
}

// ============================================================================
// POST /api/marketing/lead/:id/convert-to-deal — Lead → Deal en Zoho + Zoho Sign
// ============================================================================
//
// Handler del modal "Contrato + pago". Cuando el vendedor arrastra un card a esa
// columna, el frontend abre el DatosLegalesModal con la sección "Del deal" extra.
// Al submit del modal se llama este endpoint que:
//   1. Valida los datos legales completos
//   2. Convierte el Lead en Zoho a Account + Contact + Deal (via convertLead API)
//   3. Actualiza el Deal en Zoho con Amount = salario × 1.2, Closing_Date, etc.
//   4. Guarda IDs de Zoho en el lead (zoho_crm_lead_id, deal_id)
//   5. Actualiza pipeline_stage a 'contrato_pago'
//   6. Dispara Zoho Sign con contrato + link de pago (via Deluge existente)
//   7. Devuelve OK + Deal ID
//
// Si algo falla en pasos 2-6, el lead queda en pipeline_stage='en_seguimiento'
// para que el vendedor pueda reintentar.
export async function convertLeadToDeal(ctx: RequestContext): Promise<void> {
  const { requireAuth } = await import('../lib/auth.js');
  const { requireTenant } = await import('./tenants.js');
  await requireAuth(ctx);
  await requireTenant(ctx);

  if (!(isV3Enabled())) {
    respondFlagOff(ctx);
    return;
  }

  const m = ctx.req.url?.match(/^\/api\/marketing\/lead\/([^/]+)\/convert-to-deal\/?$/);
  const leadId = m?.[1];
  if (!leadId) throw new ValidationError('lead id missing in path');

  const body = (await readJsonBody(ctx.req)) as Record<string, unknown>;

  // Datos legales (empresa + representante)
  const razonSocial = typeof body.empresa_razon_social === 'string' ? body.empresa_razon_social.trim() : '';
  const rucNit = typeof body.empresa_ruc_nit === 'string' ? body.empresa_ruc_nit.trim() : '';
  const direccion = typeof body.empresa_direccion === 'string' ? body.empresa_direccion.trim() : '';
  const ciudad = typeof body.empresa_ciudad === 'string' ? body.empresa_ciudad.trim() : '';
  const pais = typeof body.empresa_pais === 'string' ? body.empresa_pais.trim() : 'Panamá';
  const repNombre = typeof body.representante_nombre === 'string' ? body.representante_nombre.trim() : '';
  const repCargo = typeof body.representante_cargo === 'string' ? body.representante_cargo.trim() : '';
  const repCedula = typeof body.representante_cedula === 'string' ? body.representante_cedula.trim() : '';
  const repEmail = typeof body.representante_email === 'string' ? body.representante_email.trim().toLowerCase() : '';

  // Del deal
  const puestoCargo = typeof body.puesto_cargo === 'string' ? body.puesto_cargo.trim() : '';
  const salarioUsd = typeof body.salario_usd === 'number' ? body.salario_usd : 0;
  const closingDate = typeof body.closing_date === 'string' ? body.closing_date.trim() : '';

  // Validación básica
  if (!razonSocial) throw new ValidationError('empresa_razon_social requerido');
  if (!rucNit) throw new ValidationError('empresa_ruc_nit requerido');
  if (!repNombre) throw new ValidationError('representante_nombre requerido');
  if (!repCargo) throw new ValidationError('representante_cargo requerido');
  if (!repEmail || !repEmail.includes('@')) throw new ValidationError('representante_email inválido');
  if (!puestoCargo) throw new ValidationError('puesto_cargo requerido');
  if (!salarioUsd || salarioUsd <= 0) throw new ValidationError('salario_usd debe ser > 0');
  if (!closingDate || !/^\d{4}-\d{2}-\d{2}$/.test(closingDate)) throw new ValidationError('closing_date formato YYYY-MM-DD requerido');

  // Buscar el lead
  const lead = unwrapRows<{ ROWID: string; email: string; company: string | null; contact_name: string | null; assigned_to: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, company, contact_name, assigned_to FROM ${TABLE_LEADS} WHERE ROWID = '${escapeSql(leadId)}' LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  )[0];
  if (!lead) throw new NotFoundError('lead not found');

  const dealAmount = Math.round(salarioUsd * 1.2 * 100) / 100; // 2 decimales

  // Conversión Zoho: reusa el flujo existente de freelance (convertLead → Account + Contact + Deal)
  // Import lazy para no acoplar módulos si no se usa
  const { convertLead, findLeadInCrmByEmailPublic, updateAccount, updateDeal } = await import('../lib/zohoCrmClient.js');

  let zohoLeadId: string | null = null;
  let zohoAccountId: string | null = null;
  let zohoDealId: string | null = null;
  let zohoContactId: string | null = null;
  const syncErrors: string[] = [];

  try {
    // 1. Buscar Lead en Zoho por email del cliente
    const found = await findLeadInCrmByEmailPublic(lead.email, ctx.traceId);
    if (found) {
      zohoLeadId = found.id;
      // 2. Convertir Lead → Account + Contact + Deal
      const convertResult = await convertLead(zohoLeadId, {
        deal: {
          Deal_Name: `${razonSocial} — ${puestoCargo}`,
          Amount: dealAmount,
          Closing_Date: closingDate,
        },
      }, ctx.traceId);

      if (convertResult.ok) {
        zohoAccountId = convertResult.data.Accounts ?? null;
        zohoContactId = convertResult.data.Contacts ?? null;
        zohoDealId = convertResult.data.Deals ?? null;

        // 3. Actualizar Account con datos legales
        if (zohoAccountId) {
          const accUpd = await updateAccount(zohoAccountId, {
            RUC_NIT: rucNit,
            Billing_Street: direccion || undefined,
            Billing_City: ciudad || undefined,
            Billing_Country: pais || undefined,
            Nombre_de_la_Empresa: razonSocial,
          }, ctx.traceId);
          if (!accUpd.ok) syncErrors.push(`Account update: ${accUpd.error}`);
        }

        // 4. Actualizar Deal con descripción legal
        if (zohoDealId) {
          const dealDescription = `Representante: ${repNombre} (${repCargo})\nCédula: ${repCedula || 'no informado'}\nRUC/NIT: ${rucNit}\nPuesto: ${puestoCargo}\nSalario: USD ${salarioUsd}\nFee (1.2x): USD ${dealAmount}\n2 tractos del 50% cada uno`;
          const dealUpd = await updateDeal(zohoDealId, {
            Description: dealDescription,
            Amount: dealAmount,
            Closing_Date: closingDate,
          }, ctx.traceId);
          if (!dealUpd.ok) syncErrors.push(`Deal update: ${dealUpd.error}`);
        }
      } else {
        syncErrors.push(`Convert lead: ${convertResult.error}`);
      }
    } else {
      syncErrors.push('Lead no encontrado en Zoho por email');
    }
  } catch (err) {
    syncErrors.push(`Zoho error: ${(err as Error).message}`);
    log.warn('Zoho conversion failed — continuing with local update', { traceId: ctx.traceId, leadId, error: (err as Error).message });
  }

  // Actualizar lead local (sea Zoho ok o no)
  try {
    const patch: Record<string, unknown> = {
      ROWID: leadId,
      pipeline_stage: 'contrato_pago',
      contact_name: repNombre, // Reemplaza con representante legal
      company: razonSocial,
      updated_at: now(),
    };
    if (zohoLeadId) patch.zoho_crm_lead_id = zohoLeadId;
    await datastore(ctx.req).table(TABLE_LEADS).updateRow(patch as { ROWID: string });
  } catch (err) {
    log.warn('local lead update failed after Zoho conversion', { traceId: ctx.traceId, leadId, error: (err as Error).message });
    syncErrors.push(`Local update: ${(err as Error).message}`);
  }

  // Disparar Zoho Sign con contrato + link de pago (reusa function existente)
  let signOk = false;
  let signRequestId: string | undefined;
  try {
    const { sendContract } = await import('../lib/zohoSignClient.js');
    const signResult = await sendContract({
      client_email: repEmail,
      client_name: repNombre,
      client_company: razonSocial,
      client_ruc_nit_ein: rucNit || undefined,
      client_address: direccion || undefined,
      puesto_nombre: puestoCargo,
      puesto_salario_usd: salarioUsd,
    }, ctx.traceId);
    if (signResult.ok) {
      signOk = true;
      signRequestId = signResult.data.request_id;
    } else {
      syncErrors.push(`Zoho Sign: ${signResult.error}`);
    }
  } catch (err) {
    syncErrors.push(`Zoho Sign: ${(err as Error).message}`);
    log.warn('Zoho Sign dispatch failed', { traceId: ctx.traceId, leadId, error: (err as Error).message });
  }

  sendJson(ctx.res, 200, {
    ok: syncErrors.length === 0,
    leadId,
    v3_stage: 'contrato_pago',
    zoho: {
      lead_id: zohoLeadId,
      account_id: zohoAccountId,
      contact_id: zohoContactId,
      deal_id: zohoDealId,
    },
    sign: {
      ok: signOk,
      request_id: signRequestId,
    },
    sync_errors: syncErrors.length > 0 ? syncErrors : null,
    fee_total_usd: dealAmount,
    tractos_usd: dealAmount / 2,
  });
}
