require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../luz/db");

const username = String(process.env.LUZ_ADMIN_USER || "admin_luz").trim();
const DEFAULT_LUZ_ADMIN_PASS = "MUNI123456a.";
const plainPasswordEnv = String(process.env.LUZ_ADMIN_PASS || "").trim();
const nombreCompleto = String(process.env.LUZ_ADMIN_NOMBRE || "Administrador Luz").trim();
const plainPassword = plainPasswordEnv || DEFAULT_LUZ_ADMIN_PASS;

if (!username || !plainPassword || !nombreCompleto) {
  console.error("Faltan datos para crear admin de luz.");
  process.exit(1);
}

const run = async () => {
  const ex = await pool.query("SELECT id_usuario FROM usuarios_sistema WHERE username = $1 LIMIT 1", [username]);
  if (ex.rows[0]) {
    if (plainPasswordEnv) {
      const hash = await bcrypt.hash(plainPassword, 10);
      await pool.query(
        `UPDATE usuarios_sistema
         SET password = $1,
             password_visible = $2,
             nombre_completo = $3,
             rol = 'ADMIN',
             estado = 'ACTIVO'
         WHERE username = $4`,
        [hash, plainPassword, nombreCompleto, username]
      );
    } else {
      await pool.query(
        `UPDATE usuarios_sistema
         SET nombre_completo = $1,
             rol = 'ADMIN',
             estado = 'ACTIVO'
         WHERE username = $2`,
        [nombreCompleto, username]
      );
    }
    console.log(`Admin LUZ actualizado: ${username}`);
  } else {
    const hash = await bcrypt.hash(plainPassword, 10);
    await pool.query(
      `INSERT INTO usuarios_sistema (username, password, password_visible, nombre_completo, rol, estado)
       VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVO')`,
      [username, hash, plainPassword, nombreCompleto]
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
