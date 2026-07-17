/**
 * Email templates en español + inglés. Texto plano + HTML compatible con Gmail/Outlook.
 *
 * Convención:
 * - {{variable}} para placeholders (reemplazo simple, no Mustache real para evitar dependencia)
 * - Subject line viene en el mismo objeto
 *
 * Cuando integremos Zoho ZeptoMail / Postmark / lo que sea, este módulo
 * exporta los strings y el sender los usa.
 */

export type EmailLocale = 'es' | 'en';

export type EmailTemplate = {
  subject: string;
  body_text: string;
  body_html: string;
};

type Vars = Record<string, string>;

function fillVars(s: string, vars: Vars): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function renderTemplate(template: EmailTemplate, vars: Vars): EmailTemplate {
  return {
    subject: fillVars(template.subject, vars),
    body_text: fillVars(template.body_text, vars),
    body_html: fillVars(template.body_html, vars),
  };
}

// ============================================================
// Candidate test invitation (después de prefiltro OK → técnica)
// ============================================================

// NOTA (2026-05-08): los emails al CANDIDATO se mandan desde Zoho Recruit (templates
// configuradas allá según stage). NO los mandamos desde nuestro código. Acá solo viven
// las 2 plantillas de cliente + recovery_link (caso especial: candidato pide reenvío).

// ============================================================
// Client report ready (le mando el reporte al cliente)
// ============================================================

const CLIENT_REPORT_READY: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: '{{client_name}}, reporte de finalistas para {{job_title}}',
    body_text: `Hola {{client_name}},

Tu reporte de finalistas para {{job_title}} está listo.

Incluí {{finalist_count}} candidatos top con análisis comparativo de DISC, capacidad cognitiva, integridad y nivel técnico.

Verlo: {{report_url}}

Cualquier comentario lo puedes dejar directamente en el reporte y me llega notificación.

Saludos,
{{recruiter_name}}`,
    body_html: `<p>Hola <strong>{{client_name}}</strong>,</p>
<p>Tu reporte de finalistas para <strong>{{job_title}}</strong> está listo.</p>
<p>Incluí <strong>{{finalist_count}} candidatos top</strong> con análisis comparativo de DISC, capacidad cognitiva, integridad y nivel técnico.</p>
<p><a href="{{report_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Ver reporte</a></p>
<p style="color:#666;font-size:14px;">Cualquier comentario lo puedes dejar directamente en el reporte y me llega notificación.</p>
<p>Saludos,<br/>{{recruiter_name}}</p>`,
  },
  en: {
    subject: '{{client_name}}, finalist report for {{job_title}}',
    body_text: `Hi {{client_name}},

Your finalist report for {{job_title}} is ready.

It includes {{finalist_count}} top candidates with comparative analysis of DISC, cognitive ability, integrity, and technical skills.

View: {{report_url}}

You can leave comments directly in the report and I'll get notified.

Best,
{{recruiter_name}}`,
    body_html: `<p>Hi <strong>{{client_name}}</strong>,</p>
<p>Your finalist report for <strong>{{job_title}}</strong> is ready.</p>
<p>It includes <strong>{{finalist_count}} top candidates</strong> with comparative analysis of DISC, cognitive ability, integrity, and technical skills.</p>
<p><a href="{{report_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">View report</a></p>
<p style="color:#666;font-size:14px;">You can leave comments directly in the report and I'll get notified.</p>
<p>Best,<br/>{{recruiter_name}}</p>`,
  },
};

// ============================================================
// Client portal access (link al portal con todos los puestos del cliente)
// ============================================================

const CLIENT_PORTAL_ACCESS: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Acceso a tu portal de SharkTalents — {{client_name}}',
    body_text: `Hola {{client_name}},

Tu portal personalizado en SharkTalents está activo. Acá vas a ver todos tus puestos abiertos, candidatos finalistas, y reportes en un solo lugar.

Acceder: {{portal_url}}

Importante: el link es único para vos y no requiere contraseña. No lo compartas.

Saludos,
{{recruiter_name}}`,
    body_html: `<p>Hola <strong>{{client_name}}</strong>,</p>
<p>Tu portal personalizado en SharkTalents está activo. Acá vas a ver todos tus puestos abiertos, candidatos finalistas, y reportes en un solo lugar.</p>
<p><a href="{{portal_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Acceder al portal</a></p>
<p style="color:#666;font-size:14px;">Importante: el link es único para vos y no requiere contraseña. No lo compartas.</p>
<p>Saludos,<br/>{{recruiter_name}}</p>`,
  },
  en: {
    subject: 'Your SharkTalents portal access — {{client_name}}',
    body_text: `Hi {{client_name}},

Your personalized SharkTalents portal is active. You'll see all your open roles, finalist candidates, and reports in one place.

Access: {{portal_url}}

Important: the link is unique to you and requires no password. Do not share it.

Best,
{{recruiter_name}}`,
    body_html: `<p>Hi <strong>{{client_name}}</strong>,</p>
<p>Your personalized SharkTalents portal is active. You'll see all your open roles, finalist candidates, and reports in one place.</p>
<p><a href="{{portal_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Access portal</a></p>
<p style="color:#666;font-size:14px;">Important: the link is unique to you and requires no password. Do not share it.</p>
<p>Best,<br/>{{recruiter_name}}</p>`,
  },
};

// ============================================================
// Export
// ============================================================

/**
 * Recovery: candidato perdió el link y pide uno nuevo desde el form público.
 */
const RECOVERY_LINK: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Tu nuevo link para {{job_title}}',
    body_text: `Hola,

Pediste un nuevo link para el proceso de {{job_title}} en {{job_company}}.

Tu link nuevo: {{test_link}}

Este link vence en {{expiry_days}} días. Si no fuiste vos, ignorá este email.

— SharkTalents`,
    body_html: `<p>Hola,</p>
<p>Pediste un nuevo link para el proceso de <strong>{{job_title}}</strong> en {{job_company}}.</p>
<p><a href="{{test_link}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Continuar con el proceso</a></p>
<p style="color:#666;font-size:14px;">Este link vence en <strong>{{expiry_days}} días</strong>. Si no fuiste vos, ignorá este email.</p>
<p>— <em>SharkTalents</em></p>`,
  },
  en: {
    subject: 'Your new link for {{job_title}}',
    body_text: `Hi,

You requested a new link for the {{job_title}} process at {{job_company}}.

Your new link: {{test_link}}

This link expires in {{expiry_days}} days. If this wasn't you, ignore this email.

— SharkTalents`,
    body_html: `<p>Hi,</p>
<p>You requested a new link for the <strong>{{job_title}}</strong> process at {{job_company}}.</p>
<p><a href="{{test_link}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Continue the process</a></p>
<p style="color:#666;font-size:14px;">This link expires in <strong>{{expiry_days}} days</strong>. If this wasn't you, ignore this email.</p>
<p>— <em>SharkTalents</em></p>`,
  },
};

// ============================================================
// Marketing funnel — request deletion (GDPR step 1)
// ============================================================

const MARKETING_DELETION_REQUEST: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Confirmá la baja de tu información en SharkTalents',
    body_text: `Hola,

Recibimos tu pedido para eliminar tus datos de SharkTalents.

Para confirmar, hacé click acá (link válido por {{expires_in_hours}}h):
{{deletion_url}}

Una vez confirmado, tus datos se eliminan en máximo 30 días. Si no fuiste vos, ignorá este email — el link expira solo.

Saludos,
SharkTalents`,
    body_html: `<p>Hola,</p>
<p>Recibimos tu pedido para eliminar tus datos de SharkTalents.</p>
<p><a href="{{deletion_url}}" style="background:#ef4444;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Confirmar baja</a></p>
<p style="color:#666;font-size:14px;">El link es válido por <strong>{{expires_in_hours}} horas</strong>. Una vez confirmado, tus datos se eliminan en máximo 30 días.</p>
<p style="color:#666;font-size:13px;">Si no fuiste vos quien pidió esto, ignorá este email. El link expira solo.</p>
<p style="color:#999;font-size:12px;">— <em>SharkTalents</em></p>`,
  },
  en: {
    subject: 'Confirm your data deletion request — SharkTalents',
    body_text: `Hi,

We received your request to delete your data from SharkTalents.

To confirm, click here (link valid for {{expires_in_hours}}h):
{{deletion_url}}

Once confirmed, your data will be deleted within 30 days. If this wasn't you, ignore this email — the link expires on its own.

Best,
SharkTalents`,
    body_html: `<p>Hi,</p>
<p>We received your request to delete your data from SharkTalents.</p>
<p><a href="{{deletion_url}}" style="background:#ef4444;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Confirm deletion</a></p>
<p style="color:#666;font-size:14px;">Link valid for <strong>{{expires_in_hours}} hours</strong>. Once confirmed, your data is deleted within 30 days.</p>
<p style="color:#666;font-size:13px;">If this wasn't you, ignore this email. The link expires on its own.</p>
<p style="color:#999;font-size:12px;">— <em>SharkTalents</em></p>`,
  },
};

// ============================================================
// Marketing funnel — demo test link (cuando el lead pide eval gratuita)
// ============================================================

const MARKETING_DEMO_TEST_LINK: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: '{{lead_name}} te invitó a completar una evaluación',
    body_text: `SharkTalents

Hola {{member_name}},

{{lead_name}}, de {{lead_company}}, te invitó a completar una evaluación a través de SharkTalents.

Son aproximadamente {{estimated_minutes}} minutos, en una sola sentada. La evaluación mide estilo de trabajo, razonamiento y criterio.

El reporte lo recibe {{lead_name}}, no tú.

El link expira el {{expires_at}}.

Empezar evaluación: {{test_url}}

—
Equipo SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#0e1218; padding:28px 40px; text-align:left; border-bottom:4px solid #dafd6f;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
            <h1 style="margin:0 0 20px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">{{lead_name}} te invitó a completar una evaluación</h1>
            <p style="margin:0 0 16px 0;">Hola {{member_name}},</p>
            <p style="margin:0 0 16px 0;"><strong>{{lead_name}}</strong>, de {{lead_company}}, te invitó a completar una evaluación a través de SharkTalents.</p>
            <p style="margin:0 0 24px 0;">Son aproximadamente <strong>{{estimated_minutes}} minutos</strong>, en una sola sentada. La evaluación mide estilo de trabajo, razonamiento y criterio.</p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fef9c3; border-radius:8px; margin-bottom:28px;">
              <tr>
                <td style="padding:14px 20px; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#713f12;">
                  <strong>Importante:</strong> el reporte lo recibe {{lead_name}}, no tú. El link expira el <strong>{{expires_at}}</strong>.
                </td>
              </tr>
            </table>

            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
              <tr>
                <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
                  <a href="{{test_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">
                    Empezar evaluación
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
              <strong style="color:#1f2937;">Equipo SharkTalents</strong>
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`,
  },
  en: {
    subject: 'Your SharkTalents evaluation is ready — {{member_name}}',
    body_text: `Hi {{member_name}},

{{lead_name}} from {{lead_company}} invited you to take a free talent evaluation at SharkTalents.

3 sections (DISC + cognitive ability + integrity), about {{estimated_minutes}} minutes. Take it anytime, in one go.

Start here: {{test_url}}

Link expires on {{expires_at}}.

Once complete, we send the report directly to {{lead_name}}. You can request to see yours too.

Best,
SharkTalents`,
    body_html: `<p>Hi <strong>{{member_name}}</strong>,</p>
<p><strong>{{lead_name}}</strong> from <strong>{{lead_company}}</strong> invited you to take a free talent evaluation at SharkTalents.</p>
<p>3 sections (DISC + cognitive + integrity), about <strong>{{estimated_minutes}} minutes</strong>. Take it anytime, in one go.</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start evaluation</a></p>
<p style="color:#666;font-size:14px;">Link expires on <strong>{{expires_at}}</strong>.</p>
<p style="color:#666;font-size:14px;">Once complete, we send the report directly to {{lead_name}}. You can request yours too.</p>
<p>Best,<br/><em>SharkTalents</em></p>`,
  },
};

// ============================================================
// Marketing funnel — invitación al candidato finalista (flow=finalist)
// Landing: /evalua-tu-finalista. El empleador manda a un candidato de un proceso
// activo, no a un miembro de su equipo. El ángulo del email cambia: le decimos
// al candidato que es parte del proceso de selección, no un favor a un amigo.
// ============================================================

const MARKETING_FINALIST_TEST_LINK: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Tu evaluación para {{lead_company}}',
    body_text: `SharkTalents

Hola {{member_name}},

{{lead_name}} te invita a completar dos pruebas cortas como parte del proceso para {{puesto}}.

Prueba conductual (~30-40 min):
{{conductual_url}}

Prueba de integridad (~20-30 min):
{{integridad_url}}

—
Equipo SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#0e1218; padding:28px 40px; text-align:left; border-bottom:4px solid #dafd6f;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Evaluación de finalistas.</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
            <p style="margin:0 0 20px 0;">Hola {{member_name}},</p>
            <p style="margin:0 0 28px 0;"><strong>{{lead_name}}</strong> te invita a completar dos pruebas cortas como parte del proceso para <strong>{{puesto}}</strong>.</p>

            <p style="margin:0 0 10px 0; font-size:13px; color:#4b5563; font-weight:600;">Prueba conductual (~30-40 min)</p>
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
              <tr>
                <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:12px 28px;">
                  <a href="{{conductual_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">
                    Empezar
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 10px 0; font-size:13px; color:#4b5563; font-weight:600;">Prueba de integridad (~20-30 min)</p>
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
              <tr>
                <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:12px 28px;">
                  <a href="{{integridad_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">
                    Empezar
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
              <strong style="color:#1f2937;">Equipo SharkTalents</strong>
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`,
  },
  en: {
    subject: 'Evaluation for {{puesto}} at {{lead_company}}',
    body_text: `Hi {{member_name}},

{{lead_name}} from {{lead_company}} invited you to complete an evaluation as part of the selection process for {{puesto}}.

About {{estimated_minutes}} minutes total, in one sitting. Measures work style (DISC), reasoning, integrity, and fit with the role.

Start here: {{test_url}}

Link expires on {{expires_at}}. The report goes to {{lead_name}} for the final decision.

Best,
SharkTalents`,
    body_html: `<p>Hi <strong>{{member_name}}</strong>,</p>
<p><strong>{{lead_name}}</strong> from <strong>{{lead_company}}</strong> invited you to complete an evaluation as part of the selection process for <strong>{{puesto}}</strong>.</p>
<p>About <strong>{{estimated_minutes}} minutes</strong>, in one sitting. Measures DISC, reasoning, integrity, and fit.</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start evaluation</a></p>
<p style="color:#666;font-size:14px;">Link expires on <strong>{{expires_at}}</strong>. Report goes to {{lead_name}}.</p>
<p>Best,<br/><em>SharkTalents</em></p>`,
  },
};

// ============================================================
// Marketing funnel — thank-you al lead cuando deja sus datos
// ============================================================

const MARKETING_LEAD_THANKS: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Tus evaluaciones SharkTalents están listas',
    body_text: `SharkTalents

Hola{{contact_name_prefix}},

Estos son los dos diagnósticos que estructuran el primer filtro de nuestro proceso. Tu próxima contratación se va a definir con datos, no con intuición. Las pruebas miden cómo piensa la persona, cómo se comporta en equipo y qué tan confiable es — antes de que firme contigo.

Evaluación conductual — DISC + capacidad cognitiva (~30-40 min):
{{conductual_url}}

Evaluación de integridad (~20-30 min):
{{integridad_url}}

Las puedes completar tú o reenviar este correo a la persona que vas a evaluar. Cuando se cierran las dos, el reporte completo llega directo a tu correo.

—
Equipo SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#0e1218; padding:28px 40px; text-align:left; border-bottom:4px solid #dafd6f;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
            <h1 style="margin:0 0 20px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">Tus evaluaciones SharkTalents están listas</h1>
            <p style="margin:0 0 16px 0;">Hola{{contact_name_prefix}},</p>
            <p style="margin:0 0 16px 0;">Estos son los dos diagnósticos que estructuran el primer filtro de nuestro proceso. Tu próxima contratación se va a definir con datos, no con intuición.</p>
            <p style="margin:0 0 28px 0;">Las pruebas miden cómo piensa la persona, cómo se comporta en equipo y qué tan confiable es — antes de que firme contigo.</p>

            <!-- EVALUACIÓN 1 -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:8px; margin-bottom:16px;">
              <tr>
                <td style="padding:20px 24px;">
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; color:#6b7280; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:6px;">EVALUACIÓN 1</div>
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:17px; font-weight:bold; color:#1f2937; margin-bottom:4px;">Conductual</div>
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#6b7280; margin-bottom:18px;">DISC + capacidad cognitiva · ~30-40 min</div>
                  <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:12px 28px;">
                        <a href="{{conductual_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">
                          Empezar evaluación conductual
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- EVALUACIÓN 2 -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:8px; margin-bottom:28px;">
              <tr>
                <td style="padding:20px 24px;">
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; color:#6b7280; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:6px;">EVALUACIÓN 2</div>
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:17px; font-weight:bold; color:#1f2937; margin-bottom:4px;">Integridad</div>
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#6b7280; margin-bottom:18px;">Evaluación de criterio · ~20-30 min</div>
                  <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:12px 28px;">
                        <a href="{{integridad_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">
                          Empezar evaluación de integridad
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0;">Las puedes completar tú o reenviar este correo a la persona que vas a evaluar. Cuando se cierran las dos, el reporte completo llega directo a tu correo.</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
              <strong style="color:#1f2937;">Equipo SharkTalents</strong><br/>
              ¿Necesitas contexto adicional? Responde este correo y un consultor te contacta.
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`,
  },
  en: {
    subject: 'Your free evaluations are ready — SharkTalents',
    body_text: `Hi{{contact_name_prefix}}, thanks for your interest.

Here are your evaluation links. You can take them yourself or forward this email to the team member you want to evaluate:

Behavior assessment (DISC + cognitive, ~15-20 min):
{{conductual_url}}

Integrity assessment (~10 min):
{{integridad_url}}

As soon as both are completed, we'll send the full report to this email.

Links are personal and expire on completion.

Any questions, just reply.

Best,
SharkTalents Team`,
    body_html: `<p>Hi{{contact_name_prefix}}, thanks for your interest.</p>
<p>Here are your evaluation links. You can take them yourself or forward this email to the team member you want to evaluate:</p>
<p><strong>Behavior assessment</strong> (DISC + cognitive, ~15 min)<br/>
<a href="{{conductual_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;margin:8px 0;">Start behavior assessment</a></p>
<p><strong>Integrity assessment</strong> (~10 min)<br/>
<a href="{{integridad_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;margin:8px 0;">Start integrity assessment</a></p>
<p style="color:#444;">As soon as <strong>both</strong> are completed, we'll send the full report to this email.</p>
<p style="color:#666;font-size:14px;">Links are personal and expire upon completion.</p>
<p style="color:#666;font-size:14px;">Any questions, just reply.</p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

// ============================================================
// Marketing funnel — reporte del demo listo (cuando el colaborador termina el test)
// ============================================================

const MARKETING_DEMO_REPORT_READY: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'El reporte de {{member_name}} ya está listo',
    body_text: `SharkTalents

Hola{{contact_name_prefix}},

El reporte de {{member_name}} ya está disponible. Incluye perfil DISC, capacidad cognitiva e integridad — todo en un solo documento.

El link está activo por 30 días.

Ver reporte: {{report_url}}

¿Quieres hablar con nosotros para conocer el servicio completo o evaluar a más colaboradores?
Agenda una reunión: {{booking_url}}

—
Equipo SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#0e1218; padding:28px 40px; text-align:left; border-bottom:4px solid #dafd6f;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
            <div style="display:inline-block; background-color:#dcfce7; color:#166534; font-size:12px; font-weight:bold; padding:4px 12px; border-radius:99px; margin-bottom:16px; letter-spacing:0.5px;">REPORTE LISTO</div>
            <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">El reporte de {{member_name}} ya está listo</h1>
            <p style="margin:0 0 20px 0;">Hola{{contact_name_prefix}},</p>
            <p style="margin:0 0 24px 0;">El reporte de <strong>{{member_name}}</strong> ya está disponible. Incluye perfil DISC, capacidad cognitiva e integridad — todo en un solo documento.</p>

            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
              <tr>
                <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
                  <a href="{{report_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">
                    Ver reporte completo
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 28px 0; font-size:13px; color:#6b7280;">El link está activo por 30 días.</p>

            <!-- CTA AGENDAR REUNIÓN -->
            <div style="border-top:1px solid #e5e7eb; padding-top:28px; margin-top:8px;">
              <p style="margin:0 0 10px 0; font-weight:bold; color:#1f2937; font-size:16px;">¿Quieres conocer el servicio completo?</p>
              <p style="margin:0 0 18px 0; color:#4b5563;">Agenda una reunión con nosotros y vemos cómo escalar las evaluaciones para tu equipo.</p>
              {{booking_section_html}}
            </div>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
              <strong style="color:#1f2937;">Equipo SharkTalents</strong><br/>
              ¿Dudas? Responde este email — llega directo a nuestro equipo.
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`,
  },
  en: {
    subject: 'Evaluation report ready — {{member_name}}',
    body_text: `Hi{{contact_name_prefix}},

{{member_name}} completed the SharkTalents evaluation.

You can see the full report here (link valid for 30 days):
{{report_url}}

The report includes:
- DISC profile (team behavior)
- Cognitive ability (logical reasoning)
- Integrity (honesty + accountability)

Interested in evaluating more team members or starting a formal hiring process? Reply to this email.

Best,
SharkTalents Team`,
    body_html: `<p>Hi{{contact_name_prefix}},</p>
<p><strong>{{member_name}}</strong> completed the SharkTalents evaluation.</p>
<p><a href="{{report_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">View full report</a></p>
<p style="color:#666;font-size:14px;">Link valid for 30 days.</p>
<p>The report includes:</p>
<ul>
  <li><strong>DISC profile</strong> — team behavior</li>
  <li><strong>Cognitive ability</strong> — logical reasoning</li>
  <li><strong>Integrity</strong> — honesty + accountability</li>
</ul>
<p style="color:#444;">Interested in evaluating more team members or starting a formal hiring process? Reply to this email.</p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

// ============================================================================
// marketing_fit_report — email camino A (finalista con reunión de fit)
// ============================================================================
// Chris arma el reporte manual en /marketing/fit-report/:leadId, la IA genera
// el HTML del reporte y lo pasa como `report_html`. Este template le pone
// la envoltura corporativa alrededor.
const MARKETING_FIT_REPORT: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Reporte de fit — {{candidate_name}}',
    body_text: `SharkTalents

Hola{{contact_name_prefix}},

Preparé el reporte de fit para {{candidate_name}} — puesto {{puesto}}.

Podés verlo acá: {{fit_view_url}}

El reporte incluye análisis del fit y también link al perfil psicométrico completo del candidato con visualizaciones (DISC, cognitiva, competencias, integridad).

Cualquier cosa, respondé este email — llega directo a nuestro equipo.

—
Equipo SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#0e1218; padding:26px 36px; text-align:left; border-bottom:4px solid #dafd6f;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:22px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Reporte de fit — evaluación de finalista</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 36px 28px 36px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
            <p style="margin:0 0 16px 0;">Hola{{contact_name_prefix}},</p>
            <p style="margin:0 0 20px 0;">Preparé el reporte de fit para <strong>{{candidate_name}}</strong> — puesto {{puesto}}.</p>

            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
              <tr>
                <td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 36px;">
                  <a href="{{fit_view_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#0e1218; text-decoration:none; display:inline-block;">
                    Ver reporte de fit
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px 0; font-size:14px; color:#4b5563;">Adentro vas a encontrar:</p>
            <ul style="margin:0 0 20px 0; padding-left:20px; font-size:14px; color:#4b5563; line-height:1.8;">
              <li>Análisis del fit del candidato con tu equipo y rol</li>
              <li>Fortalezas y puntos de atención específicos</li>
              <li>Recomendaciones de management para aprovechar el perfil</li>
              <li>Acceso al perfil psicométrico completo del candidato (DISC, cognitiva, competencias, integridad)</li>
            </ul>

            <p style="margin:0; font-size:13px; color:#6b7280;">Link válido por 30 días.</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#f9fafb; padding:20px 36px; border-top:1px solid #e5e7eb; text-align:center;">
            <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
              <strong style="color:#1f2937;">Equipo SharkTalents</strong><br/>
              ¿Dudas? Respondé este email.
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>`,
  },
  en: {
    subject: 'Fit report — {{candidate_name}}',
    body_text: `Hi{{contact_name_prefix}},

Here's the fit report for {{candidate_name}} — role: {{puesto}}.

View it here: {{fit_view_url}}

The link is valid for 30 days.

Reply to this email if you have any questions.

—
SharkTalents Team`,
    body_html: `<p>Hi{{contact_name_prefix}},</p>
<p>Here's the fit report for <strong>{{candidate_name}}</strong> — role: {{puesto}}.</p>
<p><a href="{{fit_view_url}}">View fit report</a></p>
<p>Link valid for 30 days.</p>
<p>— SharkTalents Team</p>`,
  },
};

/**
 * 2026-06-18: Refactor de correos del candidato — 1 correo por fase del proceso.
 *
 * Antes: 1 correo al apply listando TODAS las pruebas → confundía al candidato.
 * Ahora: 5 correos, uno por fase, disparado cuando avanza:
 *   1. candidate_prefilter_start    (al apply)
 *   2. candidate_tecnica_start      (al pasar prefilter)
 *   3. candidate_conductual_start   (al pasar técnica)
 *   4. candidate_integridad_start   (al pasar conductual)
 *   5. candidate_video_start        (al pasar integridad sin riesgo alto)
 *
 * Cada correo tiene una sola CTA clara: la prueba que tiene que hacer ahora.
 */

function shellHtml(opts: { tag: string; tagBg: string; tagColor: string; headline: string; bodyHtml: string; ctaText: string; ctaUrl: string; helpHtml?: string }): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <div style="display:inline-block; background-color:${opts.tagBg}; color:${opts.tagColor}; font-size:12px; font-weight:bold; padding:4px 12px; border-radius:99px; margin-bottom:16px; letter-spacing:0.5px;">${opts.tag}</div>
        <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">${opts.headline}</h1>
        ${opts.bodyHtml}
        <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px 0;">
          <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="${opts.ctaUrl}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">${opts.ctaText}</a>
          </td></tr>
        </table>
        ${opts.helpHtml ?? '<p style="margin:24px 0 0 0; font-size:14px; color:#4b5563;">¿Tienes alguna duda? Responde este email y te ayudamos.</p>'}
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
          <strong style="color:#1f2937;">Equipo SharkTalents</strong>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

// Fase 1 — Prefilter (se dispara al apply)
const CANDIDATE_PREFILTER_START: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Recibimos tu aplicación a {{job_title}}',
    body_text: `Hola {{candidate_name}},

Recibimos tu aplicación al puesto de {{job_title}} en {{company}}.

El primer paso es un breve cuestionario inicial (~5 min). Sirve para confirmar requisitos básicos del puesto antes de continuar con las evaluaciones.

Empieza tu cuestionario inicial:
{{test_url}}

El link es personal y válido por 14 días. Si necesitas un link nuevo, responde este email.

—
Equipo SharkTalents`,
    body_html: shellHtml({
      tag: 'PASO 1 DE 5 · CUESTIONARIO INICIAL',
      tagBg: '#dcfce7', tagColor: '#166534',
      headline: 'Hola {{candidate_name}}, recibimos tu aplicación',
      bodyHtml: `<p style="margin:0 0 12px 0;">Aplicaste al puesto de <strong>{{job_title}}</strong> en <strong>{{company}}</strong>.</p>
        <p style="margin:0 0 12px 0;">El primer paso es un <strong>breve cuestionario inicial</strong> (~5 min) para confirmar los requisitos básicos del puesto.</p>
        <p style="margin:0 0 4px 0; font-size:13px; color:#6b7280;">Una vez que lo completes, te enviaremos por correo el siguiente paso.</p>`,
      ctaText: 'Empezar cuestionario',
      ctaUrl: '{{test_url}}',
      helpHtml: `<p style="margin:0 0 8px 0; font-size:13px; color:#6b7280;">El link es personal y válido por 14 días.</p>
        <p style="margin:24px 0 0 0; font-size:14px; color:#4b5563;">¿Tienes alguna duda? Responde este email y te ayudamos.</p>`,
    }),
  },
  en: {
    subject: 'We received your application for {{job_title}}',
    body_text: `Hi {{candidate_name}},

We received your application for {{job_title}} at {{company}}.

The first step is a short initial questionnaire (~5 min) to confirm basic role requirements.

Start your questionnaire:
{{test_url}}

Link valid 14 days. Reply if you need a new one.

Best,
SharkTalents Team`,
    body_html: `<p>Hi {{candidate_name}},</p>
<p>We received your application for <strong>{{job_title}}</strong> at <strong>{{company}}</strong>.</p>
<p>First step is a short initial questionnaire (~5 min).</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start questionnaire</a></p>
<p style="color:#666;font-size:14px;">Link valid 14 days.</p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

// Fase 2 — Técnica (Téc + Inglés + Mindset bloque continuo)
const CANDIDATE_TECNICA_START: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Siguiente paso: prueba técnica para {{job_title}}',
    body_text: `Hola {{candidate_name}},

¡Pasaste el cuestionario inicial!

El siguiente paso es la prueba técnica del puesto {{job_title}}. Dura entre 20 y 30 minutos y combina:
- Preguntas técnicas del rol
- Situaciones reales de trabajo

Si el puesto lo requiere, dentro del mismo bloque haces también las pruebas de inglés y mindset (cada una con su pausa opcional).

Empieza tu prueba técnica:
{{test_url}}

Recomendación: hazla en un lugar tranquilo, sin interrupciones, en una sola sesión.

—
Equipo SharkTalents`,
    body_html: shellHtml({
      tag: 'PASO 2 DE 5 · PRUEBA TÉCNICA',
      tagBg: '#fef3c7', tagColor: '#92400e',
      headline: '¡Pasaste el cuestionario inicial!',
      bodyHtml: `<p style="margin:0 0 12px 0;">El siguiente paso es la <strong>prueba técnica</strong> de <strong>{{job_title}}</strong>. Dura entre 20 y 30 minutos.</p>
        <p style="margin:0 0 8px 0; font-size:14px; color:#4b5563;">Combina preguntas técnicas del rol + situaciones reales de trabajo. Si el puesto lo requiere, dentro del mismo bloque haces también las pruebas de inglés y mindset.</p>
        <p style="margin:0 0 12px 0; font-size:13px; color:#6b7280;">Recomendación: hazla en un lugar tranquilo, sin interrupciones, en una sola sesión.</p>`,
      ctaText: 'Empezar prueba técnica',
      ctaUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Next step: technical test for {{job_title}}',
    body_text: `Hi {{candidate_name}},

You passed the initial questionnaire!

Next step is the technical test for {{job_title}} (20-30 min). It combines role-specific questions + real work situations. If the role requires it, you'll also do the English and Mindset blocks in the same session.

Start your technical test:
{{test_url}}

Best,
SharkTalents Team`,
    body_html: `<p>Hi {{candidate_name}},</p>
<p>You passed the initial questionnaire. Next step is the technical test (20-30 min).</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start technical test</a></p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

// Fase 3 — Conductual (DISC + VELNA + Emoción)
const CANDIDATE_CONDUCTUAL_START: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Siguiente paso: evaluación conductual',
    body_text: `Hola {{candidate_name}},

¡Pasaste la prueba técnica!

El siguiente paso es la evaluación conductual. Combina:
- DISC (perfil de comportamiento)
- Capacidad cognitiva (razonamiento verbal, lógico, numérico, espacial, abstracto)
- Emoción

Dura entre 15 y 20 minutos. No hay respuestas "correctas" — describe cómo eres y cómo reaccionas en situaciones reales.

Empieza tu evaluación conductual:
{{test_url}}

—
Equipo SharkTalents`,
    body_html: shellHtml({
      tag: 'PASO 3 DE 5 · EVALUACIÓN CONDUCTUAL',
      tagBg: '#ede9fe', tagColor: '#5b21b6',
      headline: '¡Pasaste la prueba técnica!',
      bodyHtml: `<p style="margin:0 0 12px 0;">El siguiente paso es la <strong>evaluación conductual</strong>. Combina:</p>
        <ul style="margin:0 0 16px 0; padding-left:20px; color:#374151;">
          <li style="margin-bottom:6px;"><strong>DISC</strong> — perfil de comportamiento</li>
          <li style="margin-bottom:6px;"><strong>Capacidad cognitiva</strong> — razonamiento verbal, lógico, numérico, espacial, abstracto</li>
          <li style="margin-bottom:6px;"><strong>Emoción</strong></li>
        </ul>
        <p style="margin:0 0 12px 0; font-size:14px; color:#4b5563;">Dura 15-20 min. No hay respuestas "correctas" — describe cómo eres y cómo reaccionas en situaciones reales.</p>`,
      ctaText: 'Empezar evaluación conductual',
      ctaUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Next step: behavioral evaluation',
    body_text: `Hi {{candidate_name}},

You passed the technical test!

Next is the behavioral evaluation (DISC + cognitive + emotion, 15-20 min). No right or wrong answers — describe how you really behave.

Start here:
{{test_url}}

Best,
SharkTalents Team`,
    body_html: `<p>Hi {{candidate_name}},</p>
<p>You passed the technical test. Next is the behavioral evaluation (15-20 min).</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start behavioral evaluation</a></p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

// Fase 4 — Integridad
const CANDIDATE_INTEGRIDAD_START: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Siguiente paso: prueba de integridad',
    body_text: `Hola {{candidate_name}},

¡Pasaste la evaluación conductual!

Falta una prueba escrita más: integridad. Dura entre 10 y 15 minutos.

La prueba evalúa rasgos de carácter en 13 dimensiones (honestidad, confiabilidad, dominio personal, etc.). Es importante que respondas con honestidad — el sistema detecta intentos de fingir.

Empieza tu prueba de integridad:
{{test_url}}

—
Equipo SharkTalents`,
    body_html: shellHtml({
      tag: 'PASO 4 DE 5 · INTEGRIDAD',
      tagBg: '#fed7aa', tagColor: '#9a3412',
      headline: '¡Pasaste la evaluación conductual!',
      bodyHtml: `<p style="margin:0 0 12px 0;">Falta una prueba escrita más: <strong>integridad</strong>. Dura 10-15 minutos.</p>
        <p style="margin:0 0 12px 0; font-size:14px; color:#4b5563;">Evalúa rasgos de carácter en 13 dimensiones (honestidad, confiabilidad, dominio personal, etc.). Es importante que respondas con honestidad — el sistema detecta intentos de fingir.</p>`,
      ctaText: 'Empezar prueba de integridad',
      ctaUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Next step: integrity test',
    body_text: `Hi {{candidate_name}},

You passed the behavioral evaluation!

One more written test: integrity (10-15 min). Answer honestly — the system detects faking attempts.

Start here:
{{test_url}}

Best,
SharkTalents Team`,
    body_html: `<p>Hi {{candidate_name}},</p>
<p>You passed the behavioral evaluation. One more: integrity (10-15 min).</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start integrity test</a></p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

// Fase 5 — Video
const CANDIDATE_VIDEO_START: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Último paso: entrevista en video',
    body_text: `Hola {{candidate_name}},

¡Pasaste todas las pruebas escritas!

El último paso es una breve entrevista en video con análisis de IA. Vas a responder algunas preguntas frente a la cámara, una por una, con tiempo limitado para cada respuesta.

Duración total estimada: 10-15 minutos.

Empieza tu entrevista en video:
{{test_url}}

Recomendación: usa una buena conexión a internet, audio claro y un fondo neutro. La primera pregunta es para presentarte.

—
Equipo SharkTalents`,
    body_html: shellHtml({
      tag: 'PASO 5 DE 5 · ENTREVISTA EN VIDEO',
      tagBg: '#cffafe', tagColor: '#155e75',
      headline: '¡Pasaste todas las pruebas escritas!',
      bodyHtml: `<p style="margin:0 0 12px 0;">El último paso es una breve <strong>entrevista en video</strong> con análisis de IA. Vas a responder algunas preguntas frente a la cámara, una por una, con tiempo limitado.</p>
        <p style="margin:0 0 12px 0; font-size:14px; color:#4b5563;">Duración total estimada: 10-15 minutos.</p>
        <p style="margin:0 0 12px 0; font-size:13px; color:#6b7280;">Recomendación: usa una buena conexión a internet, audio claro y un fondo neutro. La primera pregunta es para presentarte.</p>`,
      ctaText: 'Empezar entrevista en video',
      ctaUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Final step: video interview',
    body_text: `Hi {{candidate_name}},

You passed all written tests!

Final step is a short video interview with AI analysis (10-15 min). One question at a time, with a time limit per answer.

Start here:
{{test_url}}

Tip: use good internet, clear audio, neutral background. First question is to introduce yourself.

Best,
SharkTalents Team`,
    body_html: `<p>Hi {{candidate_name}},</p>
<p>You passed all written tests! Final step: video interview (10-15 min).</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start video interview</a></p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

// Alias para compat: el código viejo usa 'candidate_application_received' → mapear al prefilter.
const CANDIDATE_APPLICATION_RECEIVED = CANDIDATE_PREFILTER_START;

const CLIENT_DRAFT_REVIEW: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Necesitamos tu aprobación: perfil del puesto {{job_title}}',
    body_text: `Hola {{client_name}},

Después de nuestra reunión armamos el perfil del puesto {{job_title}} y queremos asegurarnos de que está alineado con lo que necesitas antes de empezar a buscar candidatos.

Revísalo y dinos si lo apruebas o si necesitamos ajustarlo:
{{portal_url}}

El link es válido por 30 días. Si tienes dudas, responde este email.

—
{{agency_name}}`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <div style="display:inline-block; background-color:#fef9c3; color:#713f12; font-size:12px; font-weight:bold; padding:4px 12px; border-radius:99px; margin-bottom:16px; letter-spacing:0.5px;">REQUIERE TU REVISIÓN</div>
        <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">Hola {{client_name}}, necesitamos tu aprobación</h1>
        <p style="margin:0 0 16px 0;">Después de nuestra reunión armamos el perfil del puesto <strong>{{job_title}}</strong> y queremos confirmar que está alineado con lo que necesitas antes de empezar la búsqueda.</p>
        <p style="margin:0 0 24px 0;">En el link de abajo vas a ver:</p>
        <ul style="margin:0 0 24px 0; padding-left:20px; color:#374151;">
          <li style="margin-bottom:6px;">El perfil ideal (conductual + cognitivo)</li>
          <li style="margin-bottom:6px;">Las competencias clave</li>
          <li style="margin-bottom:6px;">El contexto que usaremos para evaluar candidatos</li>
        </ul>
        <p style="margin:0 0 16px 0;">Podés <strong>aprobar</strong> el perfil tal como está o <strong>pedir cambios</strong> con tus comentarios.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
          <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="{{portal_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">Revisar el perfil del puesto</a>
          </td></tr>
        </table>
        <p style="margin:0 0 8px 0; font-size:13px; color:#6b7280;">El link es válido por 30 días.</p>
        <p style="margin:24px 0 0 0; font-size:14px; color:#4b5563;">¿Alguna duda? Respondé este email y te ayudamos.</p>
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
          <strong style="color:#1f2937;">{{agency_name}}</strong>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'We need your approval: job profile for {{job_title}}',
    body_text: `Hi {{client_name}},

After our meeting we put together the profile for {{job_title}} and we want to make sure it's aligned before we start sourcing candidates.

Review it and let us know if you approve or need changes:
{{portal_url}}

Link valid for 30 days. Reply to this email if you have questions.

Best,
{{agency_name}}`,
    body_html: `<p>Hi {{client_name}},</p>
<p>After our meeting we put together the profile for <strong>{{job_title}}</strong>.</p>
<p><a href="{{portal_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Review job profile</a></p>
<p style="color:#666;font-size:14px;">Link valid for 30 days.</p>
<p>Best,<br/><em>{{agency_name}}</em></p>`,
  },
};

// ============================================================
// Cliente — búsqueda iniciada (después de aprobar el draft del perfil)
// ============================================================

const CLIENT_SEARCH_STARTED: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Tu búsqueda de {{job_title}} arrancó',
    body_text: `Hola {{client_name}},

Aprobaste el perfil de {{job_title}} y ya activamos la búsqueda.

Lo que sigue:
- Publicamos el puesto en nuestros canales.
- Los candidatos pasan por prefiltro + pruebas (DISC, integridad, técnica, video).
- Cuando tengamos los 3 finalistas te avisamos por email y WhatsApp.

Tiempo estimado: 15-25 días.

Podés seguir el progreso del embudo en cualquier momento desde tu portal:
{{portal_url}}

—
{{agency_name}}`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <div style="display:inline-block; background-color:#dcfce7; color:#166534; font-size:12px; font-weight:bold; padding:4px 12px; border-radius:99px; margin-bottom:16px; letter-spacing:0.5px;">BÚSQUEDA ACTIVA</div>
        <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">Hola {{client_name}}, tu búsqueda arrancó</h1>
        <p style="margin:0 0 16px 0;">Aprobaste el perfil de <strong>{{job_title}}</strong> y ya activamos la búsqueda.</p>
        <p style="margin:0 0 12px 0;"><strong>Lo que sigue:</strong></p>
        <ul style="margin:0 0 24px 0; padding-left:20px; color:#374151;">
          <li style="margin-bottom:6px;">Publicamos el puesto en nuestros canales</li>
          <li style="margin-bottom:6px;">Los candidatos pasan por prefiltro + pruebas (DISC, integridad, técnica, video)</li>
          <li style="margin-bottom:6px;">Cuando tengamos los 3 finalistas te avisamos por email y WhatsApp</li>
        </ul>
        <p style="margin:0 0 24px 0;">Tiempo estimado: <strong>15-25 días</strong>.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
          <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="{{portal_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">Ver tracking en vivo</a>
          </td></tr>
        </table>
        <p style="margin:24px 0 0 0; font-size:14px; color:#4b5563;">¿Necesitás algo? Respondé este email.</p>
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
          <strong style="color:#1f2937;">{{agency_name}}</strong>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'Your search for {{job_title}} has started',
    body_text: `Hi {{client_name}},

You approved the profile for {{job_title}} and we've kicked off the search.

What's next:
- We post the role on our channels.
- Candidates go through prefilter + tests (DISC, integrity, technical, video).
- Once we have 3 finalists we notify you by email and WhatsApp.

ETA: 15-25 days.

Track funnel progress anytime from your portal:
{{portal_url}}

—
{{agency_name}}`,
    body_html: `<p>Hi {{client_name}},</p>
<p>You approved the profile for <strong>{{job_title}}</strong> and we've kicked off the search.</p>
<p><a href="{{portal_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">View live tracking</a></p>
<p style="color:#666;font-size:14px;">ETA: 15-25 days.</p>
<p>Best,<br/><em>{{agency_name}}</em></p>`,
  },
};

// ============================================================
// Cliente — embudo con candidatos en evaluación
// ============================================================

const CLIENT_FUNNEL_ACTIVE: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: '{{candidates_in_tests}} candidatos en evaluación para {{job_title}}',
    body_text: `Hola {{client_name}},

Tu búsqueda está activa y tenemos {{candidates_in_tests}} candidatos en evaluación para {{job_title}}.

Cada uno está pasando por:
- DISC + análisis conductual
- Prueba de integridad
- Prueba técnica específica
- Video de presentación

Cuando tengamos los 3 finalistas te avisamos. Mientras tanto, puedes ver el embudo en vivo:
{{portal_url}}

—
{{agency_name}}`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <div style="display:inline-block; background-color:#dbeafe; color:#1e40af; font-size:12px; font-weight:bold; padding:4px 12px; border-radius:99px; margin-bottom:16px; letter-spacing:0.5px;">EMBUDO EN MOVIMIENTO</div>
        <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">{{candidates_in_tests}} candidatos en evaluación</h1>
        <p style="margin:0 0 16px 0;">Tu búsqueda de <strong>{{job_title}}</strong> está activa y cada candidato está pasando por:</p>
        <ul style="margin:0 0 24px 0; padding-left:20px; color:#374151;">
          <li style="margin-bottom:6px;">DISC + análisis conductual</li>
          <li style="margin-bottom:6px;">Prueba de integridad</li>
          <li style="margin-bottom:6px;">Prueba técnica específica del puesto</li>
          <li style="margin-bottom:6px;">Video de presentación</li>
        </ul>
        <p style="margin:0 0 24px 0;">Cuando tengamos los 3 finalistas te avisamos por email y WhatsApp.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
          <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="{{portal_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">Ver embudo en vivo</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
          <strong style="color:#1f2937;">{{agency_name}}</strong>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: '{{candidates_in_tests}} candidates in evaluation for {{job_title}}',
    body_text: `Hi {{client_name}},

Your search is active and we have {{candidates_in_tests}} candidates in evaluation for {{job_title}}.

Each one is going through DISC + integrity + technical + video.

We'll notify you when we have the 3 finalists. In the meantime, track the funnel live:
{{portal_url}}

—
{{agency_name}}`,
    body_html: `<p>Hi {{client_name}},</p>
<p>We have <strong>{{candidates_in_tests}} candidates</strong> in evaluation for <strong>{{job_title}}</strong>.</p>
<p><a href="{{portal_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">View live funnel</a></p>
<p>Best,<br/><em>{{agency_name}}</em></p>`,
  },
};

// ============================================================
// Cris — cliente pidió cambios en el draft del perfil (interno)
// ============================================================

const RECRUITER_CLIENT_CHANGES_REQUESTED: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: '[SharkTalents] {{client_name}} pidió cambios en {{job_title}}',
    body_text: `Cliente: {{client_name}} ({{client_email}})
Puesto: {{job_title}}

Comentario del cliente:
"{{client_comment}}"

Revisalo en el admin:
{{admin_url}}

—
SharkTalents — notificación interna`,
    body_html: `<p><strong>Cliente:</strong> {{client_name}} ({{client_email}})<br/>
<strong>Puesto:</strong> {{job_title}}</p>
<p><strong>Comentario del cliente:</strong></p>
<blockquote style="border-left:3px solid #dafd6f;padding:8px 16px;color:#374151;background:#f9fafb;">{{client_comment}}</blockquote>
<p><a href="{{admin_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Revisar en admin</a></p>
<p style="color:#9ca3af;font-size:12px;">SharkTalents — notificación interna</p>`,
  },
  en: {
    subject: '[SharkTalents] {{client_name}} requested changes in {{job_title}}',
    body_text: `Client: {{client_name}} ({{client_email}})
Role: {{job_title}}

Client comment:
"{{client_comment}}"

Review in admin:
{{admin_url}}`,
    body_html: `<p><strong>Client:</strong> {{client_name}} ({{client_email}})<br/>
<strong>Role:</strong> {{job_title}}</p>
<p><strong>Client comment:</strong></p>
<blockquote>{{client_comment}}</blockquote>
<p><a href="{{admin_url}}">Review in admin</a></p>`,
  },
};

// ============================================================
// Interno — alerta del sistema a Cris
// ============================================================

const RECRUITER_ALERT: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: '🚨 [SharkTalents {{severity}}] {{code}}',
    body_text: `Severidad: {{severity}}
Código: {{code}}
Recurso: {{resource}}
Alert ID: {{alert_id}}

Mensaje:
{{message}}

Contexto:
{{context_str}}

—
Notificación automática del sistema. No respondas a este email.`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a1a1a; margin:0; padding:0;">
  <tr><td align="center" style="padding:20px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#fff; border-radius:8px; overflow:hidden;">
      <tr><td style="background-color:#dc2626; padding:16px 24px;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:18px; font-weight:bold; color:#fff;">🚨 ALERTA — SharkTalents</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#fecaca; margin-top:4px;">Severidad: {{severity}}</div>
      </td></tr>
      <tr><td style="padding:24px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#1f2937;">
        <p style="margin:0 0 12px 0;"><strong>Código:</strong> <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">{{code}}</code></p>
        <p style="margin:0 0 12px 0;"><strong>Recurso:</strong> {{resource}}</p>
        <p style="margin:0 0 12px 0;"><strong>Alert ID:</strong> <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">{{alert_id}}</code></p>
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0;"/>
        <p style="margin:0 0 12px 0;"><strong>Mensaje:</strong></p>
        <div style="background:#fef2f2;border-left:3px solid #dc2626;padding:12px;color:#7f1d1d;font-size:14px;">{{message}}</div>
        <p style="margin:16px 0 8px 0;"><strong>Contexto:</strong></p>
        <pre style="background:#f9fafb;padding:12px;border-radius:4px;font-size:12px;color:#374151;overflow-x:auto;">{{context_str}}</pre>
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:16px 24px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#6b7280;">Notificación automática — no respondas</div>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: '🚨 [SharkTalents {{severity}}] {{code}}',
    body_text: `Severity: {{severity}}
Code: {{code}}
Resource: {{resource}}
Alert ID: {{alert_id}}

Message:
{{message}}

Context:
{{context_str}}`,
    body_html: `<p><strong>🚨 ALERT — {{severity}}</strong></p>
<p>Code: <code>{{code}}</code><br/>Resource: {{resource}}<br/>Alert ID: <code>{{alert_id}}</code></p>
<p><strong>Message:</strong></p>
<blockquote style="border-left:3px solid #dc2626;padding:8px 16px;background:#fef2f2;">{{message}}</blockquote>
<pre>{{context_str}}</pre>`,
  },
};

// ============================================================
// Candidato — emails de invitación a cada etapa (post-Recruit)
// ============================================================

/**
 * Patrón compartido: invitación a una etapa específica.
 * Header negro + accent verde-amarillo (#dafd6f) + body explicativo + CTA prominente.
 */
function buildCandidateInvitationHtml(args: {
  stageLabel: string;
  candidateName: string;
  jobTitle: string;
  durationMin: string;
  description: string;
  ctaText: string;
  testUrl: string;
}): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">${args.stageLabel}</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">Hola ${args.candidateName}</h1>
        <p style="margin:0 0 16px 0;">${args.description}</p>
        <p style="margin:0 0 16px 0;"><strong>Puesto:</strong> ${args.jobTitle}<br/>
           <strong>Duración estimada:</strong> ${args.durationMin}</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="${args.testUrl}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">${args.ctaText}</a>
          </td></tr>
        </table>
        <p style="margin:0; font-size:13px; color:#6b7280;">Si tienes problemas con el link, escríbenos a <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>.</p>
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#9ca3af;">SharkTalents — Evaluación con criterio</div>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

const CANDIDATE_PRESCREENING_INVITATION: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Empezá tu evaluación para {{job_title}}',
    body_text: `Hola {{candidate_name}},

Gracias por aplicar al puesto de {{job_title}}.

Antes de empezar las pruebas, necesitamos que respondas unas preguntas cortas para confirmar que estamos alineados (5 minutos máximo):

{{test_url}}

Si tienes problemas con el link, responde este email.

—
SharkTalents`,
    body_html: buildCandidateInvitationHtml({
      stageLabel: 'Empezá tu evaluación',
      candidateName: '{{candidate_name}}',
      jobTitle: '{{job_title}}',
      durationMin: '5 minutos',
      description: 'Gracias por aplicar. Antes de las pruebas, te hacemos unas preguntas cortas para confirmar que estamos alineados en lo básico (rango salarial, ubicación, disponibilidad).',
      ctaText: 'Responder las preguntas',
      testUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Start your evaluation for {{job_title}}',
    body_text: `Hi {{candidate_name}},

Thanks for applying to {{job_title}}.

Before the assessments, we need you to answer a few quick questions (5 min max):

{{test_url}}`,
    body_html: `<p>Hi {{candidate_name}},</p><p><a href="{{test_url}}">Answer the prescreening questions</a></p>`,
  },
};

const CANDIDATE_TECNICA_INVITATION: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Siguiente paso: prueba técnica de {{job_title}}',
    body_text: `Hola {{candidate_name}},

Pasaste el prescreening. Ahora viene la prueba técnica del puesto de {{job_title}} (15-25 min):

{{test_url}}

Podés pausar y retomar. Buscamos comprensión, no memoria.

—
SharkTalents`,
    body_html: buildCandidateInvitationHtml({
      stageLabel: 'Prueba técnica',
      candidateName: '{{candidate_name}}',
      jobTitle: '{{job_title}}',
      durationMin: '15-25 minutos',
      description: 'Pasaste el prescreening. Ahora viene una prueba técnica específica de este puesto. Buscamos comprensión, no memoria. Podés pausar y retomar.',
      ctaText: 'Empezar la prueba técnica',
      testUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Next step: technical test for {{job_title}}',
    body_text: `Hi {{candidate_name}},\n\nYou passed prescreening. Now the technical test (15-25 min):\n\n{{test_url}}`,
    body_html: `<p>Hi {{candidate_name}},</p><p><a href="{{test_url}}">Start the technical test</a></p>`,
  },
};

const CANDIDATE_DISC_INVITATION: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Próximo paso: evaluación conductual (DISC)',
    body_text: `Hola {{candidate_name}},

Avanzaste a la siguiente etapa. Esta es la evaluación conductual (DISC) — 40 preguntas, sin respuestas buenas ni malas. Tomá 10-15 minutos:

{{test_url}}

—
SharkTalents`,
    body_html: buildCandidateInvitationHtml({
      stageLabel: 'Evaluación conductual',
      candidateName: '{{candidate_name}}',
      jobTitle: '{{job_title}}',
      durationMin: '10-15 minutos',
      description: 'Avanzaste a la siguiente etapa. Esta es la evaluación conductual (DISC). NO hay respuestas buenas ni malas — usa tu intuición. Es para entender tu estilo de trabajo.',
      ctaText: 'Hacer evaluación DISC',
      testUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Next step: behavioral assessment (DISC)',
    body_text: `Hi {{candidate_name}},\n\nNext step: DISC assessment. No right or wrong answers (10-15 min):\n\n{{test_url}}`,
    body_html: `<p>Hi {{candidate_name}},</p><p><a href="{{test_url}}">Start DISC</a></p>`,
  },
};

const CANDIDATE_INTEGRIDAD_INVITATION: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Siguiente paso: prueba de integridad',
    body_text: `Hola {{candidate_name}},

Próxima evaluación: integridad. Son escenarios laborales — responde honestamente, los analizamos en agregado (10-15 min):

{{test_url}}`,
    body_html: buildCandidateInvitationHtml({
      stageLabel: 'Prueba de integridad',
      candidateName: '{{candidate_name}}',
      jobTitle: '{{job_title}}',
      durationMin: '10-15 minutos',
      description: 'Próxima evaluación: integridad. Son escenarios reales del día a día laboral. Respondé honestamente — analizamos patrones, no respuestas individuales.',
      ctaText: 'Empezar prueba de integridad',
      testUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Next: integrity assessment',
    body_text: `Hi {{candidate_name}},\n\nIntegrity assessment (10-15 min):\n\n{{test_url}}`,
    body_html: `<p>Hi {{candidate_name}},</p><p><a href="{{test_url}}">Start integrity test</a></p>`,
  },
};

const CANDIDATE_VIDEO_INVITATION: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Última etapa: video respuestas',
    body_text: `Hola {{candidate_name}},

Última etapa antes de la entrevista. Vas a grabar respuestas cortas en video (1-2 min cada una) a preguntas específicas del puesto.

Total: 10-15 minutos.

{{test_url}}`,
    body_html: buildCandidateInvitationHtml({
      stageLabel: 'Video respuestas',
      candidateName: '{{candidate_name}}',
      jobTitle: '{{job_title}}',
      durationMin: '10-15 minutos',
      description: 'Última etapa antes de la entrevista. Vas a grabar respuestas cortas en video (1-2 min cada una) a preguntas específicas del puesto.',
      ctaText: 'Empezar video respuestas',
      testUrl: '{{test_url}}',
    }),
  },
  en: {
    subject: 'Final step: video responses',
    body_text: `Hi {{candidate_name}},\n\nFinal step: video responses (10-15 min):\n\n{{test_url}}`,
    body_html: `<p>Hi {{candidate_name}},</p><p><a href="{{test_url}}">Start video responses</a></p>`,
  },
};

const CANDIDATE_ENTREVISTA_INVITATION: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: '🎉 Avanzaste a entrevista para {{job_title}}',
    body_text: `Hola {{candidate_name}},

¡Buenas noticias! Avanzaste a entrevista para el puesto de {{job_title}}.

{{interview_details}}

Si necesitas reagendar, responde este email.

—
{{recruiter_name}}`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Avanzaste a entrevista 🎉</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937;">Hola {{candidate_name}}, ¡felicitaciones!</h1>
        <p style="margin:0 0 16px 0;">Pasaste todas las evaluaciones y avanzaste a entrevista para el puesto de <strong>{{job_title}}</strong>.</p>
        <div style="background:#f0fdf4;border-left:3px solid #166534;padding:16px;margin:16px 0;">{{interview_details}}</div>
        <p style="margin:24px 0 0 0; font-size:14px; color:#4b5563;">Si necesitas reagendar, responde este email.</p>
        <p style="margin:16px 0 0 0;">Saludos,<br/>{{recruiter_name}}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: '🎉 You advanced to interview for {{job_title}}',
    body_text: `Hi {{candidate_name}},\n\nYou passed all evaluations and advanced to interview.\n\n{{interview_details}}\n\nBest,\n{{recruiter_name}}`,
    body_html: `<p>Hi {{candidate_name}},</p><p>You advanced to interview for <strong>{{job_title}}</strong>.</p><p>{{interview_details}}</p>`,
  },
};

const CANDIDATE_REJECTED: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Sobre tu aplicación a {{job_title}}',
    body_text: `Hola {{candidate_name}},

Gracias por el tiempo que nos dedicaste evaluando para el puesto de {{job_title}}.

En esta búsqueda específica decidimos avanzar con otros candidatos. {{reason_note}}

Te dejamos en nuestra base de candidatos: si abrimos puestos donde encajes, te contactamos.

Te deseamos lo mejor en tu búsqueda.

—
SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f;">SHARKTALENTS</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <h1 style="margin:0 0 16px 0; font-size:20px; font-weight:bold;">Hola {{candidate_name}}</h1>
        <p style="margin:0 0 16px 0;">Gracias por el tiempo que nos dedicaste evaluando para el puesto de <strong>{{job_title}}</strong>.</p>
        <p style="margin:0 0 16px 0;">En esta búsqueda específica decidimos avanzar con otros candidatos. {{reason_note}}</p>
        <p style="margin:0 0 16px 0;">Te dejamos en nuestra base — si abrimos puestos donde encajes, te contactamos.</p>
        <p style="margin:0 0 16px 0;">Te deseamos lo mejor en tu búsqueda.</p>
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#9ca3af;">SharkTalents</div>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'About your application to {{job_title}}',
    body_text: `Hi {{candidate_name}},\n\nThanks for the time you invested. We decided to move forward with other candidates for this search. {{reason_note}}\n\nWe'll keep you in our database for future roles.\n\nBest of luck.`,
    body_html: `<p>Hi {{candidate_name}},</p><p>Thanks for the time you invested.</p><p>{{reason_note}}</p>`,
  },
};

const CANDIDATE_TEST_REMINDER: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Recordatorio: completá tu evaluación para {{job_title}}',
    body_text: `Hola {{candidate_name}},

Notamos que empezaste tu evaluación para el puesto de {{job_title}} pero no la completaste todavía.

El link sigue activo:

{{test_url}}

Si tienes problemas o ya no te interesa, responde este email así te sacamos del proceso.

—
SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Recordatorio</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <h1 style="margin:0 0 16px 0; font-size:20px; font-weight:bold;">Hola {{candidate_name}}</h1>
        <p style="margin:0 0 16px 0;">Notamos que empezaste tu evaluación para <strong>{{job_title}}</strong> pero no la completaste todavía.</p>
        <p style="margin:0 0 16px 0;">El link sigue activo:</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
          <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="{{test_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none;">Continuar evaluación</a>
          </td></tr>
        </table>
        <p style="margin:24px 0 0 0; font-size:13px; color:#6b7280;">Si ya no te interesa, responde este email así te sacamos del proceso.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'Reminder: complete your evaluation',
    body_text: `Hi {{candidate_name}},\n\nYou started but didn't complete your evaluation. Link still active:\n{{test_url}}`,
    body_html: `<p>Hi {{candidate_name}},</p><p><a href="{{test_url}}">Continue evaluation</a></p>`,
  },
};

// ============================================================
// Lead que entró desde Meta Ads / CRM — primera bienvenida
// (lead no compró todavía; lo invitamos a primera llamada)
// ============================================================

const META_LEAD_WELCOME: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Cris te contacta hoy — SharkTalents',
    body_text: `Hola {{contact_name}},

Recibimos tus datos.

Cris (la fundadora) te escribe HOY por WhatsApp con los detalles
y te manda acceso a una evaluación real para que la uses con un
candidato esta semana — sin compromiso.

Si quieres adelantar la conversación, agenda una llamada acá:
{{bookings_url}}

Cris Palma
SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background:#0e1218; padding:24px 32px; border-bottom:4px solid #dafd6f;">
        <h1 style="margin:0; color:#dafd6f; font-size:22px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">SharkTalents</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px 0; font-size:16px; color:#1f2937; line-height:1.6;">Hola <strong>{{contact_name}}</strong>,</p>
        <p style="margin:0 0 16px 0; font-size:16px; color:#1f2937; line-height:1.6;">Recibimos tus datos.</p>
        <p style="margin:0 0 20px 0; font-size:16px; color:#1f2937; line-height:1.6;">
          Cris (la fundadora) te escribe <strong>HOY por WhatsApp</strong> con los detalles
          y te manda acceso a una evaluación real para que la uses con un candidato
          esta semana — sin compromiso.
        </p>
        <p style="margin:0 0 12px 0; font-size:15px; color:#374151; line-height:1.6;">¿Prefieres adelantar la conversación? Agenda una llamada:</p>
        <p style="margin:0 0 28px 0;">
          <a href="{{bookings_url}}" style="background:#dafd6f;color:#0e1218;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:700;font-size:16px;">Agendar llamada</a>
        </p>
        <p style="margin:0; font-size:15px; color:#1f2937; line-height:1.5;">Cris Palma<br/><strong style="color:#0e1218;">SharkTalents</strong></p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'Cris contacts you today — SharkTalents',
    body_text: `Hi {{contact_name}},

We received your info.

Cris (the founder) is reaching out TODAY via WhatsApp with details
and sending you access to a real evaluation to use with a candidate
this week — no strings attached.

Want to skip ahead? Book a call:
{{bookings_url}}

Cris Palma
SharkTalents`,
    body_html: `<p>Hi <strong>{{contact_name}}</strong>,</p>
<p>We received your info. Cris (the founder) is reaching out <strong>TODAY via WhatsApp</strong> with details and access to a real evaluation to use this week — no strings attached.</p>
<p>Want to skip ahead? <a href="{{bookings_url}}" style="background:#dafd6f;color:#0e1218;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:700;font-size:16px;">Book a call</a></p>
<p>Cris Palma<br/>SharkTalents</p>`,
  },
};

// ============================================================
// Cliente — confirmación de "recibimos tus comentarios" en el draft
// ============================================================

const CLIENT_COMMENTS_RECEIVED: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Recibimos tus comentarios — {{job_title}}',
    body_text: `Hola {{client_name}},

Recibimos tus comentarios sobre el perfil de {{job_title}}.

Tus observaciones:
"{{client_comment}}"

Vamos a ajustarlo y te avisamos cuando esté listo para revisar de nuevo.

Cualquier duda, responde a este email.

Chris Palma
SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background:#0e1218; padding:24px 32px; border-bottom:4px solid #dafd6f;">
        <h1 style="margin:0; color:#dafd6f; font-size:22px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">SharkTalents</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px 0; font-size:16px; color:#1f2937; line-height:1.6;">Hola <strong>{{client_name}}</strong>,</p>
        <p style="margin:0 0 20px 0; font-size:16px; color:#1f2937; line-height:1.6;">Recibimos tus comentarios sobre el perfil de <strong>{{job_title}}</strong>.</p>
        <div style="background:#f9fafb; border-left:4px solid #dafd6f; padding:16px 20px; margin:0 0 24px 0; font-size:15px; color:#374151; line-height:1.6;">
          <p style="margin:0 0 6px 0; font-weight:600; font-size:13px; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px;">Tus observaciones</p>
          <p style="margin:0; font-style:italic;">"{{client_comment}}"</p>
        </div>
        <p style="margin:0 0 24px 0; font-size:16px; color:#1f2937; line-height:1.6;">Vamos a ajustarlo y te avisamos cuando esté listo para revisar de nuevo.</p>
        <p style="margin:0 0 24px 0; font-size:14px; color:#6b7280;">Cualquier duda, responde a este email.</p>
        <p style="margin:0; font-size:15px; color:#1f2937; line-height:1.5;">Chris Palma<br/><strong style="color:#0e1218;">SharkTalents</strong></p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'We received your feedback — {{job_title}}',
    body_text: `Hi {{client_name}},\n\nWe received your feedback on the {{job_title}} profile. We'll adjust and let you know when ready.\n\nChris Palma\nSharkTalents`,
    body_html: `<p>Hi <strong>{{client_name}}</strong>,</p><p>We received your feedback on <strong>{{job_title}}</strong>. We'll adjust and let you know when ready.</p><p>Chris Palma<br/>SharkTalents</p>`,
  },
};

// ============================================================
// Cliente — "Hicimos los cambios que pediste, revisá de nuevo"
// ============================================================

const CLIENT_CHANGES_APPLIED: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Aplicamos tus cambios — {{job_title}} listo para revisar',
    body_text: `Hola {{client_name}},

Aplicamos los cambios que nos pediste en el perfil de {{job_title}}. Está listo para revisar de nuevo.

Revisa la nueva versión:
{{portal_url}}

Si todo está bien, apruébalo desde el portal y arrancamos la búsqueda. Si necesitas ajustar algo más, déjanos otro comentario.

Chris Palma
SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background:#0e1218; padding:24px 32px; border-bottom:4px solid #dafd6f;">
        <h1 style="margin:0; color:#dafd6f; font-size:22px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">SharkTalents</h1>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px 0; font-size:16px; color:#1f2937; line-height:1.6;">Hola <strong>{{client_name}}</strong>,</p>
        <p style="margin:0 0 20px 0; font-size:16px; color:#1f2937; line-height:1.6;">Aplicamos los cambios que nos pediste en el perfil de <strong>{{job_title}}</strong>. Está listo para revisar de nuevo.</p>
        <p style="margin:0 0 28px 0;">
          <a href="{{portal_url}}" style="background:#dafd6f;color:#0e1218;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:700;font-size:16px;">Revisar nueva versión</a>
        </p>
        <p style="margin:0 0 16px 0; font-size:15px; color:#374151; line-height:1.6;">Si todo está bien, apruébalo desde el portal y arrancamos la búsqueda. Si necesitas ajustar algo más, déjanos otro comentario.</p>
        <p style="margin:24px 0 0 0; font-size:15px; color:#1f2937; line-height:1.5;">Chris Palma<br/><strong style="color:#0e1218;">SharkTalents</strong></p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'Changes applied — {{job_title}} ready to review',
    body_text: `Hi {{client_name}},\n\nWe applied your changes to {{job_title}}. Ready to review:\n{{portal_url}}\n\nChris Palma\nSharkTalents`,
    body_html: `<p>Hi <strong>{{client_name}}</strong>,</p><p>We applied your changes to <strong>{{job_title}}</strong>. Ready to review.</p><p><a href="{{portal_url}}" style="background:#dafd6f;color:#0e1218;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:700;font-size:16px;">Review new version</a></p><p>Chris Palma<br/>SharkTalents</p>`,
  },
};

export const TEMPLATES = {
  // Cliente — vía ZeptoMail
  client_report_ready: CLIENT_REPORT_READY,
  client_portal_access: CLIENT_PORTAL_ACCESS,
  client_draft_review: CLIENT_DRAFT_REVIEW,
  client_search_started: CLIENT_SEARCH_STARTED,
  client_funnel_active: CLIENT_FUNNEL_ACTIVE,
  // Candidato — invitaciones por etapa
  candidate_prescreening_invitation: CANDIDATE_PRESCREENING_INVITATION,
  candidate_tecnica_invitation: CANDIDATE_TECNICA_INVITATION,
  candidate_disc_invitation: CANDIDATE_DISC_INVITATION,
  candidate_integridad_invitation: CANDIDATE_INTEGRIDAD_INVITATION,
  candidate_video_invitation: CANDIDATE_VIDEO_INVITATION,
  candidate_entrevista_invitation: CANDIDATE_ENTREVISTA_INVITATION,
  candidate_rejected: CANDIDATE_REJECTED,
  candidate_test_reminder: CANDIDATE_TEST_REMINDER,
  // Interno (a Cris)
  recruiter_client_changes_requested: RECRUITER_CLIENT_CHANGES_REQUESTED,
  recruiter_alert: RECRUITER_ALERT,
  // Candidato — único caso directo (reenvío de link bajo demanda; el resto via Recruit)
  recovery_link: RECOVERY_LINK,
  candidate_application_received: CANDIDATE_APPLICATION_RECEIVED, // alias legacy → prefilter
  candidate_prefilter_start: CANDIDATE_PREFILTER_START,
  candidate_tecnica_start: CANDIDATE_TECNICA_START,
  candidate_conductual_start: CANDIDATE_CONDUCTUAL_START,
  candidate_integridad_start: CANDIDATE_INTEGRIDAD_START,
  candidate_video_start: CANDIDATE_VIDEO_START,
  // Marketing funnel
  marketing_deletion_request: MARKETING_DELETION_REQUEST,
  marketing_demo_test_link: MARKETING_DEMO_TEST_LINK,
  marketing_finalist_test_link: MARKETING_FINALIST_TEST_LINK,
  marketing_lead_thanks: MARKETING_LEAD_THANKS,
  marketing_demo_report_ready: MARKETING_DEMO_REPORT_READY,
  marketing_fit_report: MARKETING_FIT_REPORT,
  meta_lead_welcome: META_LEAD_WELCOME,
  client_comments_received: CLIENT_COMMENTS_RECEIVED,
  client_changes_applied: CLIENT_CHANGES_APPLIED,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function getTemplate(key: TemplateKey, locale: EmailLocale = 'es'): EmailTemplate {
  return TEMPLATES[key][locale];
}

/**
 * Versión async que primero chequea overrides en BD (tabla EmailOverrides).
 *
 * Permite a Cris editar templates desde el admin UI sin redeploy. Si no hay
 * override, cae al template hardcoded de `TEMPLATES`.
 *
 * Tolerante a tabla ausente: si la tabla no existe, usa el default (el code path
 * normal ya funciona sin esta capa).
 */
export async function getTemplateWithOverride(
  req: import('http').IncomingMessage,
  key: TemplateKey,
  locale: EmailLocale = 'es',
  tenantId?: string | null,
): Promise<EmailTemplate> {
  const fallback = TEMPLATES[key][locale];
  try {
    const { zcql } = await import('./db.js');
    const { escapeSql, unwrapRows } = await import('./dbHelpers.js');
    // Prioridad: tenant-specific override > global override > default code
    const conditions: string[] = [
      `template_key = '${escapeSql(key)}'`,
      `locale = '${escapeSql(locale)}'`,
    ];
    if (tenantId) {
      // Buscar tenant-specific primero
      const tenantRows = unwrapRows<{ subject: string | null; body_html: string | null; body_text: string | null }>(
        (await zcql(req).executeZCQLQuery(
          `SELECT subject, body_html, body_text FROM EmailOverrides
           WHERE ${conditions.join(' AND ')} AND tenant_id = '${escapeSql(tenantId)}' LIMIT 1`,
        )) as unknown[],
        'EmailOverrides',
      );
      if (tenantRows[0]) {
        return {
          subject: tenantRows[0].subject ?? fallback.subject,
          body_html: tenantRows[0].body_html ?? fallback.body_html,
          body_text: tenantRows[0].body_text ?? fallback.body_text,
        };
      }
    }
    // Global override (tenant_id = null)
    const globalRows = unwrapRows<{ subject: string | null; body_html: string | null; body_text: string | null }>(
      (await zcql(req).executeZCQLQuery(
        `SELECT subject, body_html, body_text FROM EmailOverrides
         WHERE ${conditions.join(' AND ')} AND tenant_id IS NULL LIMIT 1`,
      )) as unknown[],
      'EmailOverrides',
    );
    if (globalRows[0]) {
      return {
        subject: globalRows[0].subject ?? fallback.subject,
        body_html: globalRows[0].body_html ?? fallback.body_html,
        body_text: globalRows[0].body_text ?? fallback.body_text,
      };
    }
  } catch { /* tabla no existe o query falló → usar default */ }
  return fallback;
}
