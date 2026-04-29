"use strict";
const router_1 = require("./router");
const logger_1 = require("./lib/logger");
const log = (0, logger_1.logger)('API');
module.exports = async (req, res) => {
    const started = Date.now();
    log.info(`${req.method} ${req.url}`);
    await (0, router_1.route)(req, res);
    log.info(`${req.method} ${req.url} done`, { ms: Date.now() - started, status: res.statusCode });
};
