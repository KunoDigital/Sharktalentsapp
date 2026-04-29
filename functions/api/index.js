"use strict";
const router_1 = require("./router");
const context_1 = require("./lib/context");
const logger_1 = require("./lib/logger");
const log = (0, logger_1.logger)('API');
module.exports = async (req, res) => {
    const ctx = (0, context_1.createContext)(req, res);
    log.info(`${req.method} ${req.url}`, { traceId: ctx.traceId });
    await (0, router_1.route)(ctx);
    log.info(`${req.method} ${req.url} done`, {
        traceId: ctx.traceId,
        ms: Date.now() - ctx.startedAt,
        status: res.statusCode,
    });
};
