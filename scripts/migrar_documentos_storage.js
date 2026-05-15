const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const Database = require("better-sqlite3");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://qirjfgjesjzikouehmib.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "documentos-solicitantes";
const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT, "documentos");
const LOCAL_DB = path.join(ROOT, "serviu.db");

if (!SERVICE_KEY) {
  console.error("Falta SUPABASE_SERVICE_ROLE_KEY. Usa la service_role key solo como variable temporal.");
  process.exit(1);
}

if (!fs.existsSync(DOCS_DIR)) {
  console.error("No existe carpeta documentos:", DOCS_DIR);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function walk(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full));
    if (item.isFile()) out.push(full);
  }
  return out;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function storagePath(localFile) {
  return path.relative(DOCS_DIR, localFile).split(path.sep).join("/");
}

function cleanRut(value) {
  return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function rutFromFolder(carpeta) {
  const last = String(carpeta || "").split("/").filter(Boolean).pop() || "";
  const cleanLast = cleanRut(last);
  if (cleanLast.length >= 7) return cleanLast;
  const m = last.match(/([0-9kK]{7,9})$/);
  return m ? cleanRut(m[1]) : "";
}

async function main() {
  const files = walk(DOCS_DIR);
  console.log(`Documentos encontrados: ${files.length}`);

  const { data: personas, error: perErr } = await supabase
    .from("personas")
    .select("id,rut,nombre");
  if (perErr) throw perErr;
  const personasPorRut = new Map();
  for (const p of personas || []) personasPorRut.set(cleanRut(p.rut), p);

  const archivosLocales = new Map();
  if (fs.existsSync(LOCAL_DB)) {
    const db = new Database(LOCAL_DB, { readonly: true });
    try {
      for (const row of db.prepare("select id, carpeta, nombre from archivos").all()) {
        archivosLocales.set(row.id, row);
      }
    } catch {}
    db.close();
  }

  let ok = 0;
  let fail = 0;
  let registrados = 0;
  let sinPersona = 0;
  const errores = [];

  for (const file of files) {
    const rel = path.relative(DOCS_DIR, file).split(path.sep).join("/");
    const parts = rel.split("/");
    const nombre = parts.pop();
    const carpeta = parts.join("/");
    const objectPath = storagePath(file);
    const bytes = fs.readFileSync(file);
    const tipo = contentType(file);

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, bytes, { contentType: tipo, upsert: true });

    if (upErr) {
      fail++;
      errores.push({ archivo: rel, error: upErr.message });
      console.error(`ERROR upload: ${rel} -> ${upErr.message}`);
      continue;
    }

    const id = `${carpeta}/${nombre}`;
    const rut = rutFromFolder(carpeta);
    const persona = personasPorRut.get(rut);
    if (persona) {
      const { error: dbErr } = await supabase
        .from("archivos_solicitante")
        .upsert({
          id,
          persona_id: persona.id,
          nombre,
          carpeta,
          storage_bucket: BUCKET,
          storage_path: objectPath,
          mime_type: tipo,
          tamano_bytes: bytes.length
        }, { onConflict: "id" });

      if (dbErr) {
        fail++;
        errores.push({ archivo: rel, error: dbErr.message });
        console.error(`ERROR registro: ${rel} -> ${dbErr.message}`);
        continue;
      }
      registrados++;
    } else if (archivosLocales.has(id)) {
      sinPersona++;
      console.warn(`Subido sin registro Supabase por no encontrar persona: ${rel}`);
    } else {
      sinPersona++;
    }

    ok++;
    if (ok % 25 === 0) console.log(`Subidos ${ok}/${files.length}`);
  }

  const reporte = {
    fecha: new Date().toISOString(),
    total: files.length,
    subidos: ok,
    registrados,
    sinPersona,
    errores: fail,
    detalleErrores: errores
  };
  const reportPath = path.join(ROOT, "respaldos", `reporte_migracion_storage_${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(reporte, null, 2), "utf8");

  console.log(`Listo. Subidos: ${ok}. Registrados: ${registrados}. Sin persona: ${sinPersona}. Errores: ${fail}. Reporte: ${reportPath}`);
  if (fail > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
