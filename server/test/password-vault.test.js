const test = require("node:test");
const assert = require("node:assert/strict");
const { decryptPassword, encryptPassword } = require("../password-vault");

test("la bóveda cifra y recupera una contraseña sin guardarla en texto plano", () => {
  const secret = "una-clave-de-prueba-suficientemente-larga";
  const password = "Clave Municipal 2026!";
  const encrypted = encryptPassword(password, secret);

  assert.ok(encrypted.startsWith("v1."));
  assert.equal(encrypted.includes(password), false);
  assert.equal(decryptPassword(encrypted, secret), password);
});

test("la bóveda rechaza una clave de descifrado diferente", () => {
  const encrypted = encryptPassword("Clave segura", "clave-original");
  assert.throws(() => decryptPassword(encrypted, "clave-distinta"));
});
