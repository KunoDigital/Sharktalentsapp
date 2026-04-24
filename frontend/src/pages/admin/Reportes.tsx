import { useEffect, useState } from 'react';
import { getJobs, listClientReports } from '../../services/api';
import type { CSSProperties } from 'react';

interface Job {
  id: string;
  title: string;
  company: string;
  is_active: number | string;
}

interface ReportSummary {
  report_id: string;
  name: string;
  status: string;
  created_at: string;
  published_at: string | null;
  company_slug: string;
  job_slug: string;
  candidate_count: number;
  candidate_names: string[];
}

export default function Reportes() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  useEffect(() => {
    getJobs().then(data => { setJobs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--kuno-text-muted)', padding: 24 }}>Cargando...</p>;

  // Group jobs by company
  const companies: Record<string, Job[]> = {};
  for (const j of jobs) {
    if (!companies[j.company]) companies[j.company] = [];
    companies[j.company].push(j);
  }
  const companyNames = Object.keys(companies).sort();

  const appBase = window.location.pathname.includes('/app') ? '/app/index.html' : '';

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 24 }}>Reportes</h1>

      {companyNames.length === 0 ? (
        <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14 }}>No hay puestos creados.</p>
      ) : (
        <div style={{ display: 'flex', gap: 20 }}>
          {/* Company list */}
          <div style={{ width: 260, flexShrink: 0 }}>
            <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Clientes</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {companyNames.map(name => (
                <button
                  key={name}
                  onClick={() => setSelectedCompany(selectedCompany === name ? null : name)}
                  style={selectedCompany === name ? companyBtnActive : companyBtn}
                >
                  <span style={{ flex: 1, textAlign: 'left' }}>{name}</span>
                  <span style={countBadge}>{companies[name].length}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Jobs for selected company */}
          <div style={{ flex: 1 }}>
            {!selectedCompany ? (
              <div style={emptyCard}>
                <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14 }}>Selecciona un cliente para ver sus puestos y reportes.</p>
              </div>
            ) : (
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 16 }}>{selectedCompany}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {companies[selectedCompany].map(job => (
                    <JobReportsBlock key={job.id} job={job} appBase={appBase} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function JobReportsBlock({ job, appBase }: { job: Job; appBase: string }) {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listClientReports(job.id).then(r => { setReports(r || []); setLoading(false); }).catch(() => { setReports([]); setLoading(false); });
  }, [job.id]);

  const companySlug = slugify(job.company);
  const jobSlug = slugify(job.title);
  const compareUrl = `#/admin/jobs/${job.id}/compare`;

  return (
    <div style={jobBlock}>
      <div style={jobBlockHeader}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kuno-cream)' }}>{job.title}</div>
          <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginTop: 2 }}>
            {String(job.is_active) === '1' ? 'Activo' : 'Archivado'} · {reports?.length || 0} reporte{(reports?.length || 0) === 1 ? '' : 's'}
          </div>
        </div>
        <a href={compareUrl} style={btnNewReport}>+ Nuevo reporte</a>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', padding: '12px 0' }}>Cargando reportes...</p>
      ) : (reports || []).length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', padding: '12px 0' }}>Sin reportes. Crea uno desde el comparativo.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {(reports || []).map(r => {
            const reportUrl = `${window.location.origin}${appBase}#/report/${companySlug}/${jobSlug}/${r.report_id}`;
            const prepUrl = `#/admin/jobs/${job.id}/client-report/${r.report_id}`;
            return (
              <div key={r.report_id} style={reportRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)' }}>{r.name}</span>
                    {r.status === 'published' ? <span style={badgePub}>Publicado</span> : <span style={badgeDraft}>Borrador</span>}
                  </div>
                  {r.candidate_names.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                      {r.candidate_names.join(' · ')}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <a href={prepUrl} style={btnPrepare}>Preparar</a>
                  {r.status === 'published' && (
                    <>
                      <a href={reportUrl} target="_blank" rel="noopener noreferrer" style={btnViewReport}>Ver</a>
                      <button onClick={() => { navigator.clipboard.writeText(reportUrl); }} style={btnCopy}>Copiar</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const companyBtn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 14px', background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 14, fontWeight: 500, cursor: 'pointer', textAlign: 'left' };
const companyBtnActive: CSSProperties = { ...companyBtn, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, borderColor: 'var(--kuno-lime)' };
const countBadge: CSSProperties = { background: 'var(--kuno-dark-2)', color: 'var(--kuno-text-muted)', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 };
const emptyCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 40, textAlign: 'center' };
const jobCard: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', gap: 16 };
const jobBlock: CSSProperties = { padding: '16px 18px', background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)' };
const jobBlockHeader: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
const reportRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' };
const badgePub: CSSProperties = { background: 'rgba(218,253,111,0.15)', color: 'var(--kuno-lime)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.5px' };
const badgeDraft: CSSProperties = { background: 'var(--kuno-dark)', color: 'var(--kuno-text-muted)', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10, border: '1px solid var(--kuno-border)', textTransform: 'uppercase', letterSpacing: '0.5px' };
const btnNewReport: CSSProperties = { fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius)', cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap', background: 'transparent', border: '1px dashed var(--kuno-lime)', color: 'var(--kuno-lime)' };
const btnBase: CSSProperties = { fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius)', cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' as const };
const btnPrepare: CSSProperties = { ...btnBase, background: 'transparent', border: '1px solid var(--kuno-lime)', color: 'var(--kuno-lime)' };
const btnViewReport: CSSProperties = { ...btnBase, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', border: 'none' };
const btnCopy: CSSProperties = { ...btnBase, background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)' };
