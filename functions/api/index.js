"use strict";
const router_1 = require("./router");
const context_1 = require("./lib/context");
const logger_1 = require("./lib/logger");
const cors_1 = require("./lib/cors");
const env_1 = require("./lib/env");
const log = (0, logger_1.logger)('API');
function isWebhookOrAdminPath(url) {
    if (!url)
        return false;
    const path = url.split('?')[0];
    // Webhooks y endpoints admin son server-to-server, no necesitan CORS.
    return path.startsWith('/api/webhooks/') || path.startsWith('/admin/');
}
module.exports = async (req, res) => {
    const ctx = (0, context_1.createContext)(req, res);
    // CORS solo para endpoints que el browser llama. Webhooks (Clerk → backend)
    // y admin (curl → backend) son server-to-server, sin Origin header relevante.
    if (!isWebhookOrAdminPath(req.url)) {
        (0, cors_1.applyCors)(req, res, (0, env_1.env)().ALLOWED_ORIGINS);
        if (req.method === 'OPTIONS') {
            (0, cors_1.handlePreflight)(res);
            return;
        }
    }
    log.info(`${req.method} ${req.url}`, { traceId: ctx.traceId });
    await (0, router_1.route)(ctx);
    log.info(`${req.method} ${req.url} done`, {
        traceId: ctx.traceId,
        ms: Date.now() - ctx.startedAt,
        status: res.statusCode,
    });
};
