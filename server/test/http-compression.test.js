"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const zlib = require("node:zlib");
const express = require("express");
const {
  createHttpCompressionMiddleware,
  resolveCompressionThreshold
} = require("../http-compression");

const requestAsset = (server, acceptEncoding) => new Promise((resolve, reject) => {
  const address = server.address();
  const req = http.get({
    hostname: "127.0.0.1",
    port: address.port,
    path: "/asset.css",
    headers: { "Accept-Encoding": acceptEncoding }
  }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({
      body: Buffer.concat(chunks),
      headers: res.headers,
      statusCode: res.statusCode
    }));
  });
  req.on("error", reject);
});

const decodeBody = (body, encoding) => {
  if (encoding === "br") return zlib.brotliDecompressSync(body);
  if (encoding === "gzip") return zlib.gunzipSync(body);
  if (encoding === "deflate") return zlib.inflateSync(body);
  return body;
};

test("normaliza el umbral de compresión", () => {
  assert.equal(resolveCompressionThreshold("2048"), 2048);
  assert.equal(resolveCompressionThreshold("0"), 0);
  assert.equal(resolveCompressionThreshold("-1"), 1024);
  assert.equal(resolveCompressionThreshold("invalido"), 1024);
});

test("comprime recursos grandes y conserva exactamente su contenido", async (t) => {
  const css = ".table{color:#212529;background:#fff}".repeat(800);
  const app = express();
  app.use(createHttpCompressionMiddleware({
    HTTP_COMPRESSION_ENABLED: "1",
    HTTP_COMPRESSION_THRESHOLD_BYTES: "512"
  }));
  app.get("/asset.css", (_req, res) => {
    res.type("text/css").send(css);
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await requestAsset(server, "br, gzip");
  const encoding = String(response.headers["content-encoding"] || "");
  const decoded = decodeBody(response.body, encoding).toString("utf8");

  assert.equal(response.statusCode, 200);
  assert.ok(["br", "gzip"].includes(encoding));
  assert.match(String(response.headers.vary || ""), /Accept-Encoding/i);
  assert.equal(decoded, css);
  assert.ok(response.body.length < Buffer.byteLength(css, "utf8") / 4);
});
