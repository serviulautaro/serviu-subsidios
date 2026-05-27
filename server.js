const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
// (documentos generados en HTML — sin dependencia docx)

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
// Servir archivos estáticos bajo /files/ (separado de la API /archivos/)
app.use('/files', express.static(path.join(__dirname, 'documentos')));

// Crear carpeta documentos si no existe
const docsDir = path.join(__dirname, 'documentos');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir);

// Inicializar base de datos
const db = new Database(path.join(__dirname, 'serviu.db'));

const SUPABASE_URL = 'https://qirjfgjesjzikouehmib.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SSAA2undzTyVsgCjMgbXBw_Bu9D_lvt';
const supabaseServer = createClient(SUPABASE_URL, SUPABASE_KEY);
const pgPool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    })
  : null;
let cacheBootstrap = null;
let cacheSolicitudes = null;
const SOLICITUDES_SELECT_BASE = 'id,persona_id,persona_nombre,programa_id,fecha,comite,codigo_comite,tipo_comite,profesional_comite,fecha_visita';
const SOLICITUDES_SELECT_LISTADO = `${SOLICITUDES_SELECT_BASE},documentos`;
const TABLAS_PERMITIDAS = new Set(['comites', 'personas', 'solicitudes', 'programas_custom', 'archivos_solicitante', 'visitas', 'audit_log', 'app_users']);
const ADMIN_KEY = process.env.ADMIN_KEY || Buffer.from('MTk2NTYw', 'base64').toString('utf8');

const timeout = (promise, ms, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
]);

const quoteIdent = (name) => '"' + String(name).replace(/"/g, '""') + '"';
const requirePg = () => {
  if (!pgPool) {
    const err = new Error('DATABASE_URL no configurada en el servidor.');
    err.status = 503;
    throw err;
  }
  return pgPool;
};
const validarTabla = (table) => {
  if (!TABLAS_PERMITIDAS.has(table)) {
    const err = new Error('Tabla no permitida.');
    err.status = 400;
    throw err;
  }
};
const validarAdmin = (key) => {
  if (String(key || '') !== ADMIN_KEY) {
    const err = new Error('Clave de administrador incorrecta.');
    err.status = 403;
    throw err;
  }
};
const columnasSelect = (select = '*') => {
  const limpio = String(select || '*').trim();
  if (!limpio || limpio === '*') return '*';
  return limpio.split(',').map(c => quoteIdent(c.trim())).join(', ');
};
const filtrosDesdeQuery = (query = {}) => {
  const filtros = [];
  Object.entries(query).forEach(([key, value]) => {
    const match = key.match(/^eq\[(.+)\]$/);
    if (match) filtros.push({ col: match[1], value });
  });
  return filtros;
};
const whereSql = (filtros = [], values = []) => {
  if (!filtros.length) return '';
  const partes = filtros.map(f => {
    values.push(f.value);
    return `${quoteIdent(f.col)} = $${values.length}`;
  });
  return ' WHERE ' + partes.join(' AND ');
};
const aplicarOrdenRango = (query = {}, values = []) => {
  let sql = '';
  if (query.order) {
    sql += ` ORDER BY ${quoteIdent(query.order)} ${query.ascending === 'false' ? 'DESC' : 'ASC'}`;
  }
  if (query.limit) {
    values.push(Number(query.limit));
    sql += ` LIMIT $${values.length}`;
  }
  if (query.from && query.to) {
    const from = Number(query.from);
    const to = Number(query.to);
    values.push(Math.max(0, to - from + 1));
    sql += ` LIMIT $${values.length}`;
    values.push(from);
    sql += ` OFFSET $${values.length}`;
  }
  return sql;
};

const aligerarDocumentoListado = (doc = {}) => {
  if (!doc || typeof doc !== 'object') return doc;
  const {
    archivoData,
    data,
    base64,
    contenido,
    buffer,
    ...resto
  } = doc;
  return resto;
};

const aligerarSolicitudListado = (sol = {}) => ({
  ...sol,
  documentos: Array.isArray(sol.documentos)
    ? sol.documentos.map(aligerarDocumentoListado)
    : []
});

async function pgSelect(table, query = {}) {
  validarTabla(table);
  const values = [];
  let sql = `SELECT ${columnasSelect(query.select)} FROM ${quoteIdent(table)}`;
  sql += whereSql(filtrosDesdeQuery(query), values);
  sql += aplicarOrdenRango(query, values);
  const { rows } = await requirePg().query(sql, values);
  return rows;
}

async function pgInsert(table, rows = [], { upsert = false } = {}) {
  validarTabla(table);
  const lista = Array.isArray(rows) ? rows : [rows];
  if (!lista.length) return [];
  const keys = [...new Set(lista.flatMap(row => Object.keys(row || {})))];
  if (!keys.length) return [];
  const values = [];
  const valueSql = lista.map((row, rowIdx) => {
    const placeholders = keys.map((key, colIdx) => {
      const value = row[key];
      values.push(value && typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
      return `$${rowIdx * keys.length + colIdx + 1}`;
    });
    return `(${placeholders.join(', ')})`;
  }).join(', ');
  const updateSql = upsert && keys.includes('id')
    ? ` ON CONFLICT (id) DO UPDATE SET ${keys.filter(k => k !== 'id').map(k => `${quoteIdent(k)} = EXCLUDED.${quoteIdent(k)}`).join(', ')}`
    : '';
  const sql = `INSERT INTO ${quoteIdent(table)} (${keys.map(quoteIdent).join(', ')}) VALUES ${valueSql}${updateSql} RETURNING *`;
  const { rows: inserted } = await requirePg().query(sql, values);
  return inserted;
}

async function pgUpdate(table, filtros = [], valuesObj = {}) {
  validarTabla(table);
  if (!filtros.length) throw new Error('Update sin filtros bloqueado.');
  const keys = Object.keys(valuesObj || {});
  if (!keys.length) return [];
  const values = [];
  const setSql = keys.map(key => {
    const value = valuesObj[key];
    values.push(value && typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
    return `${quoteIdent(key)} = $${values.length}`;
  }).join(', ');
  let sql = `UPDATE ${quoteIdent(table)} SET ${setSql}`;
  sql += whereSql(filtros, values);
  sql += ' RETURNING *';
  const { rows } = await requirePg().query(sql, values);
  return rows;
}

async function pgDelete(table, filtros = []) {
  validarTabla(table);
  if (!filtros.length) throw new Error('Delete sin filtros bloqueado.');
  const values = [];
  let sql = `DELETE FROM ${quoteIdent(table)}`;
  sql += whereSql(filtros, values);
  sql += ' RETURNING *';
  const { rows } = await requirePg().query(sql, values);
  return rows;
}

async function cargarSolicitudesServidor() {
  if (pgPool) {
    const rows = await pgSelect('solicitudes', { select: SOLICITUDES_SELECT_LISTADO });
    return rows.map(aligerarSolicitudListado);
  }
  const pageSize = 100;
  const todas = [];
  for (let inicio = 0; ; inicio += pageSize) {
    const { data, error } = await timeout(
      supabaseServer.from('solicitudes').select(SOLICITUDES_SELECT_LISTADO).range(inicio, inicio + pageSize - 1),
      10000,
      'Tiempo agotado cargando solicitudes'
    );
    if (error) throw error;
    todas.push(...(data || []).map(aligerarSolicitudListado));
    if (!data || data.length < pageSize) break;
  }
  return todas;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS datos (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    actualizado TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS actividades (
    id TEXT PRIMARY KEY,
    personaId TEXT NOT NULL,
    fecha TEXT,
    detalle TEXT,
    solicitud TEXT,
    creado TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS archivos (
    id TEXT PRIMARY KEY,
    carpeta TEXT NOT NULL,
    nombre TEXT NOT NULL,
    creado TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_archivos_carpeta ON archivos(carpeta);
`);

app.get('/api/bootstrap', async (req, res) => {
  try {
    if (pgPool) {
      const [comites, personas, programasCustom] = await Promise.all([
        pgSelect('comites'),
        pgSelect('personas'),
        pgSelect('programas_custom')
      ]);
      cacheBootstrap = { comites, personas, programasCustom, actualizado: new Date().toISOString(), fuente: 'render_postgres' };
      return res.json({ ok: true, ...cacheBootstrap });
    }
    const [comitesRes, personasRes, programasRes] = await timeout(Promise.all([
      supabaseServer.from('comites').select('*'),
      supabaseServer.from('personas').select('*'),
      supabaseServer.from('programas_custom').select('*')
    ]), 10000, 'Tiempo agotado cargando datos base');
    const errores = [comitesRes, personasRes, programasRes].map(r => r.error && r.error.message).filter(Boolean);
    if (errores.length) throw new Error(errores.join(' | '));
    cacheBootstrap = {
      comites: comitesRes.data || [],
      personas: personasRes.data || [],
      programasCustom: programasRes.data || [],
      actualizado: new Date().toISOString()
    };
    res.json({ ok: true, ...cacheBootstrap });
  } catch (e) {
    if (cacheBootstrap) return res.json({ ok: true, cache: true, ...cacheBootstrap });
    res.status(504).json({ ok: false, error: e.message });
  }
});

app.get('/api/solicitudes', async (req, res) => {
  try {
    const solicitudes = await cargarSolicitudesServidor();
    cacheSolicitudes = { solicitudes, actualizado: new Date().toISOString() };
    res.json({ ok: true, ...cacheSolicitudes });
  } catch (e) {
    if (cacheSolicitudes) return res.json({ ok: true, cache: true, ...cacheSolicitudes });
    res.status(504).json({ ok: false, error: e.message });
  }
});

app.get('/api/db/:table', async (req, res) => {
  try {
    const data = await pgSelect(req.params.table, req.query);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post('/api/db/:table/insert', async (req, res) => {
  try {
    const data = await pgInsert(req.params.table, req.body?.rows || req.body || []);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post('/api/db/:table/upsert', async (req, res) => {
  try {
    const data = await pgInsert(req.params.table, req.body?.rows || req.body || [], { upsert: true });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/db/:table/update', async (req, res) => {
  try {
    const data = await pgUpdate(req.params.table, req.body?.filters || [], req.body?.values || {});
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/db/:table/delete', async (req, res) => {
  try {
    const data = await pgDelete(req.params.table, req.body?.filters || []);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post('/api/rpc/:fn', async (req, res) => {
  try {
    const fn = req.params.fn;
    const body = req.body || {};
    if (fn === 'login_app_user') {
      const { rows } = await requirePg().query(
        `SELECT id, nombre, username, rol, debe_cambiar_clave
         FROM app_users
         WHERE lower(username) = lower(trim($1))
           AND activo = true
           AND password_hash = encode(digest(password_salt || $2, 'sha256'), 'hex')`,
        [body.p_username, body.p_password]
      );
      return res.json({ ok: true, data: rows });
    }
    if (fn === 'cambiar_clave_app_user') {
      if (String(body.p_nueva || '').length < 8) return res.json({ ok: true, data: false });
      const actual = await requirePg().query(
        `SELECT id FROM app_users
         WHERE id = $1 AND activo = true
           AND password_hash = encode(digest(password_salt || $2, 'sha256'), 'hex')`,
        [body.p_user_id, body.p_actual]
      );
      if (!actual.rows.length) return res.json({ ok: true, data: false });
      const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
      await requirePg().query(
        `UPDATE app_users
         SET password_salt = $1,
             password_hash = encode(digest($1 || $2, 'sha256'), 'hex'),
             debe_cambiar_clave = false,
             actualizado = now()
         WHERE id = $3`,
        [salt, body.p_nueva, body.p_user_id]
      );
      return res.json({ ok: true, data: true });
    }
    if (fn === 'registrar_auditoria') {
      await requirePg().query(
        `INSERT INTO audit_log(user_id, usuario, accion, entidad, entidad_id, detalle)
         SELECT u.id, u.nombre, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb)
         FROM app_users u
         WHERE u.id = $1 AND u.activo = true`,
        [body.p_user_id, body.p_accion, body.p_entidad, body.p_entidad_id, JSON.stringify(body.p_detalle || {})]
      );
      return res.json({ ok: true, data: null });
    }
    if (fn === 'admin_listar_app_users') {
      validarAdmin(body.p_admin_key);
      const { rows } = await requirePg().query(
        `SELECT id, nombre, username, rol, activo, debe_cambiar_clave, creado, actualizado
         FROM app_users ORDER BY nombre`
      );
      return res.json({ ok: true, data: rows });
    }
    if (fn === 'admin_crear_app_user') {
      validarAdmin(body.p_admin_key);
      const nombre = String(body.p_nombre || '').trim();
      const username = String(body.p_username || '').trim().toLowerCase();
      const password = String(body.p_password || '');
      const rol = String(body.p_rol || 'usuario') === 'admin' ? 'admin' : 'usuario';
      if (!nombre || !username || !password) {
        return res.status(400).json({ ok: false, error: 'Faltan datos para crear el usuario.' });
      }
      const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const { rows } = await requirePg().query(
        `INSERT INTO app_users(nombre, username, rol, activo, debe_cambiar_clave, password_salt, password_hash, creado, actualizado)
         VALUES ($1, $2, $3, true, true, $4, encode(digest($4 || $5, 'sha256'), 'hex'), now(), now())
         ON CONFLICT (username) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           rol = EXCLUDED.rol,
           activo = true,
           debe_cambiar_clave = true,
           password_salt = EXCLUDED.password_salt,
           password_hash = EXCLUDED.password_hash,
           actualizado = now()
         RETURNING id, nombre, username, rol, activo, debe_cambiar_clave, creado, actualizado`,
        [nombre, username, rol, salt, password]
      );
      return res.json({ ok: true, data: rows });
    }
    if (fn === 'admin_estado_app_user') {
      validarAdmin(body.p_admin_key);
      const { rows } = await requirePg().query(
        `UPDATE app_users SET activo = $1, actualizado = now()
         WHERE id = $2
         RETURNING id, nombre, username, rol, activo, debe_cambiar_clave, creado, actualizado`,
        [Boolean(body.p_activo), body.p_user_id]
      );
      return res.json({ ok: true, data: rows });
    }
    if (fn === 'admin_eliminar_app_user') {
      validarAdmin(body.p_admin_key);
      const { rows } = await requirePg().query(
        `DELETE FROM app_users
         WHERE id = $1
         RETURNING id, nombre, username, rol, activo, debe_cambiar_clave, creado, actualizado`,
        [body.p_user_id]
      );
      return res.json({ ok: true, data: rows });
    }
    return res.status(404).json({ ok: false, error: 'RPC no implementada en backend.' });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// API DATOS
app.get('/datos/:clave', (req, res) => {
  try {
    const row = db.prepare('SELECT valor FROM datos WHERE clave = ?').get(req.params.clave);
    res.json(row ? JSON.parse(row.valor) : null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/datos/:clave', (req, res) => {
  try {
    db.prepare('INSERT OR REPLACE INTO datos (clave, valor, actualizado) VALUES (?, ?, CURRENT_TIMESTAMP)').run(req.params.clave, JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API ACTIVIDADES
app.get('/actividades/:personaId', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM actividades WHERE personaId = ? ORDER BY creado DESC').all(req.params.personaId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/actividades/:personaId', (req, res) => {
  try {
    const actividades = req.body;
    db.prepare('DELETE FROM actividades WHERE personaId = ?').run(req.params.personaId);
    const insert = db.prepare('INSERT INTO actividades (id, personaId, fecha, detalle, solicitud) VALUES (?, ?, ?, ?, ?)');
    for (const a of actividades) {
      insert.run(a.id, req.params.personaId, a.fecha, a.detalle, a.solicitud);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API ARCHIVOS — soporta rutas anidadas (programa/comite/rut)
// Helper para obtener el parámetro wildcard en Express 5 (params.path) o Express 4 (params[0])
function getWildcard(req) {
  return decodeURIComponent(req.params.path || req.params[0] || '');
}

function safeDocsPath(...parts) {
  const target = path.resolve(docsDir, ...parts);
  const root = path.resolve(docsDir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    const err = new Error('Ruta fuera de documentos bloqueada.');
    err.status = 400;
    throw err;
  }
  return target;
}

function archivarArchivoLocal(filePath, carpetaRel, archivo) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const carpetaPapelera = safeDocsPath('_papelera_serviu', stamp, carpetaRel);
  fs.mkdirSync(carpetaPapelera, { recursive: true });
  const destino = path.join(carpetaPapelera, path.basename(archivo));
  fs.renameSync(filePath, destino);
  return destino;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const carpetaRel = getWildcard(req);
    const carpeta = safeDocsPath(carpetaRel);
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
    cb(null, carpeta);
  },
  filename: (req, file, cb) => {
    const nombre = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, nombre);
  }
});
const upload = multer({ storage });

app.post('/carpeta/{*path}', (req, res) => {
  const carpetaRel = getWildcard(req);
  const carpeta = safeDocsPath(carpetaRel);
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  res.json({ ok: true });
});

app.post('/subir/{*path}', upload.single('archivo'), (req, res) => {
  const carpetaRel = getWildcard(req);
  const nombre = req.file.filename;
  try {
    db.prepare('INSERT OR REPLACE INTO archivos (id, carpeta, nombre) VALUES (?, ?, ?)').run(`${carpetaRel}/${nombre}`, carpetaRel, nombre);
  } catch(e) { console.error('DB archivos:', e.message); }
  res.json({ ok: true, nombre });
});

app.get('/archivos/{*path}', (req, res) => {
  const carpetaRel = getWildcard(req);
  // Leer de la base de datos (fuente principal)
  let dbFiles = [];
  try {
    dbFiles = db.prepare('SELECT nombre FROM archivos WHERE carpeta = ? ORDER BY creado DESC').all(carpetaRel).map(r => r.nombre);
  } catch {}
  // Leer del filesystem (compatibilidad con archivos previos no registrados)
  let fsFiles = [];
  const carpetaPath = safeDocsPath(carpetaRel);
  if (fs.existsSync(carpetaPath)) {
    try {
      fsFiles = fs.readdirSync(carpetaPath).filter(item => {
        try { return fs.statSync(path.join(carpetaPath, item)).isFile(); } catch { return false; }
      });
      // Registrar en DB los archivos del filesystem que no estén ya registrados
      for (const nombre of fsFiles) {
        const id = `${carpetaRel}/${nombre}`;
        try { db.prepare('INSERT OR IGNORE INTO archivos (id, carpeta, nombre) VALUES (?, ?, ?)').run(id, carpetaRel, nombre); } catch {}
      }
    } catch {}
  }
  // Unión deduplicada: DB primero, luego filesystem
  const todos = [...new Set([...dbFiles, ...fsFiles])];
  res.json(todos);
});

app.delete('/archivos/{*path}', (req, res) => {
  try {
    const fullRel = getWildcard(req);
    const lastSlash = fullRel.lastIndexOf('/');
    if (lastSlash === -1) return res.status(400).json({ error: 'Ruta inválida' });
    const carpetaRel = fullRel.substring(0, lastSlash);
    const archivo = fullRel.substring(lastSlash + 1);
    const filePath = safeDocsPath(carpetaRel, archivo);
    archivarArchivoLocal(filePath, carpetaRel, archivo);
    try { db.prepare('DELETE FROM archivos WHERE carpeta = ? AND nombre = ?').run(carpetaRel, archivo); } catch {}
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use('/files', (req, res) => {
  res.status(404).json({ error: 'Archivo no encontrado en la carpeta de documentos.' });
});

// ─── RENOMBRAR CARPETA ────────────────────────────────────────────────────────
app.post('/renombrar-carpeta', (req, res) => {
  try {
    const { origen, destino } = req.body;
    const carpetaOrigen = safeDocsPath(origen);
    const carpetaDestino = safeDocsPath(destino);
    if (fs.existsSync(carpetaOrigen) && origen !== destino) {
      if (!fs.existsSync(carpetaDestino)) fs.mkdirSync(carpetaDestino, { recursive: true });
      // Mover todos los archivos
      const archivos = fs.readdirSync(carpetaOrigen);
      for (const arch of archivos) {
        fs.renameSync(path.join(carpetaOrigen, arch), path.join(carpetaDestino, arch));
      }
      fs.rmdirSync(carpetaOrigen);
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GENERADOR DE DOCUMENTOS HTML ────────────────────────────────────────────

function fechaEspanol(fecha) {
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = fecha ? new Date(fecha) : new Date();
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatRut(rut) {
  if (!rut) return '';
  const limpio = rut.replace(/[^0-9kK]/g, '');
  if (limpio.length < 2) return rut;
  const dv = limpio.slice(-1).toUpperCase();
  const num = limpio.slice(0, -1);
  return num.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}

function estilosBase() {
  return `
    *{box-sizing:border-box;margin:0;padding:0}
    @media print{
      @page{size:A4;margin:2cm 2cm 3cm 2cm}
      body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .btn-imprimir{display:none!important}
      .pie-pagina{position:fixed;bottom:0.4cm;left:0;right:0;border-top:1px solid #ccc}
    }
    body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;background:#e8e8e8}
    .pagina{max-width:21cm;margin:0 auto;background:#fff;padding:2cm;min-height:29.7cm;position:relative}
    .encabezado{text-align:center;margin-bottom:18px}
    .municipalidad{font-size:19pt;font-weight:bold;color:#1e3a5f;letter-spacing:.5px}
    .departamento{font-size:10.5pt;font-weight:bold;color:#1e3a5f;margin-top:3px}
    .separador{border:none;border-top:2.5px solid #1e3a5f;margin:10px 0 18px}
    .bold{font-weight:bold}
    p{margin:3px 0}
    .espacio{margin-top:10px}
    .espacio-grande{margin-top:28px}
    .firma-section{margin-top:60px;text-align:center}
    .ind{padding-left:72px}
    .pie-pagina{margin-top:32px;padding-top:7px;border-top:1px solid #ccc;text-align:center;font-size:9pt;color:#666;font-style:italic}
    .btn-imprimir{display:block;margin:0 auto 18px;padding:9px 26px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;font-size:11.5pt;cursor:pointer;font-family:Arial}
    .btn-imprimir:hover{background:#2a4f7f}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #999;padding:7px 10px;vertical-align:top}
    th{background:#1e3a5f;color:#fff;font-weight:bold}
    .td-label{background:#D0E4F7;font-weight:bold}
    .ref-fila{display:flex;justify-content:space-between;margin-bottom:14px}
  `;
}

function htmlDoc(title, body) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${estilosBase()}</style>
</head>
<body>
<div class="pagina">
<button class="btn-imprimir" onclick="window.print()">&#128424; Imprimir / Guardar PDF</button>
${body}
<div class="pie-pagina">Propietario del software: JACC</div>
</div>
</body>
</html>`;
}

function encabezadoHTML() {
  return `<div class="encabezado">
  <div class="municipalidad">MUNICIPALIDAD DE LAUTARO</div>
  <div class="departamento">DEPARTAMENTO DE VIVIENDA E INFRAESTRUCTURA</div>
  <hr class="separador">
</div>`;
}

function guardarHtml(carpeta, nombreArchivo, html) {
  if (!carpeta) return;
  const carpetaPath = safeDocsPath(carpeta);
  if (!fs.existsSync(carpetaPath)) fs.mkdirSync(carpetaPath, { recursive: true });
  fs.writeFileSync(safeDocsPath(carpeta, nombreArchivo), html, 'utf8');
}

// Guardar HTML generado en el frontend dentro de la carpeta del solicitante
app.post('/guardar-html/{*path}', (req, res) => {
  try {
    const carpetaRel = getWildcard(req);
    const { nombre, html } = req.body;
    if (!nombre || !html) return res.status(400).json({ error: 'Faltan campos' });
    const carpetaPath = safeDocsPath(carpetaRel);
    if (!fs.existsSync(carpetaPath)) fs.mkdirSync(carpetaPath, { recursive: true });
    fs.writeFileSync(safeDocsPath(carpetaRel, nombre), html, 'utf8');
    try { db.prepare('INSERT OR REPLACE INTO archivos (id, carpeta, nombre) VALUES (?, ?, ?)').run(`${carpetaRel}/${nombre}`, carpetaRel, nombre); } catch {}
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ENDPOINTS HTML ───────────────────────────────────────────────────────────

// GENERAR MEMO
app.post('/generar/memo', (req, res) => {
  try {
    const { numero, nombre, rut, direccion, coordenadas, problemas, carpeta } = req.body;
    const fecha = fechaEspanol(new Date());
    const listaProblemas = Array.isArray(problemas) && problemas.length > 0 ? problemas : [''];

    const problemasHtml = listaProblemas.map((p, i) =>
      `<p class="ind">${i + 1}.- ${p || ''}</p><div class="espacio"></div>`
    ).join('');

    const body = `
${encabezadoHTML()}
<div class="ref-fila">
  <div>
    <p><span class="bold">MEMO N°:</span> ${numero}</p>
    <p><span class="bold">MAT:</span> Solicitud evaluación de vivienda</p>
  </div>
  <div style="text-align:right">
    <p><span class="bold">LAUTARO,</span> ${fecha}</p>
  </div>
</div>
<p><span class="bold">DE &nbsp;&nbsp;&nbsp;:</span> &nbsp;<span class="bold">MARCELO CIFUENTES VÁSQUEZ</span></p>
<p class="ind">ENCARGADO ENTIDAD PATROCINANTE</p>
<p class="ind">MUNICIPALIDAD DE LAUTARO.</p>
<div class="espacio"></div>
<p><span class="bold">A &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</span> &nbsp;<span class="bold">SEÑOR EDUARDO BUSTOS VALDEBENITO</span></p>
<p class="ind">DIRECTOR DE OBRAS</p>
<p class="ind">MUNICIPALIDAD DE LAUTARO</p>
<p class="ind">PRESENTE.</p>
<div class="espacio"></div>
<p class="ind">Junto con saludar cordialmente, me permito informar a Ud., el ingreso de una solicitud para evaluar vivienda de:</p>
<div class="espacio"></div>
<p><span class="bold">NOMBRE:</span> ${(nombre || '').toUpperCase()}</p>
<div class="espacio"></div>
<p><span class="bold">RUT:</span> ${rut || ''}</p>
<div class="espacio"></div>
<p><span class="bold">DIRECCIÓN:</span> ${(direccion || '').toUpperCase()}</p>
<div class="espacio"></div>
<p><span class="bold">Coordenadas:</span> ${coordenadas || ''}</p>
<div class="espacio"></div>
<p class="bold">PROBLEMAS DE LA VIVIENDA:</p>
<div class="espacio"></div>
${problemasHtml}
<p class="bold">ADJUNTO:</p>
<div class="espacio"></div>
<p>- Rut del propietario.</p>
<p>- Informe de evaluación previa. vivienda revisada por JACC.</p>
<p>- Escritura u otro que acredite la propiedad de la vivienda.</p>
<div class="firma-section">
  <p>Sin otro particular, saluda atentamente a Usted.,</p>
  <div class="espacio-grande"></div>
  <p class="bold">MARCELO CIFUENTES VÁSQUEZ</p>
  <p class="bold">ENCARGADO DE ENTIDAD PATROCINANTE</p>
  <p class="bold">MUNICIPALIDAD DE LAUTARO</p>
</div>
<div class="espacio"></div>
<p>MCV/mcv</p>
<div class="espacio"></div>
<p class="bold">DISTRIBUCIÓN:</p>
<p>- Destinatario</p>
<p>- Archivo Vivienda</p>`;

    const html = htmlDoc(`Memorándum N° ${numero}`, body);
    const nombreArchivo = `MEMO_${numero.replace(/[^a-zA-Z0-9]/g, '_')}_${(nombre || '').split(' ')[0]}.html`;
    guardarHtml(carpeta, nombreArchivo, html);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GENERAR CARTA SERVIU
app.post('/generar/carta', (req, res) => {
  try {
    const { numero, nombre, rut, carpeta } = req.body;
    const fecha = fechaEspanol(new Date());

    const body = `
${encabezadoHTML()}
<p><span class="bold">CNº &nbsp;&nbsp;&nbsp;:</span> &nbsp;<span class="bold">${numero}</span></p>
<div class="espacio"></div>
<p><span class="bold">MAT &nbsp;&nbsp;:</span> &nbsp;Lo que indica</p>
<div class="espacio"></div>
<p><span class="bold">LAUTARO,</span> ${fecha}</p>
<div class="espacio"></div>
<p><span class="bold">DE &nbsp;&nbsp;&nbsp;:</span> &nbsp;<span class="bold">MARCELO CIFUENTES VÁSQUEZ</span></p>
<p class="ind">ENCARGADO ENTIDAD PATROCINANTE</p>
<p class="ind">MUNICIPALIDAD DE LAUTARO.</p>
<div class="espacio"></div>
<p><span class="bold">A &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</span> &nbsp;<span class="bold">SEÑOR JOSÉ LUIS SEPÚLVEDA SOZA</span></p>
<p class="ind">DIRECTOR DE SERVIU</p>
<p class="ind">REGIÓN DE LA ARAUCANÍA</p>
<p class="ind">PRESENTE.</p>
<div class="espacio-grande"></div>
<p class="ind">Junto con saludar cordialmente, me permito informar a Ud., el ingreso de una solicitud para quitar la marca de subsidio de vivienda registrado en el sistema a nombre de <strong>${(nombre || '').toUpperCase()}</strong>, RUT: ${rut || ''}.</p>
<div class="firma-section">
  <p>Sin otro particular, saluda atentamente a Usted.,</p>
  <div class="espacio-grande"></div>
  <p class="bold">MARCELO CIFUENTES VÁSQUEZ</p>
  <p class="bold">ENCARGADO DE ENTIDAD PATROCINANTE</p>
  <p class="bold">MUNICIPALIDAD DE LAUTARO</p>
</div>
<div class="espacio"></div>
<p>MCV/mcv</p>
<div class="espacio"></div>
<p class="bold">DISTRIBUCIÓN:</p>
<p>- Destinatario</p>
<p>- Archivo Vivienda</p>`;

    const html = htmlDoc(`Carta SERVIU N° ${numero}`, body);
    const nombreArchivo = `CARTA_${numero.replace(/[^a-zA-Z0-9]/g, '_')}_${(nombre || '').split(' ')[0]}.html`;
    guardarHtml(carpeta, nombreArchivo, html);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GENERAR SOLICITUD 2026
app.post('/generar/solicitud', (req, res) => {
  try {
    const { nombre, rut, direccion, telefono, subsidio, anioSubsidio, carpeta } = req.body;
    const hoy = new Date();
    const fechaStr = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

    const fila = (label, value) => `
      <tr>
        <td class="td-label" style="width:38%">${label}</td>
        <td>${value || ''}</td>
      </tr>`;

    const checkFila = (label) => `
      <tr>
        <td style="width:36px;text-align:center;font-weight:bold">☐</td>
        <td>${label}</td>
      </tr>`;

    const body = `
<p class="bold" style="text-align:center;font-size:13pt;margin-bottom:14px">Formulario de Habilitación Vivienda Inhabitable/Siniestrada</p>
<p style="margin-bottom:14px">Solicito habilitación para poder postular a un nuevo subsidio habitacional, en razón a la inhabitabilidad y/o siniestro sufrido en mi vivienda.</p>
<table style="margin-bottom:16px">
  <tbody>
    ${fila('NOMBRE BENEFICIARIO', (nombre || '').toUpperCase())}
    ${fila('RUT', rut || '')}
    ${fila('COMUNA', 'LAUTARO')}
    ${fila('DIRECCIÓN', (direccion || '').toUpperCase())}
    ${fila('TELÉFONO', telefono || '')}
    ${fila('CORREO ELECTRÓNICO', 'Jcampos@munilautaro.cl')}
    ${fila('SUBSIDIO ADJUDICADO', subsidio || '')}
    ${fila('AÑO DEL SUBSIDIO', anioSubsidio || '')}
  </tbody>
</table>
<table>
  <thead>
    <tr><th colspan="2" style="text-align:left">DOCUMENTOS A ADJUNTAR</th></tr>
  </thead>
  <tbody>
    ${checkFila('Fotocopia de cédula de Identidad por ambos lados.')}
    ${checkFila('DOCUMENTO DOM')}
    ${checkFila('Registro de Propiedad otorgado por Conservador de Bienes Raíces.')}
  </tbody>
</table>
<div style="margin-top:40px;display:flex;justify-content:space-between">
  <p>FIRMA: ___________________________</p>
  <p><span class="bold">Fecha:</span> ${fechaStr}</p>
</div>`;

    const html = htmlDoc('Formulario de Habilitación', body);
    const nombreArchivo = `SOLICITUD_${(nombre || '').split(' ')[0]}_${fechaStr.replace(/\//g, '-')}.html`;
    guardarHtml(carpeta, nombreArchivo, html);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GENERAR INFORME JACC
app.post('/generar/informe-jacc', (req, res) => {
  try {
    const { nombre, rut, telefono, direccion, coordenadas, programa, anio, carpeta, filas } = req.body;
    const rutFormateado = formatRut(rut);

    const filasHtml = (filas || []).map(fila => {
      const imgHtml = fila.imagenBase64
        ? `<img src="data:${fila.mimeType || 'image/jpeg'};base64,${fila.imagenBase64}" style="width:7cm;height:auto;display:block;margin:0 auto;max-width:100%">`
        : '<span style="color:#aaa;font-size:9pt">Sin imagen</span>';
      return `<tr>
        <td style="text-align:center;font-weight:bold;width:50px">${fila.numero}</td>
        <td>${fila.descripcion || ''}</td>
        <td style="text-align:center;width:8.5cm;padding:6px">${imgHtml}</td>
      </tr>`;
    }).join('');

    const body = `
${encabezadoHTML()}
<p class="bold" style="text-align:center;font-size:13pt;margin-bottom:18px">INFORME TÉCNICO DE VISITA JACC</p>
<p class="bold" style="margin-bottom:8px">I. ANTECEDENTES DEL BENEFICIARIO</p>
<table style="margin-bottom:18px">
  <tbody>
    <tr><td class="td-label" style="width:35%">NOMBRE BENEFICIARIO</td><td>${(nombre || '').toUpperCase()}</td></tr>
    <tr><td class="td-label">RUT</td><td>${rutFormateado}</td></tr>
    <tr><td class="td-label">TELÉFONO</td><td>${telefono || ''}</td></tr>
    <tr><td class="td-label">DIRECCIÓN</td><td>${(direccion || '').toUpperCase()}</td></tr>
    ${coordenadas ? `<tr><td class="td-label">COORDENADAS</td><td>${coordenadas}</td></tr>` : ''}
    <tr><td class="td-label">AÑO Y TIPO DE SUBSIDIO</td><td>${programa || ''}${anio ? ' &mdash; ' + anio : ''}</td></tr>
  </tbody>
</table>
<p class="bold" style="margin-bottom:8px">II. REGISTRO FOTOGRÁFICO</p>
<table>
  <thead>
    <tr>
      <th style="width:50px">N° Foto</th>
      <th>Estado de la Vivienda</th>
      <th style="width:8.5cm;text-align:center">Fotografía</th>
    </tr>
  </thead>
  <tbody>
    ${filasHtml}
  </tbody>
</table>`;

    const html = htmlDoc(`Informe JACC - ${nombre || ''}`, body);
    const nombreArchivo = `INFORME_JACC_${(nombre || 'SIN_NOMBRE').split(' ')[0]}_${new Date().toISOString().slice(0, 10)}.html`;
    guardarHtml(carpeta, nombreArchivo, html);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// SERVIR REACT
const buildPath = path.join(__dirname, 'build');
if (!fs.existsSync(buildPath)) {
  try {
    console.log('Build React no encontrado. Generando build antes de iniciar...');
    execFileSync(process.execPath, [require.resolve('react-scripts/bin/react-scripts.js'), 'build'], {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, REACT_APP_DEMO_MODE: process.env.REACT_APP_DEMO_MODE || 'false' }
    });
  } catch (e) {
    console.error('No se pudo generar build React:', e.message);
  }
}
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.use(function(req, res) {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
const os = require('os');
const interfaces = os.networkInterfaces();
let ip = 'localhost';
for (const name of Object.keys(interfaces)) {
  for (const iface of interfaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      ip = iface.address;
    }
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor SERVIU corriendo en puerto ' + PORT);
  console.log('Base de datos: serviu.db');
  console.log('Acceso en red: http://' + ip + ':' + PORT);
});
