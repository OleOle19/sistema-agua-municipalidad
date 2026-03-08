require("dotenv").config();
const { Client } = require("pg");

const dbName = String(process.env.LUZ_DB_NAME || "db_luz_pueblonuevo").trim();
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`Nombre de BD invalido para LUZ: ${dbName}`);
  process.exit(1);
}

const client = new Client({
  user: process.env.LUZ_DB_USER || process.env.DB_USER,
  password: process.env.LUZ_DB_PASSWORD || process.env.DB_PASSWORD,
  host: process.env.LUZ_DB_HOST || process.env.DB_HOST,
  port: process.env.LUZ_DB_PORT || process.env.DB_PORT,
  database: "postgres"
});

const run = async () => {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rows.length > 0) {
    console.log(`BD LUZ ya existe: ${dbName}`);
    return;
  }
  await client.query(`CREATE DATABASE "${dbName}"`);
  console.log(`BD LUZ creada: ${dbName}`);
};

run()
  .then(async () => {
    await client.end();
  })
  .catch(async (err) => {
    console.error(`Error asegurando BD LUZ: ${err.message}`);
    try { await client.end(); } catch {}
    process.exit(1);
  });
