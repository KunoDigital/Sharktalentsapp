import './pages.css';

export function ReportsStub() {
  return (
    <div>
      <h1 className="page-title">Reportes</h1>
      <p className="page-subtitle">Reportes generados al cliente.</p>
      <div className="stub-card">
        <p>📄 Próxima iteración: lista de reportes con preview, filtros por job y cliente, descarga PDF/EN.</p>
        <p className="muted-note">Ver master plan §15 (API pública) y §17 (portal cliente).</p>
      </div>
    </div>
  );
}

export function InboxStub() {
  return (
    <div>
      <h1 className="page-title">Inbox outbound</h1>
      <p className="page-subtitle">Respuestas de candidatos vía LinkedIn (HeyReach) + email.</p>
      <div className="stub-card">
        <p>📬 Próxima iteración: inbox unificada con threads, filtros por campaña, status de outreach.</p>
        <p className="muted-note">Ver master plan §22 (outbound sourcing).</p>
      </div>
    </div>
  );
}

export function SettingsStub() {
  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Configuración del tenant.</p>
      <div className="stub-card">
        <p>⚙️ Próxima iteración: API keys, integraciones Zoho, branding, plan + billing, equipo.</p>
        <p className="muted-note">Ver master plan §15 (API pública), §23 (integraciones Zoho).</p>
      </div>
    </div>
  );
}
