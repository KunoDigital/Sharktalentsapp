import axios from 'axios';

// In production (Catalyst): /server/sharktalents/api
// In development (local): /api
const isProd = window.location.hostname !== 'localhost';
const api = axios.create({ baseURL: isProd ? '/server/sharktalents/api' : '/api' });

// Attach auth token to all requests via custom header (Catalyst intercepts Authorization)
api.interceptors.request.use(config => {
  const token = localStorage.getItem('shark_token');
  if (token) config.headers['X-Auth-Token'] = token;
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/admin/login')) {
      localStorage.removeItem('shark_token');
      localStorage.removeItem('shark_user');
      window.location.hash = '#/admin/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (username: string, password: string) =>
  api.post('/admin/login', { username, password }).then(r => r.data);
export const getAuthToken = () => localStorage.getItem('shark_token');
export const getAuthUser = () => localStorage.getItem('shark_user');
export const setAuth = (token: string, username: string) => {
  localStorage.setItem('shark_token', token);
  localStorage.setItem('shark_user', username);
};
export const logout = () => {
  localStorage.removeItem('shark_token');
  localStorage.removeItem('shark_user');
};

// Admin — Jobs
export const getJobs = () => api.get('/admin/jobs').then(r => r.data);
export const createJob = (data: {
  title: string;
  company: string;
  tech_prompt?: string;
  cognitive_level: string;
  ideal_profile?: Record<string, unknown>;
  ideal_competencias?: { id: string; nivel_esperado: number }[];
}) => api.post('/admin/jobs', data).then(r => r.data);
export const getJob = (id: string) => api.get(`/admin/jobs/${id}`).then(r => r.data);
export const updateJob = (id: string, data: Record<string, unknown>) =>
  api.put(`/admin/jobs/${id}`, data).then(r => r.data);
export const archiveJob = (id: string) =>
  api.delete(`/admin/jobs/${id}`).then(r => r.data);
export const getJobAssessments = (id: string) =>
  api.get(`/admin/jobs/${id}/assessments`).then(r => r.data);

export const createAssessments = (id: string) =>
  api.post(`/admin/jobs/${id}/create-assessments`).then(r => r.data);
export const getJobsCosts = () => api.get('/admin/jobs/costs').then(r => r.data);
export const updateCostConfig = (id: string, data: { client_type: string; salary: number; advertising: number; hours: number }) =>
  api.put(`/admin/jobs/${id}/cost-config`, data).then(r => r.data);
export const generateTechnical = (id: string) =>
  api.post(`/admin/jobs/${id}/generate-technical`).then(r => r.data);
export const getTechnicalQuestions = (id: string) =>
  api.get(`/admin/jobs/${id}/technical/questions`).then(r => r.data);
export const updateTechnicalQuestion = (jobId: string, questionId: string, data: { text?: string; options?: string[]; correct?: number }) =>
  api.patch(`/admin/jobs/${jobId}/technical/questions/${questionId}`, data).then(r => r.data);
export const regenerateTechnical = (id: string, prompt: string) =>
  api.post(`/admin/jobs/${id}/regenerate-technical`, { prompt }).then(r => r.data);
export const getCompetenciasList = () =>
  api.get('/admin/jobs/competencias/list').then(r => r.data);
export const suggestProfile = (data: { jobTitle: string; competencias: { id: string; nombre: string }[] }) =>
  api.post('/admin/jobs/suggest-profile', data).then(r => r.data);

// Admin — Results & Comparison
export const getJobResults = (id: string) => api.get(`/admin/jobs/${id}/results`).then(r => r.data);
export const getComparison = (id: string) => api.get(`/admin/jobs/${id}/comparison`).then(r => r.data);
export const exportCandidatesCsv = (id: string) => api.get(`/admin/jobs/${id}/export-candidates`, { responseType: 'blob' }).then(r => r.data);
export const copyCandidateToJob = (candidateId: number, targetJobId: string) =>
  api.post(`/admin/candidates/${candidateId}/copy-to-job/${targetJobId}`).then(r => r.data);
export const getResult = (id: string) => api.get(`/admin/results/${id}`).then(r => r.data);
export const getPipeline = (id: string) => api.get(`/admin/jobs/${id}/pipeline`).then(r => r.data);
export const downloadReport = (jobId: string, candidateId: number): Promise<Blob> =>
  api.get(`/admin/jobs/${jobId}/report/${candidateId}`, { responseType: 'blob' }).then(r => r.data);
export const markReviewed = (resultId: number) =>
  api.patch(`/admin/results/${resultId}/mark-reviewed`).then(r => r.data);
export const setPipelineStage = (resultId: number, stage: string | null) =>
  api.patch(`/admin/results/${resultId}/pipeline-stage`, { stage }).then(r => r.data);
export const getIntegrityResults = (jobId: string) =>
  api.get(`/admin/jobs/${jobId}/integrity-results`).then(r => r.data);
export const getReportData = (jobId: string, candidateId: number) =>
  api.get(`/admin/jobs/${jobId}/report-data/${candidateId}`).then(r => r.data);
export const getCandidateProfile = (candidateId: number, jobId?: string) =>
  api.get(`/admin/results/candidate/${candidateId}/profile${jobId ? `?jobId=${jobId}` : ''}`).then(r => r.data);

// Admin — Candidates
export const getCandidates = () => api.get('/admin/candidates').then(r => r.data);
export const searchCandidates = (q: string) => api.get(`/admin/candidates/search?q=${encodeURIComponent(q)}`).then(r => r.data);

// Admin — Library
export const getLibrary = () => api.get('/admin/library').then(r => r.data);
export const createLibraryItem = (data: { name: string; company?: string; prompt: string }) =>
  api.post('/admin/library', data).then(r => r.data);
export const deleteLibraryItem = (id: number) => api.delete(`/admin/library/${id}`).then(r => r.data);

// Admin — Client Reports
export const createClientReport = (jobId: string, candidateIds: string[]) =>
  api.post(`/admin/jobs/${jobId}/client-report`, { candidate_ids: candidateIds }).then(r => r.data);
export const getClientReport = (jobId: string) =>
  api.get(`/admin/jobs/${jobId}/client-report`).then(r => r.data);
export const getClientReportById = (reportId: string) =>
  api.get(`/admin/client-report/${reportId}`).then(r => r.data);
export const listClientReports = (jobId: string) =>
  api.get(`/admin/jobs/${jobId}/client-reports`).then(r => r.data);
export const generateReportExplanations = (reportId: string) =>
  api.post(`/admin/client-report/${reportId}/generate-explanations`).then(r => r.data);
export const updateReportCandidate = (reportId: string, rcId: string, data: Record<string, unknown>) =>
  api.patch(`/admin/client-report/${reportId}/candidates/${rcId}`, data).then(r => r.data);
export const publishReport = (reportId: string) =>
  api.patch(`/admin/client-report/${reportId}/publish`).then(r => r.data);
export const analyzeTranscript = (reportId: string, rcId: string, transcript: string) =>
  api.post(`/admin/client-report/${reportId}/candidates/${rcId}/analyze-transcript`, { transcript }).then(r => r.data);
export const generateComparison = (reportId: string) =>
  api.post(`/admin/client-report/${reportId}/generate-comparison`).then(r => r.data);

// Public — Report (no auth)
export const getPublicReport = (companySlug: string, jobSlug: string, reportId?: string, lang?: string) => {
  const base = `${isProd ? '/server/sharktalents/api' : '/api'}/public/report/${companySlug}/${jobSlug}`;
  const url = reportId ? `${base}/${reportId}` : base;
  const params = lang && lang !== 'es' ? `?lang=${lang}` : '';
  return axios.get(url + params).then(r => r.data);
};

// Public — Test
export const getTest = (token: string) => api.get(`/public/test/${token}`).then(r => r.data);
export const startTest = (token: string, data: { name: string; email: string; phone?: string; age?: number; salary_expectation?: number; availability?: string }) =>
  api.post(`/public/test/${token}/start`, data).then(r => r.data);
export const savePartialAnswers = (token: string, data: { email: string; answers: Record<string, number> }) =>
  api.post(`/public/test/${token}/save`, data).then(r => r.data);
export const submitTest = (token: string, data: { email: string; answers: Record<string, number>; screen_exits?: number; screen_exit_log?: any[] }) =>
  api.post(`/public/test/${token}/submit`, data).then(r => r.data);
