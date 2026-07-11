/**
 * CRM interno para vendedores freelance.
 *
 * Endpoints admin (Cris/RRHH) — gestión de vendedores:
 *   POST   /api/tenant/freelance-users            crear
 *   GET    /api/tenant/freelance-users            listar todos
 *   GET    /api/tenant/freelance-users/:id        detalle + stats
 *   PATCH  /api/tenant/freelance-users/:id        editar/pausar/reactivar
 *   DELETE /api/tenant/freelance-users/:id        soft-delete (activo=false)
 *
 * Endpoints freelance — perfil propio:
 *   GET    /api/freelance/me                     perfil del vendedor logueado
 *   PATCH  /api/freelance/me                     editar phone/notes (no email/nombre)
 *   GET    /api/freelance/me/stats               estadísticas propias
 *
 * Tabla: `FreelanceUsers` (creada en Catalyst 2026-07-09).
 * Aislamiento: por `clerk_user_id` (vendedor solo ve/edita su propio row).
 */

import type { IncomingMessage } from 'http';
import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError, ForbiddenError, UnauthorizedError, AppError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRow, unwrapRows } from '../lib/dbHelpers';
import { requireTenant } from './tenants';
import { createAccount, createContact, createDeal, updateDealStage } from '../lib/zohoCrmClient';

const log = logger('FREELANCE');
const TABLE = 'FreelanceUsers';
const TABLE_LEADS = 'MarketingLeads';
const TABLE_CLIENTS = 'SalesClients';

/**
 * Etapas del embudo del freelance. Las primeras 6 viven solo en SharkTalents
 * (no llegan a Zoho). "cotizacion_contrato" es la puerta a Zoho: al mover un
 * lead a esta etapa se dispara la conversión (crear Account+Contact+Deal).
 * De ahí en adelante las etapas se espejan en Zoho como Deal.Stage.
 */
export const PIPELINE_STAGES = [
  'nuevo',
  'contactado',
  'interesado',
  'reunion_agendada',
  'reunion_hecha',
  'cotizacion_enviada',
  'cotizacion_contrato',  // ← conversión a cliente
  'contrato_enviado',
  'contrato_firmado',
  'cobrado',
  'perdido',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * Mapeo etapa SharkTalents → Zoho Deal.Stage (para las 5 etapas post-conversión).
 * Los nombres del lado derecho son los picklist values reales de la instancia
 * de Cris confirmados 2026-07-10. Kuno tiene un pipeline custom en Deals con
 * fases en español distintas al default de Zoho.
 */
export const ZOHO_STAGE_MAP: Record<string, string> = {
  cotizacion_contrato: 'Cotización',
  contrato_enviado: 'Contrato',
  contrato_firmado: 'En Ejecución Proyecto',
  cobrado: 'Cobrado / Suscripción activa',
  perdido: 'Perdido',
};

type FreelanceUserRow = {
  ROWID: string;
  tenant_id: string;
  clerk_user_id: string;
  nombre: string;
  email: string;
  phone: string;
  activo: boolean;
  leads_asignados: number;
  leads_confirmados: number;
  leads_cerrados: number;
  comision_acumulada_usd: number;
  onboarded_at: string | null;
  notes_internal: string | null;
  CREATEDTIME: string;
  MODIFIEDTIME: string;
};

// ============================================================================
// Helpers
// ============================================================================

function extractIdFromPath(url: string, pattern: RegExp): string | null {
  const m = url.match(pattern);
  return m?.[1] ?? null;
}

async function findByRowId(req: IncomingMessage, rowid: string, tenantId?: string): Promise<FreelanceUserRow | null> {
  if (!/^\d+$/.test(rowid)) return null;
  const tenantClause = tenantId ? ` AND tenant_id = '${escapeSql(tenantId)}'` : '';
  const query = `SELECT * FROM ${TABLE} WHERE ROWID = ${escapeSql(rowid)}${tenantClause} LIMIT 1`;
  const rows = unwrapRows<FreelanceUserRow>(
    (await zcql(req).executeZCQLQuery(query)) as unknown[],
    TABLE,
  );
  return rows[0] ?? null;
}

async function findByClerkUserId(req: IncomingMessage, clerkUserId: string): Promise<FreelanceUserRow | null> {
  const query = `SELECT * FROM ${TABLE} WHERE clerk_user_id = '${escapeSql(clerkUserId)}' LIMIT 1`;
  const rows = unwrapRows<FreelanceUserRow>(
    (await zcql(req).executeZCQLQuery(query)) as unknown[],
    TABLE,
  );
  return rows[0] ?? null;
}

/**
 * Catalyst devuelve booleans de forma inconsistente según cómo se creó la fila
 * (a veces `true`/`false`, a veces string `"true"`/`"false"`, a veces int `1`/`0`).
 * Este helper normaliza a bool con default `true` (defensivo — solo bloqueamos
 * cuando el valor es EXPLÍCITAMENTE falso).
 */
function isTrueish(v: unknown): boolean {
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  if (v === false || v === 0) return false;
  return true; // default permisivo si viene undefined/null
}

function toPublicRow(row: FreelanceUserRow) {
  return {
    id: row.ROWID,
    clerk_user_id: row.clerk_user_id,
    nombre: row.nombre,
    email: row.email,
    phone: row.phone,
    activo: isTrueish(row.activo),
    leads_asignados: Number(row.leads_asignados ?? 0),
    leads_confirmados: Number(row.leads_confirmados ?? 0),
    leads_cerrados: Number(row.leads_cerrados ?? 0),
    comision_acumulada_usd: Number(row.comision_acumulada_usd ?? 0),
    onboarded_at: row.onboarded_at,
    notes_internal: row.notes_internal,
    created_at: row.CREATEDTIME,
    updated_at: row.MODIFIEDTIME,
  };
}

// ============================================================================
// Admin: gestionar vendedores (auth: 'admin' — X-Internal-Key)
// ============================================================================

/**
 * POST /api/tenant/freelance-users
 * Body: { tenant_id, clerk_user_id, nombre, email, phone, notes_internal? }
 *
 * Crea un vendedor. El clerk_user_id debe corresponder a un usuario ya invitado
 * en Clerk con publicMetadata.role='freelance' seteado.
 */
export async function createFreelanceUser(ctx: RequestContext): Promise<void> {
  const tenantId = await requireTenant(ctx);
  const body = await readJsonBody<{
    clerk_user_id?: string;
    nombre?: string;
    email?: string;
    phone?: string;
    notes_internal?: string;
  }>(ctx.req);

  const clerkUserId = (body.clerk_user_id ?? '').trim();
  const nombre = (body.nombre ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const phone = (body.phone ?? '').trim();

  if (!clerkUserId) throw new ValidationError('clerk_user_id required');
  if (!nombre) throw new ValidationError('nombre required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('email invalid');
  if (!phone) throw new ValidationError('phone required');

  // Evitar duplicados por clerk_user_id (la tabla no tiene unique constraint)
  const existing = await findByClerkUserId(ctx.req, clerkUserId);
  if (existing) {
    sendJson(ctx.res, 409, { error: 'Ya existe un FreelanceUser con ese clerk_user_id', existing_id: existing.ROWID });
    return;
  }

  const inserted = await datastore(ctx.req).table(TABLE).insertRow({
    tenant_id: tenantId,
    clerk_user_id: clerkUserId,
    nombre: nombre.slice(0, 255),
    email: email.slice(0, 255),
    phone: phone.slice(0, 20),
    activo: true,
    leads_asignados: 0,
    leads_confirmados: 0,
    leads_cerrados: 0,
    comision_acumulada_usd: 0,
    onboarded_at: now(),
    notes_internal: (body.notes_internal ?? '').slice(0, 10000),
  });
  const row = unwrapRow<FreelanceUserRow>(inserted as unknown, TABLE);
  if (!row) throw new Error('Insert returned null');

  log.info('freelance user created', {
    traceId: ctx.traceId,
    id: row.ROWID,
    clerkUserId,
    email,
  });

  sendJson(ctx.res, 201, toPublicRow(row));
}

/**
 * GET /api/tenant/freelance-users
 * Query params: ?activo=true|false (opcional)
 */
export async function listFreelanceUsers(ctx: RequestContext): Promise<void> {
  const tenantId = await requireTenant(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const activoFilter = url.searchParams.get('activo');

  let query = `SELECT * FROM ${TABLE} WHERE tenant_id = '${escapeSql(tenantId)}'`;
  if (activoFilter === 'true' || activoFilter === 'false') {
    query += ` AND activo = ${activoFilter}`;
  }
  query += ` ORDER BY CREATEDTIME DESC LIMIT 300`;

  const rows = unwrapRows<FreelanceUserRow>(
    (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
    TABLE,
  );
  sendJson(ctx.res, 200, {
    count: rows.length,
    freelance_users: rows.map(toPublicRow),
  });
}

/**
 * GET /api/tenant/freelance-users/:id
 */
export async function getFreelanceUser(ctx: RequestContext): Promise<void> {
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/tenant\/freelance-users\/([^/?]+)/);
  if (!id) throw new ValidationError('id required in path');

  const row = await findByRowId(ctx.req, id, tenantId);
  if (!row) throw new NotFoundError(`FreelanceUser ${id} not found`);
  sendJson(ctx.res, 200, toPublicRow(row));
}

/**
 * PATCH /api/tenant/freelance-users/:id
 * Body: { nombre?, phone?, activo?, notes_internal? }
 * email y clerk_user_id NO son editables por admin (rompen sync con Clerk).
 */
export async function patchFreelanceUser(ctx: RequestContext): Promise<void> {
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/tenant\/freelance-users\/([^/?]+)/);
  if (!id) throw new ValidationError('id required in path');

  const existing = await findByRowId(ctx.req, id, tenantId);
  if (!existing) throw new NotFoundError(`FreelanceUser ${id} not found`);

  const body = await readJsonBody<{
    nombre?: string;
    phone?: string;
    activo?: boolean;
    notes_internal?: string;
  }>(ctx.req);

  const patch: { ROWID: string; nombre?: string; phone?: string; activo?: boolean; notes_internal?: string } = { ROWID: id };
  if (typeof body.nombre === 'string' && body.nombre.trim()) patch.nombre = body.nombre.trim().slice(0, 255);
  if (typeof body.phone === 'string' && body.phone.trim()) patch.phone = body.phone.trim().slice(0, 20);
  if (typeof body.activo === 'boolean') patch.activo = body.activo;
  if (typeof body.notes_internal === 'string') patch.notes_internal = body.notes_internal.slice(0, 10000);

  if (Object.keys(patch).length <= 1) {
    throw new ValidationError('Nada para actualizar');
  }

  const updated = await datastore(ctx.req).table(TABLE).updateRow(patch);
  const row = unwrapRow<FreelanceUserRow>(updated as unknown, TABLE);
  if (!row) throw new Error('Update returned null');

  log.info('freelance user patched', {
    traceId: ctx.traceId,
    id,
    fields: Object.keys(patch).filter((k) => k !== 'ROWID'),
  });

  sendJson(ctx.res, 200, toPublicRow(row));
}

/**
 * DELETE /api/tenant/freelance-users/:id
 * Soft delete — pone activo=false. Preserva historial de leads asignados.
 */
export async function deleteFreelanceUser(ctx: RequestContext): Promise<void> {
  const tenantId = await requireTenant(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/tenant\/freelance-users\/([^/?]+)/);
  if (!id) throw new ValidationError('id required in path');

  const existing = await findByRowId(ctx.req, id, tenantId);
  if (!existing) throw new NotFoundError(`FreelanceUser ${id} not found`);

  await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: id,
    activo: false,
  });

  log.info('freelance user soft-deleted', { traceId: ctx.traceId, id });
  sendJson(ctx.res, 200, { ok: true, id, message: 'FreelanceUser desactivado' });
}

// ============================================================================
// Freelance: perfil propio (auth: 'freelance' — validado por router)
// ============================================================================

/**
 * GET /api/freelance/me
 * Devuelve el perfil del vendedor logueado.
 */
export async function getFreelanceMe(ctx: RequestContext): Promise<void> {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');
  const row = await findByClerkUserId(ctx.req, ctx.user.clerk_user_id);
  if (!row) {
    throw new NotFoundError('FreelanceUser not found. Contactá a tu admin para completar tu setup.');
  }
  if (!isTrueish(row.activo)) {
    throw new ForbiddenError('Tu cuenta de freelance está pausada. Contactá a tu admin.');
  }
  sendJson(ctx.res, 200, toPublicRow(row));
}

/**
 * PATCH /api/freelance/me
 * Body: { phone? }
 * El vendedor solo puede editar su propio phone. Nombre/email se editan por admin.
 */
export async function patchFreelanceMe(ctx: RequestContext): Promise<void> {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');
  const row = await findByClerkUserId(ctx.req, ctx.user.clerk_user_id);
  if (!row) throw new NotFoundError('FreelanceUser not found');
  if (!isTrueish(row.activo)) {
    throw new ForbiddenError('Cuenta pausada');
  }

  const body = await readJsonBody<{ phone?: string }>(ctx.req);
  const phone = (body.phone ?? '').trim();
  if (!phone) throw new ValidationError('phone required');

  const updated = await datastore(ctx.req).table(TABLE).updateRow({
    ROWID: row.ROWID,
    phone: phone.slice(0, 20),
  });
  const updatedRow = unwrapRow<FreelanceUserRow>(updated as unknown, TABLE);
  if (!updatedRow) throw new Error('Update returned null');

  log.info('freelance user updated own phone', {
    traceId: ctx.traceId,
    clerkUserId: ctx.user.clerk_user_id,
  });

  sendJson(ctx.res, 200, toPublicRow(updatedRow));
}

// ============================================================================
// Auto-asignación de leads a freelances (round-robin básico)
// ============================================================================

/**
 * Auto-asigna un lead recién capturado al freelance activo con menos leads
 * asignados. Round-robin básico: en Fase 3 se refina con notificación por
 * WhatsApp + rotación por tenant + cooldown.
 *
 * Se llama desde captureLead cuando isNewLead=true. Best-effort: si no hay
 * freelances activos, el lead queda sin asignar (pipeline_stage='nuevo_lead')
 * y sale más tarde en un batch cron cuando haya vendedores disponibles.
 *
 * @returns freelance_user_id ROWID asignado, o null si no hubo asignación.
 */
export async function autoAssignLead(req: IncomingMessage, leadId: string): Promise<string | null> {
  try {
    const query = `SELECT ROWID, nombre, leads_asignados FROM ${TABLE} WHERE activo = true ORDER BY leads_asignados ASC, CREATEDTIME ASC LIMIT 1`;
    const rows = unwrapRows<{ ROWID: string; nombre: string; leads_asignados: number }>(
      (await zcql(req).executeZCQLQuery(query)) as unknown[],
      TABLE,
    );
    const freelance = rows[0];
    if (!freelance) {
      log.info('autoAssignLead: no active freelances — lead stays unassigned', { leadId });
      return null;
    }

    await datastore(req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      assigned_to: freelance.ROWID,
      assigned_at: now(),
      pipeline_stage: 'nuevo',
    });

    await datastore(req).table(TABLE).updateRow({
      ROWID: freelance.ROWID,
      leads_asignados: Number(freelance.leads_asignados ?? 0) + 1,
    });

    log.info('lead auto-assigned to freelance', {
      leadId,
      freelanceId: freelance.ROWID,
      freelanceName: freelance.nombre,
    });
    return freelance.ROWID;
  } catch (err) {
    log.warn('autoAssignLead failed', { leadId, error: (err as Error).message });
    return null;
  }
}

// ============================================================================
// Freelance: leads asignados + pipeline
// ============================================================================

type MarketingLeadRow = {
  ROWID: string;
  email: string;
  contact_name: string | null;
  company: string | null;
  whatsapp: string | null;
  score_quality: number | null;
  urgency: string | null;
  salary_target: string | null;
  source: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  status: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  pipeline_stage: string | null;
  demo_scheduled_at: string | null;
  demo_completed_at: string | null;
  CREATEDTIME: string;
  MODIFIEDTIME: string;
};

/**
 * Normaliza pipeline_stage al vocabulario del CRM freelance.
 * El default de MarketingLeads en Catalyst Console es "nuevo_lead" y algunos
 * leads viejos vienen con valores nulos o distintos — todos se mapean a "nuevo".
 */
function normalizeStage(raw: string | null | undefined): PipelineStage {
  if (!raw || raw === 'nuevo_lead' || raw === 'new') return 'nuevo';
  if ((PIPELINE_STAGES as readonly string[]).includes(raw)) return raw as PipelineStage;
  return 'nuevo';
}

function toPublicLead(row: MarketingLeadRow) {
  return {
    id: row.ROWID,
    email: row.email,
    contact_name: row.contact_name,
    company: row.company,
    whatsapp: row.whatsapp,
    score_quality: row.score_quality,
    urgency: row.urgency,
    salary_target: row.salary_target,
    source: row.source,
    utm_source: row.utm_source,
    utm_campaign: row.utm_campaign,
    status: row.status,
    pipeline_stage: normalizeStage(row.pipeline_stage),
    assigned_at: row.assigned_at,
    demo_scheduled_at: row.demo_scheduled_at,
    demo_completed_at: row.demo_completed_at,
    created_at: row.CREATEDTIME,
    updated_at: row.MODIFIEDTIME,
  };
}

async function getMyFreelanceRow(ctx: RequestContext): Promise<FreelanceUserRow> {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');
  const row = await findByClerkUserId(ctx.req, ctx.user.clerk_user_id);
  if (!row) throw new NotFoundError('FreelanceUser not found');
  if (!isTrueish(row.activo)) throw new ForbiddenError('Cuenta pausada');
  return row;
}

/**
 * GET /api/freelance/me/leads
 * Lista los leads asignados al freelance logueado (etapas 1-6, pre-conversión).
 * Los que ya se convirtieron viven en SalesClients y salen de `/me/clients`.
 */
export async function listMyLeads(ctx: RequestContext): Promise<void> {
  const me = await getMyFreelanceRow(ctx);
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const stageFilter = url.searchParams.get('stage');

  let query = `SELECT ROWID, email, contact_name, company, whatsapp, score_quality, urgency,
    salary_target, source, utm_source, utm_campaign, status, assigned_to, assigned_at,
    pipeline_stage, demo_scheduled_at, demo_completed_at
    FROM ${TABLE_LEADS}
    WHERE assigned_to = '${escapeSql(me.ROWID)}'`;
  if (stageFilter && (PIPELINE_STAGES as readonly string[]).includes(stageFilter)) {
    // Cuando filtramos por "nuevo" también incluimos los defaults viejos (nuevo_lead, new, null).
    if (stageFilter === 'nuevo') {
      query += ` AND (pipeline_stage = 'nuevo' OR pipeline_stage = 'nuevo_lead' OR pipeline_stage = 'new' OR pipeline_stage IS NULL)`;
    } else {
      query += ` AND pipeline_stage = '${escapeSql(stageFilter)}'`;
    }
  }
  query += ` ORDER BY MODIFIEDTIME DESC LIMIT 300`;

  let rows: MarketingLeadRow[] = [];
  try {
    rows = unwrapRows<MarketingLeadRow>(
      (await zcql(ctx.req).executeZCQLQuery(query)) as unknown[],
      TABLE_LEADS,
    );
  } catch (err) {
    // Graceful si MarketingLeads no tiene las columnas nuevas todavía
    log.warn('listMyLeads query failed — likely missing columns', {
      traceId: ctx.traceId,
      error: (err as Error).message,
    });
    sendJson(ctx.res, 200, { count: 0, leads: [], warning: 'MarketingLeads schema outdated' });
    return;
  }

  sendJson(ctx.res, 200, {
    count: rows.length,
    leads: rows.map(toPublicLead),
  });
}

/**
 * PATCH /api/freelance/me/leads/:id
 * Body: { pipeline_stage?, demo_scheduled_at?, demo_completed_at? }
 *
 * El freelance solo puede editar leads que le están asignados a él.
 * Cambiar pipeline_stage a "cotizacion_contrato" NO se hace acá — dispara la
 * conversión (POST /leads/:id/convert), que crea el registro SalesClients.
 */
export async function patchMyLead(ctx: RequestContext): Promise<void> {
  const me = await getMyFreelanceRow(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/freelance\/me\/leads\/([^/?]+)/);
  if (!id) throw new ValidationError('id required in path');

  const existingRows = unwrapRows<MarketingLeadRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, assigned_to, pipeline_stage FROM ${TABLE_LEADS} WHERE ROWID = ${escapeSql(id)} LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  );
  const existing = existingRows[0];
  if (!existing) throw new NotFoundError(`Lead ${id} not found`);
  if (existing.assigned_to !== me.ROWID) {
    throw new ForbiddenError('Ese lead no te está asignado');
  }

  const body = await readJsonBody<{
    pipeline_stage?: string;
    demo_scheduled_at?: string;
    demo_completed_at?: string;
    contact_name?: string;
    company?: string;
    whatsapp?: string;
    dolor?: string;
    puesto?: string;
  }>(ctx.req);

  const patch: {
    ROWID: string;
    pipeline_stage?: string;
    demo_scheduled_at?: string;
    demo_completed_at?: string;
    contact_name?: string;
    company?: string;
    whatsapp?: string;
    dolor?: string;
    puesto?: string;
  } = { ROWID: id };

  if (typeof body.pipeline_stage === 'string') {
    if (!(PIPELINE_STAGES as readonly string[]).includes(body.pipeline_stage)) {
      throw new ValidationError(`pipeline_stage inválido. Valores: ${PIPELINE_STAGES.join(', ')}`);
    }
    // Convertir a cliente pasa por endpoint separado (crea SalesClients + Zoho)
    if (body.pipeline_stage === 'cotizacion_contrato' || body.pipeline_stage === 'contrato_enviado' || body.pipeline_stage === 'contrato_firmado' || body.pipeline_stage === 'cobrado') {
      throw new ValidationError('Para pasar a esta etapa usá POST /leads/:id/convert primero');
    }
    patch.pipeline_stage = body.pipeline_stage;
  }
  if (typeof body.demo_scheduled_at === 'string') patch.demo_scheduled_at = body.demo_scheduled_at;
  if (typeof body.demo_completed_at === 'string') patch.demo_completed_at = body.demo_completed_at;

  // Campos editables por el freelance (info que Meta no trae o que el vendedor descubre al llamar)
  if (typeof body.contact_name === 'string') patch.contact_name = body.contact_name.trim().slice(0, 255);
  if (typeof body.company === 'string') patch.company = body.company.trim().slice(0, 255);
  if (typeof body.whatsapp === 'string') patch.whatsapp = body.whatsapp.trim().slice(0, 50);
  if (typeof body.dolor === 'string') patch.dolor = body.dolor.trim().slice(0, 500);
  if (typeof body.puesto === 'string') patch.puesto = body.puesto.trim().slice(0, 255);

  if (Object.keys(patch).length <= 1) throw new ValidationError('Nada para actualizar');

  await datastore(ctx.req).table(TABLE_LEADS).updateRow(patch);
  log.info('freelance patched own lead', { traceId: ctx.traceId, leadId: id, freelanceId: me.ROWID, fields: Object.keys(patch).filter((k) => k !== 'ROWID') });

  sendJson(ctx.res, 200, { ok: true, id, patched: Object.keys(patch).filter((k) => k !== 'ROWID') });
}

/**
 * POST /api/freelance/me/leads/:id/send-eval
 *
 * Dispara el email de evaluación (conductual + integridad) al lead. Reusa el
 * Result placeholder ya creado por captureLead. El vendedor decide cuándo
 * enviarlo — típicamente después de la primera llamada o cuando el lead está
 * en etapa "Interesado".
 *
 * Devuelve las URLs firmadas también en la response por si el vendedor quiere
 * pasarlas por WhatsApp además del email.
 */
export async function sendEvalToLead(ctx: RequestContext): Promise<void> {
  const me = await getMyFreelanceRow(ctx);
  const leadId = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/freelance\/me\/leads\/([^/?]+)\/send-eval/);
  if (!leadId) throw new ValidationError('lead_id required in path');

  const leadRows = unwrapRows<{ ROWID: string; email: string; contact_name: string | null; assigned_to: string | null; eval_result_id: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, contact_name, assigned_to, eval_result_id FROM ${TABLE_LEADS} WHERE ROWID = ${escapeSql(leadId)} LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  );
  const lead = leadRows[0];
  if (!lead) throw new NotFoundError(`Lead ${leadId} not found`);
  if (lead.assigned_to !== me.ROWID) throw new ForbiddenError('Ese lead no te está asignado');
  if (!lead.eval_result_id) {
    throw new AppError(400, 'no_result', 'Este lead no tiene evaluación creada. Contactá al admin.');
  }

  const { signToken, expiresIn, DAY_SEC } = await import('../lib/urlSigning.js');
  const exp30d = expiresIn(30 * DAY_SEC);
  const conductualToken = signToken({ kind: 'demo_conductual', ref: lead.eval_result_id, exp: exp30d });
  const integridadToken = signToken({ kind: 'demo_integridad', ref: lead.eval_result_id, exp: exp30d });
  const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
  const conductualUrl = `${baseUrl}/app/index.html#/demo-test/conductual/${conductualToken}`;
  const integridadUrl = `${baseUrl}/app/index.html#/demo-test/integridad/${integridadToken}`;

  const { publishAndProcessEvent } = await import('./outbox.js');
  const emailResult = await publishAndProcessEvent(ctx.req, 'email.send_pending', {
    to: lead.email,
    template: 'marketing_lead_thanks',
    locale: 'es',
    vars: {
      contact_name_prefix: lead.contact_name ? ` ${lead.contact_name.split(/\s+/)[0]}` : '',
      conductual_url: conductualUrl,
      integridad_url: integridadUrl,
    },
  });

  log.info('freelance sent eval email to lead', {
    traceId: ctx.traceId,
    leadId,
    freelanceId: me.ROWID,
    emailOk: emailResult.ok,
  });

  sendJson(ctx.res, 200, {
    ok: emailResult.ok,
    error: emailResult.error,
    conductual_url: conductualUrl,
    integridad_url: integridadUrl,
    message: emailResult.ok ? 'Email de evaluación enviado' : `Email falló: ${emailResult.error}`,
  });
}

/**
 * POST /api/freelance/me/leads/:id/send-quote
 * Body: { salario_mensual_usd, mensaje_extra? }
 *
 * Genera y envía por email un presupuesto simple con 1 item: reclutamiento del
 * cargo por 1.2 × salario. NO se sincroniza a Zoho — es solo un email al lead.
 * Al enviar, mueve el lead a pipeline_stage='cotizacion_enviada' + guarda el
 * precio en salary_target para pre-llenar el modal de conversión más tarde.
 */
export async function sendQuoteToLead(ctx: RequestContext): Promise<void> {
  const me = await getMyFreelanceRow(ctx);
  const leadId = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/freelance\/me\/leads\/([^/?]+)\/send-quote/);
  if (!leadId) throw new ValidationError('lead_id required in path');

  const leadRows = unwrapRows<{ ROWID: string; email: string; contact_name: string | null; company: string | null; puesto: string | null; assigned_to: string | null }>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email, contact_name, company, puesto, assigned_to FROM ${TABLE_LEADS} WHERE ROWID = ${escapeSql(leadId)} LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  );
  const lead = leadRows[0];
  if (!lead) throw new NotFoundError(`Lead ${leadId} not found`);
  if (lead.assigned_to !== me.ROWID) throw new ForbiddenError('Ese lead no te está asignado');

  const body = await readJsonBody<{ salario_mensual_usd?: number; mensaje_extra?: string }>(ctx.req);
  const salario = Number(body.salario_mensual_usd);
  if (!Number.isFinite(salario) || salario <= 0) {
    throw new ValidationError('salario_mensual_usd must be positive number');
  }
  const feeSharktalents = Math.round(salario * 1.2 * 100) / 100;
  const mensajeExtra = (body.mensaje_extra ?? '').trim().slice(0, 1000);

  const nombreCliente = lead.contact_name?.trim() || lead.email.split('@')[0];
  const empresa = lead.company?.trim() || '—';
  const puesto = lead.puesto?.trim() || 'Reclutamiento del cargo';
  const vendedorNombre = me.nombre;

  const htmlBody = renderQuoteHtml({ nombreCliente, empresa, puesto, salario, feeSharktalents, vendedorNombre, mensajeExtra });
  const subject = `Cotización SharkTalents — ${puesto}`;

  const { sendZeptoMail } = await import('../lib/zeptomailClient.js');
  const zeptoResult = await sendZeptoMail({
    to: { email: lead.email, name: nombreCliente },
    subject,
    htmlBody,
    replyTo: { email: 'cpalma@kunodigital.com', name: 'Chris Palma' },
    traceId: ctx.traceId,
  });
  const emailResult = { ok: zeptoResult.ok, error: zeptoResult.ok ? undefined : zeptoResult.error };

  // Actualizar el lead: pasa a 'cotizacion_enviada' + guarda el precio acordado en salary_target
  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      pipeline_stage: 'cotizacion_enviada',
      salary_target: String(salario),
    });
  } catch (err) {
    log.warn('lead update after send-quote failed', { traceId: ctx.traceId, leadId, error: (err as Error).message });
  }

  log.info('quote sent to lead', {
    traceId: ctx.traceId,
    leadId,
    freelanceId: me.ROWID,
    salario,
    feeSharktalents,
    emailOk: emailResult.ok,
  });

  sendJson(ctx.res, 200, {
    ok: emailResult.ok,
    error: emailResult.error,
    salario_mensual_usd: salario,
    fee_sharktalents_usd: feeSharktalents,
    message: emailResult.ok ? 'Cotización enviada por email' : `Email falló: ${emailResult.error}`,
  });
}

function renderQuoteHtml(input: {
  nombreCliente: string;
  empresa: string;
  puesto: string;
  salario: number;
  feeSharktalents: number;
  vendedorNombre: string;
  mensajeExtra: string;
}): string {
  const { nombreCliente, empresa, puesto, salario, feeSharktalents, vendedorNombre, mensajeExtra } = input;
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Cotización SharkTalents</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <div style="background:#111827;color:#dafd6f;padding:20px 28px;">
        <div style="font-size:20px;font-weight:700;letter-spacing:1px;">SharkTalents</div>
        <div style="font-size:13px;opacity:0.8;margin-top:4px;">Cotización de reclutamiento</div>
      </div>
      <div style="padding:24px 28px;">
        <p style="margin:0 0 8px 0;font-size:15px;">Hola ${escapeHtml(nombreCliente)},</p>
        <p style="margin:0 0 20px 0;font-size:14px;line-height:1.5;color:#4b5563;">
          Como conversamos, te comparto la cotización para el proceso de reclutamiento del cargo solicitado.
        </p>
        ${mensajeExtra ? `<p style="margin:0 0 16px 0;padding:12px;background:#f9fafb;border-left:3px solid #dafd6f;font-size:13px;line-height:1.5;color:#4b5563;">${escapeHtml(mensajeExtra)}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 0;font-size:12px;color:#6b7280;">Empresa:</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(empresa)}</td></tr>
          <tr><td style="padding:6px 0;font-size:12px;color:#6b7280;">Cargo a reclutar:</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(puesto)}</td></tr>
          <tr><td style="padding:6px 0;font-size:12px;color:#6b7280;">Salario mensual del puesto:</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;">$${fmt(salario)}</td></tr>
        </table>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:2px solid #111827;border-bottom:1px solid #e5e7eb;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:12px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Concepto</th>
              <th style="padding:12px 8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Precio (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:14px 8px;font-size:13px;">
                <div style="font-weight:600;">Reclutamiento cargo: ${escapeHtml(puesto)}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:4px;">Proceso completo: filtro, evaluación DISC + integridad + técnica, entrevistas, shortlist final.</div>
              </td>
              <td style="padding:14px 8px;font-size:14px;text-align:right;font-weight:700;">$${fmt(feeSharktalents)}</td>
            </tr>
          </tbody>
        </table>
        <table style="width:100%;border-collapse:collapse;margin:8px 0 24px 0;">
          <tr>
            <td style="padding:12px 8px;font-size:14px;font-weight:700;color:#111827;">TOTAL</td>
            <td style="padding:12px 8px;font-size:18px;font-weight:700;color:#111827;text-align:right;">$${fmt(feeSharktalents)}</td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:12px;color:#6b7280;line-height:1.5;">
          <strong>Vigencia:</strong> 30 días desde la fecha de envío.<br>
          <strong>Forma de pago:</strong> 50% al firmar contrato, 50% al entregar shortlist final.<br>
          <strong>Garantía:</strong> Reemplazo del candidato sin costo dentro de los primeros 60 días.
        </p>
        <p style="margin:24px 0 0 0;font-size:13px;">Cualquier consulta, escribime directamente.</p>
        <p style="margin:8px 0 0 0;font-size:13px;">
          Saludos,<br>
          <strong>${escapeHtml(vendedorNombre)}</strong><br>
          <span style="color:#6b7280;">SharkTalents</span>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================================
// Freelance: convertir a cliente (crea Account+Contact+Deal en Zoho)
// ============================================================================

/**
 * POST /api/freelance/me/leads/:id/convert
 * Body: {
 *   empresa_nombre, contacto_nombre, contacto_email, contacto_phone?,
 *   salario_mensual_usd, closing_date_est?, notes?
 * }
 *
 * Flujo:
 *   1. Valida input + verifica lead asignado a este freelance.
 *   2. Calcula monto_deal = salario * 1.2, comision = salario * 0.10.
 *   3. Inserta row en SalesClients (con zoho_sync_status='pending').
 *   4. Llama Zoho CRM: createAccount → createContact → createDeal.
 *   5. Actualiza SalesClients con los 3 IDs de Zoho + sync_status='ok'.
 *   6. Actualiza el lead: pipeline_stage='cotizacion_contrato'.
 *   7. Incrementa leads_confirmados del freelance.
 *
 * Si Zoho falla en cualquier paso, se guarda el error en zoho_sync_error y el
 * cliente queda con sync_status='failed'. El freelance puede reintentar la
 * sincronización desde la UI (endpoint separado, futuro).
 */
export async function convertLeadToClient(ctx: RequestContext): Promise<void> {
  const me = await getMyFreelanceRow(ctx);
  const tenantId = await requireTenant(ctx);
  const leadId = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/freelance\/me\/leads\/([^/?]+)\/convert/);
  if (!leadId) throw new ValidationError('lead_id required in path');

  // Verificar lead
  const leadRows = unwrapRows<MarketingLeadRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, assigned_to, pipeline_stage, email, contact_name, company FROM ${TABLE_LEADS} WHERE ROWID = ${escapeSql(leadId)} LIMIT 1`,
    )) as unknown[],
    TABLE_LEADS,
  );
  const lead = leadRows[0];
  if (!lead) throw new NotFoundError(`Lead ${leadId} not found`);
  if (lead.assigned_to !== me.ROWID) throw new ForbiddenError('Ese lead no te está asignado');

  const body = await readJsonBody<{
    empresa_nombre?: string;
    contacto_nombre?: string;
    contacto_email?: string;
    contacto_phone?: string;
    salario_mensual_usd?: number;
    closing_date_est?: string;
    notes?: string;
  }>(ctx.req);

  const empresa = (body.empresa_nombre ?? '').trim();
  const contactoNombre = (body.contacto_nombre ?? '').trim();
  const contactoEmail = (body.contacto_email ?? '').trim().toLowerCase();
  const contactoPhone = (body.contacto_phone ?? '').trim();
  const salario = Number(body.salario_mensual_usd);
  const notes = (body.notes ?? '').trim();

  if (!empresa) throw new ValidationError('empresa_nombre required');
  if (!contactoNombre) throw new ValidationError('contacto_nombre required');
  if (!contactoEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactoEmail)) throw new ValidationError('contacto_email invalid');
  if (!contactoPhone) throw new ValidationError('contacto_phone required (obligatorio para follow-up)');
  if (!Number.isFinite(salario) || salario <= 0) throw new ValidationError('salario_mensual_usd must be positive number');

  const montoDeal = Math.round(salario * 1.2 * 100) / 100;
  const comisionFreelance = Math.round(salario * 0.10 * 100) / 100;

  const closingDate = body.closing_date_est ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 1) Insertar SalesClients (pending)
  const inserted = await datastore(ctx.req).table(TABLE_CLIENTS).insertRow({
    tenant_id: tenantId,
    lead_id: leadId,
    freelance_user_id: me.ROWID,
    empresa_nombre: empresa.slice(0, 255),
    contacto_nombre: contactoNombre.slice(0, 255),
    contacto_email: contactoEmail.slice(0, 255),
    contacto_phone: contactoPhone.slice(0, 20),
    salario_mensual_usd: salario,
    monto_deal_usd: montoDeal,
    comision_freelance_usd: comisionFreelance,
    closing_date_est: closingDate,
    pipeline_stage: 'cotizacion_contrato',
    zoho_sync_status: 'pending',
    notes: notes.slice(0, 10000),
  });
  const client = unwrapRow<{ ROWID: string }>(inserted as unknown, TABLE_CLIENTS);
  if (!client) throw new AppError(500, 'insert_failed', 'SalesClients insert returned null');

  // 2) Sync a Zoho — create Account → Contact → Deal
  const zohoResult = await syncClientToZoho({
    salesClientRowId: client.ROWID,
    empresa,
    contactoNombre,
    contactoEmail,
    contactoPhone,
    montoDeal,
    closingDate,
    freelanceNombre: me.nombre,
    ctx,
  });

  // 3) Actualizar lead → pipeline_stage='cotizacion_contrato'
  try {
    await datastore(ctx.req).table(TABLE_LEADS).updateRow({
      ROWID: leadId,
      pipeline_stage: 'cotizacion_contrato',
    });
  } catch (err) {
    log.warn('lead pipeline_stage update failed', { traceId: ctx.traceId, leadId, error: (err as Error).message });
  }

  // 4) Incrementar contador freelance
  try {
    await datastore(ctx.req).table(TABLE).updateRow({
      ROWID: me.ROWID,
      leads_confirmados: Number(me.leads_confirmados ?? 0) + 1,
    });
  } catch (err) {
    log.warn('freelance counter update failed', { traceId: ctx.traceId, error: (err as Error).message });
  }

  log.info('lead converted to client', {
    traceId: ctx.traceId,
    leadId,
    salesClientId: client.ROWID,
    freelanceId: me.ROWID,
    montoDeal,
    zohoOk: zohoResult.ok,
  });

  sendJson(ctx.res, 201, {
    id: client.ROWID,
    lead_id: leadId,
    empresa_nombre: empresa,
    monto_deal_usd: montoDeal,
    comision_freelance_usd: comisionFreelance,
    pipeline_stage: 'cotizacion_contrato',
    zoho_sync_status: zohoResult.ok ? 'ok' : 'failed',
    zoho_sync_error: zohoResult.ok ? null : zohoResult.error,
    zoho_deal_id: zohoResult.ok ? zohoResult.dealId : null,
  });
}

/**
 * Ejecuta las 3 llamadas a Zoho: createAccount, createContact, createDeal.
 * Actualiza el row SalesClients con los IDs (si todo OK) o con el error.
 * Owner en Zoho no se setea acá — usa el default del refresh_token (Chris Palma).
 */
async function syncClientToZoho(input: {
  salesClientRowId: string;
  empresa: string;
  contactoNombre: string;
  contactoEmail: string;
  contactoPhone: string;
  montoDeal: number;
  closingDate: string;
  freelanceNombre: string;
  ctx: RequestContext;
}): Promise<{ ok: true; accountId: string; contactId: string; dealId: string } | { ok: false; error: string }> {
  const { salesClientRowId, empresa, contactoNombre, contactoEmail, contactoPhone, montoDeal, closingDate, freelanceNombre, ctx } = input;
  const traceId = ctx.traceId;

  // Owner ID de Chris Palma en Zoho CRM. Lee env var OWNER_ID (seteado en
  // Catalyst Console), con fallback hardcoded al ID real. El hardcoded no es
  // info sensible — es un ID interno de Zoho, no credencial.
  const ownerId = process.env.OWNER_ID || process.env.ZOHO_CRM_DEFAULT_OWNER_ID || '5710516000002213001';

  const acc = await createAccount({
    account_name: empresa,
    phone: contactoPhone || undefined,
    owner_id: ownerId,
  }, traceId);
  if (!acc.ok) {
    await markZohoFailed(ctx, salesClientRowId, `account: ${acc.error}`);
    return { ok: false, error: `Account create: ${acc.error}` };
  }

  const nameParts = contactoNombre.split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ') || firstName;

  const con = await createContact({
    first_name: firstName,
    last_name: lastName,
    email: contactoEmail,
    mobile: contactoPhone || undefined,
    account_id: acc.data.id,
    owner_id: ownerId,
  }, traceId);
  if (!con.ok) {
    await markZohoFailed(ctx, salesClientRowId, `contact: ${con.error}`);
    return { ok: false, error: `Contact create: ${con.error}` };
  }

  const dealName = `SharkTalents — ${empresa}`.slice(0, 100);
  const deal = await createDeal({
    deal_name: dealName,
    amount: montoDeal,
    stage: 'Cotización',
    closing_date: closingDate,
    account_id: acc.data.id,
    contact_id: con.data.id,
    owner_id: ownerId,
    lead_source: 'Partner',
    posibles_productos: ['Recursos Humanos'],
    description: `Vendedor responsable: ${freelanceNombre}. Comisión: 10% del salario.`,
  }, traceId);
  if (!deal.ok) {
    await markZohoFailed(ctx, salesClientRowId, `deal: ${deal.error}`);
    return { ok: false, error: `Deal create: ${deal.error}` };
  }

  await datastore(ctx.req).table(TABLE_CLIENTS).updateRow({
    ROWID: salesClientRowId,
    zoho_account_id: acc.data.id,
    zoho_contact_id: con.data.id,
    zoho_deal_id: deal.data.id,
    zoho_sync_status: 'ok',
    zoho_synced_at: now(),
    zoho_sync_error: null,
  });

  return { ok: true, accountId: acc.data.id, contactId: con.data.id, dealId: deal.data.id };
}

async function markZohoFailed(ctx: RequestContext, salesClientRowId: string, errorMsg: string): Promise<void> {
  try {
    await datastore(ctx.req).table(TABLE_CLIENTS).updateRow({
      ROWID: salesClientRowId,
      zoho_sync_status: 'failed',
      zoho_sync_error: errorMsg.slice(0, 5000),
    });
  } catch (err) {
    log.warn('markZohoFailed failed to persist', { traceId: ctx.traceId, error: (err as Error).message });
  }
}

// ============================================================================
// Freelance: SalesClients (post-conversión)
// ============================================================================

type SalesClientRow = {
  ROWID: string;
  tenant_id: string;
  lead_id: string;
  freelance_user_id: string;
  empresa_nombre: string;
  contacto_nombre: string;
  contacto_email: string;
  contacto_phone: string | null;
  salario_mensual_usd: number;
  monto_deal_usd: number;
  comision_freelance_usd: number;
  closing_date_est: string | null;
  pipeline_stage: string;
  zoho_account_id: string | null;
  zoho_contact_id: string | null;
  zoho_deal_id: string | null;
  zoho_sync_status: string | null;
  zoho_synced_at: string | null;
  zoho_sync_error: string | null;
  notes: string | null;
  CREATEDTIME: string;
  MODIFIEDTIME: string;
};

function toPublicClient(row: SalesClientRow) {
  return {
    id: row.ROWID,
    lead_id: row.lead_id,
    empresa_nombre: row.empresa_nombre,
    contacto_nombre: row.contacto_nombre,
    contacto_email: row.contacto_email,
    contacto_phone: row.contacto_phone,
    salario_mensual_usd: Number(row.salario_mensual_usd ?? 0),
    monto_deal_usd: Number(row.monto_deal_usd ?? 0),
    comision_freelance_usd: Number(row.comision_freelance_usd ?? 0),
    closing_date_est: row.closing_date_est,
    pipeline_stage: row.pipeline_stage as PipelineStage,
    zoho_deal_id: row.zoho_deal_id,
    zoho_sync_status: row.zoho_sync_status,
    zoho_sync_error: row.zoho_sync_error,
    notes: row.notes,
    created_at: row.CREATEDTIME,
    updated_at: row.MODIFIEDTIME,
  };
}

/**
 * GET /api/freelance/me/clients
 * Lista los clientes convertidos por este freelance (post-conversión: etapas 7-11).
 */
export async function listMyClients(ctx: RequestContext): Promise<void> {
  const me = await getMyFreelanceRow(ctx);
  const query = `SELECT * FROM ${TABLE_CLIENTS} WHERE freelance_user_id = '${escapeSql(me.ROWID)}' ORDER BY MODIFIEDTIME DESC LIMIT 300`;
  let rows: SalesClientRow[] = [];
  try {
    rows = unwrapRows<SalesClientRow>((await zcql(ctx.req).executeZCQLQuery(query)) as unknown[], TABLE_CLIENTS);
  } catch (err) {
    log.warn('listMyClients query failed — SalesClients table may not exist yet', { traceId: ctx.traceId, error: (err as Error).message });
    sendJson(ctx.res, 200, { count: 0, clients: [], warning: 'SalesClients table not ready' });
    return;
  }
  sendJson(ctx.res, 200, { count: rows.length, clients: rows.map(toPublicClient) });
}

/**
 * PATCH /api/freelance/me/clients/:id/stage
 * Body: { pipeline_stage }
 *
 * Cambia la etapa del cliente post-conversión. Espeja el cambio en Zoho
 * (Deal.Stage). Si Zoho falla, actualiza igual localmente y marca sync_error.
 */
export async function patchMyClientStage(ctx: RequestContext): Promise<void> {
  const me = await getMyFreelanceRow(ctx);
  const id = extractIdFromPath(ctx.req.url ?? '/', /^\/api\/freelance\/me\/clients\/([^/?]+)\/stage/);
  if (!id) throw new ValidationError('id required in path');

  const rows = unwrapRows<SalesClientRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, freelance_user_id, zoho_deal_id FROM ${TABLE_CLIENTS} WHERE ROWID = ${escapeSql(id)} LIMIT 1`,
    )) as unknown[],
    TABLE_CLIENTS,
  );
  const existing = rows[0];
  if (!existing) throw new NotFoundError(`SalesClient ${id} not found`);
  if (existing.freelance_user_id !== me.ROWID) throw new ForbiddenError('Ese cliente no te corresponde');

  const body = await readJsonBody<{ pipeline_stage?: string }>(ctx.req);
  const newStage = (body.pipeline_stage ?? '').trim();
  if (!(PIPELINE_STAGES as readonly string[]).includes(newStage)) {
    throw new ValidationError(`pipeline_stage inválido: ${newStage}`);
  }

  await datastore(ctx.req).table(TABLE_CLIENTS).updateRow({
    ROWID: id,
    pipeline_stage: newStage,
  });

  // Espejar en Zoho si tenemos deal_id + mapeo
  const zohoStage = ZOHO_STAGE_MAP[newStage];
  let zohoOk = true;
  let zohoError: string | null = null;
  if (existing.zoho_deal_id && zohoStage) {
    const res = await updateDealStage(existing.zoho_deal_id, zohoStage, ctx.traceId);
    if (!res.ok) {
      zohoOk = false;
      zohoError = res.error;
      try {
        await datastore(ctx.req).table(TABLE_CLIENTS).updateRow({
          ROWID: id,
          zoho_sync_error: `stage update: ${res.error}`.slice(0, 5000),
        });
      } catch { /* best effort */ }
    }
  }

  // Si llegó a 'contrato_firmado' incrementar leads_cerrados del freelance
  if (newStage === 'contrato_firmado') {
    try {
      const meCurrent = await getMyFreelanceRow(ctx);
      await datastore(ctx.req).table(TABLE).updateRow({
        ROWID: meCurrent.ROWID,
        leads_cerrados: Number(meCurrent.leads_cerrados ?? 0) + 1,
      });
    } catch { /* best effort */ }
  }

  log.info('client stage patched', { traceId: ctx.traceId, clientId: id, newStage, zohoOk });
  sendJson(ctx.res, 200, {
    ok: true,
    id,
    pipeline_stage: newStage,
    zoho_sync_status: zohoOk ? 'ok' : 'failed',
    zoho_sync_error: zohoError,
  });
}

// ============================================================================
// Perfil freelance (existente)
// ============================================================================

/**
 * GET /api/freelance/me/stats
 * Placeholder — Fase 5 lo expande con métricas reales (leads del mes, tasa
 * de conversión, etc.). Por ahora devuelve los contadores del row.
 */
export async function getFreelanceMeStats(ctx: RequestContext): Promise<void> {
  if (!ctx.user) throw new UnauthorizedError('Authentication required');
  const row = await findByClerkUserId(ctx.req, ctx.user.clerk_user_id);
  if (!row) throw new NotFoundError('FreelanceUser not found');

  sendJson(ctx.res, 200, {
    leads_asignados: Number(row.leads_asignados ?? 0),
    leads_confirmados: Number(row.leads_confirmados ?? 0),
    leads_cerrados: Number(row.leads_cerrados ?? 0),
    comision_acumulada_usd: Number(row.comision_acumulada_usd ?? 0),
    tasa_confirmacion_pct: row.leads_asignados
      ? Math.round((Number(row.leads_confirmados) / Number(row.leads_asignados)) * 100)
      : 0,
    tasa_cierre_pct: row.leads_confirmados
      ? Math.round((Number(row.leads_cerrados) / Number(row.leads_confirmados)) * 100)
      : 0,
  });
}
