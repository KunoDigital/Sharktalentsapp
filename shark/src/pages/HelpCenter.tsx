import { useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import './help-center.css';

type FAQ = {
  q: string;
  a: React.ReactNode;
};

type Section = {
  title: string;
  icon: string;
  faqs: FAQ[];
};

const SECTIONS: Section[] = [
  {
    title: 'Conceptos básicos',
    icon: '📚',
    faqs: [
      {
        q: '¿Qué mide cada prueba?',
        a: (
          <ul>
            <li><strong>Técnica</strong>: dominio de las habilidades del puesto (ej: SQL, ventas B2B). IA genera preguntas custom según el contexto.</li>
            <li><strong>DISC</strong>: estilo de comportamiento — Dominante / Influyente / Sólido / Cumplidor.</li>
            <li><strong>VELNA</strong>: capacidad cognitiva — Verbal, Espacial, Lógica, Numérica, Abstracta.</li>
            <li><strong>Emoción</strong>: reactividad emocional (Espontáneo ↔ Mesura ↔ Reflexivo).</li>
            <li><strong>Integridad</strong>: 15 dimensiones con detector de "buena impresión" (deseabilidad social).</li>
          </ul>
        ),
      },
      {
        q: '¿Cómo se calcula la similitud con el perfil ideal?',
        a: <>Distancia euclidiana invertida entre los scores del candidato y los del perfil ideal del puesto. 100% = match exacto. <strong>70%+</strong> es match fuerte. Debajo de 50%, no se recomienda.</>,
      },
      {
        q: '¿Qué son los PK profiles?',
        a: <>27 arquetipos de personalidad derivados del DISC (PK-01 a PK-27). Cada uno combina las 4 dimensiones en patrones accionables. Ej: <strong>PK-08</strong> = Preciso/a, Analítico/a, orientado a Calidad. Útil para describir el perfil sin entrar en los números.</>,
      },
    ],
  },
  {
    title: 'Bot decisor',
    icon: '🤖',
    faqs: [
      {
        q: '¿Cómo decide el bot?',
        a: (
          <>
            El bot evalúa cada candidato con 5 factores: técnica, DISC similitud, VELNA similitud, integridad, anti-trampa. Combina con weights conocidos y devuelve un <strong>confidence (0-1)</strong> + recomendación. Si confidence ≥ umbral (0.75 default), aplica la decisión automático. Si está debajo, manda a <Link to="/bot/review">Review queue</Link>.
          </>
        ),
      },
      {
        q: '¿Por qué a veces no aplica auto?',
        a: <>Cuando confidence está debajo del umbral, el bot prefiere que vos decidas. Eso pasa cuando los scores son ambiguos (ej: técnica alta pero DISC bajo, o anti-trampa flag). Tu decisión queda guardada como ejemplo de entrenamiento para que el bot mejore.</>,
      },
      {
        q: '¿Puedo ajustar el umbral?',
        a: <>Sí. En Settings → Bot decisor podrás ajustar el confidence umbral por etapa (cuando esté implementado el backend). Si querés que el bot sea más conservador, subilo a 0.85. Más agresivo, bajalo a 0.65.</>,
      },
      {
        q: '¿Cómo veo qué pensó el bot?',
        a: <>En cada perfil de candidato (<code>/candidates/:id</code>) hay una sección "Decisión del bot" con: rationale en español plano, factores con peso y señal, casos similares pasados que usó (RAG examples), y override si vos overrideaste.</>,
      },
    ],
  },
  {
    title: 'Anti-trampa',
    icon: '🚨',
    faqs: [
      {
        q: '¿Qué detecta el sistema anti-trampa?',
        a: (
          <ul>
            <li><strong>Cursor fuera</strong> de la pestaña por más de 500ms.</li>
            <li><strong>Window blur</strong> (cambió de pestaña/ventana).</li>
            <li><strong>Paste</strong> (pegó texto desde el clipboard).</li>
          </ul>
        ),
      },
      {
        q: '¿Cuándo me preocupo?',
        a: <>Default: <strong>3+ eventos en una sola fase</strong> levanta flag amarillo. <strong>6+ eventos</strong> es flag rojo (banner alto). Patrón típico de trampa: técnica alta + conductual con anti-trampa = posible asistencia externa.</>,
      },
      {
        q: '¿Y si el candidato es honesto pero se distrajo?',
        a: <>Los flags son señales, no rechazos automáticos. Cuando hay anti-trampa, conviene <strong>entrevistar antes de decidir</strong>. Pedile al candidato que explique cómo hizo el test, y juzgá vos.</>,
      },
    ],
  },
  {
    title: 'Reportes y feedback cliente',
    icon: '📨',
    faqs: [
      {
        q: '¿Cuándo se publica el reporte al cliente?',
        a: <>Cuando vos marcás top 3 finalistas en el comparativo y haces click "Preparar reporte para cliente". La IA genera la narrativa, vos revisás, publicás, y el cliente recibe email con el link.</>,
      },
      {
        q: '¿Cómo me entero si el cliente lo abrió?',
        a: <>En Reportes ves "Cliente abrió" con timestamp. Y el dashboard te muestra si hay <strong>feedback nuevo</strong> recibido (que vos todavía no viste).</>,
      },
      {
        q: '¿El cliente puede dar feedback?',
        a: <>Sí. En el reporte público hay 3 botones por candidato: "Quiero entrevistar" / "Tal vez" / "Pasar" + comentario opcional. Cuando aparece, ves todo en <Link to="/reports">Reportes</Link>.</>,
      },
    ],
  },
  {
    title: 'Atajos y productividad',
    icon: '⌨️',
    faqs: [
      {
        q: '¿Hay atajos de teclado?',
        a: <>Sí. Presioná <kbd>?</kbd> en cualquier momento para ver todos. Los más útiles: <kbd>⌘</kbd>+<kbd>K</kbd> búsqueda global, <kbd>j</kbd>/<kbd>k</kbd> navegar tablas, <kbd>g</kbd>+<kbd>letra</kbd> para ir a páginas (g d Dashboard, g j Jobs, etc.), <kbd>/</kbd> enfocar buscador.</>,
      },
      {
        q: '¿Cómo silencio notificaciones?',
        a: <>En <Link to="/settings">Settings</Link> → 🔔 Notificaciones, hay 5 toggles. Apagás los tipos que no querés ver. Las silenciadas no aparecen en el bell ni en el dashboard.</>,
      },
      {
        q: '¿Puedo exportar candidatos a Excel?',
        a: <>Sí. En Jobs detail y en Candidatos hay botón "Exportar Excel" que baja un .xlsx con todos los datos (incluyendo scores DISC, VELNA, técnica, integridad, anti-trampa events, bot confidence).</>,
      },
    ],
  },
  {
    title: 'Privacidad y datos',
    icon: '🔒',
    faqs: [
      {
        q: '¿Cuánto tiempo guardamos los datos del candidato?',
        a: <>6 meses después del cierre del proceso. Después se eliminan automáticamente (Ley de Protección de Datos PA / GDPR). Los videos dinámicos se eliminan a los 30 días post-cierre del puesto.</>,
      },
      {
        q: '¿Pueden pedir borrado anticipado?',
        a: <>Sí. Hay endpoint <code>/portal/data-rights</code> donde el candidato puede pedir borrado inmediato. La solicitud se procesa en 72h.</>,
      },
      {
        q: '¿Qué pasa con las grabaciones de los videos?',
        a: <>Encriptadas at-rest. Solo Cris y el cliente final que contrata pueden verlas. Se eliminan 30 días después del cierre del puesto. El candidato firma consentimiento explícito antes de grabar.</>,
      },
    ],
  },
];

export default function HelpCenter() {
  const [search, setSearch] = useState('');

  const filtered = SECTIONS.map((s) => ({
    ...s,
    faqs: s.faqs.filter((f) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return f.q.toLowerCase().includes(q) || (typeof f.a === 'string' && f.a.toLowerCase().includes(q));
    }),
  })).filter((s) => s.faqs.length > 0);

  return (
    <div>
      <h1 className="page-title">Centro de ayuda</h1>
      <p className="page-subtitle">
        Preguntas frecuentes sobre cómo funciona SharkTalents. Si no encontrás lo que buscás, escribí a{' '}
        <a href="mailto:cris@kunodigital.com">cris@kunodigital.com</a>.
      </p>

      <input
        type="search"
        className="filter-search help-search"
        placeholder="Buscar en la ayuda..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="help-sections">
        {filtered.map((s) => (
          <section key={s.title} className="help-section">
            <h2><span aria-hidden="true">{s.icon}</span> {s.title}</h2>
            <div className="help-faqs">
              {s.faqs.map((f, i) => (
                <details key={i} className="help-faq">
                  <summary>{f.q}</summary>
                  <div className="help-faq-answer">{f.a}</div>
                </details>
              ))}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="stub-card">
            <p>No encontramos nada con "{search}". <button className="btn-toolbar" onClick={() => setSearch('')}>Limpiar</button></p>
          </div>
        )}
      </div>
    </div>
  );
}
