require("../load-env");

const jwt = require("jsonwebtoken");
const pool = require("../db");

const baseUrl = String(process.env.BENCHMARK_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const requestedId = Number(process.argv[2] || 0);
const runs = Math.max(10, Number(process.argv[3] || 50));

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] || 0;
};

const run = async () => {
  const userResult = await pool.query(`
    SELECT id_usuario, username, rol, nombre_completo
    FROM usuarios_sistema
    WHERE estado = 'ACTIVO'
    ORDER BY CASE WHEN UPPER(rol) IN ('ADMIN', 'SUPERADMIN', 'ADMIN_PRINCIPAL', 'NIVEL_1') THEN 0 ELSE 1 END,
             id_usuario
    LIMIT 1
  `);
  if (userResult.rows.length === 0) throw new Error("No existe un usuario activo para el benchmark.");
  let idContribuyente = requestedId;
  if (!idContribuyente) {
    const contributor = await pool.query(`
      SELECT p.id_contribuyente
      FROM predios p
      JOIN recibos r ON r.id_predio = p.id_predio
      GROUP BY p.id_contribuyente
      ORDER BY COUNT(*) DESC, p.id_contribuyente
      LIMIT 1
    `);
    idContribuyente = Number(contributor.rows[0]?.id_contribuyente || 0);
  }
  if (!idContribuyente) throw new Error("No existe un contribuyente con historial.");

  const user = userResult.rows[0];
  const token = jwt.sign({
    id_usuario: user.id_usuario,
    username: user.username,
    rol: user.rol,
    nombre: user.nombre_completo,
    sistema: "AGUA",
    modulo: "AGUA"
  }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const url = `${baseUrl}/recibos/historial/${idContribuyente}?anio=all&incluir_futuros=S`;
  const timings = [];
  let bytes = 0;
  const hit = async () => {
    const startedAt = performance.now();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.arrayBuffer();
    if (!response.ok) throw new Error(`HTTP ${response.status}.`);
    bytes = body.byteLength;
    return performance.now() - startedAt;
  };
  for (let index = 0; index < runs; index += 1) {
    timings.push(await hit());
  }
  const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
  const concurrentTimings = [];
  const concurrency = 10;
  for (let index = 0; index < runs; index += concurrency) {
    concurrentTimings.push(...await Promise.all(
      Array.from({ length: Math.min(concurrency, runs - index) }, () => hit())
    ));
  }
  console.log(JSON.stringify({
    id_contribuyente: idContribuyente,
    ejecuciones: runs,
    promedio_ms: Number(average.toFixed(1)),
    p50_ms: Number(percentile(timings, 0.5).toFixed(1)),
    p95_ms: Number(percentile(timings, 0.95).toFixed(1)),
    max_ms: Number(Math.max(...timings).toFixed(1)),
    respuesta_kb: Number((bytes / 1024).toFixed(1)),
    objetivo_p95_ms: 250,
    cumple_objetivo: percentile(timings, 0.95) < 250,
    concurrencia: {
      solicitudes_simultaneas: concurrency,
      promedio_ms: Number((concurrentTimings.reduce((sum, value) => sum + value, 0) / concurrentTimings.length).toFixed(1)),
      p95_ms: Number(percentile(concurrentTimings, 0.95).toFixed(1)),
      max_ms: Number(Math.max(...concurrentTimings).toFixed(1))
    }
  }, null, 2));
};

run()
  .catch((error) => {
    console.error(`[BENCHMARK] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
