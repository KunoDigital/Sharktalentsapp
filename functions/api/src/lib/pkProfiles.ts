/**
 * Catálogo de 27 arquetipos PK derivados del DISC (ver outbox.ts:768 para fuente).
 * Cada arquetipo tiene un código (PK-01 a PK-27), nombre y vector DISC ideal.
 *
 * derivePkProfile(disc) encuentra el arquetipo más cercano al perfil del candidato
 * por distancia euclidiana en el espacio DISC (D, I, S, C en 0-100).
 *
 * Usado en submit DISC para guardar disc_pk_profile_code y disc_pk_profile_name
 * en Scores, para que el Comparativo los muestre.
 */

export type PkProfile = {
  code: string;
  name: string;
  d: number;
  i: number;
  s: number;
  c: number;
};

export const PK_CATALOG: PkProfile[] = [
  { code: 'PK-01', name: 'Flexible/Independiente/Cooperativo',     d: 80,  i: 20,  s: 80,  c: 20 },
  { code: 'PK-02', name: 'Empático/Brinda apoyo/Escucha',          d: 20,  i: 80,  s: 80,  c: 20 },
  { code: 'PK-03', name: 'Sociable/Persuasivo/Analítico',          d: 20,  i: 80,  s: 20,  c: 80 },
  { code: 'PK-04', name: 'Perfeccionista/Planificado/Resultados',  d: 80,  i: 20,  s: 20,  c: 80 },
  { code: 'PK-05', name: 'Decidido/Tenaz/Competitivo',             d: 100, i: 35,  s: 30,  c: 35 },
  { code: 'PK-06', name: 'Determinado/Directo/Persuasivo',         d: 80,  i: 80,  s: 20,  c: 20 },
  { code: 'PK-07', name: 'Cauteloso/Planificado/Estructurado',     d: 50,  i: 10,  s: 90,  c: 50 },
  { code: 'PK-08', name: 'Preciso/Analítico/Calidad',              d: 35,  i: 30,  s: 35,  c: 100 },
  { code: 'PK-09', name: 'Preciso/Cauteloso/Paciente',             d: 20,  i: 20,  s: 80,  c: 80 },
  { code: 'PK-10', name: 'Extrovertido/Entusiasta/Flexible',       d: 50,  i: 90,  s: 10,  c: 50 },
  { code: 'PK-11', name: 'Minucioso/Diplomático/Calidad',          d: 0,   i: 70,  s: 50,  c: 80 },
  { code: 'PK-12', name: 'Cauteloso/Persuasivo/Cooperativo',       d: 0,   i: 65,  s: 70,  c: 65 },
  { code: 'PK-13', name: 'Moderado/Amigable/Persistente',          d: 10,  i: 50,  s: 90,  c: 50 },
  { code: 'PK-14', name: 'Persuasivo/Acción/Disfruta retos',       d: 90,  i: 50,  s: 10,  c: 50 },
  { code: 'PK-15', name: 'Comunicativo/Amigable/Multitarea',       d: 10,  i: 90,  s: 50,  c: 50 },
  { code: 'PK-16', name: 'Independiente/Arriesgado/Resultados',    d: 90,  i: 50,  s: 50,  c: 10 },
  { code: 'PK-17', name: 'Directo/Analítico/Arriesgado',           d: 90,  i: 10,  s: 50,  c: 50 },
  { code: 'PK-18', name: 'Independiente/Sociable/Determinado',     d: 60,  i: 80,  s: 60,  c: 0 },
  { code: 'PK-19', name: 'Socialmente hábil/Considerado/Rápido',   d: 60,  i: 80,  s: 0,   c: 60 },
  { code: 'PK-20', name: 'Pragmático/Cauteloso/Paciente',          d: 60,  i: 0,   s: 80,  c: 60 },
  { code: 'PK-21', name: 'Sociable/Rápido/Autoconfianza',          d: 50,  i: 90,  s: 50,  c: 10 },
  { code: 'PK-22', name: 'Persistente/Estabilidad/Flexible',       d: 50,  i: 50,  s: 90,  c: 10 },
  { code: 'PK-23', name: 'Minucioso/Detalles/Multitarea',          d: 50,  i: 50,  s: 10,  c: 90 },
  { code: 'PK-24', name: 'Minucioso/Cauteloso/Estructurado',       d: 50,  i: 10,  s: 50,  c: 90 },
  { code: 'PK-25', name: 'Paciente/Estabilidad/Calmado',           d: 35,  i: 30,  s: 100, c: 35 },
  { code: 'PK-26', name: 'Metódico/Estabilidad/Relaciones',        d: 10,  i: 50,  s: 50,  c: 90 },
  { code: 'PK-27', name: 'Amigable/Comunicativo/Extrovertido',     d: 30,  i: 100, s: 35,  c: 35 },
];

/**
 * Encuentra el arquetipo PK más cercano al perfil DISC dado, por distancia euclidiana.
 * Retorna null si el input es inválido (algún eje no es número).
 */
export function derivePkProfile(disc: { d: number; i: number; s: number; c: number } | null | undefined): PkProfile | null {
  if (!disc) return null;
  const { d, i, s, c } = disc;
  if (!Number.isFinite(d) || !Number.isFinite(i) || !Number.isFinite(s) || !Number.isFinite(c)) return null;

  let bestProfile: PkProfile = PK_CATALOG[0];
  let bestDistance = Infinity;
  for (const pk of PK_CATALOG) {
    const dist = Math.sqrt(
      Math.pow(d - pk.d, 2) +
      Math.pow(i - pk.i, 2) +
      Math.pow(s - pk.s, 2) +
      Math.pow(c - pk.c, 2),
    );
    if (dist < bestDistance) {
      bestDistance = dist;
      bestProfile = pk;
    }
  }
  return bestProfile;
}
