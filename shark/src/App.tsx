import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import AdminLayout from './layouts/AdminLayout';
import Dashboard from './pages/Dashboard';
import JobsList from './pages/JobsList';
import JobDetail from './pages/JobDetail';
import CandidatesList from './pages/CandidatesList';
import CandidateDetail from './pages/CandidateDetail';
import Comparativo from './pages/Comparativo';
import { ReportsStub, InboxStub, SettingsStub } from './pages/Stubs';
import PublicReport from './pages/public/PublicReport';
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

function ProtectedAdmin() {
  return (
    <>
      <SignedOut>
        <SignedOutLanding />
      </SignedOut>
      <SignedIn>
        <Routes>
          <Route path="/" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="jobs" element={<JobsList />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="jobs/:id/comparar" element={<Comparativo />} />
            <Route path="candidates" element={<CandidatesList />} />
            <Route path="candidates/:id" element={<CandidateDetail />} />
            <Route path="reports" element={<ReportsStub />} />
            <Route path="inbox" element={<InboxStub />} />
            <Route path="settings" element={<SettingsStub />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SignedIn>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Public routes — no Clerk auth required */}
        <Route path="/report/:token" element={<PublicReport />} />
        {/* Everything else requires login */}
        <Route path="/*" element={<ProtectedAdmin />} />
      </Routes>
    </HashRouter>
  );
}
