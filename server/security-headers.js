"use strict";

const normalizeOrigin = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
};

const configuredConnectSources = () => String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const buildContentSecurityPolicy = () => {
  const connectSources = ["'self'", "ws:", "wss:", ...configuredConnectSources()];
  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    ["script-src", "'self'"],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'", "data:"],
    ["media-src", "'self'", "blob:"],
    ["connect-src", ...new Set(connectSources)],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"]
  ];
  return directives.map(([name, ...values]) => `${name} ${values.join(" ")}`).join("; ");
};

const requestUsesHttps = (req) => {
  if (req?.secure || req?.socket?.encrypted) return true;
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return forwardedProto === "https";
};

const securityHeaders = (req, res, next) => {
  const cspHeader = process.env.SECURITY_CSP_REPORT_ONLY === "1"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
  const usesHttps = requestUsesHttps(req);

  res.setHeader(cspHeader, buildContentSecurityPolicy());
  if (usesHttps) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  }
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()"
  );

  if (process.env.SECURITY_HSTS_ENABLED !== "0" && usesHttps) {
    const configuredMaxAge = Number(process.env.SECURITY_HSTS_MAX_AGE || 31536000);
    const maxAge = Number.isSafeInteger(configuredMaxAge) && configuredMaxAge >= 0
      ? configuredMaxAge
      : 31536000;
    const includeSubDomains = process.env.SECURITY_HSTS_INCLUDE_SUBDOMAINS === "1"
      ? "; includeSubDomains"
      : "";
    res.setHeader("Strict-Transport-Security", `max-age=${maxAge}${includeSubDomains}`);
  }

  return next();
};

module.exports = {
  buildContentSecurityPolicy,
  requestUsesHttps,
  securityHeaders
};
