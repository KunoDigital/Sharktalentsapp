import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import AdminLayout from './layouts/AdminLayout';
import Dashboard from './pages/Dashboard';
import JobsList from './pages/JobsList';
import JobDetail from './pages/JobDetail';
import CandidatesList from './pages/CandidatesList';
import { ReportsStub, InboxStub, SettingsStub } from './pages/Stubs';
import './App.css';

function SignedOutLanding() {
  return (
    <div className="signed-out-landing">
      <h1>SharkTalents</h1>
      <p>Plataforma multi-tenant de evaluación de talento.</p>
      <SignInButton mode="modal">
        <button className="btn-primary">Iniciar sesión</button>
      </SignInButton>
    </div>
  );
}

export default function App() {
  return (
    <>
      <SignedOut>
        <SignedOutLanding />
      </SignedOut>
      <SignedIn>
        <HashRouter>
          <Routes>
            <Route path="/" element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="jobs" element={<JobsList />} />
              <Route path="jobs/:id" element={<JobDetail />} />
              <Route path="candidates" element={<CandidatesList />} />
              <Route path="reports" element={<ReportsStub />} />
              <Route path="inbox" element={<InboxStub />} />
              <Route path="settings" element={<SettingsStub />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </SignedIn>
    </>
  );
}
