import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './components/AdminLayout';
import RequireAuth from './components/RequireAuth';
import Login from './pages/admin/Login';
import JobList from './pages/admin/JobList';
import JobCreate from './pages/admin/JobCreate';
import JobDetail from './pages/admin/JobDetail';
import JobPipeline from './pages/admin/JobPipeline';
import CandidateList from './pages/admin/CandidateList';
import TechLibrary from './pages/admin/TechLibrary';
import CandidateReport from './pages/admin/CandidateReport';
import IntegrityResults from './pages/admin/IntegrityResults';
import CompareView from './pages/admin/CompareView';
import Costos from './pages/admin/Costos';
import Reportes from './pages/admin/Reportes';
import ReportPreparation from './pages/admin/ReportPreparation';
import ClientReport from './pages/public/ClientReport';
import TestEntry from './pages/candidate/TestEntry';
import TestQuestions from './pages/candidate/TestQuestions';
import TestDone from './pages/candidate/TestDone';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Login */}
        <Route path="/admin/login" element={<Login />} />

        {/* Admin routes with sidebar layout — protected */}
        <Route element={<RequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<JobList />} />
            <Route path="/admin/jobs/new" element={<JobCreate />} />
            <Route path="/admin/jobs/:id" element={<JobDetail />} />
            <Route path="/admin/jobs/:id/pipeline" element={<JobPipeline />} />
            <Route path="/admin/jobs/:id/candidates/:candidateId/report" element={<CandidateReport />} />
            <Route path="/admin/jobs/:id/integrity" element={<IntegrityResults />} />
            <Route path="/admin/jobs/:id/compare" element={<CompareView />} />
            <Route path="/admin/candidates" element={<CandidateList />} />
            <Route path="/admin/library" element={<TechLibrary />} />
            <Route path="/admin/reportes" element={<Reportes />} />
            <Route path="/admin/costos" element={<Costos />} />
            <Route path="/admin/jobs/:id/client-report" element={<ReportPreparation />} />
            <Route path="/admin/jobs/:id/client-report/:reportId" element={<ReportPreparation />} />
          </Route>
        </Route>

        {/* Public routes (no sidebar, no auth) */}
        <Route path="/report/:companySlug/:jobSlug" element={<ClientReport />} />
        <Route path="/report/:companySlug/:jobSlug/:reportId" element={<ClientReport />} />
        <Route path="/test/:token" element={<TestEntry />} />
        <Route path="/test/:token/questions" element={<TestQuestions />} />
        <Route path="/test/:token/done" element={<TestDone />} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </HashRouter>
  );
}
