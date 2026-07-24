"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildContentSecurityPolicy,
  requestUsesHttps,
  securityHeaders
} = require("../security-headers");

test("CSP restringe scripts, marcos y objetos a una política segura", () => {
  const csp = buildContentSecurityPolicy();
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' ws: wss:/);
});

test("detecta HTTPS directo y detrás de proxy", () => {
  assert.equal(requestUsesHttps({ secure: true, headers: {} }), true);
  assert.equal(requestUsesHttps({ secure: false, headers: { "x-forwarded-proto": "https" } }), true);
  assert.equal(requestUsesHttps({ secure: false, headers: { "x-forwarded-proto": "http" } }), false);
});

test("envía las cabeceras defensivas y HSTS solamente por HTTPS", () => {
  const headers = new Map();
  const res = { setHeader: (name, value) => headers.set(name, value) };
  let continued = false;
  securityHeaders(
    { secure: false, headers: { "x-forwarded-proto": "https" } },
    res,
    () => { continued = true; }
  );

  assert.equal(continued, true);
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
  assert.ok(headers.has("Content-Security-Policy"));
});
