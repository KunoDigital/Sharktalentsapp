import type { RequestContext } from './lib/context';
import { AppError } from './lib/errors';
import { sendJson } from './lib/http';
import { logger } from './lib/logger';
import { requireAuth } from './lib/auth';
import { reportError } from './lib/errorTracker';
import { metrics } from './lib/metrics';
import { getHealth, getAdminHealthCheck, getIntegrationsStatus } from './features/health';
import { handleClerkWebhook, requireTenant, getMyBranding, updateMyBranding } from './features/tenants';
import { handleHeyReachWebhook } from './features/heyreachWebhook';
import { handleZiaWebhook } from './features/ziaWebhook';
import { handleZohoSignWebhook } from './features/zohoSignWebhook';
import { handleZohoRecruitWebhook } from './features/zohoRecruitWebhook';
import { handleWhatsAppWebhook } from './features/whatsappWebhook';
import { verifyTables, listAllTenants, getAdminStats, anthropicPing, listAuditLog, issuePortalToken, listAntiCheatEvents, listEmailTemplates, getMetricsSnapshot } from './features/admin';
import { processOutbox, listOutbox, processOutboxFromTenant, listOutboxFromTenant, searchOutboxByRecipient } from './features/outbox';
import { exportCandidateData, deleteCandidateData, purgeOldVideos } from './features/gdpr';
import { listJobs, getJob, createJob, patchJob, archiveJob, generateJobTechQuestions, notifyClientReportReady, retryRecruitSync, inspectRecruitJobOpeningFields, dumpRecruitJobOpening, forcePublishRecruitJob } from './features/jobs';
import { listCandidates, getCandidate, createCandidate, patchCandidate } from './features/candidates';
import {
  listApplications,
  getApplication,
  createApplication,
  transitionApplication,
  getApplicationTransitions,
} from './features/applications';
import { writeScores, readScores } from './features/scores';
import { writeIntegrity, readIntegrity } from './features/integrity';
import { generateDraft, refineDraft } from './features/drafts';
import {
  saveJobDraft,
  listJobDrafts,
  getJobDraft,
  patchJobDraft,
  convertDraftToJob,
} from './features/jobDrafts';
import { botReview } from './features/bot';
import { listReviewQueueHandler, decideReviewQueueItem, getBotStats } from './features/reviewQueue';
import {
  generateVideosForApplication,
  listVideosForApplication,
  analyzeVideoResponse,
  listTestVideos,
  submitTestVideo,
  uploadTestVideo,
} from './features/videos';
import { submitMindsetTest, getMindsetForApplication } from './features/mindsetTest';
import { submitEnglishTest, getEnglishForApplication } from './features/englishTest';
import { approveDraftPublic, requestChangesDraftPublic, sendDraftToClient, getDraftPublic, listRecentDraftComments } from './features/jobDrafts';
import {
  listPool,
  addToPool,
  patchPoolEntry,
  removeFromPool,
  matchPool,
} from './features/candidatePool';
import { getTestStatus, submitTest, getTestTechQuestions } from './features/publicTest';
import { getPublicReport } from './features/publicReport';
import { getPublicReportBundle } from './features/publicReportBundle';
import { getClientPortal, getClientPortalJob, issuePortalForTenant } from './features/clientPortal';
import { createApiKey, listApiKeys, patchApiKey, revokeApiKey } from './features/apiKeys';
import { getOpenApiSpec, getApiDocs } from './features/openApiSpec';
import { getPublicJobInfo, submitApplication } from './features/publicApply';
import { resendCandidateLink } from './features/publicRecovery';
import { handleRecruitTestLink } from './features/recruitTestLink';
import { listReports } from './features/reports';
import { getTenantConfig, patchTenantConfig } from './features/tenantConfig';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from './features/notifications';
import {
  listOutreachCampaigns,
  createOutreachCampaign,
  listOutreachInbox,
  patchOutreachInboxItem,
  replyOutreachInbox,
} from './features/outreach';
import {
  listPrefilterQuestions,
  createPrefilterQuestion,
  patchPrefilterQuestion,
  deletePrefilterQuestion,
  getPrefilterPublic,
  submitPrefilterAnswers,
  listPrefilterAnswersForApplication,
} from './features/prefilter';
import { captureLead, requestEval, getLeadStatus, listMarketingLeads, requestLeadDeletion, confirmLeadDeletion, createManualLead, convertLeadToTenant, sendDemoToLead, sendContractToLead, getContractContext, registerDemoTest, diagnoseLead, resetLead, simulateCompletion, forceCrmSync, listCrmModules, linkMarketingTenant, whoami, resendReport, adminWipeLeads, patchLead, getLeadDemoStatus, forceGenerateLeadReport, inspectIntegrityDims, renameCandidate, testIntegrityDimsInsert, importLeadFromCrm, listImportableCrmLeads, dumpCrmLead } from './features/marketing';
import { getVideoConsent, postVideoConsent, withdrawVideoConsent } from './features/videoConsents';
import { scheduleBriefing, listBriefings } from './features/briefings';
import { trackPortalEvent, listJobTracking } from './features/jobTracking';
import { sendOfferForSignature } from './features/contracts';
import { checkRateLimit } from './lib/rateLimiter';

const log = logger('ROUTER');

type Handler = (ctx: RequestContext) => Promise<void>;

/**
 * Auth modes:
 * - 'public'  → no auth, rate-limit por IP
 * - 'tenant'  → Clerk JWT + tenant scoping (rate-limit por tenant)
 * - 'admin'   → Internal API key (rate-limit por IP)
 * - 'webhook' → Auth en el handler (svix), rate-limit por IP, NO normal rate-limit
 *               (los webhooks se reintentan, no podemos limitarles bursts)
 */
type AuthMode = 'public' | 'tenant' | 'admin' | 'webhook';

type Route = { method: string; pattern: RegExp; handler: Handler; auth: AuthMode };

const routes: Route[] = [
  // Health (público, sin rate-limit)
  { method: 'GET', pattern: /^\/health\/?$/, handler: getHealth, auth: 'public' },

  // Marketing funnel — landing externa (auth via X-Marketing-Site-Key, no Clerk)
  { method: 'POST', pattern: /^\/api\/marketing\/lead\/?$/, handler: captureLead, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/eval-request\/?$/, handler: requestEval, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/demo-test\/register\/?$/, handler: registerDemoTest, auth: 'public' },
  { method: 'GET', pattern: /^\/api\/marketing\/_diagnose\/?$/, handler: diagnoseLead, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/_reset\/?$/, handler: resetLead, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/_simulate_completion\/?$/, handler: simulateCompletion, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/_force_crm_sync\/?$/, handler: forceCrmSync, auth: 'public' },
  { method: 'GET', pattern: /^\/api\/marketing\/_list_crm_modules\/?$/, handler: listCrmModules, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/_link_marketing_tenant\/?$/, handler: linkMarketingTenant, auth: 'public' },
  { method: 'GET', pattern: /^\/api\/marketing\/_whoami\/?$/, handler: whoami, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/_resend_report\/?$/, handler: resendReport, auth: 'public' },
  { method: 'GET', pattern: /^\/api\/marketing\/lead-status\/?$/, handler: getLeadStatus, auth: 'public' },
  { method: 'POST', pattern: /^\/api\/marketing\/lead\/request-deletion\/?$/, handler: requestLeadDeletion, auth: 'public' },
  { method: 'DELETE', pattern: /^\/api\/marketing\/lead\/?$/, handler: confirmLeadDeletion, auth: 'public' },
  { method: 'GET', pattern: /^\/api\/marketing\/leads\/?$/, handler: listMarketingLeads, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/marketing\/lead-manual\/?$/, handler: createManualLead, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/marketing\/import-from-crm\/?$/, handler: importLeadFromCrm, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/marketing\/crm-leads\/?$/, handler: listImportableCrmLeads, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/marketing\/_dump_crm_lead\/?$/, handler: dumpCrmLead, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/marketing\/lead\/[^/]+\/?$/, handler: patchLead, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/marketing\/lead\/[^/]+\/demo-status\/?$/, handler: getLeadDemoStatus, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/marketing\/lead\/[^/]+\/force-report\/?$/, handler: forceGenerateLeadReport, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/_inspect_integrity_dims\/[^/]+\/?$/, handler: inspectIntegrityDims, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/_test_integrity_dims_insert\/[^/]+\/?$/, handler: testIntegrityDimsInsert, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/candidates\/[^/]+\/rename\/?$/, handler: renameCandidate, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/marketing\/_admin_wipe_leads\/?$/, handler: adminWipeLeads, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/marketing\/lead\/[^/]+\/send-demo\/?$/, handler: sendDemoToLead, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/marketing\/lead\/[^/]+\/send-contract\/?$/, handler: sendContractToLead, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/marketing\/lead\/[^/]+\/contract-context\/?$/, handler: getContractContext, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/marketing\/lead\/[^/]+\/convert-to-tenant\/?$/, handler: convertLeadToTenant, auth: 'tenant' },

  // OpenAPI / docs (público)
  { method: 'GET', pattern: /^\/api\/openapi\.json\/?$/, handler: getOpenApiSpec, auth: 'public' },
  { method: 'GET', pattern: /^\/docs\/?$/, handler: getApiDocs, auth: 'public' },

  // Webhooks (auth dentro del handler)
  { method: 'POST', pattern: /^\/api\/webhooks\/clerk\/?$/, handler: handleClerkWebhook, auth: 'webhook' },
  { method: 'POST', pattern: /^\/api\/webhooks\/heyreach\/?$/, handler: handleHeyReachWebhook, auth: 'webhook' },
  { method: 'POST', pattern: /^\/api\/webhooks\/zia\/?$/, handler: handleZiaWebhook, auth: 'webhook' },
  { method: 'POST', pattern: /^\/api\/webhooks\/zoho-sign\/?$/, handler: handleZohoSignWebhook, auth: 'webhook' },
  { method: 'POST', pattern: /^\/api\/webhooks\/zoho-recruit\/?$/, handler: handleZohoRecruitWebhook, auth: 'webhook' },
  { method: 'GET', pattern: /^\/api\/webhooks\/whatsapp\/?$/, handler: handleWhatsAppWebhook, auth: 'webhook' },
  { method: 'POST', pattern: /^\/api\/webhooks\/whatsapp\/?$/, handler: handleWhatsAppWebhook, auth: 'webhook' },

  // Admin (X-Internal-Key)
  { method: 'GET', pattern: /^\/admin\/verify-tables\/?$/, handler: verifyTables, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/tenants\/?$/, handler: listAllTenants, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/stats\/?$/, handler: getAdminStats, auth: 'admin' },
  { method: 'POST', pattern: /^\/admin\/outbox\/process\/?$/, handler: processOutbox, auth: 'admin' },
  { method: 'POST', pattern: /^\/api\/outbox\/process-now\/?$/, handler: processOutboxFromTenant, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/outbox\/recent\/?$/, handler: listOutboxFromTenant, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/outbox\/by-recipient\/?$/, handler: searchOutboxByRecipient, auth: 'tenant' },
  { method: 'GET', pattern: /^\/admin\/outbox\/?$/, handler: listOutbox, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/anthropic-ping\/?$/, handler: anthropicPing, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/gdpr\/candidate-export\/?$/, handler: exportCandidateData, auth: 'admin' },
  { method: 'POST', pattern: /^\/admin\/gdpr\/candidate-delete\/?$/, handler: deleteCandidateData, auth: 'admin' },
  { method: 'POST', pattern: /^\/admin\/gdpr\/purge-old-videos\/?$/, handler: purgeOldVideos, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/audit-log\/?$/, handler: listAuditLog, auth: 'admin' },
  { method: 'POST', pattern: /^\/admin\/portals\/issue\/?$/, handler: issuePortalToken, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/anti-cheat\/?$/, handler: listAntiCheatEvents, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/health-check\/?$/, handler: getAdminHealthCheck, auth: 'admin' },
  { method: 'GET', pattern: /^\/admin\/metrics\/?$/, handler: getMetricsSnapshot, auth: 'admin' },
  { method: 'GET', pattern: /^\/api\/email-templates\/?$/, handler: listEmailTemplates, auth: 'tenant' },

  // Jobs
  { method: 'GET', pattern: /^\/api\/jobs\/?$/, handler: listJobs, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/jobs\/?$/, handler: createJob, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/jobs\/[^/]+\/?$/, handler: getJob, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/jobs\/[^/]+\/?$/, handler: patchJob, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/jobs\/[^/]+\/tech-questions\/generate\/?$/, handler: generateJobTechQuestions, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/jobs\/[^/]+\/retry-recruit-sync\/?$/, handler: retryRecruitSync, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/_inspect_recruit_fields\/?$/, handler: inspectRecruitJobOpeningFields, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/_dump_recruit_job\/[^/]+\/?$/, handler: dumpRecruitJobOpening, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/_force_publish_recruit_job\/[^/]+\/?$/, handler: forcePublishRecruitJob, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/jobs\/[^/]+\/notify-client-report-ready\/?$/, handler: notifyClientReportReady, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/jobs\/[^/]+\/prefilter\/?$/, handler: listPrefilterQuestions, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/jobs\/[^/]+\/tracking\/?$/, handler: listJobTracking, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/jobs\/[^/]+\/prefilter\/?$/, handler: createPrefilterQuestion, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/jobs\/[^/]+\/prefilter\/[^/]+\/?$/, handler: patchPrefilterQuestion, auth: 'tenant' },
  { method: 'DELETE', pattern: /^\/api\/jobs\/[^/]+\/prefilter\/[^/]+\/?$/, handler: deletePrefilterQuestion, auth: 'tenant' },
  { method: 'DELETE', pattern: /^\/api\/jobs\/[^/]+\/?$/, handler: archiveJob, auth: 'tenant' },

  // Tenant self
  { method: 'GET', pattern: /^\/api\/tenants\/me\/branding\/?$/, handler: getMyBranding, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/tenants\/me\/branding\/?$/, handler: updateMyBranding, auth: 'tenant' },

  // Candidates
  { method: 'GET', pattern: /^\/api\/candidates\/?$/, handler: listCandidates, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/candidates\/?$/, handler: createCandidate, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/candidates\/[^/]+\/?$/, handler: getCandidate, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/candidates\/[^/]+\/?$/, handler: patchCandidate, auth: 'tenant' },

  // Applications (Results)
  { method: 'GET', pattern: /^\/api\/applications\/?$/, handler: listApplications, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/applications\/?$/, handler: createApplication, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/transitions\/?$/, handler: getApplicationTransitions, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/applications\/[^/]+\/transition\/?$/, handler: transitionApplication, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/scores\/?$/, handler: readScores, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/prefilter-answers\/?$/, handler: listPrefilterAnswersForApplication, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/applications\/[^/]+\/scores\/?$/, handler: writeScores, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/integrity\/?$/, handler: readIntegrity, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/applications\/[^/]+\/integrity\/?$/, handler: writeIntegrity, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/applications\/[^/]+\/bot-review\/?$/, handler: botReview, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/applications\/[^/]+\/send-offer\/?$/, handler: sendOfferForSignature, auth: 'tenant' },

  // Videos dinámicos (doc 20) — tenant
  { method: 'POST', pattern: /^\/api\/applications\/[^/]+\/videos\/generate\/?$/, handler: generateVideosForApplication, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/applications\/[^/]+\/videos\/[^/]+\/analyze\/?$/, handler: analyzeVideoResponse, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/videos\/?$/, handler: listVideosForApplication, auth: 'tenant' },

  // Review queue del bot decisor
  { method: 'GET', pattern: /^\/api\/bot\/review-queue\/?$/, handler: listReviewQueueHandler, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/bot\/review-queue\/[^/]+\/decide\/?$/, handler: decideReviewQueueItem, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/bot\/stats\/?$/, handler: getBotStats, auth: 'tenant' },

  // Pool interno de candidatos (sourcing capa 1, doc 22)
  { method: 'POST', pattern: /^\/api\/pool\/match\/?$/, handler: matchPool, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/pool\/?$/, handler: listPool, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/pool\/?$/, handler: addToPool, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/pool\/[^/]+\/?$/, handler: patchPoolEntry, auth: 'tenant' },
  { method: 'DELETE', pattern: /^\/api\/pool\/[^/]+\/?$/, handler: removeFromPool, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/?$/, handler: getApplication, auth: 'tenant' },

  // Drafts (IA)
  { method: 'POST', pattern: /^\/api\/drafts\/generate\/?$/, handler: generateDraft, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/briefings\/schedule\/?$/, handler: scheduleBriefing, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/briefings\/?$/, handler: listBriefings, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/drafts\/refine\/?$/, handler: refineDraft, auth: 'tenant' },

  // Job profile drafts persistence
  { method: 'POST', pattern: /^\/api\/drafts\/jobs\/save\/?$/, handler: saveJobDraft, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/drafts\/jobs\/[^/]+\/convert\/?$/, handler: convertDraftToJob, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/drafts\/jobs\/[^/]+\/send-to-client\/?$/, handler: sendDraftToClient, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/drafts\/jobs\/_recent_client_comments\/?$/, handler: listRecentDraftComments, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/drafts\/jobs\/?$/, handler: listJobDrafts, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/drafts\/jobs\/[^/]+\/?$/, handler: getJobDraft, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/drafts\/jobs\/[^/]+\/?$/, handler: patchJobDraft, auth: 'tenant' },

  // Portal del cliente externo — emisión tenant-scoped (Cris invita un cliente)
  { method: 'POST', pattern: /^\/api\/portals\/issue\/?$/, handler: issuePortalForTenant, auth: 'tenant' },

  // Reports — listado de jobs con finalists (deriva del estado actual + cache si existe)
  { method: 'GET', pattern: /^\/api\/reports\/?$/, handler: listReports, auth: 'tenant' },

  // Integrations status (qué integraciones tienen env vars configuradas)
  { method: 'GET', pattern: /^\/api\/integrations\/status\/?$/, handler: getIntegrationsStatus, auth: 'tenant' },

  // Tenant config (bot threshold, mode, etc.) — Block 2 §9 deferred
  { method: 'GET', pattern: /^\/api\/tenant\/config\/?$/, handler: getTenantConfig, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/tenant\/config\/?$/, handler: patchTenantConfig, auth: 'tenant' },

  // Notifications
  { method: 'GET', pattern: /^\/api\/notifications\/?$/, handler: listNotifications, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/notifications\/mark-all-read\/?$/, handler: markAllNotificationsRead, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/notifications\/[^/]+\/read\/?$/, handler: markNotificationRead, auth: 'tenant' },

  // Outreach (LinkedIn / email outbound) — campañas + inbox unificado
  { method: 'GET', pattern: /^\/api\/outreach\/campaigns\/?$/, handler: listOutreachCampaigns, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/outreach\/campaigns\/?$/, handler: createOutreachCampaign, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/outreach\/inbox\/?$/, handler: listOutreachInbox, auth: 'tenant' },
  { method: 'POST', pattern: /^\/api\/outreach\/inbox\/[^/]+\/reply\/?$/, handler: replyOutreachInbox, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/outreach\/inbox\/[^/]+\/?$/, handler: patchOutreachInboxItem, auth: 'tenant' },

  // API keys management (admin del tenant — Clerk auth)
  { method: 'POST', pattern: /^\/api\/api-keys\/?$/, handler: createApiKey, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/api-keys\/?$/, handler: listApiKeys, auth: 'tenant' },
  { method: 'PATCH', pattern: /^\/api\/api-keys\/[^/]+\/?$/, handler: patchApiKey, auth: 'tenant' },
  { method: 'DELETE', pattern: /^\/api\/api-keys\/[^/]+\/?$/, handler: revokeApiKey, auth: 'tenant' },

  // Public — signed URL token, sin Clerk
  { method: 'GET', pattern: /^\/test\/[^/]+\/?$/, handler: getTestStatus, auth: 'public' },
  { method: 'GET', pattern: /^\/test\/[^/]+\/prefilter\/?$/, handler: getPrefilterPublic, auth: 'public' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/prefilter\/?$/, handler: submitPrefilterAnswers, auth: 'public' },
  { method: 'GET', pattern: /^\/test\/[^/]+\/consent\/?$/, handler: getVideoConsent, auth: 'public' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/consent\/?$/, handler: postVideoConsent, auth: 'public' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/consent\/withdraw\/?$/, handler: withdrawVideoConsent, auth: 'public' },
  { method: 'GET', pattern: /^\/test\/[^/]+\/tech-questions\/?$/, handler: getTestTechQuestions, auth: 'public' },
  { method: 'GET', pattern: /^\/test\/[^/]+\/videos\/?$/, handler: listTestVideos, auth: 'public' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/videos\/[^/]+\/upload\/?$/, handler: uploadTestVideo, auth: 'public' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/videos\/[^/]+\/submit\/?$/, handler: submitTestVideo, auth: 'public' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/mindset\/submit\/?$/, handler: submitMindsetTest, auth: 'public' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/english\/submit\/?$/, handler: submitEnglishTest, auth: 'public' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/mindset\/?$/, handler: getMindsetForApplication, auth: 'tenant' },
  { method: 'GET', pattern: /^\/api\/applications\/[^/]+\/english\/?$/, handler: getEnglishForApplication, auth: 'tenant' },
  { method: 'POST', pattern: /^\/test\/[^/]+\/submit\/?$/, handler: submitTest, auth: 'public' },
  { method: 'GET', pattern: /^\/report\/bundle\/[^/]+\/?$/, handler: getPublicReportBundle, auth: 'public' },
  { method: 'GET', pattern: /^\/report\/[^/]+\/?$/, handler: getPublicReport, auth: 'public' },

  // Client portal — token signed, sin Clerk (la empresa cliente ve sus puestos)
  { method: 'GET', pattern: /^\/portal\/[^/]+\/jobs\/[^/]+\/?$/, handler: getClientPortalJob, auth: 'public' },
  { method: 'POST', pattern: /^\/portal\/[^/]+\/track\/?$/, handler: trackPortalEvent, auth: 'public' },
  { method: 'GET', pattern: /^\/portal\/[^/]+\/drafts\/[^/]+\/?$/, handler: getDraftPublic, auth: 'public' },
  { method: 'POST', pattern: /^\/portal\/[^/]+\/drafts\/[^/]+\/approve\/?$/, handler: approveDraftPublic, auth: 'public' },
  { method: 'POST', pattern: /^\/portal\/[^/]+\/drafts\/[^/]+\/request-changes\/?$/, handler: requestChangesDraftPublic, auth: 'public' },
  { method: 'GET', pattern: /^\/portal\/[^/]+\/?$/, handler: getClientPortal, auth: 'public' },

  // Apply público (un candidato aplicando a un puesto via link compartido)
  { method: 'POST', pattern: /^\/apply\/[^/]+\/[^/]+\/resend\/?$/, handler: resendCandidateLink, auth: 'public' },
  { method: 'GET', pattern: /^\/apply\/[^/]+\/[^/]+\/?$/, handler: getPublicJobInfo, auth: 'public' },
  { method: 'POST', pattern: /^\/apply\/[^/]+\/[^/]+\/?$/, handler: submitApplication, auth: 'public' },

  // Entry desde Recruit: candidato hace click en el link del email/WP → este endpoint
  // resuelve recruit_id + recruit_job_id, crea/encuentra Application en SharkTalents
  // y redirige al test correspondiente. Público porque viene de email.
  { method: 'GET', pattern: /^\/api\/recruit\/test-link\/?$/, handler: handleRecruitTestLink, auth: 'public' },
];

function getClientIp(ctx: RequestContext): string {
  return (ctx.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? (ctx.req.socket?.remoteAddress ?? 'unknown');
}

export const API_VERSION = 'v1';

/**
 * Normaliza el path para versionado de API.
 * - `/api/v1/jobs` → `/api/jobs` (versión explícita)
 * - `/api/jobs` → `/api/jobs` (sin versión, asume v1)
 *
 * Esto permite que clientes futuros puedan migrar a v2 sin romper consumidores v1.
 */
function normalizeApiVersion(path: string): string {
  return path.replace(/^\/api\/v1\//, '/api/');
}

export async function route(ctx: RequestContext): Promise<void> {
  const url = ctx.req.url ?? '/';
  const method = (ctx.req.method ?? 'GET').toUpperCase();
  const rawPath = url.split('?')[0];
  const path = normalizeApiVersion(rawPath);

  // Header de versión en TODA respuesta de API
  ctx.res.setHeader('X-API-Version', API_VERSION);

  // Si la URL llegó con /v1/ prefix, normalizar también ctx.req.url para que
  // handlers que leen ctx.req.url (extractIdFromPath, etc.) vean el path canónico.
  if (rawPath !== path) {
    const queryStart = url.indexOf('?');
    ctx.req.url = path + (queryStart >= 0 ? url.slice(queryStart) : '');
  }

  try {
    const matched = routes.find((r) => r.method === method && r.pattern.test(path));

    if (!matched) {
      sendJson(ctx.res, 404, {
        error: { code: 'not_found', message: `No route for ${method} ${path}` },
      });
      return;
    }

    // Auth + tenant resolution ANTES del rate-limit, para que tengamos tenantId.
    const ip = getClientIp(ctx);

    if (matched.auth === 'tenant') {
      await requireAuth(ctx);
      await requireTenant(ctx);
      // Ahora ctx.tenantId está poblado → rate-limit per-tenant
      checkRateLimit({ tenantId: ctx.tenantId, ip });
    } else if (matched.auth === 'admin') {
      // Admin: la verificación de X-Internal-Key vive en cada handler.
      // El rate-limit es por IP (admin no tiene tenant).
      checkRateLimit({ tenantId: null, ip });
    } else if (matched.auth === 'public') {
      // Público: rate-limit por IP, excepto /health.
      if (path !== '/health') {
        checkRateLimit({ tenantId: null, ip });
      }
    } else if (matched.auth === 'webhook') {
      // Webhooks: NO aplicar rate-limit (Clerk reintenta y no podemos bloquear retries).
      // La firma se valida en el handler.
    }

    const handlerStart = Date.now();
    await matched.handler(ctx);
    metrics.incrementCounter('http_requests_total', { method, status: '2xx', auth: matched.auth });
    metrics.observeHistogram('http_request_duration_ms', Date.now() - handlerStart, { method, auth: matched.auth });
  } catch (err) {
    if (err instanceof AppError) {
      log.warn('app error', {
        traceId: ctx.traceId,
        code: err.code,
        message: err.message,
        status: err.status,
      });
      metrics.incrementCounter('http_requests_total', { method, status: `${err.status}` });
      sendJson(ctx.res, err.status, {
        error: { code: err.code, message: err.message, details: err.details },
        trace_id: ctx.traceId,
      });
      return;
    }
    metrics.incrementCounter('http_requests_total', { method, status: '500' });
    log.error('unhandled error', {
      traceId: ctx.traceId,
      message: (err as Error).message,
      stack: (err as Error).stack,
    });
    reportError(err, {
      traceId: ctx.traceId,
      route: ctx.req.url ?? 'unknown',
      tenant_id: ctx.tenantId ?? undefined,
      user_id: ctx.user?.clerk_user_id,
    });
    sendJson(ctx.res, 500, {
      error: { code: 'internal_error', message: 'Internal server error' },
      trace_id: ctx.traceId,
    });
  }
}
