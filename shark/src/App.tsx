import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import ErrorBoundary from './components/ErrorBoundary';
import AdminLayout from './layouts/AdminLayout';
import JobsList from './pages/JobsList';  // eager: primera página al loggear

// Admin pages — lazy loaded
const Dashboard = lazy(() => import('./pages/Dashboard'));
const JobDetail = lazy(() => import('./pages/JobDetail'));
const JobForm = lazy(() => import('./pages/JobForm'));
const CandidatesList = lazy(() => import('./pages/CandidatesList'));
const CandidateDetail = lazy(() => import('./pages/CandidateDetail'));
const Comparativo = lazy(() => import('./pages/Comparativo'));
const DraftsList = lazy(() => import('./pages/DraftsList'));
const DraftReview = lazy(() => import('./pages/DraftReview'));
const BotReviewQueue = lazy(() => import('./pages/BotReviewQueue'));
const Reportes = lazy(() => import('./pages/Reportes'));
const InboxOutbound = lazy(() => import('./pages/InboxOutbound'));
const Settings = lazy(() => import('./pages/Settings'));
const EmailPreviews = lazy(() => import('./pages/EmailPreviews'));
const HelpCenter = lazy(() => import('./pages/HelpCenter'));
const MarketingLeads = lazy(() => import('./pages/MarketingLeads'));

// Public pages — lazy loaded (cada candidato carga solo lo que necesita)
const PublicReport = lazy(() => import('./pages/public/PublicReport'));
const ClientPortalLanding = lazy(() => import('./pages/public/ClientPortalLanding'));
const ClientDraftReview = lazy(() => import('./pages/public/ClientDraftReview'));
const ClientPortalJobView = lazy(() => import('./pages/public/ClientPortalJob'));
const CandidateTestEntry = lazy(() => import('./pages/public/CandidateTestEntry'));
const CandidateDiscTest = lazy(() => import('./pages/public/CandidateDiscTest'));
const CandidateTecnicaTest = lazy(() => import('./pages/public/CandidateTecnicaTest'));
const CandidateVelnaTest = lazy(() => import('./pages/public/CandidateVelnaTest'));
const CandidateIntegridadTest = lazy(() => import('./pages/public/CandidateIntegridadTest'));
const CandidateVideoTest = lazy(() => import('./pages/public/CandidateVideoTest'));
const CandidateMindsetTest = lazy(() => import('./pages/public/CandidateMindsetTest'));
const CandidateEnglishTest = lazy(() => import('./pages/public/CandidateEnglishTest'));
const CandidatePrefilter = lazy(() => import('./pages/public/CandidatePrefilter'));
const CandidateApply = lazy(() => import('./pages/public/CandidateApply'));
const CandidateRecovery = lazy(() => import('./pages/public/CandidateRecovery'));
const CandidateTestDone = lazy(() => import('./pages/public/CandidateTestDone'));
const DemoTestRegister = lazy(() => import('./pages/public/DemoTestRegister'));
const DemoReport = lazy(() => import('./pages/public/DemoReport'));

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

function LoadingSimple() {
  return (
    <div style={{ padding: '2rem' }}>
      <Skeleton width="40%" height={28} className="skel-mb" />
      <Skeleton width="100%" height={200} className="skel-mb" />
    </div>
  );
}

function lazyRoute(node: React.ReactNode, context: string, fallback: React.ReactNode = <LoadingSimple />) {
  return (
    <ErrorBoundary context={context}>
      <Suspense fallback={fallback}>{node}</Suspense>
    </ErrorBoundary>
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
            <Route index element={lazyRoute(<Dashboard />, 'dashboard', <LoadingPage />)} />
            <Route path="jobs" element={<ErrorBoundary context="jobs-list"><JobsList /></ErrorBoundary>} />
            <Route path="jobs/new" element={lazyRoute(<JobForm mode="create" />, 'job-new')} />
            <Route path="jobs/:id" element={lazyRoute(<JobDetail />, 'job-detail')} />
            <Route path="jobs/:id/edit" element={lazyRoute(<JobForm mode="edit" />, 'job-edit')} />
            <Route path="jobs/:id/comparar" element={lazyRoute(<Comparativo />, 'comparativo')} />
            <Route path="candidates" element={lazyRoute(<CandidatesList />, 'candidates-list')} />
            <Route path="candidates/:id" element={lazyRoute(<CandidateDetail />, 'candidate-detail')} />
            <Route path="drafts" element={lazyRoute(<DraftsList />, 'drafts-list')} />
            <Route path="drafts/:id" element={lazyRoute(<DraftReview />, 'draft-review')} />
            <Route path="bot/review" element={lazyRoute(<BotReviewQueue />, 'bot-review')} />
            <Route path="reports" element={lazyRoute(<Reportes />, 'reportes')} />
            <Route path="inbox" element={lazyRoute(<InboxOutbound />, 'inbox')} />
            <Route path="settings" element={lazyRoute(<Settings />, 'settings')} />
            <Route path="emails" element={lazyRoute(<EmailPreviews />, 'emails')} />
            <Route path="marketing/leads" element={lazyRoute(<MarketingLeads />, 'marketing-leads')} />
            <Route path="help" element={lazyRoute(<HelpCenter />, 'help')} />
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
        <Route path="/report/:token" element={lazyRoute(<PublicReport />, 'public-report')} />
        <Route path="/portal/:token" element={lazyRoute(<ClientPortalLanding />, 'client-portal-landing')} />
        <Route path="/portal/:token/jobs/:jobId" element={lazyRoute(<ClientPortalJobView />, 'client-portal-job')} />
        <Route path="/portal/:token/draft/:draftId" element={lazyRoute(<ClientDraftReview />, 'client-draft-review')} />
        <Route path="/test/:token" element={lazyRoute(<CandidateTestEntry />, 'candidate-entry')} />
        <Route path="/test/:token/tecnica" element={lazyRoute(<CandidateTecnicaTest />, 'candidate-tecnica')} />
        <Route path="/test/:token/velna" element={lazyRoute(<CandidateVelnaTest />, 'candidate-velna')} />
        <Route path="/test/:token/disc" element={lazyRoute(<CandidateDiscTest />, 'candidate-disc')} />
        <Route path="/test/:token/integridad" element={lazyRoute(<CandidateIntegridadTest />, 'candidate-integridad')} />
        <Route path="/test/:token/videos" element={lazyRoute(<CandidateVideoTest />, 'candidate-videos')} />
        <Route path="/test/:token/seccion2" element={lazyRoute(<CandidateMindsetTest />, 'candidate-mindset')} />
        <Route path="/test/:token/ingles" element={lazyRoute(<CandidateEnglishTest />, 'candidate-english')} />
        <Route path="/test/:token/prefilter" element={lazyRoute(<CandidatePrefilter />, 'candidate-prefilter')} />
        <Route path="/demo-test/:section/:token" element={lazyRoute(<DemoTestRegister />, 'demo-test-register')} />
        <Route path="/demo-report/:token" element={lazyRoute(<DemoReport />, 'demo-report')} />
        <Route path="/apply/:tenantSlug/:jobSlug" element={lazyRoute(<CandidateApply />, 'candidate-apply')} />
        <Route path="/apply/:tenantSlug/:jobSlug/recover" element={lazyRoute(<CandidateRecovery />, 'candidate-recovery')} />
        <Route path="/test/:token/done" element={lazyRoute(<CandidateTestDone />, 'candidate-done')} />
        <Route path="/*" element={<ErrorBoundary context="admin-app"><ProtectedAdmin /></ErrorBoundary>} />
      </Routes>
    </HashRouter>
  );
}
