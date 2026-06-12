/**
 * Mapeo centralizado de pipeline_stage (snake_case interno) → label español + color.
 *
 * Usar en TODA la admin UI en lugar de exponer los strings internos.
 * No exportar al cliente final — esto es solo para el dashboard de Cris.
 */

export type PipelineStage =
  | 'prefilter_pending'
  | 'prefilter_passed'
  | 'salary_out_of_range'
  | 'tecnica_completed'
  | 'conductual_completed'
  | 'integridad_completed'
  | 'videos_pending'
  | 'videos_completed'
  | 'bot_decision_advance'
  | 'finalist'
  | 'awaiting_client_review'
  | 'interview_scheduled'
  | 'offered'
  | 'hired'
  | 'auto_rejected_low_score'
  | 'auto_rejected_disc_mismatch'
  | 'auto_rejected_english_failed'
  | 'auto_rejected_mindset_limiting'
  | 'rejected_by_admin'
  | 'offer_declined'
  | 'withdrew';

type StageDef = {
  label: string;
  shortLabel: string;
  /** Categoría para agrupar visualmente. */
  category: 'pendiente' | 'evaluando' | 'finalista' | 'cerrado_ok' | 'cerrado_rechazo';
  color: string;
};

export const STAGE_LABELS: Record<PipelineStage, StageDef> = {
  prefilter_pending: { label: 'Pendiente de prescreening', shortLabel: 'Prescreening', category: 'pendiente', color: '#9ca3af' },
  prefilter_passed: { label: 'Pasó prescreening — esperando técnica', shortLabel: 'Listo p/ técnica', category: 'pendiente', color: '#3b82f6' },
  salary_out_of_range: { label: 'Salario fuera de rango', shortLabel: 'Salario', category: 'cerrado_rechazo', color: '#f59e0b' },

  tecnica_completed: { label: 'Técnica completada', shortLabel: 'Técnica ✓', category: 'evaluando', color: '#3b82f6' },
  conductual_completed: { label: 'DISC completado', shortLabel: 'DISC ✓', category: 'evaluando', color: '#6366f1' },
  integridad_completed: { label: 'Integridad completada', shortLabel: 'Integridad ✓', category: 'evaluando', color: '#8b5cf6' },
  videos_pending: { label: 'Esperando videos', shortLabel: 'Video pend.', category: 'evaluando', color: '#a855f7' },
  videos_completed: { label: 'Videos completados', shortLabel: 'Video ✓', category: 'evaluando', color: '#a855f7' },
  bot_decision_advance: { label: 'Bot aprobó', shortLabel: 'Bot ✓', category: 'evaluando', color: '#dafd6f' },

  finalist: { label: 'Finalista', shortLabel: 'Finalista', category: 'finalista', color: '#16a34a' },
  awaiting_client_review: { label: 'Esperando revisión del cliente', shortLabel: 'En cliente', category: 'finalista', color: '#16a34a' },
  interview_scheduled: { label: 'Entrevista agendada', shortLabel: 'Entrevista', category: 'finalista', color: '#15803d' },
  offered: { label: 'Oferta enviada', shortLabel: 'Oferta', category: 'finalista', color: '#15803d' },

  hired: { label: 'Contratado 🎉', shortLabel: 'Contratado', category: 'cerrado_ok', color: '#15803d' },

  auto_rejected_low_score: { label: 'Rechazo automático — score bajo', shortLabel: 'Score bajo', category: 'cerrado_rechazo', color: '#dc2626' },
  auto_rejected_disc_mismatch: { label: 'Rechazo automático — DISC no encaja', shortLabel: 'DISC mismatch', category: 'cerrado_rechazo', color: '#dc2626' },
  auto_rejected_english_failed: { label: 'Rechazo automático — inglés', shortLabel: 'Inglés bajo', category: 'cerrado_rechazo', color: '#dc2626' },
  auto_rejected_mindset_limiting: { label: 'Rechazo automático — mindset', shortLabel: 'Mindset', category: 'cerrado_rechazo', color: '#dc2626' },
  rejected_by_admin: { label: 'Rechazado manualmente', shortLabel: 'Rechazado', category: 'cerrado_rechazo', color: '#dc2626' },
  offer_declined: { label: 'Rechazó la oferta', shortLabel: 'Rechazó oferta', category: 'cerrado_rechazo', color: '#f59e0b' },
  withdrew: { label: 'Se retiró del proceso', shortLabel: 'Retirado', category: 'cerrado_rechazo', color: '#9ca3af' },
};

const FALLBACK: StageDef = {
  label: 'Estado desconocido', shortLabel: 'Desconocido', category: 'pendiente', color: '#9ca3af',
};

export function getStageLabel(stage: string): StageDef {
  return STAGE_LABELS[stage as PipelineStage] ?? { ...FALLBACK, label: stage, shortLabel: stage };
}

export function getStageLabelText(stage: string): string {
  return getStageLabel(stage).label;
}

export function getStageColor(stage: string): string {
  return getStageLabel(stage).color;
}
