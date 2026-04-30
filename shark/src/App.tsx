import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import ErrorBoundary from './components/ErrorBoundary';
import AdminLayout from './layouts/AdminLayout';
import JobsList from './pages/JobsList';

// Lazy: Dashboard (recharts ~210KB), PublicReport (jsPDF + html2canvas, ~200KB)
const Dashboard = lazy(() => import('./pages/Dashboard'));
import JobDetail from './pages/JobDetail';
import JobForm from './pages/JobForm';
import CandidatesList from './pages/CandidatesList';
import CandidateDetail from './pages/CandidateDetail';
import Comparativo from './pages/Comparativo';
import DraftsList from './pages/DraftsList';
import DraftReview from './pages/DraftReview';
import BotReviewQueue from './pages/BotReviewQueue';
import Reportes from './pages/Reportes';
import InboxOutbound from './pages/InboxOutbound';
import Settings from './pages/Settings';
import EmailPreviews from './pages/EmailPreviews';
import HelpCenter from './pages/HelpCenter';
import PublicReport from './pages/public/PublicReport';
import ClientPortalLanding from './pages/public/ClientPortalLanding';
import ClientPortalJobView from './pages/public/ClientPortalJob';
import CandidateTestEntry from './pages/public/CandidateTestEntry';
import CandidateDiscTest from './pages/public/CandidateDiscTest';
import CandidateTecnicaTest from './pages/public/CandidateTecnicaTest';
import CandidateVelnaTest from './pages/public/CandidateVelnaTest';
import CandidateIntegridadTest from './pages/public/CandidateIntegridadTest';
import CandidateVideoTest from './pages/public/CandidateVideoTest';
import CandidateApply from './pages/public/CandidateApply';
import CandidateTestDone from './pages/public/CandidateTestDone';
import { Skeleton, SkeletonStatCard, SkeletonChart } from './components/Skeleton';
import './App.css';
import './components/error-boundary.css';

function LoadingPage() {
  return (
    <div style={{ padding: '2rem' }}>
      <Skeleton width="40%" height={28} className="skel-mb" />
      <Skeleton width="60%" height={14} className="skel-mb" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: '2rem' }}>
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginTop: '1.5rem' }}>
        <SkeletonChart />
        <SkeletonChart height={180} />
        <SkeletonChart height={180} />
      </div>
    </div>
  );
}

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
            <Route index element={<ErrorBoundary context="dashboard"><Suspense fallback={<LoadingPage />}><Dashboard /></Suspense></ErrorBoundary>} />
            <Route path="jobs" element={<ErrorBoundary context="jobs-list"><JobsList /></ErrorBoundary>} />
            <Route path="jobs/new" element={<ErrorBoundary context="job-new"><JobForm mode="create" /></ErrorBoundary>} />
            <Route path="jobs/:id" element={<ErrorBoundary context="job-detail"><JobDetail /></ErrorBoundary>} />
            <Route path="jobs/:id/edit" element={<ErrorBoundary context="job-edit"><JobForm mode="edit" /></ErrorBoundary>} />
            <Route path="jobs/:id/comparar" element={<ErrorBoundary context="comparativo"><Comparativo /></ErrorBoundary>} />
            <Route path="candidates" element={<ErrorBoundary context="candidates-list"><CandidatesList /></ErrorBoundary>} />
            <Route path="candidates/:id" element={<ErrorBoundary context="candidate-detail"><CandidateDetail /></ErrorBoundary>} />
            <Route path="drafts" element={<ErrorBoundary context="drafts-list"><DraftsList /></ErrorBoundary>} />
            <Route path="drafts/:id" element={<ErrorBoundary context="draft-review"><DraftReview /></ErrorBoundary>} />
            <Route path="bot/review" element={<ErrorBoundary context="bot-review"><BotReviewQueue /></ErrorBoundary>} />
            <Route path="reports" element={<ErrorBoundary context="reportes"><Reportes /></ErrorBoundary>} />
            <Route path="inbox" element={<ErrorBoundary context="inbox"><InboxOutbound /></ErrorBoundary>} />
            <Route path="settings" element={<ErrorBoundary context="settings"><Settings /></ErrorBoundary>} />
            <Route path="emails" element={<ErrorBoundary context="emails"><EmailPreviews /></ErrorBoundary>} />
            <Route path="help" element={<ErrorBoundary context="help"><HelpCenter /></ErrorBoundary>} />
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
        <Route path="/report/:token" element={<ErrorBoundary context="public-report"><PublicReport /></ErrorBoundary>} />
        <Route path="/portal/:token" element={<ErrorBoundary context="client-portal-landing"><ClientPortalLanding /></ErrorBoundary>} />
        <Route path="/portal/:token/jobs/:jobId" element={<ErrorBoundary context="client-portal-job"><ClientPortalJobView /></ErrorBoundary>} />
        <Route path="/test/:token" element={<ErrorBoundary context="candidate-entry"><CandidateTestEntry /></ErrorBoundary>} />
        <Route path="/test/:token/tecnica" element={<ErrorBoundary context="candidate-tecnica"><CandidateTecnicaTest /></ErrorBoundary>} />
        <Route path="/test/:token/velna" element={<ErrorBoundary context="candidate-velna"><CandidateVelnaTest /></ErrorBoundary>} />
        <Route path="/test/:token/disc" element={<ErrorBoundary context="candidate-disc"><CandidateDiscTest /></ErrorBoundary>} />
        <Route path="/test/:token/integridad" element={<ErrorBoundary context="candidate-integridad"><CandidateIntegridadTest /></ErrorBoundary>} />
        <Route path="/test/:token/videos" element={<ErrorBoundary context="candidate-videos"><CandidateVideoTest /></ErrorBoundary>} />
        <Route path="/apply/:tenantSlug/:jobSlug" element={<ErrorBoundary context="candidate-apply"><CandidateApply /></ErrorBoundary>} />
        <Route path="/test/:token/done" element={<ErrorBoundary context="candidate-done"><CandidateTestDone /></ErrorBoundary>} />
        <Route path="/*" element={<ErrorBoundary context="admin-app"><ProtectedAdmin /></ErrorBoundary>} />
      </Routes>
    </HashRouter>
  );
}
