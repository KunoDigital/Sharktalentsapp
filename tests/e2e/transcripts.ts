/**
 * 10 transcripts mock realistas para tests E2E.
 *
 * Cada uno simula una reunión entre Cris (reclutadora) y un cliente distinto,
 * cubriendo puestos típicos LATAM con perfiles DISC esperados diferentes.
 *
 * IMPORTANTE: estos transcripts a veces contienen "typos de Zia" (nombre de
 * empresa mal transcrito) — eso es a propósito para validar que la IA respeta
 * el `client_company` del lead y no el del transcript.
 *
 * Estructura esperada por la IA tras cada uno:
 *   - title: depende del puesto
 *   - DISC: variar — algunos D alto, otros C alto, otros I+S
 *   - competencias: del catálogo cerrado, 3-5
 *   - salary_range_usd.max: salario mensual mencionado en transcript
 */

export type TranscriptCase = {
  id: number;
  expected_title: string;
  expected_disc_dominant: 'D' | 'I' | 'S' | 'C';
  expected_salary_max: number;
  transcript: string;
};

export const TRANSCRIPTS: TranscriptCase[] = [
  // ============ 1. Gerente Comercial (D alto + I medio) ============
  {
    id: 1,
    expected_title: 'Gerente Comercial',
    expected_disc_dominant: 'D',
    expected_salary_max: 4000,
    transcript: `
Reunión cliente: Gerente Comercial para distribuidora de productos de consumo masivo.

Cliente: Necesitamos un Gerente Comercial urgente. El actual renunció hace dos meses y la cartera está cayendo. Somos una distribuidora en Panamá, 25 empleados.

Cris: ¿Qué necesitás que haga esta persona?

Cliente: Lidera 4 ejecutivos de cuenta. Reporta directo a mí. Cuota mensual y abrir mercados nuevos. Decidido, sin miedo a tomar decisiones, pero que sepa motivar al equipo. No autoritario.

Cris: ¿Salario?

Cliente: 2500 base más comisiones por cumplimiento. Target total mensual 4000. Híbrido, 3 días oficina. Viajes 1-2 veces al mes.

Cris: ¿Experiencia?

Cliente: 5+ años liderando equipos comerciales B2B. Distribución o consumo masivo idealmente. Universitario en administración. Inglés intermedio. CRM Zoho.

Cris: Tu estilo de liderazgo?

Cliente: Directa, voy al grano, escucho. No micromanagear. Resultado claro semanalmente. No tolero excusas ni esconder problemas.

Cris: Plazo de incorporación?

Cliente: Ayer. Urgente.
`.trim(),
  },

  // ============ 2. Asistente Contable (C alto) ============
  {
    id: 2,
    expected_title: 'Asistente Contable',
    expected_disc_dominant: 'C',
    expected_salary_max: 1100,
    transcript: `
Reunión: Asistente Contable para estudio contable mediano en ciudad de Panamá.

Cliente: Necesito un asistente contable. La chica anterior renunció y estamos cerrando el mes con presión.

Cris: ¿Qué tareas específicas?

Cliente: Registro de facturas, conciliaciones bancarias, apoyo en declaraciones de ITBMS. No es contadora aún, asistente. Que sea muy ordenada y cuidadosa con los números. Si comete un error pequeño, después es un dolor de cabeza en auditoría.

Cris: ¿Salario?

Cliente: 900 base, sube a 1100 después de los 3 meses. Tiempo completo, presencial. Tenemos oficina en San Francisco.

Cris: ¿Perfil?

Cliente: Técnica o universitaria en contabilidad. Excel intermedio. Manejo de algún sistema contable (Quickbooks o Contaplus). 1-2 años de experiencia mínimo, no necesito senior.

Cris: ¿Personalidad?

Cliente: Calmada, organizada, que no se desespere con volumen. Que pregunte si no entiende. No me sirve alguien impulsivo que invente entradas para "cerrar rápido".

Cris: Plazo?

Cliente: 30 días máximo para incorporar.
`.trim(),
  },

  // ============ 3. Encargado de RRHH (I + S alto) ============
  {
    id: 3,
    expected_title: 'Encargado de Recursos Humanos',
    expected_disc_dominant: 'I',
    expected_salary_max: 2200,
    transcript: `
Reunión: Encargado de RRHH para empresa hotelera mediana en Panamá.

Cliente: Tenemos 80 empleados entre dos propiedades. Hasta ahora yo manejé RRHH a medias. Ya no doy abasto.

Cris: ¿Qué necesita esta persona?

Cliente: Selección, capacitaciones, clima laboral, payroll básico (lo más fuerte lo lleva mi contadora). Tiene que saber escuchar a los empleados. La rotación es alta y el clima estaba feo. Necesitamos a alguien que conecte con la gente.

Cris: ¿Salario?

Cliente: 1800 base más bonos por reducción de rotación. Total mensual puede llegar a 2200. Presencial, una propiedad por día.

Cris: ¿Experiencia?

Cliente: 3-5 años en RRHH operativo, idealmente en hotelería o retail. Licenciatura en Psicología o RRHH. Buen trato con la gente. Que sepa mediar cuando hay conflictos.

Cris: ¿Personalidad?

Cliente: Carismática pero no superficial. Que la gente quiera contarle las cosas. Paciente con los procesos lentos del gobierno (Mitradel, CSS). Empática pero también firme cuando hay que ser firme.

Cris: Urgencia?

Cliente: 45 días.
`.trim(),
  },

  // ============ 4. Desarrollador Backend Senior (C alto + D medio) ============
  {
    id: 4,
    expected_title: 'Desarrollador Backend Senior',
    expected_disc_dominant: 'C',
    expected_salary_max: 3500,
    transcript: `
Reunión: Desarrollador Backend Senior para SaaS B2B en Panamá.

Cliente: Tenemos una plataforma SaaS de logística. 3 desarrolladores hoy, necesitamos un cuarto senior para que tome ownership del backend.

Cris: Stack técnico?

Cliente: Node.js con TypeScript, PostgreSQL, AWS. Microservicios. Tests con Jest. Docker. CI/CD con GitHub Actions.

Cris: Responsabilidades?

Cliente: Diseño de APIs nuevas, code review al resto del equipo, mejorar performance del core de logística. Va a trabajar con producto y QA. Decisiones técnicas de arquitectura las toma él o las propone al CTO.

Cris: Salario?

Cliente: 2800 base + bonos por entregas. Total mensual hasta 3500. Remoto 100%. Equipos provistos.

Cris: Perfil?

Cliente: 5+ años con Node.js / TypeScript profesional. Buen manejo de SQL (no solo ORM). Experiencia con sistemas en producción que escalen. Que escriba código limpio, no spaghetti. Tests son obligatorios, no opcionales.

Cris: Personalidad?

Cliente: Detallista, que piense bien antes de codear. Que cuestione si algo no tiene sentido, pero respetuoso. No quiero rockstar con ego. Trabajo en equipo, code review constructivo.

Cris: Plazo?

Cliente: Lo antes posible pero el calce cultural importa más que la velocidad. 60 días.
`.trim(),
  },

  // ============ 5. Ejecutivo de Cuentas (I muy alto) ============
  {
    id: 5,
    expected_title: 'Ejecutivo de Cuentas',
    expected_disc_dominant: 'I',
    expected_salary_max: 2800,
    transcript: `
Reunión: Ejecutivo de Cuentas Senior para agencia de marketing digital.

Cliente: Crecemos rápido y necesitamos un ejecutivo de cuentas que maneje 8-10 clientes mediano-grandes. El actual gerente comercial ya no puede atenderlos todos.

Cris: Qué hace esta persona?

Cliente: Es la cara visible ante el cliente. Reuniones mensuales, presenta resultados, propone optimizaciones, vende servicios adicionales (upsell). Coordina internamente con el equipo creativo y de pauta.

Cris: Salario?

Cliente: 1800 base + comisión por upsell que cierre. Total típico mensual 2500-2800. Híbrido 2 días oficina.

Cris: Experiencia?

Cliente: 3-5 años en agencias o consultoría B2B. Conocer marketing digital al nivel de hablar el lenguaje (CPC, CPM, ROAS) pero no tiene que ejecutar. Que sepa vender ideas, no solo presentar reportes.

Cris: Personalidad?

Cliente: Súper sociable, energía contagiosa, que enamore al cliente. Optimista pero realista. Resiliente — vamos a perder clientes a veces y tiene que aguantar. Que no le tiemble el pulso para decir "no" cuando un cliente pide algo imposible.

Cris: Plazo?

Cliente: 45 días. Tenemos un cliente grande nuevo que arranca en 60.
`.trim(),
  },

  // ============ 6. Coordinador de Logística (D medio + C alto) ============
  {
    id: 6,
    expected_title: 'Coordinador de Logística',
    expected_disc_dominant: 'C',
    expected_salary_max: 1800,
    transcript: `
Reunión: Coordinador de Logística para importadora.

Cliente: Importamos productos electrónicos desde Asia. Necesitamos un coordinador de logística que maneje todo el proceso: desde la orden de compra hasta que el producto entra al almacén.

Cris: Tareas?

Cliente: Coordinar con proveedores Asia, seguimiento de embarques, trámites aduana Panamá, recepción en almacén, control de inventario inicial. Reporta al Gerente de Operaciones. No tiene gente a cargo directa pero coordina con 3 personas del almacén.

Cris: Salario?

Cliente: 1500 base, llega a 1800 con cumplimiento de KPIs. Presencial en zona libre Colón.

Cris: Perfil?

Cliente: Técnico o universitario en comercio internacional o logística. 3+ años en importación, ideal con experiencia en aduana panameña. Excel avanzado obligatorio. Inglés intermedio para correos con Asia.

Cris: Personalidad?

Cliente: Súper organizado. Que el caos no lo paralice — siempre hay un embarque atrasado, un proveedor que no responde. Que sea firme con proveedores cuando se atrasan. Detallista con números, los errores en aduana cuestan caro.

Cris: Urgencia?

Cliente: 30 días.
`.trim(),
  },

  // ============ 7. Diseñador UX (I + C balanceado) ============
  {
    id: 7,
    expected_title: 'Diseñador UX',
    expected_disc_dominant: 'I',
    expected_salary_max: 2500,
    transcript: `
Reunión: Diseñador UX para fintech panameña.

Cliente: Lanzamos una app de pagos hace 6 meses. Tenemos diseñador junior, necesitamos un UX senior que lidere la mejora de la experiencia.

Cris: Qué hace?

Cliente: Research con usuarios (entrevistas, tests de usabilidad), prototipado en Figma, diseño de flujos, handoff a developers. Lidera al junior. Trabaja con Product Owner y dev team.

Cris: Salario?

Cliente: 2000 base + bonos por release. Total mensual hasta 2500. Remoto, pero le pedimos venir a Panamá una vez al mes.

Cris: Experiencia?

Cliente: 4+ años en UX. Portfolio con casos reales de apps usadas por miles. Manejo de Figma. Que sepa research, no solo dibujar pantallas. Idealmente experiencia previa en fintech o productos transaccionales.

Cris: Personalidad?

Cliente: Comunicativa — defiende sus ideas con usuarios y datos, no solo con opinión. Empática con el usuario final. Detallista en el polish del UI. Sabe negociar con devs cuando algo es difícil de implementar.

Cris: Plazo?

Cliente: 45 días.
`.trim(),
  },

  // ============ 8. Recepcionista / Asistente (S alto) ============
  {
    id: 8,
    expected_title: 'Recepcionista Asistente Administrativa',
    expected_disc_dominant: 'S',
    expected_salary_max: 900,
    transcript: `
Reunión: Recepcionista / Asistente Administrativa para bufete legal mediano.

Cliente: Tenemos 12 abogados, necesitamos cubrir recepción y apoyo administrativo. La chica anterior se mudó a otra provincia.

Cris: Tareas?

Cliente: Recepción de clientes, manejo de central telefónica, agenda de los abogados, archivar expedientes físicos y digitales, apoyo en armado de carpetas para reuniones. Coordina con la contadora externa para pagos básicos.

Cris: Salario?

Cliente: 750 base, 900 después de los 6 meses. Presencial, 8 a 5 con hora de almuerzo.

Cris: Perfil?

Cliente: Secretariado o estudiante universitario. Office a nivel básico-medio. Presentación impecable (atendemos clientes corporativos). Inglés básico para algunas llamadas.

Cris: Personalidad?

Cliente: Calmada, paciente, ordenada. Que aguante a abogados estresados sin tomárselo personal. Discreta, va a manejar información sensible. Leal. La rotación nos mata, queremos a alguien que se quede 3-5 años.

Cris: Plazo?

Cliente: 30 días.
`.trim(),
  },

  // ============ 9. Supervisor de Producción (D + C alto) ============
  {
    id: 9,
    expected_title: 'Supervisor de Producción',
    expected_disc_dominant: 'D',
    expected_salary_max: 2400,
    transcript: `
Reunión: Supervisor de Producción para planta de alimentos.

Cliente: Procesamos productos lácteos. Tenemos 35 operarios en planta. Necesitamos un supervisor de turno que asegure cumplimiento de producción, calidad e inocuidad.

Cris: Responsabilidades?

Cliente: Asignar tareas a los operarios, controlar tiempos de producción, asegurar BPM (Buenas Prácticas de Manufactura), reportar defectos al gerente de planta. Toma decisiones operativas en piso. Maneja conflictos entre operarios.

Cris: Salario?

Cliente: 1800 base + bonos por cumplimiento. Total mensual hasta 2400. Presencial, turno de 6am a 3pm, rotativo cada 2 semanas con otro supervisor.

Cris: Perfil?

Cliente: Ingeniero en alimentos o industrial. 3-5 años en supervisión de planta, ideal alimentos / farma. Conocimiento sólido de BPM e HACCP. Que sepa leer indicadores (rendimiento, mermas).

Cris: Personalidad?

Cliente: Firme, autoridad clara. Los operarios necesitan saber quién manda en piso. Pero respetuoso — no autoritario gritón. Detallista con la calidad, no dejes pasar nada. Capaz de aguantar presión cuando hay un problema y la cadena se para.

Cris: Urgencia?

Cliente: 45 días.
`.trim(),
  },

  // ============ 10. Gerente de Marketing (D + I alto) ============
  {
    id: 10,
    expected_title: 'Gerente de Marketing Digital',
    expected_disc_dominant: 'D',
    expected_salary_max: 3200,
    transcript: `
Reunión: Gerente de Marketing Digital para retail de moda.

Cliente: Tenemos 8 tiendas físicas y un e-commerce que creció el último año. Necesitamos un gerente de marketing digital que lidere el e-commerce y la estrategia online.

Cris: Qué hace?

Cliente: Define estrategia digital, lidera al equipo de 3 personas (community manager, diseñador, ejecutor de pauta), aprueba campañas, reporta resultados al directorio mensualmente. Cuota de ventas online y métricas de adquisición.

Cris: Salario?

Cliente: 2500 base + bono trimestral por cumplimiento. Total mensual promedio 3200. Híbrido 3 días oficina.

Cris: Experiencia?

Cliente: 5+ años en marketing digital, idealmente retail / e-commerce. Manejo de Meta Ads, Google Ads, Shopify o similar. Que entienda data (Google Analytics, GA4). Inglés avanzado, vamos a vender pronto a Costa Rica y Colombia.

Cris: Personalidad?

Cliente: Decidida, propone y defiende sus ideas. Líder, no jefe — motivar al equipo creativo. Buena para presentar al directorio (somos exigentes). Resiliente, las métricas digitales fluctúan y no puede entrar en pánico.

Cris: Plazo?

Cliente: 60 días. El calce con el equipo importa.
`.trim(),
  },
];
