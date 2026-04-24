import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJobs, archiveJob } from '../../services/api';
import type { CSSProperties } from 'react';

interface Job {
  id: number;
  title: string;
  company: string;
  cognitive_level: string;
  is_active: number | string;
  created_at: string;
}

const levelLabels: Record<string, string> = {
  basic: 'Básico',
  mid: 'Medio',
  senior: 'Gerencial',
};

export default function JobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const loadJobs = () => {
    getJobs().then(data => { setJobs(data); setLoading(false); });
  };

  useEffect(() => { loadJobs(); }, []);

  const activeJobs = jobs.filter(j => String(j.is_active) === '1');
  const archivedJobs = jobs.filter(j => String(j.is_active) !== '1');
  const visibleJobs = showArchived ? jobs : activeJobs;

  return (
    <div>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={titleStyle}>Puestos</h1>
          {archivedJobs.length > 0 && (
            <button onClick={() => setShowArchived(!showArchived)} style={btnToggleArchived}>
              {showArchived ? `Ocultar archivados (${archivedJobs.length})` : `Ver archivados (${archivedJobs.length})`}
            </button>
          )}
        </div>
        <Link to="/admin/jobs/new">
          <button style={btnPrimary}>+ Nuevo puesto</button>
        </Link>
      </div>

      {loading ? (
        <p style={{ color: 'var(--kuno-text-muted)' }}>Cargando...</p>
      ) : visibleJobs.length === 0 ? (
        <div style={emptyState}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>◻</p>
          <p style={{ color: 'var(--kuno-text-muted)', fontSize: 15 }}>No hay puestos creados aún.</p>
          <Link to="/admin/jobs/new">
            <button style={{ ...btnPrimary, marginTop: 16 }}>Crear primer puesto</button>
          </Link>
        </div>
      ) : (
        <div style={gridStyle}>
          {visibleJobs.map(job => (
            <JobCard key={job.id} job={job} onArchived={loadJobs} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, onArchived }: { job: Job; onArchived: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const isActive = String(job.is_active) === '1';

  const handleArchive = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`¿Archivar "${job.title}"? El puesto no se eliminará, solo se ocultará.`)) return;
    setArchiving(true);
    await archiveJob(String(job.id));
    onArchived();
  };

  const cardStyle: CSSProperties = {
    background: isActive ? 'var(--kuno-dark)' : 'var(--kuno-dark-2)',
    border: `1px solid ${hovered ? 'var(--kuno-lime)' : 'var(--kuno-border)'}`,
    borderRadius: 'var(--radius-lg)',
    padding: 20,
    transition: 'border-color 0.2s',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    opacity: isActive ? 1 : 0.6,
  };

  return (
    <Link
      to={`/admin/jobs/${job.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--kuno-cream)' }}>{job.title}</h3>
          <span style={isActive ? badgeActive : badgeInactive}>
            {isActive ? 'Activo' : 'Archivado'}
          </span>
        </div>
        <p style={{ fontSize: 14, color: 'var(--kuno-text-muted)' }}>{job.company}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
          <span style={badgeLevel}>{levelLabels[job.cognitive_level] || job.cognitive_level}</span>
          {isActive && (
            <button onClick={handleArchive} disabled={archiving} style={btnArchive}>
              {archiving ? '...' : 'Archivar'}
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 28,
};

const titleStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: 'var(--kuno-cream)',
};

const btnPrimary: CSSProperties = {
  background: 'var(--kuno-lime)',
  color: 'var(--kuno-dark)',
  fontWeight: 600,
  fontSize: 14,
  padding: '10px 20px',
  borderRadius: 'var(--radius)',
  border: 'none',
};

const btnToggleArchived: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--kuno-border)',
  color: 'var(--kuno-text-muted)',
  fontSize: 12,
  fontWeight: 500,
  padding: '6px 14px',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
};

const btnArchive: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--kuno-border)',
  color: 'var(--kuno-text-muted)',
  fontSize: 11,
  padding: '4px 10px',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: 16,
};

const emptyState: CSSProperties = {
  textAlign: 'center',
  padding: '80px 0',
};

const badgeActive: CSSProperties = {
  background: 'var(--kuno-lime)',
  color: 'var(--kuno-dark)',
  fontSize: 11,
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: 20,
};

const badgeInactive: CSSProperties = {
  background: 'var(--kuno-slate)',
  color: 'var(--kuno-cream)',
  fontSize: 11,
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: 20,
};

const badgeLevel: CSSProperties = {
  background: 'var(--kuno-slate)',
  color: 'var(--kuno-cream)',
  fontSize: 11,
  fontWeight: 500,
  padding: '3px 10px',
  borderRadius: 20,
};
