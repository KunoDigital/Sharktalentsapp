import { Link } from 'react-router-dom';
import { useFavorites } from '../hooks/useFavorites';
import './pages.css';

const TYPE_META: Record<string, { icon: string; pathPrefix: string }> = {
  job: { icon: '💼', pathPrefix: '/jobs' },
  candidate: { icon: '👤', pathPrefix: '/candidates' },
  draft: { icon: '📋', pathPrefix: '/drafts' },
  client: { icon: '🏢', pathPrefix: '/clients/health' },
};

export default function FavoritesPage() {
  const { favorites, loading, toggle } = useFavorites();

  if (loading) return <div className="page"><p>Cargando…</p></div>;

  const grouped = favorites.reduce<Record<string, typeof favorites>>((acc, f) => {
    if (!acc[f.resource_type]) acc[f.resource_type] = [];
    acc[f.resource_type].push(f);
    return acc;
  }, {});

  return (
    <div className="page">
      <h1 className="page-title">★ Favoritos</h1>
      <p className="page-subtitle">{favorites.length} elementos marcados. Acceso rápido a lo que más usás.</p>

      {favorites.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', marginTop: 24 }}>
          Aún no marcaste nada. En JobDetail o CandidateDetail apretá la ★ junto al título.
        </div>
      ) : (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {Object.entries(grouped).map(([type, items]) => {
            const meta = TYPE_META[type] ?? { icon: '★', pathPrefix: '' };
            return (
              <section key={type}>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {meta.icon} {type === 'job' ? 'Puestos' : type === 'candidate' ? 'Candidatos' : type === 'draft' ? 'Drafts' : 'Clientes'}
                </h2>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {items.map((f) => (
                    <li key={f.ROWID} style={{
                      padding: 10, background: '#fff', border: '1px solid #e5e7eb',
                      borderRadius: 6, marginBottom: 6,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <Link to={`${meta.pathPrefix}/${f.resource_id}`} style={{ color: '#1f2937', textDecoration: 'none', fontWeight: 500 }}>
                        {f.label ?? f.resource_id}
                      </Link>
                      <button
                        onClick={() => toggle(f.resource_type, f.resource_id)}
                        style={{ background: 'transparent', border: 0, cursor: 'pointer', color: '#dc2626', fontSize: 16 }}
                        title="Quitar de favoritos"
                      >
                        ★
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
