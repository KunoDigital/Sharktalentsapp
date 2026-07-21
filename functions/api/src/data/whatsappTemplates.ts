/**
 * Templates de WhatsApp Business para SharkTalents V2 (parte comercial).
 *
 * Pivot 2026-06-10:
 *   - V2 cubre lado COMERCIAL (lead → agenda → draft → contrato)
 *   - V1 sigue siendo el productivo para CANDIDATOS
 *   - Bot Ari = asistente virtual de SharkTalents, identificación clara en todos los mensajes
 *   - Chat automático, primeros 2 mensajes aclaran "no responder aquí"
 *
 * IMPORTANTE: estos NO son los templates en sí — son los nombres + texto + params para
 * referencia del código. Los templates REALES tienen que ser creados y aprobados en
 * Twilio Content Builder, Twilio los manda a Meta para aprobación (1-24h cada uno).
 *
 * Una vez aprobados:
 *   1. Twilio genera un Content SID (HXxxxxx) por cada uno
 *   2. Lo mapeas acá en el campo `twilio_content_sid` para que el outbox pueda usarlo
 *   3. El dispatcher (whatsappDispatcher) usa Content SID en producción
 *
 * Reglas Meta cumplidas en TODOS:
 *   - lowercase + underscores en nombres
 *   - variables secuenciales {{1}}, {{2}}, {{3}}
 *   - no empiezan ni terminan con variable
 *   - body < 1024 chars (todos < 400)
 *   - footer < 60 chars, sin emojis
 *   - identificación de empresa (SharkTalents)
 *   - UTILITY = transaccional puro, MARKETING = promocional
 *   - URLs en variables (HTTPS, verificables — regla nueva 2026)
 */

export type WhatsAppTemplateDef = {
  /** Nombre exacto del template en Twilio Content Builder + Meta. lowercase + underscores. */
  name: string;
  /** Categoría según Meta: UTILITY (transaccional ~$0.04), MARKETING (promo ~$0.10), AUTHENTICATION (OTP). */
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  /** Cuándo se usa este template en el flujo comercial V2. */
  use_case: string;
  /** Idiomas aprobados. */
  languages: ('es' | 'en')[];
  /** Parámetros que espera el body (en orden de aparición). */
  params: Array<{ name: string; example: string }>;
  /** Texto del body en español (copy/paste a Twilio Content Builder). */
  template_text_es: string;
  /** Footer del template (max 60 chars, sin emojis). */
  footer_es?: string;
  /** Twilio Content SID (HXxxxxx) — se llena DESPUÉS de aprobar el template en Twilio.
   *  Hasta entonces el outbox falla en producción con "content_sid not set". */
  twilio_content_sid?: string;
};

/**
 * Templates V2 (parte comercial). 7 totales: 3 MARKETING + 4 UTILITY.
 *
 * NO incluye templates de candidatos (V1 los maneja).
 */
export const WHATSAPP_TEMPLATES: Record<string, WhatsAppTemplateDef> = {
  // ==================== MARKETING (~$0.10/msg) ====================

  meta_lead_welcome: {
    name: 'meta_lead_welcome',
    category: 'MARKETING',
    use_case: 'Cliente entra desde Meta Ad → primer contacto. Asistente Ari se presenta. Botón CTA agenda Zoho Bookings.',
    languages: ['es'],
    params: [
      { name: 'client_name', example: 'Carlos' },
    ],
    template_text_es: `Hola {{1}}, soy Ari, tu asistente virtual de SharkTalents. Vi que te interesa evaluar candidatos con IA. Por este chat te enviaré las novedades de tu cuenta. Para conocer en detalle nuestro servicio, precios y ver una demo, agenda 30 min con un asesor. Este chat es automático, por favor no respondas aquí. Saludos.`,
    footer_es: 'Canal automatico. Agenda para hablar con asesor.',
    // Twilio Content SID (submitted 2026-06-10, esperando aprobación Meta business-initiated).
    twilio_content_sid: 'HX848f3b9630dff9aa49bb98da70c8de3a',
    // Botón CTA URL FIJO (no variable). El link de Zoho Bookings es el mismo para todos los leads.
    // Button text: "Agenda una llamada"
    // Button URL: https://kunodigital.zohobookings.com/#/4313826000006...
  },

  marketing_lead_thanks: {
    name: 'marketing_lead_thanks',
    category: 'MARKETING',
    use_case: 'Cliente llenó formulario/quiz en la landing → gracias + link de demo + link agenda.',
    languages: ['es'],
    params: [
      { name: 'client_name', example: 'Carlos' },
      { name: 'demo_link', example: 'https://app.sharktalents.ai/demo/abc123' },
      { name: 'booking_link', example: 'https://bookings.zoho.com/sharktalents' },
    ],
    template_text_es: `Hola {{1}}, soy Ari, tu asistente virtual de SharkTalents. Gracias por completar el cuestionario. Aquí está el link de tu demo: {{2}}. Para conversar con un asesor y conocer nuestros precios, agenda 30 min aquí: {{3}}. Este chat es automático, por favor no respondas aquí. Saludos.`,
    footer_es: 'Canal automatico. Agenda para hablar con asesor.',
  },

  // ==================== UTILITY (~$0.04/msg) ====================

  client_briefing_scheduled: {
    name: 'client_briefing_scheduled',
    category: 'UTILITY',
    use_case: 'Cliente agendó briefing → confirma fecha y manda link de videollamada (Zoho Meeting).',
    languages: ['es'],
    params: [
      { name: 'client_name', example: 'Carlos' },
      { name: 'date_time', example: 'martes 12 de junio a las 10:00 AM' },
      { name: 'meeting_link', example: 'https://meet.zoho.com/abc123' },
    ],
    template_text_es: `Hola {{1}}, soy Ari. Confirmo tu reunión de briefing para el {{2}}. El link de la videollamada es: {{3}}. Te esperamos puntual. Si necesitas cambiarla, agenda nuevamente desde el portal. Saludos.`,
    footer_es: 'Canal automatico. Para soporte, agenda con asesor.',
  },

  client_draft_review: {
    name: 'client_draft_review',
    category: 'UTILITY',
    use_case: 'Draft del puesto generado por IA → cliente debe revisar y comentar/aprobar en portal.',
    languages: ['es'],
    params: [
      { name: 'client_name', example: 'Carlos' },
      { name: 'job_title', example: 'Gerente de Ventas' },
      { name: 'portal_link', example: 'https://app.sharktalents.ai/portal/abc/draft/xyz' },
    ],
    template_text_es: `Hola {{1}}, soy Ari. Ya está listo el perfil de cargo para {{2}}. Por favor revísalo y déjanos saber tus comentarios en este link: {{3}}. Cuando lo apruebes te enviaremos el contrato para iniciar. Saludos.`,
    footer_es: 'Canal automatico. Para soporte, agenda con asesor.',
  },

  client_comments_received: {
    name: 'client_comments_received',
    category: 'UTILITY',
    use_case: 'Cliente dejó comentarios en el draft → confirmación de recepción.',
    languages: ['es'],
    params: [
      { name: 'client_name', example: 'Carlos' },
      { name: 'job_title', example: 'Gerente de Ventas' },
    ],
    template_text_es: `Hola {{1}}, soy Ari. Recibimos tus comentarios sobre el perfil de {{2}}. Nuestro equipo los está revisando para ajustar el draft. Te aviso cuando esté listo para que lo revises de nuevo. Saludos.`,
    footer_es: 'Canal automatico. Para soporte, agenda con asesor.',
  },

  client_changes_applied: {
    name: 'client_changes_applied',
    category: 'UTILITY',
    use_case: 'Cambios al draft aplicados según comentarios del cliente → cliente debe re-revisar.',
    languages: ['es'],
    params: [
      { name: 'client_name', example: 'Carlos' },
      { name: 'job_title', example: 'Gerente de Ventas' },
      { name: 'portal_link', example: 'https://app.sharktalents.ai/portal/abc/draft/xyz' },
    ],
    template_text_es: `Hola {{1}}, soy Ari. Ya aplicamos los cambios al perfil de {{2}} según tus comentarios. Por favor revísalo aquí: {{3}}. Si todo está OK, lo apruebas y te enviamos el contrato para iniciar. Saludos.`,
    footer_es: 'Canal automatico. Para soporte, agenda con asesor.',
  },

  client_contract_ready: {
    name: 'client_contract_ready',
    category: 'UTILITY',
    use_case: 'Contrato enviado a Zoho Sign → notifica al cliente que revise su email (link de firma).',
    languages: ['es'],
    params: [
      { name: 'client_name', example: 'Carlos' },
    ],
    template_text_es: `Hola {{1}}, soy Ari. Te enviamos el contrato a tu correo. Por favor revísalo y fírmalo desde el link de Zoho Sign. Si no lo ves en la bandeja principal, busca en spam o promociones. Cualquier duda, escribe a Chris Palma al +50763333870.`,
    footer_es: 'Canal automatico. Chris Palma: +50763333870.',
  },

  // ==================== CANDIDATO (UTILITY, aprobados 2026-07-17) ====================
  // Paralelos a los templates de email en emailTemplates.ts. Se disparan desde
  // candidateNotifier cuando el candidato transiciona entre fases. Categoría UTILITY
  // porque son transaccionales (proceso de aplicación).

  candidate_tecnica_start_wa: {
    name: 'candidate_tecnica_start_wa',
    category: 'UTILITY',
    use_case: 'Candidato pasó prescreening → invitación a la prueba técnica.',
    languages: ['es'],
    params: [
      { name: 'candidate_name', example: 'María' },
      { name: 'job_title', example: 'Gerente de Marca' },
      { name: 'test_link', example: 'https://app.sharktalents.ai/test/abc123' },
    ],
    template_text_es: `Hola {{1}}, superaste el prescreening para {{2}} y avanzas a la prueba técnica. Necesitas una computadora y entre 30 y 40 minutos sin interrupciones. Comienza aquí: {{3}}. Éxitos. Si tienes alguna duda escribe al correo RRHH@sharktalents.ai.`,
    twilio_content_sid: 'HX22721aa379af6e19d40ab908cc77fb6b',
  },

  candidate_conductual_start_wa: {
    name: 'candidate_conductual_start_wa',
    category: 'UTILITY',
    use_case: 'Candidato pasó la técnica → invitación a la evaluación conductual (DISC+VELNA+Emoción).',
    languages: ['es'],
    params: [
      { name: 'candidate_name', example: 'María' },
      { name: 'job_title', example: 'Gerente de Marca' },
      { name: 'test_link', example: 'https://app.sharktalents.ai/test/abc123' },
    ],
    template_text_es: `Hola {{1}}, avanzas a la siguiente etapa para {{2}}: prueba conductual y de cognición, unos 20 minutos. Comienza aquí: {{3}}. Éxitos. Si tienes alguna duda escribe al correo RRHH@sharktalents.ai.`,
    twilio_content_sid: 'HXac086904a5d674b57b15ddcab1304cc3',
  },

  candidate_integridad_start_wa: {
    name: 'candidate_integridad_start_wa',
    category: 'UTILITY',
    use_case: 'Candidato pasó conductual → invitación a la evaluación de integridad.',
    languages: ['es'],
    params: [
      { name: 'candidate_name', example: 'María' },
      { name: 'job_title', example: 'Gerente de Marca' },
      { name: 'test_link', example: 'https://app.sharktalents.ai/test/abc123' },
    ],
    template_text_es: `Hola {{1}}, pasas a la penúltima etapa para {{2}}: evaluación de integridad, unos 15 minutos. Ten a mano tu documento de identificación. Comienza aquí: {{3}}. Éxitos. Si tienes alguna duda escribe al correo RRHH@sharktalents.ai.`,
    twilio_content_sid: 'HXdb7c09cd2f6363197cb9574765545f9e',
  },

  candidate_video_start_wa: {
    name: 'candidate_video_start_wa',
    category: 'UTILITY',
    use_case: 'Chris generó las preguntas del video → candidato responde 5-7 preguntas cortas.',
    languages: ['es'],
    params: [
      { name: 'candidate_name', example: 'María' },
      { name: 'job_title', example: 'Gerente de Marca' },
      { name: 'test_link', example: 'https://app.sharktalents.ai/test/abc123/videos' },
    ],
    template_text_es: `Hola {{1}}, último paso para {{2}}: preguntas en video, unos 15 minutos. Puedes grabarlas cuando quieras — busca un lugar tranquilo y con buena luz. Nos interesa cómo piensas, no la calidad de tu cámara. Comienza aquí: {{3}}. Éxitos. Si tienes alguna duda escribe al correo RRHH@sharktalents.ai.`,
    twilio_content_sid: 'HXa39d2bc341a711a3240b333f2d5edce7',
  },

  // NOTA: candidate_rejected NO tiene template WhatsApp por decisión de Chris (2026-07-17).
  // El rechazo se manda SOLO por email (candidate_rejected en emailTemplates.ts) —
  // costo del mensaje adicional no justificado para un cierre.
};

/**
 * Helper: validar que un template_name + params son válidos antes de mandar.
 */
export function validateTemplate(
  templateName: string,
  params: string[],
): { valid: boolean; error?: string } {
  const tpl = WHATSAPP_TEMPLATES[templateName];
  if (!tpl) {
    return { valid: false, error: `Unknown template: ${templateName}` };
  }
  if (params.length !== tpl.params.length) {
    return {
      valid: false,
      error: `Template ${templateName} requires ${tpl.params.length} params, got ${params.length}`,
    };
  }
  return { valid: true };
}

/**
 * Helper: render del body con valores reales (para sandbox testing donde mandamos texto plano).
 * NO usar en producción — producción usa Content SID + ContentVariables (Twilio API).
 */
export function renderTemplateText(templateName: string, params: string[]): string {
  const tpl = WHATSAPP_TEMPLATES[templateName];
  if (!tpl) return '';
  let text = tpl.template_text_es;
  params.forEach((value, idx) => {
    text = text.replaceAll(`{{${idx + 1}}}`, value);
  });
  return text;
}
