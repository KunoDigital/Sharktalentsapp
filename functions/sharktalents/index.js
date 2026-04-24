"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const router_1 = require("./router");
const adminJobs_1 = require("./routes/adminJobs");
const adminAssessments_1 = require("./routes/adminAssessments");
const adminResults_1 = require("./routes/adminResults");
const adminCandidates_1 = require("./routes/adminCandidates");
const adminLibrary_1 = require("./routes/adminLibrary");
const publicTest_1 = require("./routes/publicTest");
const publicReport_1 = require("./routes/publicReport");
const adminReports_1 = require("./routes/adminReports");
const auth_1 = require("./routes/auth");
console.log('[INIT] Registering routes...');
(0, auth_1.registerAuthRoutes)();
(0, adminReports_1.registerAdminReportRoutes)();
(0, adminJobs_1.registerAdminJobRoutes)();
(0, adminAssessments_1.registerAdminAssessmentRoutes)();
(0, adminResults_1.registerAdminResultRoutes)();
(0, adminCandidates_1.registerAdminCandidateRoutes)();
(0, adminLibrary_1.registerAdminLibraryRoutes)();
(0, publicTest_1.registerPublicTestRoutes)();
(0, publicReport_1.registerPublicReportRoutes)();
console.log('[INIT] Routes registered');
module.exports = async (req, res) => {
    const ts = Date.now();
    console.log(`[REQ] ${req.method} ${req.url}`);
    console.log(`[REQ] Headers:`, JSON.stringify({
        'content-type': req.headers['content-type'],
        'cookie': req.headers['cookie'] ? 'PRESENT' : 'ABSENT',
        'x-zc-project': req.headers['x-zc-project'],
        'x-catalyst-org': req.headers['x-catalyst-org'],
        'user-agent': (req.headers['user-agent'] || '').substring(0, 50),
    }));
    try {
        await (0, router_1.handleRequest)(req, res);
        console.log(`[REQ] Completed in ${Date.now() - ts}ms`);
    }
    catch (err) {
        console.error(`[REQ] UNHANDLED ERROR:`, err.message);
        console.error(`[REQ] Stack:`, err.stack?.split('\n').slice(0, 5).join('\n'));
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
    }
};
