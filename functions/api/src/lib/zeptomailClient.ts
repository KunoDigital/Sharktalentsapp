/**
 * Cliente de ZeptoMail (Zoho transactional email). Reemplaza Postmark/SendGrid —
 * incluido en Zoho One de Cris.
 *
 * Reuses la infra de fetchWithTimeout + circuitBreaker para evitar function muerta
 * si ZeptoMail está caído.
 *
 * Docs API: https://www.zoho.com/zeptomail/help/api/email-sending-api.html
 *
 * Env vars requeridas:
 *   ZEPTOMAIL_API_TOKEN — empieza con "Zoho-enczapikey ..."
 *   ZEPTOMAIL_FROM_EMAIL — ej "noreply@sharktalents.ai"
 *   ZEPTOMAIL_FROM_NAME — ej "SharkTalents"
 *
 * NOTA: ZeptoMail tiene 2 modos:
 *   1. Send con HTML/text body (lo que usamos por default)
 *   2. Send con template_key (template prediseñada en ZeptoMail UI)
 *
 * Para v1 usamos modo 1 (HTML inline). Templates las podemos migrar después.
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { withBreaker } from './circuitBreaker';
import { logger } from './logger';

const log = logger('ZEPTOMAIL');

const ZEPTOMAIL_API_URL = 'https://api.zeptomail.com/v1.1/email';

export type ZeptoMailRecipient = {
  email: string;
  name?: string;
};

export type ZeptoMailSendInput = {
  /** Destinatario(s). */
  to: ZeptoMailRecipient | ZeptoMailRecipient[];
  /** Subject del email. */
  subject: string;
  /** Body HTML. ZeptoMail acepta HTML inline. */
  htmlBody: string;
  /** Body en plano (fallback para clientes que no renderizan HTML). Opcional. */
  textBody?: string;
  /** Reply-to opcional. */
  replyTo?: ZeptoMailRecipient;
  /** Trace ID para correlacionar con logs. */
  traceId?: string;
  /** URL/mailto para el List-Unsubscribe header (CAN-SPAM compliance + deliverability). */
  unsubscribeUrl?: string;
};

/**
 * Envuelve un fragmento HTML en un documento HTML válido si todavía no lo tiene.
 * Fix de deliverability: mail-tester penaliza HTML que no tiene <html> tag.
 */
function ensureFullHtmlDocument(htmlFragment: string, subject: string): string {
  const trimmed = htmlFragment.trim();
  if (/^<!DOCTYPE/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return htmlFragment;
  }
  // Escape básico del subject para meta title
  const safeTitle = subject.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c));
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6;">
${htmlFragment}
</body>
</html>`;
}

/**
 * Deriva una versión text/plain razonable desde HTML cuando el caller no la provee.
 * No es perfecto pero evita el penalty de "HTML-only message".
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type ZeptoMailSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; status?: number };

/**
 * Envía un email transaccional via ZeptoMail.
 *
 * Falla suave: si ZEPTOMAIL_API_TOKEN no está seteado, devuelve error sin lanzar.
 * Idea: el caller (outbox dispatcher) decide si reintentar o marcar failed.
 */
export async function sendZeptoMail(input: ZeptoMailSendInput): Promise<ZeptoMailSendResult> {
  const token = process.env.ZEPTOMAIL_API_TOKEN;
  const fromEmail = process.env.ZEPTOMAIL_FROM_EMAIL;
  const fromName = process.env.ZEPTOMAIL_FROM_NAME ?? 'SharkTalents';

  if (!token) {
    return { ok: false, error: 'ZEPTOMAIL_API_TOKEN not configured' };
  }
  if (!fromEmail) {
    return { ok: false, error: 'ZEPTOMAIL_FROM_EMAIL not configured' };
  }

  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  if (recipients.length === 0) {
    return { ok: false, error: 'no recipients' };
  }

  // Asegurar documento HTML válido + version text/plain (fixes mail-tester penalties)
  const htmlFull = ensureFullHtmlDocument(input.htmlBody, input.subject);
  const textFinal = input.textBody && input.textBody.trim().length > 0
    ? input.textBody
    : htmlToPlainText(input.htmlBody);

  // NOTA: ZeptoMail v1.1 API NO acepta headers custom (List-Unsubscribe, etc) en el JSON
  // del send endpoint. Devuelve "Bad Syntax" si se intenta. Para agregarlos hay que usar
  // ZeptoMail Templates (UI) o cambiar a otro provider. Por ahora omitimos — el penalty
  // de -0.5 en mail-tester por List-Unsubscribe es aceptable para el volumen actual.

  const body = {
    from: { address: fromEmail, name: fromName },
    to: recipients.map((r) => ({ email_address: { address: r.email, name: r.name ?? r.email } })),
    subject: input.subject,
    htmlbody: htmlFull,
    textbody: textFinal,
    reply_to: input.replyTo
      ? [{ address: input.replyTo.email, name: input.replyTo.name ?? input.replyTo.email }]
      : undefined,
  };

  log.info('sending email', {
    traceId: input.traceId,
    to_count: recipients.length,
    subject: input.subject.slice(0, 60),
  });

  try {
    const result = await withBreaker(
      { name: 'zeptomail', threshold: 5, cooldownMs: 60_000 },
      async () => {
        const response = await fetchWithTimeout(ZEPTOMAIL_API_URL, {
          method: 'POST',
          headers: {
            // ZeptoMail token already includes "Zoho-enczapikey " prefix
            Authorization: token,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          timeoutMs: 15_000,
        });

        const text = await response.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Si no es JSON, usar el texto como mensaje de error
        }

        if (!response.ok) {
          const errorMsg = (parsed as { message?: string })?.message ?? text.slice(0, 200);
          throw new Error(`ZeptoMail HTTP ${response.status}: ${errorMsg}`);
        }

        const data = parsed as { data?: Array<{ message_id?: string }>; request_id?: string };
        const messageId = data.data?.[0]?.message_id ?? data.request_id ?? 'unknown';
        return messageId;
      },
    );

    log.info('email sent', { traceId: input.traceId, messageId: result });
    return { ok: true, messageId: result };
  } catch (err) {
    log.warn('email send failed', {
      traceId: input.traceId,
      error: (err as Error).message,
    });
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Helper para wrapping HTML simple sin template engine. Usar para emails básicos.
 * Si necesitás algo más sofisticado (variables, layouts), usar template_key de ZeptoMail.
 */
export function simpleEmailHtml(opts: {
  greeting?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  signature?: string;
}): string {
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<p style="margin: 24px 0;"><a href="${opts.ctaUrl}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">${opts.ctaLabel}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SharkTalents</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1f2937;">
  ${opts.greeting ? `<p>${opts.greeting}</p>` : ''}
  <div>${opts.body}</div>
  ${cta}
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
  <p style="color: #6b7280; font-size: 14px;">${opts.signature ?? 'SharkTalents'}</p>
</body>
</html>`;
}
