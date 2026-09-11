import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(scriptDir, "../dist/assets");
const kib = (bytes) => bytes / 1024;
const formatKib = (bytes) => `${kib(bytes).toFixed(2)} KiB`;

const findOne = (files, pattern, label) => {
  const matches = files.filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`${label}: se esperaba un archivo y se encontraron ${matches.length}.`);
  }
  return matches[0];
};

const readAsset = async (name) => {
  const content = await readFile(path.join(assetsDir, name));
  return {
    name,
    rawBytes: content.byteLength,
    gzipBytes: gzipSync(content).byteLength
  };
};

const main = async () => {
  const files = await readdir(assetsDir);
  const initialJsNames = [
    findOne(files, /^index-.*\.js$/, "Entrada principal"),
    findOne(files, /^vendor-react-.*\.js$/, "React compartido"),
    findOne(files, /^vendor-ui-.*\.js$/, "Interfaz compartida"),
    findOne(files, /^vendor-data-.*\.js$/, "Cliente de datos")
  ];
  const initialCssNames = [
    findOne(files, /^index-.*\.css$/, "Estilos propios"),
    findOne(files, /^vendor-ui-.*\.css$/, "Estilos compartidos")
  ];
  const heroName = findOne(
    files,
    /^landing-hero-art-v1-.*\.(?:avif|jpe?g|png|webp)$/,
    "Imagen principal"
  );

  const initialJs = await Promise.all(initialJsNames.map(readAsset));
  const initialCss = await Promise.all(initialCssNames.map(readAsset));
  const hero = await readAsset(heroName);
  const checks = [
    {
      label: "JavaScript inicial comprimido",
      actual: initialJs.reduce((total, asset) => total + asset.gzipBytes, 0),
      limit: 115 * 1024
    },
    {
      label: "CSS inicial comprimido",
      actual: initialCss.reduce((total, asset) => total + asset.gzipBytes, 0),
      limit: 40 * 1024
    },
    {
      label: "Imagen principal",
      actual: hero.rawBytes,
      limit: 500 * 1024
    }
  ];

  let failed = false;
  for (const check of checks) {
    const passed = check.actual <= check.limit;
    const marker = passed ? "OK" : "EXCEDE";
    console.log(`${marker}  ${check.label}: ${formatKib(check.actual)} / ${formatKib(check.limit)}`);
    failed ||= !passed;
  }

  if (failed) {
    process.exitCode = 1;
    console.error("El build supera el presupuesto. Revise qué recurso aumentó antes de publicarlo.");
  }
};

main().catch((error) => {
  process.exitCode = 1;
  console.error(`No se pudo verificar el presupuesto del build: ${error.message}`);
});
