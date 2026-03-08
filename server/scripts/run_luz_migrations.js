const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../luz/db");

const MIGRATIONS_DIR = path.resolve(__dirname, "../sql/luz_migrations");
const STATUS_ONLY = process.argv.includes("--status");

const ensureMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      file_name TEXT PRIMARY KEY,
      checksum_sha256 TEXT NOT NULL,
      execution_ms INTEGER NOT NULL DEFAULT 0,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const getMigrationFiles = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
};

const sha256 = (content) => crypto.createHash("sha256").update(content).digest("hex");

const run = async () => {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const files = getMigrationFiles();
    if (files.length === 0) {
      console.log("No se encontraron migraciones en server/sql/luz_migrations.");
      return;
    }

    const appliedRows = await client.query("SELECT file_name, checksum_sha256, applied_at FROM schema_migrations");
    const appliedMap = new Map((appliedRows.rows || []).map((r) => [String(r.file_name), String(r.checksum_sha256 || "")]));

    let pending = 0;
    for (const file of files) {
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      const checksum = sha256(sql);
      const appliedChecksum = appliedMap.get(file);
      if (!appliedChecksum) {
        pending += 1;
        console.log(`[PENDIENTE] ${file}`);
        continue;
      }
      if (appliedChecksum !== checksum) {
        throw new Error(`La migracion ${file} ya fue aplicada con otro checksum. No la modifiques; crea una nueva migracion.`);
      }
      console.log(`[OK] ${file}`);
    }

    if (STATUS_ONLY) {
      console.log(`\nResumen: ${files.length} total, ${pending} pendientes, ${files.length - pending} aplicadas.`);
      return;
    }

    if (pending === 0) {
      console.log("\nNo hay migraciones pendientes.");
      return;
    }

    console.log("\nAplicando migraciones pendientes...\n");
    for (const file of files) {
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      const checksum = sha256(sql);
      const appliedChecksum = appliedMap.get(file);
      if (appliedChecksum) continue;

      const start = Date.now();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        const executionMs = Date.now() - start;
        await client.query(
          `
          INSERT INTO schema_migrations (file_name, checksum_sha256, execution_ms)
          VALUES ($1, $2, $3)
          `,
          [file, checksum, executionMs]
        );
        await client.query("COMMIT");
        console.log(`[APLICADA] ${file} (${executionMs} ms)`);
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw new Error(`Fallo migracion ${file}: ${error.message}`);
      }
    }

    console.log("\nMigraciones de LUZ completadas.");
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error(`Error de migraciones LUZ: ${error.message}`);
  process.exit(1);
});
