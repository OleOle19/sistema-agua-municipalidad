const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN_X = 36;
const PAGE_START_Y = 760;
const LINE_HEIGHT = 13;
const MAX_LINES_PER_PAGE = 52;
const MAX_LINE_CHARS = 108;

const byteLength = (value) => new TextEncoder().encode(String(value || "")).length;

const normalizePdfText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\x20-\x7E]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const escapePdfString = (value) => String(value || "")
  .replace(/\\/g, "\\\\")
  .replace(/\(/g, "\\(")
  .replace(/\)/g, "\\)");

const wrapLine = (value, maxChars = MAX_LINE_CHARS) => {
  const text = normalizePdfText(value);
  if (!text) return [""];
  if (text.length <= maxChars) return [text];

  const words = text.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (word.length > maxChars) {
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      current = "";
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
};

const formatMoney = (value) => {
  const n = Number.parseFloat(value);
  return `S/. ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
};

const formatDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-PE");
};

const pushWrapped = (lines, value, indent = "") => {
  const wrapped = wrapLine(value);
  wrapped.forEach((line, idx) => {
    lines.push(idx === 0 ? `${indent}${line}` : `${indent}${line}`);
  });
};

const toPageStreams = (lines) => {
  const chunks = [];
  for (let i = 0; i < lines.length; i += MAX_LINES_PER_PAGE) {
    chunks.push(lines.slice(i, i + MAX_LINES_PER_PAGE));
  }
  if (chunks.length === 0) chunks.push(["Sin datos para exportar."]);

  return chunks.map((pageLines) => {
    const ops = ["BT", "/F1 10 Tf", `${PAGE_MARGIN_X} ${PAGE_START_Y} Td`];
    pageLines.forEach((line, idx) => {
      if (idx > 0) ops.push(`0 -${LINE_HEIGHT} Td`);
      const safe = escapePdfString(normalizePdfText(line) || " ");
      ops.push(`(${safe}) Tj`);
    });
    ops.push("ET");
    return ops.join("\n");
  });
};

const buildPdfBlobFromStreams = (streams) => {
  const pageCount = Math.max(1, streams.length);
  const fontObjId = 3 + pageCount * 2;
  const maxObjId = fontObjId;
  const objects = new Array(maxObjId + 1);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  const kids = [];
  for (let i = 0; i < pageCount; i += 1) {
    const pageObjId = 3 + i * 2;
    const contentObjId = pageObjId + 1;
    kids.push(`${pageObjId} 0 R`);

    objects[pageObjId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`;
    const stream = streams[i] || "BT /F1 10 Tf 36 760 Td (Sin datos) Tj ET";
    objects[contentObjId] = `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }

  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;
  objects[fontObjId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = new Array(maxObjId + 1).fill(0);

  for (let id = 1; id <= maxObjId; id += 1) {
    offsets[id] = byteLength(pdf);
    pdf += `${id} 0 obj\n${objects[id] || "<<>>"}\nendobj\n`;
  }

  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${maxObjId + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id <= maxObjId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
};

export const buildReporteEstadoConexionPdf = (payload = {}) => {
  const lista = Array.isArray(payload?.lista) ? payload.lista : [];
  const criterio = payload?.criterio || {};
  const modoReporte = String(criterio?.modo_reporte || "estado").toLowerCase();
  const estadoObjetivo = String(criterio?.estado_objetivo || "").toUpperCase();
  const esProyeccion = modoReporte === "proyeccion";
  const mostrarDetalleCorte = estadoObjetivo === "CORTADO";
  const mostrarEvidencia = mostrarDetalleCorte && Boolean(payload?.mostrar_evidencia);

  const generadoEn = payload?.generado_en ? new Date(payload.generado_en) : new Date();
  const fechaValida = Number.isNaN(generadoEn.getTime()) ? new Date() : generadoEn;
  const totalDeuda = lista.reduce((acc, row) => acc + (Number.parseFloat(row?.deuda_total ?? row?.deuda_anio ?? 0) || 0), 0);
  const totalAbono = lista.reduce((acc, row) => acc + (Number.parseFloat(row?.abono_total ?? row?.abono_anio ?? 0) || 0), 0);
  const totalMensual = lista.reduce((acc, row) => acc + (Number.parseFloat(row?.monto_mensual ?? row?.monto_referencia ?? 0) || 0), 0);
  const totalProyectado = lista.reduce((acc, row) => acc + (Number.parseFloat(row?.total_proyectado ?? row?.monto_periodo ?? 0) || 0), 0);
  const proyeccion = payload?.proyeccion || {};

  const lines = [];
  if (esProyeccion) {
    lines.push("REPORTE DE PROYECCION FUTURA - CONEXION ACTIVA");
    lines.push("Municipalidad Distrital de Pueblo Nuevo");
    lines.push(`Fecha: ${fechaValida.toLocaleDateString("es-PE")} ${fechaValida.toLocaleTimeString("es-PE")}`);
    lines.push(`Criterio: ${criterio?.descripcion || "Seleccion manual"}`);
    lines.push(`Estado: ${criterio?.estado_label || "Con conexion"}`);
    lines.push(`Mes referencia: ${proyeccion?.fecha_referencia_mes || "-"}`);
    lines.push(`Meses proyectados: ${Number(proyeccion?.meses_proyeccion || 0)} | Base mensual: ${formatMoney(totalMensual)} | Total proyectado: ${formatMoney(totalProyectado)}`);
    lines.push("=".repeat(90));
    if (Array.isArray(proyeccion?.detalle_mensual) && proyeccion.detalle_mensual.length > 0) {
      lines.push("DETALLE MENSUAL");
      proyeccion.detalle_mensual.forEach((row) => {
        lines.push(`- ${row?.periodo || "-"} | Inicio ${row?.fecha_inicio_mes || "-"} | Total ${formatMoney(row?.total || 0)}`);
      });
      lines.push("=".repeat(90));
    }
    if (lista.length === 0) {
      lines.push("No hay datos para este criterio.");
    } else {
      lista.forEach((row, idx) => {
        pushWrapped(lines, `${idx + 1}. [${row?.codigo_municipal || "-"}] ${row?.nombre_completo || ""}`);
        pushWrapped(lines, `   Direccion: ${row?.direccion_completa || ""}`);
        pushWrapped(lines, `   Predios activos: ${Number(row?.total_predios || 0)} | Base mensual: ${formatMoney(row?.monto_mensual || 0)} | Total proyectado: ${formatMoney(row?.total_proyectado || 0)}`);
        lines.push("-".repeat(90));
      });
    }
    const streams = toPageStreams(lines);
    return buildPdfBlobFromStreams(streams);
  }

  lines.push("REPORTE DE ESTADO DE CONEXION");
  lines.push("Municipalidad Distrital de Pueblo Nuevo");
  lines.push(`Fecha: ${fechaValida.toLocaleDateString("es-PE")} ${fechaValida.toLocaleTimeString("es-PE")}`);
  lines.push(`Criterio: ${criterio?.descripcion || "Seleccion manual"}`);
  lines.push(`Estado: ${criterio?.estado_label || "Contribuyentes"}`);
  lines.push("Orden: Calle y numero ascendente");
  lines.push(`Registros: ${lista.length} | Total deuda: ${formatMoney(totalDeuda)} | Total abono: ${formatMoney(totalAbono)}`);
  if (mostrarEvidencia) {
    lines.push("Incluye evidencia de corte adjunta.");
  }
  lines.push("=".repeat(90));

  if (lista.length === 0) {
    lines.push("No hay datos para este criterio.");
  } else {
    lista.forEach((row, idx) => {
      const codigo = row?.codigo_municipal || "-";
      const nombre = row?.nombre_completo || "";
      const dni = row?.dni_ruc || "-";
      const direccion = row?.direccion_completa || "";
      const meses = Number(row?.meses_deuda || 0);
      const deuda = formatMoney(row?.deuda_total ?? row?.deuda_anio ?? 0);
      const abono = formatMoney(row?.abono_total ?? row?.abono_anio ?? 0);

      pushWrapped(lines, `${idx + 1}. [${codigo}] ${nombre}`);
      pushWrapped(lines, `   DNI: ${dni}`);
      pushWrapped(lines, `   Direccion: ${direccion}`);
      pushWrapped(lines, `   Meses deuda: ${meses} | Deuda total: ${deuda} | Abono total: ${abono}`);

      if (mostrarDetalleCorte) {
        const fechaCorte = formatDate(row?.corte_fecha) || "-";
        const motivo = row?.corte_motivo || row?.estado_conexion_motivo_ultimo || "-";
        pushWrapped(lines, `   Fecha corte: ${fechaCorte}`);
        pushWrapped(lines, `   Motivo: ${motivo}`);
      }

      if (mostrarEvidencia) {
        const evidencia = row?.evidencia_resumen || "Sin evidencia adjunta";
        pushWrapped(lines, `   Evidencia: ${evidencia}`);
      }

      lines.push("-".repeat(90));
    });
  }

  const streams = toPageStreams(lines);
  return buildPdfBlobFromStreams(streams);
};
