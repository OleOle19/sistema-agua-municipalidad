const crypto = require("crypto");

const FORMAT_VERSION = "v1";
const IV_BYTES = 12;

const deriveKey = (secret) => crypto
  .createHash("sha256")
  .update(`municipal-password-vault:${String(secret || "")}`, "utf8")
  .digest();

const encryptPassword = (password, secret) => {
  const plain = String(password || "");
  if (!plain) return null;
  if (!String(secret || "")) throw new Error("PASSWORD_VAULT_SECRET no configurado");

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
};

const decryptPassword = (payload, secret) => {
  const raw = String(payload || "").trim();
  if (!raw) return null;
  if (!String(secret || "")) throw new Error("PASSWORD_VAULT_SECRET no configurado");

  const [version, ivRaw, tagRaw, encryptedRaw, ...extra] = raw.split(".");
  if (version !== FORMAT_VERSION || !ivRaw || !tagRaw || !encryptedRaw || extra.length > 0) {
    throw new Error("Formato de credencial cifrada inválido");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
};

module.exports = { decryptPassword, encryptPassword };
