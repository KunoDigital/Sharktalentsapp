import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  OrganizationSwitcher,
  useOrganization,
} from '@clerk/clerk-react';
import './App.css';

function AdminShell() {
  const { organization, isLoaded } = useOrganization();

  return (
    <div className="App">
      <header className="App-header" style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'space-between', padding: '1rem' }}>
        <h1 style={{ margin: 0 }}>SharkTalents</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" />
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>
      <main style={{ padding: '2rem' }}>
        {!isLoaded && <p>Cargando…</p>}
        {isLoaded && !organization && (
          <div>
            <h2>Sin organización activa</h2>
            <p>Creá una organización en el menú superior para empezar.</p>
          </div>
        )}
        {isLoaded && organization && (
          <div>
            <h2>Tenant activo: {organization.name}</h2>
            <p>Slug: {organization.slug}</p>
            <p>Clerk org id: <code>{organization.id}</code></p>
            <p style={{ color: '#6b7280' }}>
              (Próximas iteraciones agregan: jobs, candidatos, pipeline, reportes…)
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <>
      <SignedOut>
        <div style={{ padding: '4rem 2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <h1>SharkTalents</h1>
          <p>Plataforma multi-tenant de evaluación de talento.</p>
          <SignInButton mode="modal">
            <button style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: 'pointer' }}>
              Iniciar sesión
            </button>
          </SignInButton>
        </div>
      </SignedOut>
      <SignedIn>
        <AdminShell />
      </SignedIn>
    </>
  );
}

export default App;
