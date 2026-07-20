const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inferAuditCategory,
  inferAuditEntity,
  inferAuditRisk,
  normalizeAuditActivityFilter,
  normalizeAuditEventCode,
  redactAuditPayload,
  shouldRedactAuditKey
} = require("../audit-utils");

test("redactAuditPayload oculta secretos sin distinguir mayusculas y conserva contexto util", () => {
  const result = redactAuditPayload({
    username: "caja-1",
    PASSWORD: "no-debe-verse",
    nested: {
      Authorization: "Bearer secreto",
      monto: 42.5,
      credencial_token: "abc",
      refreshToken: "def",
      apiKey: "ghi",
      items: [{ contrasena: "1234", id_recibo: 91 }]
    }
  });

  assert.deepEqual(result, {
    username: "caja-1",
    PASSWORD: "[REDACTED]",
    nested: {
      Authorization: "[REDACTED]",
      monto: 42.5,
      credencial_token: "[REDACTED]",
      refreshToken: "[REDACTED]",
      apiKey: "[REDACTED]",
      items: [{ contrasena: "[REDACTED]", id_recibo: 91 }]
    }
  });
  assert.equal(shouldRedactAuditKey("JWT_SECRET"), true);
  assert.equal(shouldRedactAuditKey("foto_medidor_base64"), true);
  assert.equal(shouldRedactAuditKey("id_recibo"), false);
});

test("normalizeAuditEventCode elimina identificadores variables de las rutas", () => {
  assert.equal(normalizeAuditEventCode("DELETE /recibos/9381"), "DELETE_RECIBOS_ID");
  assert.equal(
    normalizeAuditEventCode("PATCH /api/usuarios/550e8400-e29b-41d4-a716-446655440000"),
    "PATCH_API_USUARIOS_ID"
  );
  assert.equal(normalizeAuditEventCode("Pago aplicado"), "PAGO_APLICADO");
});

test("normalizeAuditActivityFilter admite compensaciones y descarta valores desconocidos", () => {
  assert.equal(normalizeAuditActivityFilter(" compensacion "), "COMPENSACION");
  assert.equal(normalizeAuditActivityFilter("POST"), "POST");
  assert.equal(normalizeAuditActivityFilter("otro"), "TODOS");
});

test("clasifica eventos con categoria y riesgo consistentes", () => {
  assert.equal(inferAuditCategory("AUTH_LOGIN"), "SEGURIDAD");
  assert.equal(inferAuditCategory("PAGO_REGISTRADO"), "CAJA");
  assert.equal(inferAuditCategory("GET /reportes", "GET"), "CONSULTA");
  assert.equal(inferAuditRisk("USUARIO_ELIMINADO"), "ALTO");
  assert.equal(inferAuditRisk("PAGO_REGISTRADO"), "MEDIO");
  assert.equal(inferAuditRisk("GET /reportes", "CONSULTA"), "BAJO");
});

test("infiere entidad e identificador desde parametros de ruta", () => {
  assert.deepEqual(inferAuditEntity("/recibos/57", { id: 57 }), {
    entidad_tipo: "RECIBO",
    entidad_id: "57"
  });
  assert.deepEqual(inferAuditEntity("/luz/suministros/18", { id_suministro: 18 }), {
    entidad_tipo: "SUMINISTRO",
    entidad_id: "18"
  });
  assert.deepEqual(inferAuditEntity("/reportes", {}), {
    entidad_tipo: null,
    entidad_id: null
  });
});
