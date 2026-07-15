"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const target = String(process.argv[2] || "").trim();
if (!target) {
  console.error("Uso: npm run backup:verify -- <ruta-al-conjunto-backup>");
  process.exit(1);
}

const root = path.resolve(target);
const manifestPath = path.join(root, "backup-manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error("No existe backup-manifest.json.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (Number(manifest?.format_version) !== 1 || !Array.isArray(manifest?.files)) {
  throw new Error("Formato de manifiesto no soportado.");
}

const hashFile = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
for (const entry of manifest.files) {
  const relative = String(entry?.path || "").replace(/\\/g, "/");
  const absolute = path.resolve(root, relative);
  if (!relative || (absolute !== root && !absolute.startsWith(`${root}${path.sep}`))) {
    throw new Error(`Ruta inválida en manifiesto: ${relative}`);
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Falta archivo: ${relative}`);
  const size = Number(fs.statSync(absolute).size || 0);
  if (size !== Number(entry.bytes || 0)) throw new Error(`Tamaño inválido: ${relative}`);
  if (hashFile(absolute) !== String(entry.sha256 || "")) throw new Error(`Checksum inválido: ${relative}`);
}

for (const databaseFile of ["agua.sql", "luz.sql"]) {
  const absolute = path.join(root, databaseFile);
  const header = fs.readFileSync(absolute, "utf8").slice(0, 5000);
  if (!/PostgreSQL database dump/i.test(header)) throw new Error(`${databaseFile} no parece un dump PostgreSQL válido.`);
}

console.log(JSON.stringify({ ok: true, backup: root, files: manifest.files.length, created_at: manifest.created_at }, null, 2));
