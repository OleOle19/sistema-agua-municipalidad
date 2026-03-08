require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../luz/db");

const username = String(process.env.LUZ_ADMIN_USER || "admin_luz").trim();
const plainPassword = String(process.env.LUZ_ADMIN_PASS || "Cambiar123!").trim();
const nombreCompleto = String(process.env.LUZ_ADMIN_NOMBRE || "Administrador Luz").trim();

if (!username || !plainPassword || !nombreCompleto) {
  console.error("Faltan datos para crear admin de luz.");
  process.exit(1);
}

const run = async () => {
  const hash = await bcrypt.hash(plainPassword, 10);
  const ex = await pool.query("SELECT id_usuario FROM usuarios_sistema WHERE username = $1 LIMIT 1", [username]);
  if (ex.rows[0]) {
    await pool.query(
      `UPDATE usuarios_sistema
       SET password = $1,
           nombre_completo = $2,
           rol = 'ADMIN',
           estado = 'ACTIVO'
       WHERE username = $3`,
      [hash, nombreCompleto, username]
    );
    console.log(`Admin LUZ actualizado: ${username}`);
  } else {
    await pool.query(
      `INSERT INTO usuarios_sistema (username, password, nombre_completo, rol, estado)
       VALUES ($1, $2, $3, 'ADMIN', 'ACTIVO')`,
      [username, hash, nombreCompleto]
    );
    console.log(`Admin LUZ creado: ${username}`);
  }
};

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err) => {
    console.error(`Error bootstrap admin luz: ${err.message}`);
    try { await pool.end(); } catch {}
    process.exit(1);
  });
