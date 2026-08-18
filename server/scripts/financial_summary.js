require("../load-env");

const command = String(process.argv[2] || "status").trim().toLowerCase();
const { financialSummaryService, pool, luzPool } = require("../index");

const run = async () => {
  if (command === "rebuild") {
    const result = await financialSummaryService.rebuild();
    console.log(`[RESUMEN] Reconstrucción completada: ${JSON.stringify(result)}`);
    return;
  }
  if (command === "verify") {
    const result = await financialSummaryService.verify();
    console.log(`[RESUMEN] Verificación: ${JSON.stringify(result, null, 2)}`);
    if (result.total_diferencias > 0) process.exitCode = 2;
    return;
  }
  if (command === "refresh") {
    const result = await financialSummaryService.refreshDirty({ maxBatches: 100 });
    console.log(`[RESUMEN] Pendientes actualizados: ${JSON.stringify(result)}`);
    return;
  }
  if (command === "status") {
    const result = await financialSummaryService.coverage();
    console.log(`[RESUMEN] Estado: ${JSON.stringify({ modo: financialSummaryService.mode, ...result }, null, 2)}`);
    return;
  }
  throw new Error("Comando inválido. Use status, rebuild, verify o refresh.");
};

run()
  .catch((error) => {
    console.error(`[RESUMEN] Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([pool.end(), luzPool.end()]);
  });
