const fs = require("fs");
const path = require("path");
const pool = require("../db");

const EPS = 0.001;

function splitCsv(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseMonto(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw.replace(/\s+/g, "").replace(/,/g, "."));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function parsePositiveInt(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function periodKey(anio, mes) {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}`;
}

function periodToNum(periodo) {
  if (!/^\d{4}-\d{2}$/.test(String(periodo || ""))) return 0;
  return Number(String(periodo).replace("-", ""));
}

function validatePeriodText(value, flagName) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`${flagName} debe tener formato YYYY-MM. Valor recibido: ${value}`);
  }
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) {
    throw new Error(`${flagName} tiene mes invalido: ${value}`);
  }
  return value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactPeriods(periods) {
  const sorted = [...new Set((periods || []).filter(Boolean))].sort();
  if (sorted.length === 0) return [];
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  function nextPeriod(periodo) {
    const anio = Number(periodo.slice(0, 4));
    const mes = Number(periodo.slice(5, 7));
    const nextMonth = mes === 12 ? 1 : mes + 1;
    const nextYear = mes === 12 ? anio + 1 : anio;
    return periodKey(nextYear, nextMonth);
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === nextPeriod(prev)) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? start : `${start} a ${prev}`);
    start = current;
    prev = current;
  }
  ranges.push(start === prev ? start : `${start} a ${prev}`);
  return ranges;
}

function latestPeriod(periods, predicate = null) {
  const filtered = (periods || []).filter((periodo) => {
    if (!periodo) return false;
    return predicate ? predicate(periodo) : true;
  });
  if (filtered.length === 0) return null;
  return filtered.sort().at(-1) || null;
}

function loadRowsFromTxt(filePath, options = {}) {
  const fromPeriod = validatePeriodText(options.fromPeriod || null, "--from-period");
  const fromPeriodNum = fromPeriod ? periodToNum(fromPeriod) : null;
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];

  lines.forEach((line, index) => {
    const parts = splitCsv(line).map((value) => String(value || "").trim());
    if (parts.length < 12) return;

    const codigo = String(parts[0] || "").trim();
    const anio = parsePositiveInt(parts[1]);
    const mes = parsePositiveInt(parts[2]);
    const subtotalAgua = parseMonto(parts[3]);
    const subtotalDesague = parseMonto(parts[4]);
    const subtotalLimpieza = parseMonto(parts[5]);
    const subtotalAdmin = parseMonto(parts[6]);
    const subtotalExtra = parseMonto(parts[7]);
    const totalArchivo = parseMonto(parts[8]);
    const abono = parseMonto(parts[9]);
    const pagadoSn = String(parts[11] || "").trim().toUpperCase();
    const totalPartes = round2(
      subtotalAgua
      + subtotalDesague
      + subtotalLimpieza
      + subtotalAdmin
      + subtotalExtra
    );

    if (!codigo || !anio || mes < 1 || mes > 12) return;
    if (abono <= 0 && totalArchivo <= 0 && totalPartes <= 0) return;

    const periodo = periodKey(anio, mes);
    if (Number.isFinite(fromPeriodNum) && periodToNum(periodo) < fromPeriodNum) return;

    rows.push({
      linea: index + 1,
      codigo_municipal: codigo,
      anio,
      mes,
      periodo,
      subtotal_agua: subtotalAgua,
      subtotal_desague: subtotalDesague,
      subtotal_limpieza: subtotalLimpieza,
      subtotal_admin: subtotalAdmin,
      subtotal_extra: subtotalExtra,
      total_archivo: totalArchivo,
      abono_archivo: abono,
      recibo_legacy: String(parts[10] || "").trim(),
      pagado_sn: pagadoSn
    });
  });

  return rows;
}

function buildRowMap(rows) {
  const map = new Map();
  rows.forEach((row) => {
    map.set(`${row.codigo_municipal}|${row.periodo}`, row);
  });
  return map;
}

function summarizeByCodigo(oldRows, newRows) {
  const oldMap = buildRowMap(oldRows);
  const newMap = buildRowMap(newRows);
  const groups = new Map();

  oldRows.forEach((oldRow) => {
    if (oldRow.pagado_sn !== "S") return;
    const key = `${oldRow.codigo_municipal}|${oldRow.periodo}`;
    const newRow = newMap.get(key) || null;
    const missingCurrent = !newRow;
    const unpaidCurrent = newRow && newRow.pagado_sn !== "S";
    const lowerPayment = newRow && newRow.pagado_sn === "S" && (newRow.abono_archivo + EPS) < oldRow.abono_archivo;
    if (!missingCurrent && !unpaidCurrent && !lowerPayment) return;

    const codigo = oldRow.codigo_municipal;
    if (!groups.has(codigo)) {
      groups.set(codigo, {
        codigo_municipal: codigo,
        nombre_completo: "",
        missing_paid_periods: [],
        old_paid_periods: [],
        new_paid_periods: [],
        examples: []
      });
    }
    const group = groups.get(codigo);
    group.missing_paid_periods.push(oldRow.periodo);
    group.examples.push({
      periodo: oldRow.periodo,
      razon: missingCurrent ? "sin_fila_actual" : (unpaidCurrent ? "no_pagado_actual" : "monto_actual_menor"),
      antiguo: {
        pagado_sn: oldRow.pagado_sn,
        abono_archivo: oldRow.abono_archivo,
        total_archivo: oldRow.total_archivo,
        linea: oldRow.linea
      },
      actual: newRow ? {
        pagado_sn: newRow.pagado_sn,
        abono_archivo: newRow.abono_archivo,
        total_archivo: newRow.total_archivo,
        linea: newRow.linea
      } : null
    });
  });

  const oldPaidByCodigo = new Map();
  oldRows.forEach((row) => {
    if (row.pagado_sn !== "S") return;
    const list = oldPaidByCodigo.get(row.codigo_municipal) || [];
    list.push(row.periodo);
    oldPaidByCodigo.set(row.codigo_municipal, list);
  });

  const newPaidByCodigo = new Map();
  newRows.forEach((row) => {
    if (row.pagado_sn !== "S") return;
    const list = newPaidByCodigo.get(row.codigo_municipal) || [];
    list.push(row.periodo);
    newPaidByCodigo.set(row.codigo_municipal, list);
  });

  const cases = Array.from(groups.values()).map((group) => {
    const oldPaidPeriods = [...new Set(oldPaidByCodigo.get(group.codigo_municipal) || [])].sort();
    const newPaidPeriods = [...new Set(newPaidByCodigo.get(group.codigo_municipal) || [])].sort();
    const missingPaidPeriods = [...new Set(group.missing_paid_periods)].sort();
    const affected2026 = missingPaidPeriods.filter((periodo) => periodo.startsWith("2026-"));
    const affected2025Plus = missingPaidPeriods.filter((periodo) => periodToNum(periodo) >= 202501);

    return {
      codigo_municipal: group.codigo_municipal,
      nombre_completo: group.nombre_completo,
      total_periodos_afectados: missingPaidPeriods.length,
      total_periodos_afectados_2025_plus: affected2025Plus.length,
      total_periodos_afectados_2026: affected2026.length,
      old_paid_count: oldPaidPeriods.length,
      new_paid_count: newPaidPeriods.length,
      old_latest_paid: latestPeriod(oldPaidPeriods),
      new_latest_paid: latestPeriod(newPaidPeriods),
      old_latest_paid_2026: latestPeriod(oldPaidPeriods, (periodo) => periodo.startsWith("2026-")),
      new_latest_paid_2026: latestPeriod(newPaidPeriods, (periodo) => periodo.startsWith("2026-")),
      missing_paid_periods: missingPaidPeriods,
      missing_paid_period_ranges: compactPeriods(missingPaidPeriods),
      examples: group.examples.sort((a, b) => a.periodo.localeCompare(b.periodo))
    };
  });

  cases.sort((a, b) => (
    b.total_periodos_afectados_2025_plus - a.total_periodos_afectados_2025_plus
    || b.total_periodos_afectados_2026 - a.total_periodos_afectados_2026
    || b.total_periodos_afectados - a.total_periodos_afectados
    || String(a.codigo_municipal).localeCompare(String(b.codigo_municipal))
  ));

  const summary = {
    total_casos: cases.length,
    total_periodos_afectados: cases.reduce((acc, item) => acc + item.total_periodos_afectados, 0),
    total_periodos_afectados_2025_plus: cases.reduce((acc, item) => acc + item.total_periodos_afectados_2025_plus, 0),
    total_periodos_afectados_2026: cases.reduce((acc, item) => acc + item.total_periodos_afectados_2026, 0),
    con_afectacion_2026: cases.filter((item) => item.total_periodos_afectados_2026 > 0).length,
    con_afectacion_2025_plus: cases.filter((item) => item.total_periodos_afectados_2025_plus > 0).length
  };

  return { summary, cases, oldMap, newMap };
}

function filterAdvanceLosses(summaryResult) {
  const cases = (summaryResult.cases || []).map((item) => {
    const newLatest = item.new_latest_paid;
    const advancePeriods = (item.missing_paid_periods || []).filter((periodo) => {
      if (!newLatest) return true;
      return periodToNum(periodo) > periodToNum(newLatest);
    });
    const advanceExamples = (item.examples || []).filter((example) => {
      if (!newLatest) return true;
      return periodToNum(example.periodo) > periodToNum(newLatest);
    });
    return {
      ...item,
      total_periodos_afectados: advancePeriods.length,
      total_periodos_afectados_2025_plus: advancePeriods.filter((periodo) => periodToNum(periodo) >= 202501).length,
      total_periodos_afectados_2026: advancePeriods.filter((periodo) => periodo.startsWith("2026-")).length,
      missing_paid_periods: advancePeriods,
      missing_paid_period_ranges: compactPeriods(advancePeriods),
      examples: advanceExamples
    };
  }).filter((item) => {
    if (!item.old_latest_paid) return false;
    if (item.total_periodos_afectados <= 0) return false;
    if (!item.new_latest_paid) return true;
    return periodToNum(item.old_latest_paid) > periodToNum(item.new_latest_paid);
  });

  cases.sort((a, b) => (
    periodToNum(b.old_latest_paid || "0000-00") - periodToNum(a.old_latest_paid || "0000-00")
    || periodToNum(b.new_latest_paid || "0000-00") - periodToNum(a.new_latest_paid || "0000-00")
    || b.total_periodos_afectados - a.total_periodos_afectados
    || String(a.codigo_municipal).localeCompare(String(b.codigo_municipal))
  ));

  const summary = {
    total_casos: cases.length,
    total_periodos_afectados: cases.reduce((acc, item) => acc + item.total_periodos_afectados, 0),
    total_periodos_afectados_2025_plus: cases.reduce((acc, item) => acc + item.total_periodos_afectados_2025_plus, 0),
    total_periodos_afectados_2026: cases.reduce((acc, item) => acc + item.total_periodos_afectados_2026, 0),
    con_afectacion_2026: cases.filter((item) => item.total_periodos_afectados_2026 > 0).length,
    con_afectacion_2025_plus: cases.filter((item) => item.total_periodos_afectados_2025_plus > 0).length
  };

  return { summary, cases };
}

async function enrichNames(cases) {
  if (!cases.length) return false;
  const codes = [...new Set(cases.map((item) => String(item.codigo_municipal || "").trim()).filter(Boolean))];
  if (!codes.length) return false;

  const rs = await pool.query(`
    SELECT DISTINCT ON (TRIM(codigo_municipal))
      TRIM(codigo_municipal) AS codigo_municipal,
      COALESCE(NULLIF(TRIM(nombre_completo), ''), NULLIF(TRIM(sec_nombre), ''), '') AS nombre_completo
    FROM contribuyentes
    WHERE TRIM(codigo_municipal) = ANY($1::text[])
    ORDER BY TRIM(codigo_municipal), id_contribuyente DESC
  `, [codes]);

  const byCode = new Map();
  rs.rows.forEach((row) => {
    byCode.set(String(row.codigo_municipal || "").trim(), String(row.nombre_completo || "").trim());
  });

  cases.forEach((item) => {
    item.nombre_completo = byCode.get(String(item.codigo_municipal || "").trim()) || "";
  });

  return true;
}

function buildHtml(report) {
  const generatedAt = new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
  const caseCards = report.cases.map((item, index) => {
    const periodRanges = item.missing_paid_period_ranges.join(", ");
    const exampleRows = item.examples.slice(0, 12).map((example) => `
      <tr>
        <td>${escapeHtml(example.periodo)}</td>
        <td>${escapeHtml(example.razon)}</td>
        <td>${escapeHtml(example.antiguo.pagado_sn)} / ${escapeHtml(example.antiguo.abono_archivo)}</td>
        <td>${example.actual ? `${escapeHtml(example.actual.pagado_sn)} / ${escapeHtml(example.actual.abono_archivo)}` : "sin fila"}</td>
      </tr>
    `).join("");

    return `
      <section class="case-card">
        <div class="case-head">
          <div>
            <div class="case-index">Caso ${index + 1}</div>
            <h2>${escapeHtml(item.codigo_municipal)}${item.nombre_completo ? ` - ${escapeHtml(item.nombre_completo)}` : ""}</h2>
          </div>
          <div class="badge">${item.total_periodos_afectados} periodos</div>
        </div>
        <div class="stats-grid">
          <div class="stat">
            <div class="label">Ultimo pagado antiguo</div>
            <div class="value">${escapeHtml(item.old_latest_paid || "-")}</div>
          </div>
          <div class="stat">
            <div class="label">Ultimo pagado actual</div>
            <div class="value">${escapeHtml(item.new_latest_paid || "-")}</div>
          </div>
          <div class="stat">
            <div class="label">Ultimo pagado 2026 antiguo</div>
            <div class="value">${escapeHtml(item.old_latest_paid_2026 || "-")}</div>
          </div>
          <div class="stat">
            <div class="label">Ultimo pagado 2026 actual</div>
            <div class="value">${escapeHtml(item.new_latest_paid_2026 || "-")}</div>
          </div>
        </div>
        <p><strong>Periodos pagados en el archivo antiguo pero no reflejados igual en el actual:</strong> ${escapeHtml(periodRanges || "-")}</p>
        <table>
          <thead>
            <tr>
              <th>Periodo</th>
              <th>Razon</th>
              <th>Antiguo</th>
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            ${exampleRows}
          </tbody>
        </table>
      </section>
    `;
  }).join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Comparacion de historial de finanzas</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5efe4;
      --paper: #fffaf1;
      --ink: #202020;
      --muted: #6b655d;
      --line: #dccfb9;
      --accent: #9f4b24;
      --accent-soft: #f2d8c8;
      --good: #1e6a43;
      --warn: #8e2d1f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Georgia", "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(159, 75, 36, 0.08), transparent 28%),
        linear-gradient(180deg, #f8f2e7, var(--bg));
    }
    .page {
      width: 100%;
      max-width: 1040px;
      margin: 0 auto;
      padding: 32px 36px 56px;
    }
    .hero {
      background: linear-gradient(135deg, rgba(255,250,241,0.96), rgba(242,216,200,0.94));
      border: 1px solid rgba(159, 75, 36, 0.14);
      border-radius: 22px;
      padding: 28px;
      box-shadow: 0 18px 45px rgba(84, 52, 29, 0.08);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.1;
    }
    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }
    .summary-grid, .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .summary-card, .stat {
      background: rgba(255,255,255,0.72);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px 16px;
    }
    .summary-card .label, .stat .label {
      display: block;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .summary-card .value, .stat .value {
      display: block;
      font-size: 24px;
      font-weight: 700;
      color: var(--accent);
    }
    .meta {
      margin-top: 18px;
      font-size: 13px;
      color: var(--muted);
    }
    .case-card {
      margin-top: 22px;
      padding: 22px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: 0 12px 24px rgba(84, 52, 29, 0.05);
      page-break-inside: avoid;
    }
    .case-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 12px;
    }
    .case-index {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 4px;
    }
    h2 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
    }
    .badge {
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--warn);
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    p {
      font-size: 14px;
      line-height: 1.55;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    th {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .footer-note {
      margin-top: 24px;
      color: var(--muted);
      font-size: 12px;
    }
    @page {
      size: A4;
      margin: 10mm;
    }
    @media print {
      body { background: #fff; }
      .page { padding: 0; }
      .hero, .case-card {
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <h1>Comparacion de historial de finanzas legacy</h1>
      <p class="subtitle">
        ${report.inputs.mode === "advance-only"
          ? `Se marcaron solo los casos donde el archivo antiguo llega a periodos <strong>mas adelantados</strong> que el actual, y esos periodos adelantados ya no aparecen igual en el archivo vigente.`
          : `Se marcaron los casos donde un periodo figura como <strong>pagado</strong> en el archivo antiguo pero en el archivo actual no aparece igual: o no existe la fila, o sale como no pagado, o el monto actual es menor.`}
      </p>
      <div class="summary-grid">
        <div class="summary-card">
          <span class="label">Casos detectados</span>
          <span class="value">${escapeHtml(report.summary.total_casos)}</span>
        </div>
        <div class="summary-card">
          <span class="label">Periodos afectados</span>
          <span class="value">${escapeHtml(report.summary.total_periodos_afectados)}</span>
        </div>
        <div class="summary-card">
          <span class="label">Casos con 2026</span>
          <span class="value">${escapeHtml(report.summary.con_afectacion_2026)}</span>
        </div>
        <div class="summary-card">
          <span class="label">Periodos 2025+</span>
          <span class="value">${escapeHtml(report.summary.total_periodos_afectados_2025_plus)}</span>
        </div>
      </div>
      <div class="meta">
        Generado: ${escapeHtml(generatedAt)}<br/>
        Archivo antiguo: ${escapeHtml(report.inputs.oldFile)}<br/>
        Archivo actual: ${escapeHtml(report.inputs.newFile)}<br/>
        Filtro desde periodo: ${escapeHtml(report.inputs.fromPeriod || "sin filtro")}
        <br/>Modo: ${escapeHtml(report.inputs.mode || "all-losses")}
      </div>
    </section>
    ${caseCards || `<section class="case-card"><h2>Sin diferencias</h2><p>No se encontraron casos con la regla aplicada.</p></section>`}
    <div class="footer-note">
      Nota: el nombre del contribuyente se toma de la base actual solo si el codigo municipal existe y la base local responde.
    </div>
  </main>
  </body>
</html>`;
}

function sanitizePdfText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrapText(text, maxChars = 92) {
  const input = sanitizePdfText(text);
  if (input.length <= maxChars) return [input];
  const words = input.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    if (!current) {
      current = word;
      return;
    }
    const next = `${current} ${word}`;
    if (next.length <= maxChars) {
      current = next;
      return;
    }
    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines.length ? lines : [input.slice(0, maxChars)];
}

function buildTextReportLines(report) {
  const lines = [];
  lines.push("COMPARACION DE HISTORIAL DE FINANZAS LEGACY");
  lines.push("");
  lines.push(`Generado: ${report.generated_at}`);
  lines.push(`Archivo antiguo: ${report.inputs.oldFile}`);
  lines.push(`Archivo actual: ${report.inputs.newFile}`);
  lines.push(`Filtro desde periodo: ${report.inputs.fromPeriod || "sin filtro"}`);
  lines.push(`Modo: ${report.inputs.mode || "all-losses"}`);
  lines.push(`Casos detectados: ${report.summary.total_casos}`);
  lines.push(`Periodos afectados: ${report.summary.total_periodos_afectados}`);
  lines.push(`Casos con afectacion 2026: ${report.summary.con_afectacion_2026}`);
  lines.push(`Periodos afectados 2025+: ${report.summary.total_periodos_afectados_2025_plus}`);
  lines.push("");
  if (report.inputs.mode === "advance-only") {
    lines.push("Regla usada: solo se listan casos donde el archivo antiguo llega a un ultimo");
    lines.push("periodo pagado mas adelantado que el actual. Se muestran unicamente esos");
    lines.push("periodos adelantados que el actual perdio o ya no refleja igual.");
  } else {
    lines.push("Regla usada: en el archivo antiguo el periodo sale como pagado (S), pero en el");
    lines.push("archivo actual ese mismo periodo no aparece igual: falta la fila, sale como");
    lines.push("no pagado, o el monto actual es menor.");
  }
  lines.push("");

  report.cases.forEach((item, index) => {
    lines.push(`CASO ${index + 1}`);
    lines.push(`Codigo: ${item.codigo_municipal}${item.nombre_completo ? ` | Nombre: ${item.nombre_completo}` : ""}`);
    lines.push(`Periodos afectados: ${item.total_periodos_afectados}`);
    lines.push(`Ultimo pagado antiguo: ${item.old_latest_paid || "-"} | Ultimo pagado actual: ${item.new_latest_paid || "-"}`);
    lines.push(`Ultimo pagado 2026 antiguo: ${item.old_latest_paid_2026 || "-"} | Ultimo pagado 2026 actual: ${item.new_latest_paid_2026 || "-"}`);
    wrapText(`Periodos pagados en antiguo pero no reflejados igual en actual: ${item.missing_paid_period_ranges.join(", ") || "-"}`).forEach((line) => {
      lines.push(line);
    });
    item.examples.slice(0, 10).forEach((example) => {
      const actual = example.actual
        ? `actual=${example.actual.pagado_sn}/${example.actual.abono_archivo}`
        : "actual=sin_fila";
      lines.push(`  - ${example.periodo} | ${example.razon} | antiguo=${example.antiguo.pagado_sn}/${example.antiguo.abono_archivo} | ${actual}`);
    });
    lines.push("");
  });

  return lines;
}

function escapePdfLiteral(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildPdfBufferFromLines(lines) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 40;
  const marginTop = 48;
  const fontSize = 10;
  const lineHeight = 13;
  const usableHeight = pageHeight - (marginTop * 2);
  const linesPerPage = Math.max(1, Math.floor(usableHeight / lineHeight));
  const pages = [];

  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }

  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");

  const pageObjectNumbers = [];
  const contentObjectNumbers = [];
  const fontObjectNumber = 3;
  let nextObjectNumber = 4;

  pages.forEach(() => {
    pageObjectNumbers.push(nextObjectNumber);
    nextObjectNumber += 1;
    contentObjectNumbers.push(nextObjectNumber);
    nextObjectNumber += 1;
  });

  objects.push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  pages.forEach((pageLines, index) => {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = contentObjectNumbers[index];
    const streamLines = [
      "BT",
      `/F1 ${fontSize} Tf`,
      `${marginLeft} ${pageHeight - marginTop} Td`,
      `${lineHeight} TL`
    ];
    pageLines.forEach((line, lineIndex) => {
      const escaped = escapePdfLiteral(sanitizePdfText(line));
      if (lineIndex === 0) {
        streamLines.push(`(${escaped}) Tj`);
      } else {
        streamLines.push(`T* (${escaped}) Tj`);
      }
    });
    streamLines.push("ET");
    const streamBody = streamLines.join("\n");
    objects[pageObjectNumber - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber - 1] = `<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((objectBody, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function parseArgs(argv) {
  const options = {
    oldFile: null,
    newFile: null,
    outDir: null,
    fromPeriod: null,
    mode: "all-losses"
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--out-dir=")) {
      options.outDir = String(arg.split("=")[1] || "").trim() || null;
      return;
    }
    if (arg.startsWith("--from-period=")) {
      options.fromPeriod = String(arg.split("=")[1] || "").trim() || null;
      return;
    }
    if (arg === "--advance-only") {
      options.mode = "advance-only";
      return;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = String(arg.split("=")[1] || "").trim() || "all-losses";
      return;
    }
    if (!options.oldFile) {
      options.oldFile = arg;
      return;
    }
    if (!options.newFile) {
      options.newFile = arg;
    }
  });

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.oldFile || !options.newFile) {
    throw new Error("Uso: node server/scripts/compare_historial_finanzas_txt.js <txt-antiguo> <txt-actual> [--from-period=YYYY-MM] [--out-dir=ruta]");
  }

  options.fromPeriod = validatePeriodText(options.fromPeriod, "--from-period");

  const oldFile = path.resolve(options.oldFile);
  const newFile = path.resolve(options.newFile);
  if (!fs.existsSync(oldFile)) throw new Error(`No existe archivo antiguo: ${oldFile}`);
  if (!fs.existsSync(newFile)) throw new Error(`No existe archivo actual: ${newFile}`);

  const outDir = path.resolve(options.outDir || path.join(process.cwd(), "reports", `comparacion_finanzas_${new Date().toISOString().slice(0, 10)}`));
  fs.mkdirSync(outDir, { recursive: true });

  const oldRows = loadRowsFromTxt(oldFile, { fromPeriod: options.fromPeriod });
  const newRows = loadRowsFromTxt(newFile, { fromPeriod: options.fromPeriod });
  const baseResult = summarizeByCodigo(oldRows, newRows);
  const result = options.mode === "advance-only"
    ? filterAdvanceLosses(baseResult)
    : baseResult;

  let namesLoaded = false;
  try {
    namesLoaded = await enrichNames(result.cases);
  } catch (err) {
    console.warn(`Aviso: no se pudieron cargar nombres desde la base actual: ${err.message}`);
  } finally {
    await pool.end().catch(() => {});
  }

  const report = {
    generated_at: new Date().toISOString(),
    inputs: {
      oldFile,
      newFile,
      fromPeriod: options.fromPeriod || null,
      mode: options.mode,
      namesLoaded
    },
    old_rows: oldRows.length,
    new_rows: newRows.length,
    summary: result.summary,
    cases: result.cases
  };

  const jsonPath = path.join(outDir, "comparacion_finanzas.json");
  const htmlPath = path.join(outDir, "comparacion_finanzas.html");
  const pdfPath = path.join(outDir, "comparacion_finanzas.pdf");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(htmlPath, buildHtml(report), "utf8");
  fs.writeFileSync(pdfPath, buildPdfBufferFromLines(buildTextReportLines(report)));

  console.log(JSON.stringify({
    ok: true,
    out_dir: outDir,
    json: jsonPath,
    html: htmlPath,
    pdf: pdfPath,
    total_casos: report.summary.total_casos,
    total_periodos_afectados: report.summary.total_periodos_afectados,
    total_periodos_afectados_2025_plus: report.summary.total_periodos_afectados_2025_plus,
    total_periodos_afectados_2026: report.summary.total_periodos_afectados_2026,
    names_loaded: namesLoaded
  }, null, 2));
}

main().catch((err) => {
  console.error("Error comparando historiales:", err.message);
  process.exitCode = 1;
});
