import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('TAGS_PANEL');

type Tag = { ROWID: string; tag: string };

export function CandidateTagsPanel({ candidateId }: { candidateId: string }) {
  const api = useApi();
  const [tags, setTags] = useState<Tag[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ tag: string; count: number }>>([]);
  const [input, setInput] = useState('');
  const [tableNotReady, setTableNotReady] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  async function load() {
    try {
      const [tagsRes, allRes] = await Promise.all([
        api.candidates.listTags(candidateId),
        api.candidates.listAllTenantTags().catch(() => ({ tags: [] as Array<{ tag: string; count: number }> })),
      ]);
      setTags(tagsRes.tags.map((t) => ({ ROWID: t.ROWID, tag: t.tag })));
      if (tagsRes.table_not_ready) setTableNotReady(true);
      setSuggestions(allRes.tags);
    } catch (err) {
      log.warn('tags load failed', { error: (err as Error).message });
    }
  }

  useEffect(() => { load(); }, [candidateId]);

  async function handleAdd(rawTag: string) {
    const t = rawTag.trim();
    if (!t) return;
    try {
      await api.candidates.addTag(candidateId, t);
      setInput('');
      setShowSuggestions(false);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  }

  async function handleRemove(tag: Tag) {
    try {
      await api.candidates.removeTag(candidateId, tag.ROWID);
      await load();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    handleAdd(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      handleAdd(input);
    }
  }

  if (tableNotReady) return null;

  const existingTags = new Set(tags.map((t) => t.tag));
  const filteredSuggestions = suggestions
    .filter((s) => !existingTags.has(s.tag) && (input.length < 2 || s.tag.includes(input.toLowerCase())))
    .slice(0, 8);

  return (
    <section style={{ margin: '1rem 0', padding: 16, border: '1px solid var(--st-border)', borderRadius: 8, background: 'var(--st-bg-elev)' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>
        🏷️ Tags
        {tags.length > 0 && <span style={{ fontSize: 12, color: 'var(--st-fg-muted-2)', fontWeight: 400, marginLeft: 6 }}>({tags.length})</span>}
      </h3>

      {/* Tags actuales */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {tags.map((tag) => (
          <span
            key={tag.ROWID}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 99,
              background: '#dafd6f', color: 'var(--st-fg)', fontSize: 13, fontWeight: 500,
            }}
          >
            {tag.tag}
            <button
              onClick={() => handleRemove(tag)}
              style={{
                background: 'transparent', border: 0, cursor: 'pointer',
                color: 'var(--st-fg-muted)', fontSize: 14, padding: 0, lineHeight: 1,
              }}
              title="Quitar tag"
            >
              ×
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--st-fg-muted-2)' }}>Sin tags todavía.</span>
        )}
      </div>

      {/* Input + autocomplete */}
      <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Agregar tag (ej. react, sales, remote)…"
          style={{ width: '100%', padding: 8, border: '1px solid var(--st-border-strong)', borderRadius: 4, fontSize: 13 }}
        />
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--st-bg-elev)', border: '1px solid var(--st-border)', borderRadius: 4,
            maxHeight: 200, overflowY: 'auto', zIndex: 5,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}>
            {filteredSuggestions.map((s) => (
              <button
                key={s.tag}
                type="button"
                onMouseDown={() => handleAdd(s.tag)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '8px 12px', background: 'transparent', border: 0,
                  cursor: 'pointer', fontSize: 13, color: 'var(--st-fg)',
                  display: 'flex', justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span>{s.tag}</span>
                <span style={{ fontSize: 11, color: 'var(--st-fg-muted-2)' }}>{s.count} candidatos</span>
              </button>
            ))}
          </div>
        )}
      </form>
      <p style={{ margin: '8px 0 0 0', fontSize: 11, color: 'var(--st-fg-muted-2)' }}>
        Enter para agregar. Los tags se comparten con tu equipo y permiten buscar candidatos en el pool.
      </p>
    </section>
  );
}
