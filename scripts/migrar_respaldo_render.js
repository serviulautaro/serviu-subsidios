const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const datosPath = path.join(process.env.USERPROFILE || "", "Desktop", "datos-render-serviu.txt");
const backupDir = path.join("C:", "Users", "JORGE", "Desktop", "serviu-subsidios", "respaldos", "20260525_183214", "exports");

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(backupDir, name), "utf8"));

const readRenderUrl = () => {
  const txt = fs.readFileSync(datosPath, "utf8");
  const pgLine = txt.split(/\r?\n/).find((line) => line.startsWith("PGPASSWORD=")) || "";
  const password = (pgLine.match(/^PGPASSWORD=(\S+)/) || [])[1];
  if (password) {
    return `postgresql://serviu:${encodeURIComponent(password)}@dpg-d8b18rel51nc7398d50g-a.oregon-postgres.render.com:5432/serviu`;
  }
  const line = txt.split(/\r?\n/).find((l) => l.startsWith("RENDER_EXTERNAL_DATABASE_URL="));
  if (!line) throw new Error("No se encontro RENDER_EXTERNAL_DATABASE_URL ni PGPASSWORD en datos-render-serviu.txt");
  return line.slice(line.indexOf("=") + 1).trim();
};

const quoteIdent = (name) => '"' + String(name).replace(/"/g, '""') + '"';

const TABLES = {
  comites: {
    file: "comites.json",
    columns: {
      id: "text PRIMARY KEY",
      nombre: "text",
      descripcion: "text",
      programa_id: "text",
      fecha_creacion: "text",
    },
  },
  personas: {
    file: "personas.json",
    columns: {
      id: "text PRIMARY KEY",
      nombre: "text",
      rut: "text",
      fecha_nacimiento: "text",
      telefono: "text",
      email: "text",
      direccion: "text",
      comuna: "text",
      puntaje_rsh: "text",
      integrantes_familiares: "text",
      comite_id: "text",
      comite: "text",
      codigo_comite: "text",
      tipo_comite: "text",
      profesional_comite: "text",
      fecha_ingreso: "text",
      estado_desmarque: "text",
      sector: "text",
      observaciones: "text",
      rol_propiedad: "text",
      coordenadas: "text",
      dominio_terreno: "text",
      anio_subsidio: "text",
      numero_recepcion: "text",
      fecha_recepcion: "text",
      dominiopropiedad: "text DEFAULT ''",
      nfjs: "text DEFAULT ''",
      sistemaagua: "text DEFAULT ''",
      nservicioagua: "text DEFAULT ''",
      proveedorelectrico: "text DEFAULT ''",
      nclienteelectricidad: "text DEFAULT ''",
      certruralidad: "text DEFAULT ''",
      avaluofiscal: "text DEFAULT ''",
      informacionesprevias: "text DEFAULT ''",
      infprevias: "text DEFAULT ''",
      antecedentesvivienda: "text DEFAULT ''",
      discapacidad: "text DEFAULT ''",
      movilidadreducida: "text DEFAULT ''",
      credencialdiscapacidad: "text DEFAULT ''",
      cuentaahorro: "text DEFAULT ''",
      rutcolores: "text DEFAULT ''",
      banco: "text DEFAULT ''",
      subsidio_anterior: "text DEFAULT ''",
      estadocivil: "text DEFAULT ''",
      ahorropostular: "text DEFAULT ''",
      adultomayor: "text DEFAULT ''",
      cargo_comite: "text DEFAULT ''",
      numero_lista: "text DEFAULT ''",
      rol: "text DEFAULT ''",
      permisoedificacion: "text DEFAULT ''",
      recepciondefinitiva: "text DEFAULT ''",
      constructoraseleccionada: "text DEFAULT ''",
      metrosoriginal: "text DEFAULT ''",
      metrosampl: "text DEFAULT ''",
      metrosnoregul: "text DEFAULT ''",
      totalmetros: "text DEFAULT ''",
      modalidadpostulacion: "text DEFAULT ''",
    },
  },
  solicitudes: {
    file: "solicitudes.json",
    columns: {
      id: "text PRIMARY KEY",
      persona_id: "text",
      persona_nombre: "text",
      programa_id: "text",
      fecha: "text",
      comite: "text",
      codigo_comite: "text",
      tipo_comite: "text",
      profesional_comite: "text",
      fecha_visita: "text DEFAULT ''",
      documentos: "jsonb DEFAULT '[]'::jsonb",
    },
  },
  programas_custom: {
    file: "programas_custom.json",
    columns: {
      id: "text PRIMARY KEY",
      nombre: "text",
      descripcion: "text",
      color: "text",
      colorlight: "text",
      icon: "text",
      documentos: "jsonb DEFAULT '[]'::jsonb",
    },
  },
  archivos_solicitante: {
    file: "archivos_solicitante.json",
    columns: {
      id: "text PRIMARY KEY",
      persona_id: "text",
      nombre: "text",
      carpeta: "text",
      creado: "text",
      storage_bucket: "text DEFAULT 'documentos-solicitantes'",
      storage_path: "text DEFAULT ''",
      mime_type: "text DEFAULT ''",
      tamano_bytes: "bigint DEFAULT 0",
    },
  },
};

const ensureAudit = async (client) => {
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre text NOT NULL,
      username text UNIQUE NOT NULL,
      password_salt text NOT NULL,
      password_hash text NOT NULL,
      rol text NOT NULL DEFAULT 'usuario',
      activo boolean NOT NULL DEFAULT true,
      debe_cambiar_clave boolean NOT NULL DEFAULT true,
      creado timestamptz NOT NULL DEFAULT now(),
      actualizado timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES app_users(id),
      usuario text,
      accion text NOT NULL,
      entidad text,
      entidad_id text,
      detalle jsonb DEFAULT '{}'::jsonb,
      creado timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    INSERT INTO app_users(nombre, username, password_salt, password_hash, rol, activo, debe_cambiar_clave)
    VALUES
      ('Marcelo Cifuentes Vasquez', 'marcelo.cifuentes', 'febf9044e1b22a7a9e93d33bbdff9213', '4c3b9ed937cebebb3cb1326eb88642a871080bec5ac32270036ce698e39c3b9a', 'usuario', true, true),
      ('Jacqueline Ortega', 'jacqueline.ortega', '12e5262ce35efec1c8833b6c2adfbaf3', 'ac7e6fb5554aeccc8e2c26332864ad74269d47609d123837026895bca5625efc', 'usuario', true, true),
      ('Priscilla Curin Castro', 'priscilla.curin', '8141d3cd3471b079a9356db45cda196a', 'fb9c8e2d6e6127ef9d428d2ffb2a67998f1498c88513ad3c32cd6f9782ed9763', 'usuario', true, true),
      ('Jonathan Rodriguez', 'jonathan.rodriguez', 'a5e80f9eb67aae411e591f6ca4e5abf5', '560064cea80a12810187d6c37cf05ba723026b1cdfea448480896561fe931e8e', 'usuario', true, true),
      ('Onoria Retamal', 'onoria.retamal', 'c3595cb9d59c1367d445172829083089', '2b01d259512fc3e25b36959f45dcfa4a5d042b71856172d44ad15cf6ce1414a7', 'usuario', true, true),
      ('Jorge Campos Campos', 'jorge.campos', 'f623de85221a4e472c06f2078404615f', 'b0847c0d4574aebd479d1f601c8d5699a3447c19c89ab4517ddf4be945581118', 'admin', true, true)
    ON CONFLICT (username) DO NOTHING
  `);
};

const ensureTable = async (client, table, columns) => {
  const defs = Object.entries(columns).map(([name, type]) => `${quoteIdent(name)} ${type}`).join(", ");
  await client.query(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${defs})`);
  for (const [name, type] of Object.entries(columns)) {
    await client.query(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(name)} ${type.replace(/ PRIMARY KEY/i, "")}`);
  }
};

const valueFor = (value, type) => {
  if (value === undefined || value === null) return null;
  if (type.startsWith("jsonb")) return JSON.stringify(value);
  if (type.startsWith("bigint")) return Number(value || 0);
  return String(value);
};

const upsertRows = async (client, table, spec) => {
  const rows = readJson(spec.file);
  const cols = Object.keys(spec.columns);
  const colSql = cols.map(quoteIdent).join(", ");
  const updates = cols.filter((c) => c !== "id").map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(", ");
  const batchSize = 50;
  await client.query("BEGIN");
  try {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = [];
      const rowSql = batch.map((row, rowIdx) => {
        const placeholders = cols.map((col, colIdx) => {
          values.push(valueFor(row[col], spec.columns[col]));
          return `$${rowIdx * cols.length + colIdx + 1}`;
        }).join(", ");
        return `(${placeholders})`;
      }).join(", ");
      const sql = `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES ${rowSql} ON CONFLICT (id) DO UPDATE SET ${updates}`;
      await client.query(sql, values);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return rows.length;
};

const main = async () => {
  if (!fs.existsSync(datosPath)) throw new Error(`No existe ${datosPath}`);
  if (!fs.existsSync(backupDir)) throw new Error(`No existe ${backupDir}`);

  const client = new Client({
    connectionString: readRenderUrl(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await ensureAudit(client);
    const resumen = {};
    for (const [table, spec] of Object.entries(TABLES)) {
      await ensureTable(client, table, spec.columns);
      resumen[table] = await upsertRows(client, table, spec);
    }
    for (const table of Object.keys(TABLES)) {
      const count = await client.query(`SELECT count(*)::int AS n FROM ${quoteIdent(table)}`);
      resumen[`${table}_en_render`] = count.rows[0].n;
    }
    const outDir = path.join(root, "respaldos_migracion");
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `render_migracion_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(out, JSON.stringify({ ok: true, fuente: backupDir, resumen }, null, 2));
    console.log(JSON.stringify({ ok: true, resumen, reporte: out }, null, 2));
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error("ERROR_MIGRACION:", err.message);
  process.exit(1);
});
