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

Cualquier comentario lo podés dejar directamente en el reporte y me llega notificación.

Saludos,
{{recruiter_name}}`,
    body_html: `<p>Hola <strong>{{client_name}}</strong>,</p>
<p>Tu reporte de finalistas para <strong>{{job_title}}</strong> está listo.</p>
<p>Incluí <strong>{{finalist_count}} candidatos top</strong> con análisis comparativo de DISC, capacidad cognitiva, integridad y nivel técnico.</p>
<p><a href="{{report_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Ver reporte</a></p>
<p style="color:#666;font-size:14px;">Cualquier comentario lo podés dejar directamente en el reporte y me llega notificación.</p>
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
// Marketing funnel — thank-you al lead cuando deja sus datos
// ============================================================

const MARKETING_LEAD_THANKS: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Tus 2 evaluaciones gratuitas están listas',
    body_text: `SharkTalents

Hola{{contact_name_prefix}},

Acabas de dar el primer paso para contratar con datos, no con intuición.

Estas dos evaluaciones te van a mostrar cómo piensa, cómo se comporta en equipo y qué tan confiable es la persona que evalúes — antes de que firme contigo.

Evaluación conductual — DISC + capacidad cognitiva (~30-40 min):
{{conductual_url}}

Evaluación de integridad (~20-30 min):
{{integridad_url}}

Puedes hacerlas tú mismo o reenviar este email a quien quieras evaluar. Cuando se completen las dos, el reporte llega automáticamente.

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
            <h1 style="margin:0 0 20px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">Tus 2 evaluaciones gratuitas están listas</h1>
            <p style="margin:0 0 16px 0;">Hola{{contact_name_prefix}},</p>
            <p style="margin:0 0 16px 0;">Acabas de dar el primer paso para contratar con datos, no con intuición.</p>
            <p style="margin:0 0 28px 0;">Estas dos evaluaciones te van a mostrar cómo piensa, cómo se comporta en equipo y qué tan confiable es la persona que evalúes — antes de que firme contigo.</p>

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

            <p style="margin:0;">Puedes hacerlas tú mismo o reenviar este email a quien quieras evaluar. Cuando se completen las dos, el reporte llega automáticamente.</p>
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

const CANDIDATE_APPLICATION_RECEIVED: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Recibimos tu aplicación a {{job_title}}',
    body_text: `Hola {{candidate_name}},

Recibimos tu aplicación al puesto de {{job_title}} en {{company}}.

El siguiente paso es completar una evaluación corta que combina:
- Perfil conductual (DISC + capacidad cognitiva, ~25 min)
- Integridad (~15 min)
- Prueba técnica (varía según el rol)

Podés hacer las pruebas en el orden que prefieras desde este link:
{{test_url}}

El link es personal y válido por 14 días. Si necesitás más tiempo o un link nuevo, respondé este email.

Cualquier duda, escribinos a este correo.

—
Equipo SharkTalents`,
    body_html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6; margin:0; padding:0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
      <tr><td style="background-color:#0e1218; padding:28px 40px; border-bottom:4px solid #dafd6f;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:24px; font-weight:bold; color:#dafd6f; letter-spacing:1px;">SHARKTALENTS</div>
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8a93a3; margin-top:4px;">Una evaluación con criterio.</div>
      </td></tr>
      <tr><td style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#1f2937;">
        <div style="display:inline-block; background-color:#dcfce7; color:#166534; font-size:12px; font-weight:bold; padding:4px 12px; border-radius:99px; margin-bottom:16px; letter-spacing:0.5px;">APLICACIÓN RECIBIDA</div>
        <h1 style="margin:0 0 16px 0; font-size:22px; font-weight:bold; color:#1f2937; line-height:1.3;">Hola {{candidate_name}}, recibimos tu aplicación</h1>
        <p style="margin:0 0 16px 0;">Aplicaste al puesto de <strong>{{job_title}}</strong> en <strong>{{company}}</strong>.</p>
        <p style="margin:0 0 24px 0;">El siguiente paso es completar una evaluación corta que nos ayuda a entender tu perfil:</p>
        <ul style="margin:0 0 24px 0; padding-left:20px; color:#374151;">
          <li style="margin-bottom:6px;"><strong>Perfil conductual</strong> (DISC + capacidad cognitiva, ~25 min)</li>
          <li style="margin-bottom:6px;"><strong>Integridad</strong> (~15 min)</li>
          <li style="margin-bottom:6px;"><strong>Prueba técnica</strong> (varía según el rol)</li>
        </ul>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
          <tr><td align="center" style="background-color:#dafd6f; border-radius:6px; padding:14px 32px;">
            <a href="{{test_url}}" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#1f2937; text-decoration:none; display:inline-block;">Empezar mis pruebas</a>
          </td></tr>
        </table>
        <p style="margin:0 0 8px 0; font-size:13px; color:#6b7280;">El link es personal y válido por 14 días. Podés hacer las pruebas en el orden que prefieras.</p>
        <p style="margin:24px 0 0 0; font-size:14px; color:#4b5563;">¿Algún problema? Respondé este email y te ayudamos.</p>
      </td></tr>
      <tr><td style="background-color:#f9fafb; padding:20px 40px; border-top:1px solid #e5e7eb; text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#6b7280; line-height:1.6;">
          <strong style="color:#1f2937;">Equipo SharkTalents</strong>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  },
  en: {
    subject: 'We received your application for {{job_title}}',
    body_text: `Hi {{candidate_name}},

We received your application for {{job_title}} at {{company}}.

Next step is a short evaluation that combines:
- Behavioral profile (DISC + cognitive ability, ~25 min)
- Integrity (~15 min)
- Technical test (varies by role)

Start your tests here (link valid 14 days):
{{test_url}}

Reply to this email if you need a new link or more time.

Best,
SharkTalents Team`,
    body_html: `<p>Hi {{candidate_name}},</p>
<p>We received your application for <strong>{{job_title}}</strong> at <strong>{{company}}</strong>.</p>
<p><a href="{{test_url}}" style="background:#dafd6f;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start my tests</a></p>
<p style="color:#666;font-size:14px;">Link valid for 14 days.</p>
<p>Best,<br/><em>SharkTalents Team</em></p>`,
  },
};

const CLIENT_DRAFT_REVIEW: Record<EmailLocale, EmailTemplate> = {
  es: {
    subject: 'Necesitamos tu aprobación: perfil del puesto {{job_title}}',
    body_text: `Hola {{client_name}},

Después de nuestra reunión armamos el perfil del puesto {{job_title}} y queremos asegurarnos de que está alineado con lo que necesitás antes de empezar a buscar candidatos.

Revisalo y decinos si lo aprobás o si necesitamos ajustarlo:
{{portal_url}}

El link es válido por 30 días. Si tenés dudas, respondé este email.

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
        <p style="margin:0 0 16px 0;">Después de nuestra reunión armamos el perfil del puesto <strong>{{job_title}}</strong> y queremos confirmar que está alineado con lo que necesitás antes de empezar la búsqueda.</p>
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

export const TEMPLATES = {
  // Cliente — vía ZeptoMail
  client_report_ready: CLIENT_REPORT_READY,
  client_portal_access: CLIENT_PORTAL_ACCESS,
  client_draft_review: CLIENT_DRAFT_REVIEW,
  // Candidato — único caso directo (reenvío de link bajo demanda; el resto via Recruit)
  recovery_link: RECOVERY_LINK,
  candidate_application_received: CANDIDATE_APPLICATION_RECEIVED,
  // Marketing funnel
  marketing_deletion_request: MARKETING_DELETION_REQUEST,
  marketing_demo_test_link: MARKETING_DEMO_TEST_LINK,
  marketing_lead_thanks: MARKETING_LEAD_THANKS,
  marketing_demo_report_ready: MARKETING_DEMO_REPORT_READY,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function getTemplate(key: TemplateKey, locale: EmailLocale = 'es'): EmailTemplate {
  return TEMPLATES[key][locale];
}
