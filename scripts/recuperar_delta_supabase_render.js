const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://qirjfgjesjzikouehmib.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_SSAA2undzTyVsgCjMgbXBw_Bu9D_lvt";
const datosRenderPath = path.join(process.env.USERPROFILE || "", "Desktop", "datos-render-serviu.txt");

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

const quoteIdent = (name) => '"' + String(name).replace(/"/g, '""') + '"';
const keyDoc = (doc = {}) => String(doc.id || doc.archivo || doc.nombre || "").trim().toLowerCase();
const docScore = (doc = {}) => {
  let score = 0;
  if (doc.entregado) score += 10;
  if (doc.valor) score += 3;
  if (doc.archivo || doc.storagePath || doc.storage_path || doc.archivoData) score += 5;
  return score + Object.keys(doc || {}).length / 100;
};

const mergeDocs = (actual = [], incoming = []) => {
  const merged = Array.isArray(actual) ? actual.map((d) => ({ ...d })) : [];
  const pos = new Map();
  merged.forEach((doc, idx) => {
    const key = keyDoc(doc);
    if (key) pos.set(key, idx);
  });
  for (const src of Array.isArray(incoming) ? incoming : []) {
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
      if (combined[k] === undefined || combined[k] === null || combined[k] === "" || combined[k] === false) {
        combined[k] = v;
      }
    }
    if (docScore(src) > docScore(dst)) {
      merged[idx] = { ...combined, ...src };
    } else {
      merged[idx] = combined;
    }
  }
  return merged;
};

async function fetchAllSupabase(supabase, table, select = "*") {
  const pageSize = 500;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function upsertRows(client, table, rows) {
  if (!rows.length) return 0;
  let count = 0;
  for (const row of rows) {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    if (!keys.length || !row.id) continue;
    const values = keys.map((k) => {
      const v = row[k];
      return v && typeof v === "object" && !Buffer.isBuffer(v) ? JSON.stringify(v) : v;
    });
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const updates = keys.filter((k) => k !== "id").map((k) => `${quoteIdent(k)} = EXCLUDED.${quoteIdent(k)}`).join(", ");
    const sql = `INSERT INTO ${quoteIdent(table)} (${keys.map(quoteIdent).join(", ")})
      VALUES (${placeholders})
      ON CONFLICT (id) DO UPDATE SET ${updates || `${quoteIdent("id")} = EXCLUDED.${quoteIdent("id")}`}`;
    await client.query(sql, values);
    count += 1;
  }
  return count;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const render = new Client({ connectionString: readRenderUrl(), ssl: { rejectUnauthorized: false } });
  await render.connect();
  try {
    console.log("Leyendo Supabase en modo solo lectura...");
    const [supSolicitudes, supArchivos] = await Promise.all([
      fetchAllSupabase(supabase, "solicitudes", "*"),
      fetchAllSupabase(supabase, "archivos_solicitante", "*"),
    ]);

    console.log(`Supabase solicitudes=${supSolicitudes.length} archivos=${supArchivos.length}`);

    const { rows: renderSolicitudes } = await render.query('SELECT id, documentos FROM "solicitudes"');
    const actualPorId = new Map(renderSolicitudes.map((r) => [r.id, r]));
    const solicitudesActualizadas = [];

    for (const src of supSolicitudes) {
      const actual = actualPorId.get(src.id);
      if (!actual) {
        solicitudesActualizadas.push(src);
        continue;
      }
      const docs = mergeDocs(actual.documentos || [], src.documentos || []);
      if (JSON.stringify(docs) !== JSON.stringify(actual.documentos || [])) {
        solicitudesActualizadas.push({ ...src, documentos: docs });
      }
    }

    const nSol = await upsertRows(render, "solicitudes", solicitudesActualizadas);
    const nArch = await upsertRows(render, "archivos_solicitante", supArchivos);

    console.log(`Recuperadas/mezcladas solicitudes=${nSol}`);
    console.log(`Recuperados/mezclados archivos=${nArch}`);
    console.log("Listo. No se borro ningun registro de Render.");
  } finally {
    await render.end();
  }
}

main().catch((err) => {
  console.error("No se pudo recuperar desde Supabase:", err.message);
  process.exit(1);
});
