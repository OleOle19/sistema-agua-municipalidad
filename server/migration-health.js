"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sha256 = (content) => crypto.createHash("sha256").update(content).digest("hex");

const getMigrationState = async (db, migrationsDir, legacyAccepted = new Map()) => {
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((name) => name.toLowerCase().endsWith(".sql")).sort()
    : [];
  const appliedRs = await db.query("SELECT file_name, checksum_sha256 FROM schema_migrations");
  const applied = new Map(appliedRs.rows.map((row) => [String(row.file_name), String(row.checksum_sha256 || "")]));
  const pending = [];
  const mismatches = [];
  for (const file of files) {
    const expected = sha256(fs.readFileSync(path.join(migrationsDir, file)));
    const current = applied.get(file);
    if (!current) {
      pending.push(file);
      continue;
    }
    if (current !== expected && legacyAccepted.get(file)?.has(current) !== true) {
      mismatches.push(file);
    }
  }
  return {
    ok: pending.length === 0 && mismatches.length === 0,
    total: files.length,
    applied: files.length - pending.length,
    pending,
    mismatches
  };
};

module.exports = { getMigrationState };
