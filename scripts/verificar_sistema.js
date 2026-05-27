const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "src", "App.js");
const serverPath = path.join(root, "server.js");
const pkgPath = path.join(root, "package.json");

const read = (file) => fs.readFileSync(file, "utf8");

const checks = [];
const warnings = [];

function ok(name, condition, detail = "") {
  checks.push({ name, condition: !!condition, detail });
}

function warn(name, condition, detail = "") {
  if (!condition) warnings.push({ name, detail });
}

function contains(text, needle) {
  return text.includes(needle);
}

function regex(text, pattern) {
  return pattern.test(text);
}

function main() {
  const requiredFiles = [appPath, serverPath, pkgPath];
  requiredFiles.forEach((file) => ok(`Existe ${path.relative(root, file)}`, fs.existsSync(file)));

  if (!fs.existsSync(appPath)) throw new Error("No existe src/App.js");

  const app = read(appPath);
  const server = fs.existsSync(serverPath) ? read(serverPath) : "";
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(read(pkgPath)) : {};

  ok("Script verificar disponible en package.json", pkg.scripts && pkg.scripts.verificar === "node scripts/verificar_sistema.js");

  ok("No aparece texto antiguo Control de Subsidios", !contains(app, "Control de Subsidios"));
  ok("No aparece Pitrufquén en App.js", !regex(app, /Pitrufqu[eé]n/i));
  ok("Menu lateral usa nombre oficial del sistema", contains(app, "Sistema de Gestión de Subsidios Habitacionales"));

  ok("Visitas no se vacían ante error de carga", !contains(app, "setVisitas([])"));
  ok("Visitas tienen respaldo interno en solicitudes", contains(app, "__registro_visitas_oficina__"));
  ok("Visitas se fusionan desde tabla y respaldo", contains(app, "fusionarVisitas"));
  ok("Guardar visita no cierra formulario si falla persistencia", contains(app, "evitar pérdida de datos"));
  ok("Guardar visita reintenta con columnas mínimas", contains(app, "[visitas insert retry]"));

  ok("Documentos HTML generados se abren desde respaldo", contains(app, "data:text/html") && contains(app, "setHtmlPreview(html)"));
  ok("Borrar documento limpia respaldo interno", contains(app, "quitarRegistroInterno"));
  ok("Borrar documento limpia solicitud sin borrar otros datos", contains(app, "archivoData: \"\"") && contains(app, "storagePath: \"\""));
  ok("Archivos guardados conservan respaldo data/storage", contains(app, "archivoData: storagePath ? \"\" : dataUrl") && contains(app, "storagePath"));

  ok("Solicitud 2026 usa plantilla oficial", contains(app, "formulario_solicitud_habilitacion_inhabitabilidad_2026.pdf"));
  ok("Carta SERVIU tiene destinatario Marco Seguel", contains(app, "SEÑOR MARCO SEGUEL REYES"));
  ok("Carta SERVIU permite destinatario Otro", contains(app, "<option value=\"otro\">Otro</option>"));

  ok("No hay localStorage.clear", !contains(app, "localStorage.clear"));
  ok("No hay window.location.reload forzado", !contains(app, "window.location.reload"));
  ok("Update backend sin filtros bloqueado", contains(server, "Update sin filtros bloqueado"));

  const deleteCalls = [...app.matchAll(/supabase\.from\([^)]+\)\.delete\(\)([^;]+)/g)].map((m) => m[0]);
  deleteCalls.forEach((call, index) => {
    ok(`Delete Supabase ${index + 1} tiene filtro eq`, call.includes(".eq("), call);
  });

  warn(
    "server.js mantiene DELETE FROM actividades",
    !contains(server, "DELETE FROM actividades WHERE personaId"),
    "Existe endpoint antiguo que reemplaza actividades por persona. No afecta visitas, pero revisar si se vuelve a usar actividades."
  );

  const failed = checks.filter((c) => !c.condition);
  console.log("\nVerificación SERVIU Subsidios");
  console.log("================================");
  checks.forEach((c) => {
    console.log(`${c.condition ? "OK " : "ERR"} ${c.name}${c.detail && !c.condition ? `\n    ${c.detail}` : ""}`);
  });

  if (warnings.length) {
    console.log("\nAdvertencias");
    warnings.forEach((w) => console.log(`WARN ${w.name}${w.detail ? `\n    ${w.detail}` : ""}`));
  }

  if (failed.length) {
    console.error(`\nFalló la verificación: ${failed.length} regla(s) crítica(s). No publicar hasta reparar.`);
    process.exit(1);
  }

  console.log("\nVerificación aprobada. Puede continuar con npm run build.");
}

main();
