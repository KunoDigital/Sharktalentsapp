/**
 * Banner que se muestra cuando un endpoint devuelve 503 con `code: table_not_ready`.
 *
 * Las tablas Block 2 son opcionales — si Cris todavía no las creó en Catalyst,
 * el backend responde con 503 graceful. Este componente da contexto al usuario.
 */
type Props = {
  /** Nombre de la tabla pendiente. Ej: "CandidatePool" */
  tableName: string;
  /** Sección del doc MIGRATIONS_BLOCK2.md donde está el schema. Ej: "§15" */
  migrationSection?: string;
  /** Qué pasa cuando la tabla esté creada (descripción del feature) */
  unlocksFeature?: string;
};

export function TableNotReadyBanner({ tableName, migrationSection, unlocksFeature }: Props) {
  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        borderRadius: '6px',
        color: '#f59e0b',
        fontSize: 14,
      }}
    >
      ⚠️ La tabla <code>{tableName}</code> todavía no se creó en Catalyst Console.
      {migrationSection && <> Ver <code>MIGRATIONS_BLOCK2.md {migrationSection}</code>.</>}
      {unlocksFeature && <> Cuando la crees: {unlocksFeature}.</>}
    </div>
  );
}

export default TableNotReadyBanner;
