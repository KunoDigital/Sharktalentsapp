/**
 * Slack notifications client — para alertas internas del equipo (no a candidatos).
 *
 * Usa Slack Incoming Webhooks (URL específica por canal). Más simple que Slack API
 * tradicional — no requiere OAuth, solo una URL de webhook.
 *
 * Casos de uso:
 *   - Cris recibe ping cuando un candidato es auto-rejected
 *   - Cuando aparece un finalist nuevo
 *   - Cuando el bot decisor flagea low confidence
 *   - Cuando falla un deploy o un cron job
 *
 * Setup en Slack:
 *   1. Slack workspace → Apps → Create New App → From Scratch
 *   2. Activate "Incoming Webhooks"
 *   3. Add New Webhook to Workspace → seleccionar canal (#sharktalents-alerts)
 *   4. Copiar la URL (queda hardcoded a ese canal)
 *   5. Pegar en Catalyst Console env var: SLACK_WEBHOOK_URL
 *
 * Docs: https://api.slack.com/messaging/webhooks
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { logger } from './logger';

const log = logger('SLACK');

export type SlackBlock =
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' }
  | { type: 'header'; text: { type: 'plain_text'; text: string } }
  | {
      type: 'context';
      elements: Array<{ type: 'mrkdwn'; text: string }>;
    };

export type SlackMessage = {
  /** Texto plano (fallback). */
  text: string;
  /** Blocks (UI rica) — opcional. */
  blocks?: SlackBlock[];
  /** Channel override (solo funciona si el webhook tiene scope amplio). */
  channel?: string;
  /** Username/icon override del bot. */
  username?: string;
  /** Emoji icon (ej ':robot_face:') */
  icon_emoji?: string;
};

export type SlackResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Envía un mensaje a Slack via webhook. Best-effort — si falla, no throw.
 *
 * @param message Mensaje a enviar
 * @param traceId Para correlación con logs
 */
export async function sendSlackMessage(
  message: SlackMessage,
  traceId = '',
): Promise<SlackResult> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, error: 'SLACK_WEBHOOK_URL not configured' };
  }

  try {
    const response = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      timeoutMs: 10_000,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn('Slack webhook failed', {
        traceId,
        status: response.status,
        error: errorText.slice(0, 200),
      });
      return { ok: false, error: `Slack HTTP ${response.status}` };
    }

    log.info('Slack message sent', { traceId, length: message.text.length });
    return { ok: true };
  } catch (err) {
    log.warn('Slack webhook threw', {
      traceId,
      error: (err as Error).message,
    });
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Helper: notifica un finalist nuevo a Slack con formato bonito.
 */
export async function notifyFinalist(
  args: {
    candidateName: string;
    jobTitle: string;
    affinity: number;
    appUrl: string;
  },
  traceId = '',
): Promise<SlackResult> {
  return sendSlackMessage(
    {
      text: `🎯 Nuevo finalist: ${args.candidateName} para ${args.jobTitle}`,
      username: 'SharkTalents',
      icon_emoji: ':shark:',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🎯 Nuevo finalist disponible' },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${args.candidateName}* para *${args.jobTitle}*\n_Afinidad: ${args.affinity}%_`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `<${args.appUrl}|Ver detalle del candidato>` },
          ],
        },
      ],
    },
    traceId,
  );
}

/**
 * Helper: notifica auto-rejection a Slack.
 */
export async function notifyAutoRejected(
  args: {
    candidateName: string;
    jobTitle: string;
    reasons: string[];
  },
  traceId = '',
): Promise<SlackResult> {
  return sendSlackMessage(
    {
      text: `⚠️ Auto-rejected: ${args.candidateName} (${args.jobTitle})`,
      username: 'SharkTalents',
      icon_emoji: ':no_entry_sign:',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${args.candidateName}* fue auto-rechazado para *${args.jobTitle}*`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Razones:*\n' + args.reasons.map((r) => `• ${r}`).join('\n'),
          },
        },
      ],
    },
    traceId,
  );
}
