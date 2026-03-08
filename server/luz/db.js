const { Pool } = require("pg");
require("dotenv").config();

const luzPool = new Pool({
  user: process.env.LUZ_DB_USER || process.env.DB_USER,
  password: process.env.LUZ_DB_PASSWORD || process.env.DB_PASSWORD,
  host: process.env.LUZ_DB_HOST || process.env.DB_HOST,
  port: process.env.LUZ_DB_PORT || process.env.DB_PORT,
  database: process.env.LUZ_DB_NAME || "db_luz_pueblonuevo"
});

module.exports = luzPool;
