/**
 * Webhook entrante de Zoho CRM — recibe leads que entran al CRM desde fuentes
 * externas (Meta Ads, manual del equipo Kuno, etc).
 *
 * Cuando se crea un Lead en CRM con cierto Lead_Source (configurable via
 * `CRM_META_LEAD_SOURCE`), Chris configura un workflow rule que dispara un POST
 * acá. SharkTalents:
 *   1. Crea/actualiza MarketingLead en su tabla
 *   2. Dispara email "Bienvenida + agenda llamada" (template `meta_lead_welcome`)
 *   3. (Futuro) WhatsApp con mismo mensaje — pendiente configurar Twilio
 *
 * Validación: secret literal en `CRM_WEBHOOK_SECRET` (Catalyst strip headers,
 * por eso el secret va en query string).
 *
 * Endpoint:
 *   POST /api/webhooks/zoho-crm/lead-created?secret=XXX
 *   Body form-urlencoded o JSON: { email, contact_name, company, phone, lead_source, ... }
 *
 * Idempotency: si el email ya existe en MarketingLeads, UPDATE en vez de crear
 * duplicado. No re-dispara email si ya se envió antes.
 */
import type { RequestContext } from '../lib/context';
import { sendJson } from '../lib/http';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows, unwrapRow } from '../lib/dbHelpers';

const log = logger('ZOHO_CRM_WEBHOOK');

async function readRawBody(req: RequestContext['req']): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Parsea body que puede ser JSON o form-urlencoded (Zoho manda lo que configures). */
function parseBody(raw: string, contentType: string | undefined): Record<string, unknown> {
  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ValidationError('invalid JSON body');
    }
  }
  // Default: form-urlencoded
  const params = new URLSearchParams(raw);
  const result: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) result[k] = v;
  return result;
}

export async function handleZohoCrmLeadCreated(ctx: RequestContext): Promise<void> {
  const e = env();
  const secret = e.CRM_WEBHOOK_SECRET;
  if (!secret) {
    log.error('CRM_WEBHOOK_SECRET not configured');
    sendJson(ctx.res, 503, { error: 'webhook not configured' });
    return;
  }

  // Secret va en query string (Catalyst strip de custom headers).
  const url = new URL(ctx.req.url ?? '/', 'http://x');
  const providedSecret = url.searchParams.get('secret') ?? '';
  if (providedSecret !== secret) {
    throw new UnauthorizedError('Invalid CRM webhook secret');
  }

  const rawBody = await readRawBody(ctx.req);
  const contentType = typeof ctx.req.headers['content-type'] === 'string' ? ctx.req.headers['content-type'] : '';
  const bodyRaw = parseBody(rawBody, contentType) as Record<string, unknown>;

  // Log keys del body para diagnosticar mapping de campos cuando Zoho cambia nombres.
  log.info('webhook body keys', { keys: Object.keys(bodyRaw) });

  // Helper: lee el primer field que tenga valor entre varias variantes (case-insensitive).
  const pickField = (...names: string[]): string => {
    for (const name of names) {
      // Match exacto
      const direct = bodyRaw[name];
      if (typeof direct === 'string' && direct.trim()) return direct.trim();
      // Match case-insensitive
      const key = Object.keys(bodyRaw).find((k) => k.toLowerCase() === name.toLowerCase());
      if (key) {
        const val = bodyRaw[key];
        if (typeof val === 'string' && val.trim()) return val.trim();
      }
    }
    return '';
  };

  const email = pickField('email', 'Email').toLowerCase();
  // Aceptamos nombre completo o nombre+apellido por separado (Meta lo manda separado).
  const firstName = pickField('first_name', 'First_Name');
  const lastName = pickField('last_name', 'Last_Name');
  const contactName = pickField('contact_name', 'Contact_Name', 'name', 'Name')
    || [firstName, lastName].filter(Boolean).join(' ').trim();
  const company = pickField('company', 'Company');
  // Zoho puede mandar Mobile, Phone, mobile, phone, WhatsApp, Whatsapp...
  const phone = pickField('mobile', 'Mobile', 'phone', 'Phone', 'whatsapp', 'WhatsApp', 'Whatsapp');
  const leadSource = pickField('lead_source', 'Lead_Source');
  // 2026-06-22: campos nuevos del formulario Meta (4 preguntas calificadoras).
  // dolor = Q3 (desafío principal: alta rotación / candidatos no rinden / proceso lento / presupuesto)
  // role = Q4 (rol del lead: dueño/CEO / Director RRHH / gerente de área / Otro)
  const dolor = pickField('dolor', 'Dolor', 'pain_point', 'pain', 'desafio', 'Desafio');
  const role = pickField('role', 'puesto', 'Puesto', 'rol', 'Rol', 'role_in_hiring');
  // Q1 y Q2 son booleanos sí/no — opcionales para humanización del mensaje
  const hasVacancy = pickField('vacancy', 'Vacancy', 'vacante', 'Vacante');
  const hadBadHire = pickField('bad_hire', 'mala_contratacion', 'BadHire');

  if (!email) {
    sendJson(ctx.res, 400, { error: 'email required' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(ctx.res, 400, { error: 'invalid email format' });
    return;
  }

  // Filtro por Lead_Source: solo procesamos los configurados. Si no matchea,
  // 200 OK sin hacer nada (no es error, simplemente no es nuestro flujo).
  const allowedSources = (e.CRM_META_LEAD_SOURCE ?? 'SharkTalents Funnel,Meta leads ad')
    .split(',').map((s) => s.trim().toLowerCase());
  if (!allowedSources.includes(leadSource.toLowerCase())) {
    log.info('lead source not in allowed list — skipping', {
      lead_source: leadSource,
      allowed: allowedSources,
      email_masked: email.slice(0, 3) + '***',
    });
    sendJson(ctx.res, 200, { received: true, processed: false, reason: 'lead_source_not_allowed' });
    return;
  }

  // 1. Buscar lead existente por email (idempotency).
  type LeadRow = { ROWID: string; email: string };
  const existing = unwrapRows<LeadRow>(
    (await zcql(ctx.req).executeZCQLQuery(
      `SELECT ROWID, email FROM MarketingLeads WHERE email = '${escapeSql(email)}' LIMIT 1`,
    )) as unknown[],
    'MarketingLeads',
  );

  let leadId: string;
  let isNew = false;
  if (existing[0]) {
    leadId = existing[0].ROWID;
    // Actualizar con datos nuevos si vienen.
    const updates: Record<string, unknown> = { ROWID: leadId, updated_at: now() };
    if (contactName) updates.contact_name = contactName.slice(0, 255);
    if (company) updates.company = company.slice(0, 255);
    if (phone) updates.whatsapp = phone.slice(0, 50);
    if (dolor) updates.dolor = dolor.slice(0, 255);
    if (role) updates.puesto = role.slice(0, 100);
    if (Object.keys(updates).length > 2) {
      // Try/catch tolera columnas nuevas inexistentes (Cris las crea en Console post-deploy)
      try {
        await datastore(ctx.req).table('MarketingLeads').updateRow(updates as { ROWID: string });
      } catch (err) {
        log.warn('MarketingLeads update with new fields failed (columnas no creadas?), retrying core fields only', { error: (err as Error).message });
        const coreUpdates: Record<string, unknown> = { ROWID: leadId, updated_at: now() };
        if (contactName) coreUpdates.contact_name = contactName.slice(0, 255);
        if (company) coreUpdates.company = company.slice(0, 255);
        if (phone) coreUpdates.whatsapp = phone.slice(0, 50);
        await datastore(ctx.req).table('MarketingLeads').updateRow(coreUpdates as { ROWID: string });
      }
    }
    log.info('crm lead exists — updated', { leadId, email_masked: email.slice(0, 3) + '***' });
  } else {
    const insertPayload: Record<string, unknown> = {
      email,
      contact_name: contactName.slice(0, 255) || null,
      company: company.slice(0, 255) || null,
      whatsapp: phone.slice(0, 50) || null,
      source: leadSource.slice(0, 50) || 'crm_webhook',
      // 2026-06-11: bug fix — leads del webhook CRM no se mostraban en el kanban porque
      // status quedaba null. El kanban filtra por status in ('new','eval_requested',...).
      status: 'new',
      created_at: now(),
      updated_at: now(),
      // 2026-06-22: dolor (Q3) y puesto (Q4) del formulario Meta.
      // Las columnas existen en MarketingLeads. Q1 (vacancy) y Q2 (bad_hire) no se persisten
      // por decisión de Cris — entran al webhook pero se ignoran a nivel storage.
      dolor: dolor ? dolor.slice(0, 255) : null,
      puesto: role ? role.slice(0, 100) : null,
    };
    let inserted: unknown;
    try {
      inserted = await datastore(ctx.req).table('MarketingLeads').insertRow(insertPayload);
    } catch (err) {
      log.warn('MarketingLeads insert con campos nuevos falló (columnas no creadas?), reintentando solo core', { error: (err as Error).message });
      // Fallback: insertar solo los campos core para no perder el lead
      const corePayload = {
        email,
        contact_name: contactName.slice(0, 255) || null,
        company: company.slice(0, 255) || null,
        whatsapp: phone.slice(0, 50) || null,
        source: leadSource.slice(0, 50) || 'crm_webhook',
        status: 'new',
        created_at: now(),
        updated_at: now(),
      };
      inserted = await datastore(ctx.req).table('MarketingLeads').insertRow(corePayload);
    }
    const row = unwrapRow<{ ROWID: string }>(inserted, 'MarketingLeads');
    if (!row) {
      throw new Error('MarketingLeads insert returned null');
    }
    leadId = row.ROWID;
    isNew = true;
    log.info('crm lead created — new MarketingLead', { leadId, source: leadSource });

    // Auto-asignar a freelance con menos leads (round-robin básico).
    // Solo para leads nuevos — los existing ya tienen assigned_to del primer paso.
    try {
      const { autoAssignLead } = await import('./freelance.js');
      const assignedTo = await autoAssignLead(ctx.req, leadId);
      log.info('crm webhook auto-assign result', { leadId, assignedTo: assignedTo ?? 'none' });
    } catch (err) {
      log.warn('crm webhook auto-assign failed', { leadId, error: (err as Error).message });
    }
  }

  // 2. Email de bienvenida — DESHABILITADO (2026-07-10).
  //
  // Antes se disparaba automáticamente al recibir un lead desde Zoho CRM. Ahora
  // el vendedor freelance decide cuándo enviarlo desde el botón "📧 Enviar
  // evaluación" en el kanban. Motivo: el flujo consultivo requiere que el
  // vendedor califique al lead antes de mandarle links de evaluación.
  //
  // Si el lead vino de la landing "prueba gratis" (auto-servicio), el endpoint
  // /api/marketing/lead sí manda email — pero esa es una entrada distinta.

  // 3. Alerta WhatsApp a Cris (speed-to-lead < 5 min). Solo si es lead nuevo de Meta
  // y OPS_ALERT_PHONE está configurado.
  //
  // 2026-06-29: switch a template `lead_alerta_cris` aprobado por Meta. Si
  // TWILIO_TPL_LEAD_ALERTA está configurado, manda template (6 variables,
  // formato fijo). Sino, fallback a sendText (sandbox / 24h window).
  //
  // Template body (las 6 variables son posicionales):
  //   👤 {{1}}  → nombre
  //   📧 {{2}}  → email
  //   📱 {{3}}  → wa.me link
  //   💼 Rol: {{4}}
  //   💥 Dolor: {{5}}
  //   Mensaje sugerido: {{6}}
  if (isNew && e.OPS_ALERT_PHONE) {
    const leadPhoneClean = (phone ?? '').replace(/[^\d]/g, '');
    const waLink = leadPhoneClean ? `https://wa.me/${leadPhoneClean}` : '(sin WhatsApp)';

    // Mensaje sugerido (Claude Haiku + 9 ejemplos aprobados por Cristian).
    // Falla silenciosa: si Claude no responde, la sugerencia queda como placeholder.
    let sugerido = '(no generado — revisa logs si esto se repite)';
    try {
      const { generateLeadSuggestedMessage } = await import('../lib/leadMessageGenerator.js');
      const generated = await generateLeadSuggestedMessage(
        { nombre: contactName, rol: role, dolor },
        ctx.traceId,
      );
      if (generated) sugerido = generated;
    } catch (err) {
      log.debug('suggested message generation skipped', { error: (err as Error).message });
    }

    // TWILIO_TPL_LEAD_ALERTA: leer de tabla Config (env vars del proyecto llegaron al cap).
    let templateSid = '';
    try {
      const { getSecret } = await import('../lib/secretsCache.js');
      templateSid = await getSecret('TWILIO_TPL_LEAD_ALERTA', ctx.req);
    } catch (err) {
      log.debug('TWILIO_TPL_LEAD_ALERTA read failed', { error: (err as Error).message });
    }
    try {
      if (templateSid) {
        // Path producción: template aprobado por Meta. 6 variables posicionales.
        const { sendTemplate } = await import('../lib/whatsappDispatcher.js');
        const waRes = await sendTemplate(
          {
            to_phone: e.OPS_ALERT_PHONE,
            template_name: templateSid,
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: contactName || 'sin nombre' },
                  { type: 'text', text: email || 'sin email' },
                  { type: 'text', text: waLink },
                  { type: 'text', text: role || 'sin rol' },
                  { type: 'text', text: dolor || 'sin dolor' },
                  { type: 'text', text: sugerido },
                ],
              },
            ],
          },
          ctx.traceId,
        );
        log.info('ops alert whatsapp template result', {
          leadId,
          ok: waRes.ok,
          error: waRes.ok ? undefined : waRes.error,
        });
      } else {
        // Fallback: sendText (sandbox / 24h window) con el cuerpo formado.
        const alertLines = [
          `🦈 Lead nuevo en SharkTalents`,
          ``,
          `👤 ${contactName || 'sin nombre'}`,
          `📧 ${email}`,
          `📱 ${waLink}`,
          `🎯 Fuente: ${leadSource || 'Meta'}`,
        ];
        if (role) alertLines.push(`💼 Rol: ${role}`);
        if (dolor) alertLines.push(`💥 Dolor: ${dolor}`);
        if (hasVacancy) alertLines.push(`📋 Vacante este trimestre: ${hasVacancy}`);
        if (hadBadHire) alertLines.push(`⚠️ Mala contratación previa: ${hadBadHire}`);
        if (sugerido && !sugerido.startsWith('(no generado')) {
          alertLines.push(``, `💡 Sugerido:`, sugerido);
        }
        alertLines.push(``, `Speed-to-lead: < 5 min recomendado.`);
        const { sendText } = await import('../lib/whatsappDispatcher.js');
        const waRes = await sendText(
          { to_phone: e.OPS_ALERT_PHONE, body: alertLines.join('\n') },
          ctx.traceId,
        );
        log.info('ops alert whatsapp text fallback result', {
          leadId,
          ok: waRes.ok,
          error: waRes.ok ? undefined : waRes.error,
        });
      }
    } catch (err) {
      log.warn('ops alert whatsapp failed', { leadId, error: (err as Error).message });
    }
  }

  sendJson(ctx.res, 200, {
    received: true,
    processed: true,
    lead_id: leadId,
    is_new: isNew,
    email_queued: isNew,
  });
}
