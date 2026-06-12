/**
 * Endpoints admin para editar templates de email sin redeploy.
 *
 *   GET    /api/admin/email-templates                — lista todos los templates + override status
 *   GET    /api/admin/email-templates/:key/:locale   — devuelve el template actual (override o default)
 *   PUT    /api/admin/email-templates/:key/:locale   — guarda override
 *   DELETE /api/admin/email-templates/:key/:locale   — borra override (vuelve a default)
 *
 * El override por tenant tiene prioridad sobre el global. Default code es fallback.
 */

import type { RequestContext } from '../lib/context';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendJson, readJsonBody } from '../lib/http';
import { logger } from '../lib/logger';
import { datastore, zcql, now } from '../lib/db';
import { escapeSql, unwrapRows } from '../lib/dbHelpers';
import { requireAuth } from '../lib/auth';
import { requireTenant } from './tenants';
import { TEMPLATES, getTemplate, getTemplateWithOverride, type TemplateKey, type EmailLocale } from '../lib/emailTemplates';
import { auditLog } from '../lib/auditLog';

const log = logger('TEMPLATE_OVERRIDES');
// 2026-06-04: nombre "EmailTemplateOverrides" envenenado en Catalyst tras orphan; renombrado.
const TABLE = 'EmailOverrides';

type OverrideRow = {
  ROWID: string;
  tenant_id: string | null;
  template_key: string;
  locale: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  updated_at: string;
  updated_by: string | null;
};

function parsePath(url: string): { key: TemplateKey; locale: EmailLocale } | null {
  const m = url.match(/^\/api\/admin\/email-templates\/([^/]+)\/([^/?]+)/);
  if (!m) return null;
  const key = m[1] as TemplateKey;
  const locale = m[2] as EmailLocale;
  if (!(key in TEMPLATES)) return null;
  if (locale !== 'es' && locale !== 'en') return null;
  return { key, locale };
}

export async function listEmailTemplatesWithOverrides(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  let overrides: OverrideRow[] = [];
  try {
    overrides = unwrapRows<OverrideRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT * FROM ${TABLE} WHERE tenant_id = '${escapeSql(tenantId)}' OR tenant_id IS NULL`,
      )) as unknown[],
      TABLE,
    );
  } catch { /* tabla no existe */ }

  const keys = Object.keys(TEMPLATES) as TemplateKey[];
  const items = keys.flatMap((key) => (['es', 'en'] as EmailLocale[]).map((locale) => {
    const tenantOverride = overrides.find((o) => o.template_key === key && o.locale === locale && o.tenant_id === tenantId);
    const globalOverride = overrides.find((o) => o.template_key === key && o.locale === locale && o.tenant_id == null);
    const def = getTemplate(key, locale);
    return {
      key,
      locale,
      default_subject: def.subject,
      has_tenant_override: !!tenantOverride,
      has_global_override: !!globalOverride,
      tenant_override_updated_at: tenantOverride?.updated_at ?? null,
      tenant_override_updated_by: tenantOverride?.updated_by ?? null,
    };
  }));

  sendJson(ctx.res, 200, { items });
}

export async function getEmailTemplateOverride(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const parsed = parsePath(ctx.req.url ?? '/');
  if (!parsed) throw new NotFoundError('template no encontrado');

  const def = getTemplate(parsed.key, parsed.locale);
  const effective = await getTemplateWithOverride(ctx.req, parsed.key, parsed.locale, tenantId);

  sendJson(ctx.res, 200, {
    key: parsed.key,
    locale: parsed.locale,
    default: def,
    effective,
    is_overridden:
      def.subject !== effective.subject ||
      def.body_html !== effective.body_html ||
      def.body_text !== effective.body_text,
  });
}

export async function putEmailTemplateOverride(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const parsed = parsePath(ctx.req.url ?? '/');
  if (!parsed) throw new NotFoundError('template no encontrado');

  const body = await readJsonBody<{ subject?: string; body_html?: string; body_text?: string }>(ctx.req);
  const subject = typeof body.subject === 'string' ? body.subject.slice(0, 500) : null;
  const bodyHtml = typeof body.body_html === 'string' ? body.body_html.slice(0, 50_000) : null;
  const bodyText = typeof body.body_text === 'string' ? body.body_text.slice(0, 30_000) : null;
  if (!subject && !bodyHtml && !bodyText) {
    throw new ValidationError('al menos uno de subject/body_html/body_text es requerido');
  }

  // ¿Ya existe un override?
  let existing: OverrideRow | undefined;
  try {
    existing = unwrapRows<OverrideRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE}
         WHERE template_key = '${escapeSql(parsed.key)}'
           AND locale = '${escapeSql(parsed.locale)}'
           AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];
  } catch { /* tabla puede no existir */ }

  const userId = ctx.user?.clerk_user_id ?? 'unknown';
  try {
    if (existing) {
      await datastore(ctx.req).table(TABLE).updateRow({
        ROWID: existing.ROWID,
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        updated_at: now(),
        updated_by: userId,
      });
    } else {
      await datastore(ctx.req).table(TABLE).insertRow({
        tenant_id: tenantId,
        template_key: parsed.key,
        locale: parsed.locale,
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        created_at: now(),
        updated_at: now(),
        updated_by: userId,
      });
    }
    void auditLog(ctx, {
      action: 'tenant.update',
      resource_type: 'email_template_override',
      resource_id: `${parsed.key}:${parsed.locale}`,
      changes: { template_key: parsed.key, locale: parsed.locale },
    });
    sendJson(ctx.res, 200, { ok: true, key: parsed.key, locale: parsed.locale });
  } catch (err) {
    log.warn('override save failed (tabla puede no existir)', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'override_save_failed', message: (err as Error).message } });
  }
}

export async function deleteEmailTemplateOverride(ctx: RequestContext): Promise<void> {
  await requireAuth(ctx);
  const tenantId = await requireTenant(ctx);

  const parsed = parsePath(ctx.req.url ?? '/');
  if (!parsed) throw new NotFoundError('template no encontrado');

  try {
    const existing = unwrapRows<OverrideRow>(
      (await zcql(ctx.req).executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE}
         WHERE template_key = '${escapeSql(parsed.key)}'
           AND locale = '${escapeSql(parsed.locale)}'
           AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
      )) as unknown[],
      TABLE,
    )[0];
    if (!existing) {
      sendJson(ctx.res, 200, { ok: true, message: 'no había override' });
      return;
    }
    await datastore(ctx.req).table(TABLE).deleteRow(existing.ROWID);
    void auditLog(ctx, {
      action: 'tenant.delete',
      resource_type: 'email_template_override',
      resource_id: `${parsed.key}:${parsed.locale}`,
    });
    sendJson(ctx.res, 200, { ok: true });
  } catch (err) {
    log.warn('override delete failed', { error: (err as Error).message });
    sendJson(ctx.res, 500, { error: { code: 'override_delete_failed', message: (err as Error).message } });
  }
}
