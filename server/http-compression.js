"use strict";

const compression = require("compression");

const DEFAULT_THRESHOLD_BYTES = 1024;

const resolveCompressionThreshold = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_THRESHOLD_BYTES;
};

const createHttpCompressionMiddleware = (env = process.env) => {
  if (env.HTTP_COMPRESSION_ENABLED === "0") {
    return (_req, _res, next) => next();
  }

  return compression({
    threshold: resolveCompressionThreshold(env.HTTP_COMPRESSION_THRESHOLD_BYTES)
  });
};

module.exports = {
  DEFAULT_THRESHOLD_BYTES,
  createHttpCompressionMiddleware,
  resolveCompressionThreshold
};
