// Mock client reports — what clients see when they receive the public report URL.
// Each report aggregates a job + selected finalists + IA-generated narrative.
// In production: backend generates this with Claude when the admin clicks "Publicar reporte".

export type ReportCandidateNarrative = {
  application_id: string;
  affinity_pct: number; // afinidad global con perfil ideal
  affinity_label: 'Mejor afinidad' | 'Buena afinidad' | 'Afinidad moderada';
  // narrativa IA
  paragraph_intro: string;
  // afinidad por dimensión
  afinidad_conductual: number;
  afinidad_cognitiva: number;
  afinidad_tecnica: number;
  afinidad_integridad: number;
  afinidad_emocion: number;
  // estilo de trabajo (4 mini-cards)
  estilo_decisiones: string;
  estilo_equipo: string;
  estilo_presion: string;
  estilo_comunicacion: string;
  // fortalezas y consideraciones
  fortalezas: string[];
  a_tomar_en_cuenta: string[];
  // perfil emocional
  perfil_emocional_text: string;
};

export type ReportConclusion = {
  si_priorizas_autonomia: string;
  si_priorizas_crecimiento: string;
  menor_riesgo: string;
  mayor_potencial: string;
  recomendacion_final: string;
};

export type Report = {
  token: string;
  job_id: string;
  tenant_name: string; // ej: "Kuno Digital"
  published_at: string;
  status: 'published' | 'archived';
  candidate_app_ids: string[];
  narratives: Record<string, ReportCandidateNarrative>;
  conclusion: ReportConclusion;
};

export const MOCK_REPORTS: Record<string, Report> = {
  'rpt_banca_2026_04': {
    token: 'rpt_banca_2026_04',
    job_id: 'job_2',
    tenant_name: 'Kuno Digital',
    published_at: '2026-04-25',
    status: 'published',
    candidate_app_ids: ['app_10', 'app_11', 'app_12'],
    narratives: {
      app_10: {
        application_id: 'app_10',
        affinity_pct: 91,
        affinity_label: 'Mejor afinidad',
        paragraph_intro:
          'Luis es un profesional con dominio técnico muy sólido que puede entrar a operar en gestión de cartera bancaria PyME sin necesidad de capacitación inicial. Su perfil dominante (D-Dominante) y alta inteligencia social lo posicionan como un líder natural que toma decisiones rápidas bajo presión.',
        afinidad_conductual: 88,
        afinidad_cognitiva: 90,
        afinidad_tecnica: 91,
        afinidad_integridad: 95,
        afinidad_emocion: 75,
        estilo_decisiones: 'Decide rápido y con datos. Toma riesgos calculados.',
        estilo_equipo: 'Líder natural — delega bien y motiva con visión clara.',
        estilo_presion: 'Mantiene composición y aumenta foco bajo presión.',
        estilo_comunicacion: 'Directo, persuasivo, va al grano. Construye relación rápido.',
        fortalezas: [
          'Domina las herramientas de análisis de cartera del día a día',
          'Resiliencia comprobada — gestionó cartera durante crisis 2024',
          'Construye relaciones con clientes corporativos rápidamente',
          'Lidera con autonomía sin necesidad de supervisión constante',
        ],
        a_tomar_en_cuenta: [
          'Puede saltar pasos en procesos formales si los considera lentos',
          'Estructuras muy rígidas o burocráticas pueden frustrarlo',
          'Necesita objetivos claros y autonomía para ejecutar',
        ],
        perfil_emocional_text:
          'Espontáneo y reactivo, lo que lo mantiene ágil en negociación pero a veces puede tomar decisiones impulsivas si no se le da tiempo de procesar.',
      },
      app_11: {
        application_id: 'app_11',
        affinity_pct: 86,
        affinity_label: 'Buena afinidad',
        paragraph_intro:
          'Patricia tiene una combinación poco común de carisma comunicativo (perfil I) con experiencia profunda en banca PyME. 15 años en el rubro le dan red de contactos que puede activar desde día 1. Construye relación rápido y mantiene cartera por largo plazo.',
        afinidad_conductual: 86,
        afinidad_cognitiva: 84,
        afinidad_tecnica: 84,
        afinidad_integridad: 92,
        afinidad_emocion: 80,
        estilo_decisiones: 'Decide consultando, valida con stakeholders antes.',
        estilo_equipo: 'Coordinadora natural, multiplica el equipo a través de relaciones.',
        estilo_presion: 'Calma y enfoca al equipo en momentos críticos.',
        estilo_comunicacion: 'Comunicadora natural, construye redes amplias y profundas.',
        fortalezas: [
          '15 años de experiencia banca PyME con cartera propia',
          'Red de contactos activa que puede traer al banco',
          'Comunicación cliente-céntrica, retiene cartera por años',
          'Estilo I+D balanceado: vende y ejecuta',
        ],
        a_tomar_en_cuenta: [
          'Aspiración salarial $4200 — en límite alto del rango ($3000-4500)',
          'Disponibilidad 15 días de pre-aviso vs inmediato',
          'Necesitará claridad sobre estructura de comisiones',
        ],
        perfil_emocional_text:
          'Mesurada, lo que la mantiene estable en relaciones largas con clientes pero puede ser cautelosa en negociaciones que requieren agresividad.',
      },
      app_12: {
        application_id: 'app_12',
        affinity_pct: 80,
        affinity_label: 'Buena afinidad',
        paragraph_intro:
          'Alejandro es una opción sólida con 8 años en banca PyME y perfil D-Dominante orientado a calidad. Aspiración salarial conservadora dentro del rango, totalmente disponible. Buen track record en cartera de mediana empresa.',
        afinidad_conductual: 81,
        afinidad_cognitiva: 79,
        afinidad_tecnica: 79,
        afinidad_integridad: 88,
        afinidad_emocion: 70,
        estilo_decisiones: 'Analiza datos antes de decidir, balancea velocidad con precisión.',
        estilo_equipo: 'Trabaja bien en estructuras claras, delega cuando hay procesos.',
        estilo_presion: 'Mantiene calidad bajo presión, no sacrifica precisión.',
        estilo_comunicacion: 'Profesional y directa, prefiere documentar en escrito.',
        fortalezas: [
          '8 años experiencia banca PyME',
          'Aspiración salarial dentro del rango — flexibilidad',
          'Disponibilidad inmediata',
          'Combina dominio (D) con calidad (C) — pragmático',
        ],
        a_tomar_en_cuenta: [
          'Cartera previa más mediana empresa que PyME pequeña',
          'Menos red de contactos que Patricia',
          'Cognitiva 79% — debajo de Luis y Patricia',
        ],
        perfil_emocional_text:
          'Equilibrado, lo que permite manejar situaciones diversas con flexibilidad pero puede no destacar en momentos que requieren intensidad.',
      },
    },
    conclusion: {
      si_priorizas_autonomia:
        'Luis es la opción más fuerte. Maneja cartera independiente desde día 1, decide rápido, no necesita supervisión.',
      si_priorizas_crecimiento:
        'Patricia trae 15 años de red activa que puede capitalizar inmediatamente. Construye negocio nuevo más rápido.',
      menor_riesgo:
        'Alejandro tiene aspiración salarial más baja y disponibilidad inmediata. Buen ratio costo/calidad.',
      mayor_potencial:
        'Luis combina dominio técnico, datos sólidos en cargo previo y perfil de líder. Mayor potencial de crecer hacia gerencia regional.',
      recomendacion_final:
        'Recomendamos contratar a Luis Tejada. Tiene score técnico superior (91% vs 84% y 79%), experiencia operativa directa relevante, demuestra proactividad y autonomía documentada. Patricia es excelente segunda opción si la red de contactos es prioridad estratégica. Alejandro como opción de menor costo si presupuesto es restricción dura.',
    },
  },
};

export function getReportByToken(token: string): Report | undefined {
  return MOCK_REPORTS[token];
}
