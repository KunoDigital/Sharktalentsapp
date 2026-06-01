"use strict";
/**
 * Templates aprobados de WhatsApp Business para SharkTalents.
 *
 * IMPORTANTE: estos NO son los templates en sí — son los nombres + estructura para
 * referencia del código. Los templates REALES tienen que ser creados y aprobados
 * en Meta Business Manager (template approval tarda 1-3 días).
 *
 * Una vez aprobados, este archivo describe el "contrato" — qué params requiere cada uno
 * y dónde se usa en el flow de SharkTalents.
 *
 * Setup:
 *   1. Meta Business Manager → WhatsApp → Manage Templates
 *   2. Crear cada template con el nombre exacto de abajo
 *   3. Submit for approval
 *   4. Una vez aprobado, este código los puede usar
 *
 * Idiomas: 'es' (español) y 'en' (inglés). Crear ambas variantes en Meta.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHATSAPP_TEMPLATES = void 0;
exports.validateTemplate = validateTemplate;
/**
 * Templates definidos para SharkTalents.
 */
exports.WHATSAPP_TEMPLATES = {
    candidate_invitation_to_test: {
        name: 'candidate_invitation_to_test',
        category: 'UTILITY',
        use_case: 'Invitar a un candidato a hacer el test después de aplicar',
        languages: ['es', 'en'],
        params: [
            { name: 'candidate_name', example: 'María' },
            { name: 'job_title', example: 'Senior Developer' },
            { name: 'test_link', example: 'https://app.sharktalents.ai/test/abc123' },
        ],
        template_text_es: `Hola {{1}}, gracias por aplicar a {{2}}. Para avanzar en el proceso, necesitamos que completes una evaluación corta. Acceso: {{3}}`,
    },
    candidate_test_reminder: {
        name: 'candidate_test_reminder',
        category: 'UTILITY',
        use_case: 'Recordatorio cuando el candidato empezó el test pero no terminó (24h)',
        languages: ['es', 'en'],
        params: [
            { name: 'candidate_name', example: 'María' },
            { name: 'continue_link', example: 'https://app.sharktalents.ai/continue/xyz789' },
        ],
        template_text_es: `Hola {{1}}, vimos que empezaste tu evaluación pero no la terminaste. Podés retomar acá: {{2}}. Te toma ~10 min y tu progreso está guardado.`,
    },
    candidate_offer_ready: {
        name: 'candidate_offer_ready',
        category: 'UTILITY',
        use_case: 'Notificar al candidato que su oferta está lista para firmar',
        languages: ['es', 'en'],
        params: [
            { name: 'candidate_name', example: 'María' },
            { name: 'company_name', example: 'Acme Corp' },
            { name: 'sign_link', example: 'https://sign.zoho.com/abc123' },
        ],
        template_text_es: `Hola {{1}}, ¡felicitaciones! {{2}} te quiere ofrecer la posición. Firmá tu oferta aquí: {{3}}`,
    },
    candidate_rejected: {
        name: 'candidate_rejected',
        category: 'UTILITY',
        use_case: 'Notificar rechazo de manera respetuosa',
        languages: ['es', 'en'],
        params: [
            { name: 'candidate_name', example: 'María' },
            { name: 'job_title', example: 'Senior Developer' },
        ],
        template_text_es: `Hola {{1}}, gracias por tu interés en {{2}}. En esta oportunidad seguimos con otros perfiles que se ajustan más al puesto. Te mantenemos en nuestra base para futuras búsquedas.`,
    },
    client_finalist_ready: {
        name: 'client_finalist_ready',
        category: 'UTILITY',
        use_case: 'Notificar al cliente cuando hay finalistas listos para revisar',
        languages: ['es', 'en'],
        params: [
            { name: 'client_name', example: 'Carlos' },
            { name: 'job_title', example: 'Senior Developer' },
            { name: 'count', example: '4' },
            { name: 'portal_link', example: 'https://app.sharktalents.ai/portal/abc123' },
        ],
        template_text_es: `Hola {{1}}, tenemos {{3}} finalistas para {{2}} listos para tu revisión. Accedé al portal: {{4}}`,
    },
    client_briefing_scheduled: {
        name: 'client_briefing_scheduled',
        category: 'UTILITY',
        use_case: 'Confirmar al cliente la reunión de briefing agendada',
        languages: ['es', 'en'],
        params: [
            { name: 'client_name', example: 'Carlos' },
            { name: 'date_time', example: 'martes 12 de mayo a las 10:00' },
            { name: 'meeting_link', example: 'https://meet.zoho.com/abc' },
        ],
        template_text_es: `Hola {{1}}, agendamos tu reunión de briefing para {{2}}. Link: {{3}}`,
    },
};
/**
 * Helper: validar que un template_name + params son válidos antes de mandar.
 */
function validateTemplate(templateName, params) {
    const tpl = exports.WHATSAPP_TEMPLATES[templateName];
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
