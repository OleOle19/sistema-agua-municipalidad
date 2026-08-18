const DEFAULT_BATCH_SIZE = 500;
const CALCULATION_VERSION = 1;

const normalizeMode = (value) => {
  const mode = String(value || "off").trim().toLowerCase();
  return ["off", "compare", "on"].includes(mode) ? mode : "off";
};

const toNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeRow = (row = {}) => ({
  id_contribuyente: Number(row.id_contribuyente || 0),
  deuda_anio: toNumber(row.deuda_anio),
  abono_anio: toNumber(row.abono_anio),
  meses_deuda: Number(row.meses_deuda || 0),
  pendiente_caja_monto: toNumber(row.pendiente_caja_monto),
  pendiente_caja_ordenes: Number(row.pendiente_caja_ordenes || 0),
  predios_morosos_actuales: Number(row.predios_morosos_actuales || 0)
});

const compareRows = (legacyRows = [], summaryRows = [], tolerance = 0.001) => {
  const legacy = new Map(legacyRows.map((row) => [Number(row.id_contribuyente), normalizeRow(row)]));
  const summary = new Map(summaryRows.map((row) => [Number(row.id_contribuyente), normalizeRow(row)]));
  const ids = new Set([...legacy.keys(), ...summary.keys()]);
  const differences = [];
  const numericFields = ["deuda_anio", "abono_anio", "pendiente_caja_monto"];
  const integerFields = ["meses_deuda", "pendiente_caja_ordenes", "predios_morosos_actuales"];

  for (const id of ids) {
    const oldRow = legacy.get(id) || normalizeRow({ id_contribuyente: id });
    const newRow = summary.get(id) || normalizeRow({ id_contribuyente: id });
    const changedFields = [];
    numericFields.forEach((field) => {
      if (Math.abs(oldRow[field] - newRow[field]) > tolerance) changedFields.push(field);
    });
    integerFields.forEach((field) => {
      if (oldRow[field] !== newRow[field]) changedFields.push(field);
    });
    if (changedFields.length > 0) {
      differences.push({ id_contribuyente: id, campos: changedFields, legacy: oldRow, resumen: newRow });
    }
  }

  return {
    total_legacy: legacy.size,
    total_resumen: summary.size,
    total_diferencias: differences.length,
    diferencias: differences.slice(0, 50)
  };
};

const createFinancialSummaryService = ({
  pool,
  buildFinancialQuery,
  getClosedPeriod,
  mode = process.env.FINANCIAL_SUMMARY_MODE,
  reconciliationMs = process.env.FINANCIAL_SUMMARY_RECONCILIATION_MS,
  logger = console
} = {}) => {
  if (!pool || typeof buildFinancialQuery !== "function" || typeof getClosedPeriod !== "function") {
    throw new Error("Configuración incompleta del resumen financiero.");
  }

  const configuredMode = normalizeMode(mode);
  const intervalMs = Math.max(60_000, Number(reconciliationMs || 600_000));
  let maintenancePromise = null;
  let reconciliationTimer = null;

  const getPeriod = () => {
    const period = getClosedPeriod() || {};
    const anio = Number(period.anio || 0);
    const mes = Number(period.mes || 0);
    return { anio, mes, periodo: (anio * 100) + mes };
  };

  const queryLegacy = async (db = pool, ids = null) => {
    const period = getPeriod();
    const filteredIds = Array.isArray(ids)
      ? Array.from(new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
      : null;
    const result = await db.query(
      buildFinancialQuery({ filterContributorIds: Boolean(filteredIds) }),
      filteredIds ? [period.anio, period.mes, filteredIds] : [period.anio, period.mes]
    );
    return result.rows;
  };

  const readSummaryRows = async (db = pool) => {
    const { periodo } = getPeriod();
    const result = await db.query(`
      SELECT
        id_contribuyente,
        deuda_anio,
        abono_anio,
        meses_deuda,
        pendiente_caja_monto,
        pendiente_caja_ordenes,
        predios_morosos_actuales
      FROM contribuyentes_resumen_financiero
      WHERE periodo_corte = $1
      ORDER BY id_contribuyente
    `, [periodo]);
    return result.rows;
  };

  const refreshIdsInTransaction = async (client, ids) => {
    const uniqueIds = Array.from(new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) return 0;
    const period = getPeriod();
    const financialQuery = buildFinancialQuery({ filterContributorIds: true });

    await client.query(
      "DELETE FROM contribuyentes_resumen_financiero WHERE id_contribuyente = ANY($1::int[])",
      [uniqueIds]
    );
    const inserted = await client.query(`
      WITH calculado AS (
        ${financialQuery}
      )
      INSERT INTO contribuyentes_resumen_financiero (
        id_contribuyente,
        deuda_anio,
        abono_anio,
        meses_deuda,
        pendiente_caja_monto,
        pendiente_caja_ordenes,
        predios_morosos_actuales,
        periodo_corte,
        calculo_version,
        actualizado_en
      )
      SELECT
        id_contribuyente,
        ROUND(COALESCE(deuda_anio, 0)::numeric, 2),
        ROUND(COALESCE(abono_anio, 0)::numeric, 2),
        COALESCE(meses_deuda, 0)::int,
        ROUND(COALESCE(pendiente_caja_monto, 0)::numeric, 2),
        COALESCE(pendiente_caja_ordenes, 0)::int,
        COALESCE(predios_morosos_actuales, 0)::int,
        $4::int,
        $5::smallint,
        NOW()
      FROM calculado
      ON CONFLICT (id_contribuyente) DO UPDATE SET
        deuda_anio = EXCLUDED.deuda_anio,
        abono_anio = EXCLUDED.abono_anio,
        meses_deuda = EXCLUDED.meses_deuda,
        pendiente_caja_monto = EXCLUDED.pendiente_caja_monto,
        pendiente_caja_ordenes = EXCLUDED.pendiente_caja_ordenes,
        predios_morosos_actuales = EXCLUDED.predios_morosos_actuales,
        periodo_corte = EXCLUDED.periodo_corte,
        calculo_version = EXCLUDED.calculo_version,
        actualizado_en = EXCLUDED.actualizado_en
      RETURNING id_contribuyente
    `, [period.anio, period.mes, uniqueIds, period.periodo, CALCULATION_VERSION]);
    await client.query(
      "DELETE FROM contribuyentes_resumen_dirty WHERE id_contribuyente = ANY($1::int[])",
      [uniqueIds]
    );
    return Number(inserted.rowCount || 0);
  };

  const refreshDirty = async ({ batchSize = DEFAULT_BATCH_SIZE, maxBatches = 20 } = {}) => {
    let processed = 0;
    let batches = 0;
    while (batches < maxBatches) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const dirty = await client.query(`
          SELECT id_contribuyente
          FROM contribuyentes_resumen_dirty
          ORDER BY marcado_en, id_contribuyente
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        `, [Math.max(1, Number(batchSize || DEFAULT_BATCH_SIZE))]);
        const ids = dirty.rows.map((row) => Number(row.id_contribuyente)).filter(Boolean);
        if (ids.length === 0) {
          await client.query("COMMIT");
          break;
        }
        await refreshIdsInTransaction(client, ids);
        await client.query("COMMIT");
        processed += ids.length;
        batches += 1;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally {
        client.release();
      }
    }
    return { processed, batches };
  };

  const rebuild = async () => {
    const client = await pool.connect();
    const startedAt = Date.now();
    const period = getPeriod();
    try {
      await client.query("BEGIN");
      // Evita perder una marca dirty si una operación financiera coincide con
      // la reconstrucción completa. Los triggers esperan y marcan al afectado
      // inmediatamente después de confirmar este proceso excepcional.
      await client.query("LOCK TABLE contribuyentes_resumen_dirty IN SHARE ROW EXCLUSIVE MODE");
      await client.query(`
        CREATE TEMP TABLE tmp_resumen_financiero ON COMMIT DROP AS
        ${buildFinancialQuery({ filterContributorIds: false })}
      `, [period.anio, period.mes]);
      await client.query("DELETE FROM contribuyentes_resumen_financiero");
      const inserted = await client.query(`
        INSERT INTO contribuyentes_resumen_financiero (
          id_contribuyente,
          deuda_anio,
          abono_anio,
          meses_deuda,
          pendiente_caja_monto,
          pendiente_caja_ordenes,
          predios_morosos_actuales,
          periodo_corte,
          calculo_version,
          actualizado_en
        )
        SELECT
          id_contribuyente,
          ROUND(COALESCE(deuda_anio, 0)::numeric, 2),
          ROUND(COALESCE(abono_anio, 0)::numeric, 2),
          COALESCE(meses_deuda, 0)::int,
          ROUND(COALESCE(pendiente_caja_monto, 0)::numeric, 2),
          COALESCE(pendiente_caja_ordenes, 0)::int,
          COALESCE(predios_morosos_actuales, 0)::int,
          $1::int,
          $2::smallint,
          NOW()
        FROM tmp_resumen_financiero
        ON CONFLICT (id_contribuyente) DO UPDATE SET
          deuda_anio = EXCLUDED.deuda_anio,
          abono_anio = EXCLUDED.abono_anio,
          meses_deuda = EXCLUDED.meses_deuda,
          pendiente_caja_monto = EXCLUDED.pendiente_caja_monto,
          pendiente_caja_ordenes = EXCLUDED.pendiente_caja_ordenes,
          predios_morosos_actuales = EXCLUDED.predios_morosos_actuales,
          periodo_corte = EXCLUDED.periodo_corte,
          calculo_version = EXCLUDED.calculo_version,
          actualizado_en = EXCLUDED.actualizado_en
        RETURNING id_contribuyente
      `, [period.periodo, CALCULATION_VERSION]);
      await client.query("DELETE FROM contribuyentes_resumen_dirty");
      await client.query("COMMIT");
      return {
        rows: Number(inserted.rowCount || 0),
        period: period.periodo,
        duration_ms: Date.now() - startedAt
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  };

  const coverage = async () => {
    const { periodo } = getPeriod();
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM contribuyentes) AS contribuyentes,
        (SELECT COUNT(*)::int FROM contribuyentes_resumen_financiero WHERE periodo_corte = $1) AS resumen,
        (SELECT COUNT(*)::int FROM contribuyentes_resumen_dirty) AS pendientes
    `, [periodo]);
    return { ...result.rows[0], periodo };
  };

  const verify = async () => {
    const startedAt = Date.now();
    const [legacyRows, summaryRows] = await Promise.all([queryLegacy(pool), readSummaryRows(pool)]);
    return {
      ...compareRows(legacyRows, summaryRows),
      duration_ms: Date.now() - startedAt,
      periodo: getPeriod().periodo
    };
  };

  const runMaintenance = (action) => {
    if (maintenancePromise) return maintenancePromise;
    maintenancePromise = Promise.resolve()
      .then(action)
      .finally(() => { maintenancePromise = null; });
    return maintenancePromise;
  };

  const ensureReady = async () => runMaintenance(async () => {
    await refreshDirty();
    const state = await coverage();
    if (Number(state.resumen) !== Number(state.contribuyentes) || Number(state.pendientes) > 0) {
      return rebuild();
    }
    return { rows: Number(state.resumen), period: state.periodo, duration_ms: 0 };
  });

  const getRows = async () => {
    if (configuredMode === "off") return queryLegacy(pool);
    try {
      if (configuredMode === "compare") {
        await ensureReady();
        const legacyRows = await queryLegacy(pool);
        const summaryRows = await readSummaryRows(pool);
        const comparison = compareRows(legacyRows, summaryRows);
        const level = comparison.total_diferencias > 0 ? "warn" : "info";
        logger[level](`[PERF][resumen_financiero.compare] ${JSON.stringify(comparison)}`);
        return legacyRows;
      }
      await ensureReady();
      return readSummaryRows(pool);
    } catch (error) {
      logger.error(`[PERF][resumen_financiero] fallback legacy: ${error.message}`);
      return queryLegacy(pool);
    }
  };

  const getDashboardMorosos = async () => {
    if (configuredMode !== "on") return null;
    await ensureReady();
    const { periodo } = getPeriod();
    const result = await pool.query(`
      SELECT COALESCE(SUM(predios_morosos_actuales), 0)::int AS total
      FROM contribuyentes_resumen_financiero
      WHERE periodo_corte = $1
    `, [periodo]);
    return Number(result.rows[0]?.total || 0);
  };

  const startReconciliation = ({ onUpdated } = {}) => {
    if (configuredMode === "off" || reconciliationTimer) return;
    const run = () => runMaintenance(async () => {
      const result = await refreshDirty();
      if (result.processed > 0 && typeof onUpdated === "function") onUpdated(result);
      return result;
    }).catch((error) => logger.error(`[PERF][resumen_financiero.reconcile] ${error.message}`));
    reconciliationTimer = setInterval(run, intervalMs);
    reconciliationTimer.unref?.();
    setTimeout(run, 1000).unref?.();
  };

  const stopReconciliation = () => {
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  };

  return {
    mode: configuredMode,
    isActive: () => configuredMode === "on",
    queryLegacy,
    readSummaryRows,
    refreshDirty,
    rebuild,
    verify,
    coverage,
    getRows,
    getDashboardMorosos,
    startReconciliation,
    stopReconciliation
  };
};

module.exports = {
  CALCULATION_VERSION,
  compareRows,
  createFinancialSummaryService,
  normalizeMode
};
