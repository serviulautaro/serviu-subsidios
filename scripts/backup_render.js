const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const datosRenderPath = path.join(process.env.USERPROFILE || "", "Desktop", "datos-render-serviu.txt");
const outRoot = path.join(process.env.USERPROFILE || "", "Desktop", "serviu-subsidios", "respaldos");
const tables = ["comites", "personas", "solicitudes", "programas_custom", "archivos_solicitante", "app_users", "audit_log"];

const readRenderUrl = () => {
  const txt = fs.readFileSync(datosRenderPath, "utf8");
  const pgLine = txt.split(/\r?\n/).find((line) => line.startsWith("PGPASSWORD=")) || "";
  const password = (pgLine.match(/^PGPASSWORD=(\S+)/) || [])[1];
  if (password) {
    return `postgresql://serviu:${encodeURIComponent(password)}@dpg-d8b18rel51nc7398d50g-a.oregon-postgres.render.com:5432/serviu`;
  }
  const line = txt.split(/\r?\n/).find((l) => l.startsWith("RENDER_EXTERNAL_DATABASE_URL="));
  if (!line) throw new Error("No se encontro la conexion Render en datos-render-serviu.txt");
  return line.slice(line.indexOf("=") + 1).trim();
};

const stamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_render`;
};

async function main() {
  const dir = path.join(outRoot, stamp(), "exports");
  fs.mkdirSync(dir, { recursive: true });
  const client = new Client({ connectionString: readRenderUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const manifest = { generado: new Date().toISOString(), fuente: "render_postgres", tablas: {} };
  try {
    for (const table of tables) {
      try {
        const { rows } = await client.query(`SELECT * FROM "${table}"`);
        fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2), "utf8");
        manifest.tablas[table] = rows.length;
        console.log(`${table}: ${rows.length}`);
      } catch (err) {
        manifest.tablas[table] = { error: err.message };
        console.warn(`${table}: ${err.message}`);
      }
    }
    fs.writeFileSync(path.join(path.dirname(dir), "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    console.log(`Respaldo creado: ${path.dirname(dir)}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("No se pudo crear respaldo Render:", err.message);
  process.exit(1);
});
