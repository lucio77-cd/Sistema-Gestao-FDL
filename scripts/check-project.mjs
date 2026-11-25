import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const jsFiles = walk(join(root, "js")).filter((path) => extname(path) === ".js");
for (const file of jsFiles) {
  const source = readFileSync(file, "utf8");
  const result = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: source,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push(`Sintaxe inválida em ${file.replace(root + "/", "")}:\n${result.stderr || result.stdout}`);
  }
}

const htmlFiles = readdirSync(root).filter((file) => file.endsWith(".html"));
const referencePattern = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
for (const htmlFile of htmlFiles) {
  const html = readFileSync(join(root, htmlFile), "utf8");
  for (const match of html.matchAll(referencePattern)) {
    const reference = match[1].trim();
    if (!reference || /^(?:https?:)?\/\//i.test(reference) || /^(?:data:|#|mailto:)/i.test(reference)) continue;
    const localPath = reference.split(/[?#]/, 1)[0];
    if (!localPath) continue;
    if (!existsSync(resolve(root, localPath))) {
      failures.push(`Referência local inexistente em ${htmlFile}: ${reference}`);
    }
  }
}

if (failures.length) {
  console.error("Foram encontradas falhas de qualidade:\n\n" + failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log(`Verificação concluída: ${jsFiles.length} arquivos JavaScript e ${htmlFiles.length} páginas HTML analisados.`);
}
