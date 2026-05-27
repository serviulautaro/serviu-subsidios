const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const datosRenderPath = path.join(process.env.USERPROFILE || "", "Desktop", "datos-render-serviu.txt");
const backupDir = process.env.BACKUP_EXPORTS_DIR || path.join("C:", "Users", "JORGE", "Desktop", "serviu-subsidios", "respaldos", "20260525_183214", "exports");

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

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(backupDir, name), "utf8"));
const keyDoc = (doc = {}) => String(doc.id || doc.archivo || doc.nombre || "").trim().toLowerCase();
const scoreDoc = (doc = {}) => {
  let score = 0;
  if (doc.entregado) score += 10;
  if (doc.valor) score += 4;
  if (doc.archivo || doc.storagePath || doc.storage_path || doc.archivoData) score += 6;
  return score + Object.keys(doc || {}).length / 100;
};
const scoreDocs = (docs = []) => (Array.isArray(docs) ? docs : []).reduce((sum, doc) => sum + scoreDoc(doc), 0);

const mergeDocs = (actual = [], respaldo = []) => {
  const merged = Array.isArray(actual) ? actual.map((d) => ({ ...d })) : [];
  const pos = new Map();
  merged.forEach((doc, idx) => {
    const key = keyDoc(doc);
    if (key) pos.set(key, idx);
  });
  for (const src of Array.isArray(respaldo) ? respaldo : []) {
    const key = keyDoc(src);
    if (!key) continue;
    if (!pos.has(key)) {
      pos.set(key, merged.length);
      merged.push({ ...src });
      continue;
    }
    const idx = pos.get(key);
    const dst = merged[idx] || {};
    const combined = { ...dst };
    for (const [k, v] of Object.entries(src || {})) {
      if (combined[k] === undefined || combined[k] === null || combined[k] === "" || combined[k] === false) combined[k] = v;
    }
    merged[idx] = scoreDoc(src) > scoreDoc(dst) ? { ...combined, ...src } : combined;
  }
  return merged;
};

async function main() {
  const respaldoSolicitudes = readJson("solicitudes.json");
  const respaldoArchivos = fs.existsSync(path.join(backupDir, "archivos_solicitante.json")) ? readJson("archivos_solicitante.json") : [];
  const client = new Client({ connectionString: readRenderUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN");
    let solicitudesReparadas = 0;
    let documentosAntes = 0;
    let documentosDespues = 0;
    for (const respaldo of respaldoSolicitudes) {
      if (!respaldo?.id) continue;
      const actualRes = await client.query('SELECT id, documentos FROM "solicitudes" WHERE id = $1', [respaldo.id]);
      if (!actualRes.rows.length) {
        await client.query(
          `INSERT INTO "solicitudes"(id, persona_id, persona_nombre, programa_id, fecha, comite, codigo_comite, tipo_comite, profesional_comite, fecha_visita, documentos)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            respaldo.id,
            respaldo.persona_id,
            respaldo.persona_nombre,
            respaldo.programa_id,
            respaldo.fecha,
            respaldo.comite,
            respaldo.codigo_comite,
            respaldo.tipo_comite,
            respaldo.profesional_comite,
            respaldo.fecha_visita || "",
            JSON.stringify(respaldo.documentos || []),
          ]
        );
        solicitudesReparadas += 1;
        documentosDespues += (respaldo.documentos || []).length;
        continue;
      }
      const actual = actualRes.rows[0];
      const docsActuales = actual.documentos || [];
      const docsRespaldo = respaldo.documentos || [];
      documentosAntes += docsActuales.length;
      const merged = mergeDocs(docsActuales, docsRespaldo);
      documentosDespues += merged.length;
      const debeReparar = merged.length > docsActuales.length || scoreDocs(merged) > scoreDocs(docsActuales);
      if (!debeReparar) continue;
      await client.query('UPDATE "solicitudes" SET documentos = $1::jsonb WHERE id = $2', [JSON.stringify(merged), respaldo.id]);
      solicitudesReparadas += 1;
    }

    let archivosReparados = 0;
    for (const archivo of respaldoArchivos) {
      if (!archivo?.id) continue;
      const keys = Object.keys(archivo).filter((k) => archivo[k] !== undefined);
      const values = keys.map((k) => archivo[k]);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const updates = keys.filter((k) => k !== "id").map((k) => `"${k}" = EXCLUDED."${k}"`).join(", ");
      await client.query(
        `INSERT INTO "archivos_solicitante" (${keys.map((k) => `"${k}"`).join(", ")})
         VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${updates || '"id" = EXCLUDED."id"'}`,
        values
      );
      archivosReparados += 1;
    }
    await client.query("COMMIT");
    console.log(`Solicitudes reparadas/insertadas: ${solicitudesReparadas}`);
    console.log(`Documentos contados antes=${documentosAntes} despues=${documentosDespues}`);
    console.log(`Archivos registrados/mezclados: ${archivosReparados}`);
    console.log("Listo. No se borro informacion.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("No se pudo restaurar desde respaldo:", err.message);
  process.exit(1);
});
