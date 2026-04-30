import * as XLSX from 'xlsx';
import type { Application } from '../data/mockApplications';
import { STATE_LABELS, SOURCE_LABELS } from '../data/mockApplications';
import type { Job } from '../data/mockJobs';

/**
 * Genera un .xlsx descargable con la tabla de candidatos de un puesto.
 * Una hoja por puesto si se pasan varios.
 */
export function exportCandidatesToExcel(
  applications: Application[],
  jobs: Job[],
  filename: string,
): void {
  const wb = XLSX.utils.book_new();

  // Una hoja con todos los candidatos
  const rows = applications.map((app) => {
    const job = jobs.find((j) => j.id === app.job_id);
    return {
      'Candidato': app.candidate_name,
      'Email': app.candidate_email,
      'Teléfono': app.candidate_phone,
      'Edad': app.candidate_age,
      'Puesto': job?.title ?? '—',
      'Cliente': job?.client_company ?? '—',
      'Source': SOURCE_LABELS[app.source],
      'Estado': STATE_LABELS[app.state],
      'Aspiración salarial (USD/mes)': app.salary_aspiration_usd,
      'Disponibilidad': app.disponibilidad,
      'Aplicó': app.applied_at,
      'DISC dominante': app.disc?.dominant_label ?? '—',
      'DISC similitud (%)': app.disc?.similitud_pct ?? '—',
      'PK profile': app.disc?.pk_profile_code ?? '—',
      'VELNA similitud (%)': app.velna?.similitud_pct ?? '—',
      'Técnica (%)': app.tecnica?.pct ?? '—',
      'Técnica estado': app.tecnica?.estado ?? '—',
      'Emoción': app.emocional?.label ?? '—',
      'Anti-trampa eventos': app.anti_cheat_events.length,
      'Bot confidence': app.bot_confidence != null ? `${(app.bot_confidence * 100).toFixed(0)}%` : '—',
      'Bot recomienda': app.bot_recommendation ?? '—',
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-fit columnas (estimación)
  const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
    wch: Math.min(
      Math.max(
        key.length,
        ...rows.map((r) => String(r[key as keyof typeof r] ?? '').length),
      ) + 2,
      40,
    ),
  }));
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Candidatos');

  XLSX.writeFile(wb, filename);
}

/**
 * Genera un .xlsx con la tabla de jobs.
 */
export function exportJobsToExcel(jobs: Job[], filename: string): void {
  const wb = XLSX.utils.book_new();
  const rows = jobs.map((j) => ({
    'Puesto': j.title,
    'Cliente': j.client_company,
    'Industria': j.client_industry,
    'Ubicación': j.location,
    'Estado': j.status,
    'Aplicaciones': j.applications_count,
    'En pipeline': j.applications_in_progress,
    'Finalistas': j.finalists_count,
    'Salario min (USD)': j.salary_range_usd.min,
    'Salario max (USD)': j.salary_range_usd.max,
    'Fee (USD)': j.fee_usd,
    'Mínimo técnica (%)': j.tecnica_minimo_pct,
    'Perfil ideal A': j.disc_ideal_a.pk_profile_name,
    'Perfil ideal B': j.disc_ideal_b?.pk_profile_name ?? '—',
    'Creado': j.created_at,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
    wch: Math.min(Math.max(key.length, ...rows.map((r) => String(r[key as keyof typeof r] ?? '').length)) + 2, 35),
  }));
  ws['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, 'Puestos');
  XLSX.writeFile(wb, filename);
}
