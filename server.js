const express = require('express');
require('dotenv').config();
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
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcmpmZ2plc2p6aWtvdWVobWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NjgxMTUsImV4cCI6MjA5MzI0NDExNX0.7bDpXPZyc-Ovt-EWBqCl3RsbPqiU_eSAa98F_ufbVqU';
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
if (pgPool) {
  pgPool.on('error', (err) => {
    console.error('[pg] Error de conexion en reposo:', err.message);
  });
}
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
// Migración: leer archivos físicos del repo git y guardarlos en PostgreSQL
async function migrarArchivosGitAPG() {
  if (!pgPool) return;
  try {
    const recorrer = (dir, base = '') => {
      let r = [];
      try {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = base ? base + '/' + item.name : item.name;
          if (item.isDirectory()) r = r.concat(recorrer(path.join(dir, item.name), rel));
          else if (item.isFile() && !item.name.startsWith('.')) r.push({ ruta: path.join(dir, item.name), rel });
        }
      } catch {}
      return r;
    };

    const archivos = recorrer(docsDir);
    console.log('[migrar-git] Archivos en disco:', archivos.length);
    const mimeMap = { '.pdf':'application/pdf','.html':'text/html','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png' };
    let ok = 0, skip = 0;

    for (const { ruta, rel } of archivos) {
      try {
        const lastSlash = rel.lastIndexOf('/');
        if (lastSlash === -1) continue;
        const carpeta = rel.substring(0, lastSlash);
        const nombre = rel.substring(lastSlash + 1);
        const mime = mimeMap[path.extname(nombre).toLowerCase()] || 'application/octet-stream';

        // Buscar registro existente en PG por carpeta+nombre
        const { rows: existing } = await requirePg().query(
          `SELECT id, persona_id, data_url FROM archivos_solicitante WHERE carpeta=$1 AND nombre=$2 LIMIT 1`,
          [carpeta, nombre]
        );

        // Si ya tiene data_url, saltar
        if (existing.length && existing[0].data_url) { skip++; continue; }

        const buf = fs.readFileSync(ruta);
        const dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');

        if (existing.length) {
          // Actualizar con data_url
          await requirePg().query(
            `UPDATE archivos_solicitante SET data_url=$1, mime_type=$2 WHERE id=$3`,
            [dataUrl, mime, existing[0].id]
          );
          ok++;
        } else {
          // Buscar persona_id — primero por carpeta exacta, luego por RUT
          const partes = carpeta.split('/');
          const rutCarpeta = partes[partes.length - 1];
          let personaId = null;

          // Intentar match por RUT en carpeta
          for (const parte of partes.reverse()) {
            const { rows } = await requirePg().query(
              `SELECT id FROM personas WHERE rut=$1 OR rut ILIKE $1 LIMIT 1`, [parte]
            );
            if (rows.length) { personaId = rows[0].id; break; }
          }

          if (personaId) {
            await requirePg().query(
              `INSERT INTO archivos_solicitante (id, persona_id, nombre, carpeta, data_url, mime_type)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT(id) DO UPDATE SET data_url=EXCLUDED.data_url, mime_type=EXCLUDED.mime_type`,
              [archivoRegistroId(personaId, carpeta, nombre), personaId, nombre, carpeta, dataUrl, mime]
            );
            ok++;
          }
        }
      } catch(e) { /* skip */ }
    }
    console.log('[migrar-git] ' + ok + ' guardados, ' + skip + ' ya tenían data_url');
  } catch(e) { console.warn('[migrar-git] Error:', e.message); }
}

// Migración automática: copiar archivos de Supabase Storage → PostgreSQL
async function migrarArchivosSuapabaseAPG() {
  if (!pgPool) return;
  try {
    const { rows } = await requirePg().query(
      `SELECT id, persona_id, nombre, carpeta FROM archivos_solicitante
       WHERE data_url IS NULL AND nombre IS NOT NULL LIMIT 300`
    );
    if (!rows.length) { console.log('[migrar] Sin archivos pendientes.'); return; }
    console.log('[migrar] Archivos a migrar:', rows.length);
    const jwtKey = process.env.SUPABASE_JWT_SERVICE_ROLE;
    const https = require('https');
    const listarCarpeta = (prefix) => new Promise((resolve) => {
      const opts = {
        hostname: 'qirjfgjesjzikouehmib.supabase.co',
        path: '/storage/v1/object/list/documentos-solicitantes',
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwtKey, 'Content-Type': 'application/json' }
      };
      const req = https.request(opts, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
      });
      req.on('error', () => resolve([]));
      req.write(JSON.stringify({ prefix, limit: 1000, offset: 0 }));
      req.end();
    });
    const indice = {};
    const procesarCarpeta = async (prefix) => {
      const items = await listarCarpeta(prefix);
      for (const item of items) {
        if (item.id) {
          indice[item.name] = 'https://qirjfgjesjzikouehmib.supabase.co/storage/v1/object/authenticated/documentos-solicitantes/' + (prefix ? prefix.split('/').map(s=>encodeURIComponent(s)).join('/') + '/' : '') + encodeURIComponent(item.name);
        } else {
          await procesarCarpeta(prefix ? prefix + '/' + item.name : item.name);
        }
      }
    };
    await procesarCarpeta('');
    console.log('[migrar] Archivos indexados:', Object.keys(indice).length);
    let ok = 0, fail = 0;
    for (const row of rows) {
      try {
        const url = indice[row.nombre];
        if (!url) { fail++; continue; }
        const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + jwtKey }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) { fail++; continue; }
        const ct = r.headers.get('content-type') || 'application/octet-stream';
        if (ct.includes('text/html') || ct.includes('application/json')) { fail++; continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length) { fail++; continue; }
        const dataUrl = 'data:' + ct + ';base64,' + buf.toString('base64');
        await requirePg().query(
          `UPDATE archivos_solicitante SET data_url=$1, mime_type=$2 WHERE id=$3`,
          [dataUrl, ct, row.id]
        );
        ok++;
      } catch(e) { fail++; }
    }
    console.log('[migrar] ' + ok + ' OK, ' + fail + ' fallidos de ' + rows.length);
  } catch(e) { console.warn('[migrar] Error:', e.message); }
}
let schemaRuntimePromise = null;
async function ensureRuntimeSchema() {
  if (!pgPool) return;
  if (!schemaRuntimePromise) {
    schemaRuntimePromise = requirePg().query(`
      ALTER TABLE "comites" ADD COLUMN IF NOT EXISTS "tipo" text;
      ALTER TABLE "comites" ADD COLUMN IF NOT EXISTS "linea_tiempo" jsonb DEFAULT '{}'::jsonb;
      ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "linea_tiempo_csp" jsonb DEFAULT '{}'::jsonb;
      ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "pendiente_calificar" boolean DEFAULT false;
      ALTER TABLE "archivos_solicitante" ADD COLUMN IF NOT EXISTS "data_url" text;
      ALTER TABLE "archivos_solicitante" ADD COLUMN IF NOT EXISTS "mime_type" text;
      ALTER TABLE "visitas" ADD COLUMN IF NOT EXISTS "siguiente_paso" text;
      ALTER TABLE "visitas" ADD COLUMN IF NOT EXISTS "fecha_compromiso" text;
    `).catch(err => {
      schemaRuntimePromise = null;
      throw err;
    });
  }
  await schemaRuntimePromise;
}
const columnasSelect = (select = '*') => {
  const limpio = String(select || '*').trim();
  if (!limpio || limpio === '*') return '*';
  return limpio.split(',').map(c => quoteIdent(c.trim())).join(', ');
};
const filtrosDesdeQuery = (query = {}) => {
  const filtros = [];
  Object.entries(query).forEach(([key, value]) => {
    // Formato 1: op[col]=valor (eq, neq, gte, lt)
    const match = key.match(/^(eq|neq|gte|lt)\[(.+)\]$/);
    if (match) { filtros.push({ op: match[1], col: match[2], value }); return; }
    // Formato 2: col=eq.valor (compatibilidad Supabase)
    if (typeof value === 'string' && value.startsWith('eq.')) {
      filtros.push({ op: 'eq', col: key, value: value.slice(3) });
    }
  });
  return filtros;
};
const OPERADORES_SQL = { eq: '=', neq: '<>', gte: '>=', lt: '<' };
const whereSql = (filtros = [], values = []) => {
  if (!filtros.length) return '';
  const partes = filtros.map(f => {
    const op = OPERADORES_SQL[f.op || 'eq'] || '=';
    values.push(f.value);
    return `${quoteIdent(f.col)} ${op} $${values.length}`;
  });
  return ' WHERE ' + partes.join(' AND ');
};

const COMITE_DESMARQUE = 'comite_desmarque';
const PROGRAMA_DESMARQUE = 'habitabilidad';
const NOMBRE_COMITE_DESMARQUE = 'DESMARQUE DE VIVIENDA';
const textoRegla = (v) => String(v || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .trim();
const parseJsonSeguro = (v, fallback) => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};
const docConVb = (doc = {}) => doc.vb === true || doc.vb === 'true' || doc.entregado === true;
const docNombreNorm = (doc = {}) => textoRegla(doc.nombre);
const valorDocTexto = (doc = {}) => textoRegla(doc.valor || doc.opcionSeleccionada || doc.etiqueta);
const respuestaServiuLista = (sol = {}) => {
  const docs = parseJsonSeguro(sol.documentos, []);
  const respuesta = docs.find(doc =>
    docNombreNorm(doc).includes('RESPUESTA') && docNombreNorm(doc).includes('SERVIU')
  );
  const texto = valorDocTexto(respuesta);
  return docConVb(respuesta) && (texto.includes('DESMARCADO') || texto.includes('APROBADO'));
};
async function solicitudDesmarquePersona(personaId) {
  if (!personaId) return null;
  const { rows } = await requirePg().query(
    `SELECT id, persona_id, programa_id, documentos
     FROM "solicitudes"
     WHERE persona_id=$1 AND programa_id=$2
     LIMIT 1`,
    [personaId, PROGRAMA_DESMARQUE]
  );
  return rows[0] || null;
}
async function personaTieneDesmarque(personaId) {
  return !!(await solicitudDesmarquePersona(personaId));
}
async function datosPersonaRegla(personaId) {
  if (!personaId) return null;
  const { rows } = await requirePg().query(
    `SELECT id, comite_id, estado_desmarque FROM "personas" WHERE id=$1 LIMIT 1`,
    [personaId]
  );
  return rows[0] || null;
}
async function validarDesmarqueListoParaSegundoPrograma(row = {}) {
  const personaId = row.persona_id || row.personaId;
  const programaId = row.programa_id || row.programaId;
  if (!personaId || !programaId || programaId === PROGRAMA_DESMARQUE) return;
  const solDesmarque = await solicitudDesmarquePersona(personaId);
  if (!solDesmarque) return;
  const persona = await datosPersonaRegla(personaId);
  const codigoDestino = row.codigo_comite || row.codigoComite || '';
  if (persona && persona.comite_id && persona.comite_id !== COMITE_DESMARQUE && String(persona.comite_id) !== String(codigoDestino)) {
    const err = new Error('Este desmarcado ya fue movido a otro programa y no puede moverse nuevamente.');
    err.status = 409;
    throw err;
  }
  const estadoDesmarcado = textoRegla(persona?.estado_desmarque) === 'DESMARCADO';
  if (!estadoDesmarcado && !respuestaServiuLista(solDesmarque)) {
    const err = new Error('No se puede mover desde Desmarque: falta completar el paso 9 (Respuesta SERVIU en DESMARCADO/APROBADO).');
    err.status = 409;
    throw err;
  }
}
async function normalizarSolicitudProgramaUnico(row = {}, upsert = false) {
  await validarDesmarqueListoParaSegundoPrograma(row);
  const personaId = row.persona_id || row.personaId;
  const programaId = row.programa_id || row.programaId;
  if (!personaId || !programaId || programaId === PROGRAMA_DESMARQUE) return row;
  const { rows } = await requirePg().query(
    `SELECT id FROM "solicitudes"
     WHERE persona_id=$1 AND programa_id<>$2 AND id<>COALESCE($3, '')
     ORDER BY fecha DESC NULLS LAST, id DESC
     LIMIT 1`,
    [personaId, PROGRAMA_DESMARQUE, row.id || '']
  );
  if (rows.length && upsert) return { ...row, id: rows[0].id };
  if (rows.length && !upsert) {
    const err = new Error('El solicitante ya tiene un programa normal activo. Use mover/reemplazar, no agregar otro.');
    err.status = 409;
    throw err;
  }
  return row;
}
const aplicarOrdenRango = (query = {}, values = []) => {
  let sql = '';
  const orderCol = query.orderBy || query.order;
  const orderDir = (query.orderAsc === 'false' || query.ascending === 'false') ? 'DESC' : 'ASC';
  if (orderCol) {
    sql += ` ORDER BY ${quoteIdent(orderCol)} ${orderDir}`;
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
  await ensureRuntimeSchema();
  const values = [];
  let sql = `SELECT ${columnasSelect(query.select)} FROM ${quoteIdent(table)}`;
  sql += whereSql(filtrosDesdeQuery(query), values);
  if (table === 'archivos_solicitante' && String(query.soloDisponibles || '') === 'true') {
    sql += sql.includes(' WHERE ') ? ' AND data_url IS NOT NULL' : ' WHERE data_url IS NOT NULL';
  }
  sql += aplicarOrdenRango(query, values);
  const { rows } = await requirePg().query(sql, values);
  return rows;
}

async function pgSelectSolicitudesListado() {
  const columnas = SOLICITUDES_SELECT_BASE.split(',').map(c => c.trim()).filter(Boolean);
  const sql = `
    SELECT ${columnas.map(quoteIdent).join(', ')},
      COALESCE((
        SELECT jsonb_agg(doc - 'archivoData' - 'data' - 'base64' - 'contenido' - 'buffer')
        FROM jsonb_array_elements(COALESCE("documentos", '[]'::jsonb)) AS doc
      ), '[]'::jsonb) AS documentos
    FROM "solicitudes"
  `;
  const { rows } = await requirePg().query(sql);
  return rows;
}

async function pgInsert(table, rows = [], { upsert = false } = {}) {
  validarTabla(table);
  await ensureRuntimeSchema();
  let lista = Array.isArray(rows) ? rows : [rows];
  if (!lista.length) return [];
  if (table === 'solicitudes') {
    lista = [];
    for (const row of (Array.isArray(rows) ? rows : [rows])) {
      lista.push(await normalizarSolicitudProgramaUnico(row || {}, upsert));
    }
  }
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

const toSnake = s => s.replace(/([A-Z])/g, m => '_' + m.toLowerCase());
async function pgUpdate(table, filtros = [], valuesObj = {}) {
  valuesObj = Object.fromEntries(Object.entries(valuesObj).map(([k,v]) => [toSnake(k), v]));
  validarTabla(table);
  await ensureRuntimeSchema();
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
  await ensureRuntimeSchema();
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
    return pgSelectSolicitudesListado();
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

// Ruta para guardar archivo como base64 directo en PostgreSQL (sin disco)
app.post('/api/archivo-base64', async (req, res) => {
  try {
    const { persona_id, nombre, carpeta, data_url, mime_type } = req.body || {};
    if (!persona_id || !nombre || !data_url) {
      return res.status(400).json({ error: 'Faltan campos: persona_id, nombre, data_url' });
    }
    if (!pgPool) return res.status(503).json({ error: 'Sin PostgreSQL' });
    await ensureRuntimeSchema(); // garantiza columnas data_url y mime_type
    await requirePg().query(
      `INSERT INTO archivos_solicitante (id, persona_id, nombre, carpeta, data_url, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET data_url=EXCLUDED.data_url, mime_type=EXCLUDED.mime_type, carpeta=EXCLUDED.carpeta`,
      [archivoRegistroId(persona_id, carpeta || '', nombre), persona_id, nombre, carpeta || '', data_url, mime_type || 'application/octet-stream']
    );
    // Registrar en SQLite también
    try { db.prepare('INSERT OR REPLACE INTO archivos (id, carpeta, nombre) VALUES (?, ?, ?)').run((carpeta||'') + '/' + nombre, carpeta||'', nombre); } catch {}
    await registrarAuditoriaAutomatica(req, 'api_upsert', 'archivos_solicitante', [{
      id: archivoRegistroId(persona_id, carpeta || '', nombre),
      persona_id,
      nombre,
      carpeta: carpeta || '',
    }], { campos: ['nombre', 'carpeta', 'data_url', 'mime_type'] });
    console.log('[archivo-base64] Guardado en PG:', nombre, 'persona:', persona_id);
    res.json({ ok: true, nombre });
  } catch(e) {
    console.error('[archivo-base64] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Diagnóstico del sistema de archivos
app.get('/api/diagnostico', async (req, res) => {
  const info = { pgConectado: !!pgPool, tablas: {}, disco: {} };
  if (pgPool) {
    try {
      const { rows } = await requirePg().query(
        `SELECT 
          (SELECT COUNT(*) FROM archivos_solicitante) as total_archivos,
          (SELECT COUNT(*) FROM archivos_solicitante WHERE data_url IS NOT NULL) as con_data_url,
          (SELECT COUNT(*) FROM archivos_solicitante WHERE data_url IS NULL) as sin_data_url`
      );
      info.tablas = rows[0];
    } catch(e) { info.tablas = { error: e.message }; }
  }
  try {
    const contarArchivos = (dir) => {
      let n = 0;
      try { for (const f of require('fs').readdirSync(dir, {withFileTypes:true})) {
        if (f.isFile()) n++; else if (f.isDirectory()) n += contarArchivos(require('path').join(dir,f.name));
      }} catch {}
      return n;
    };
    info.disco = { archivos_en_repo: contarArchivos(docsDir) };
  } catch {}
  res.json(info);
});

// Endpoint manual para forzar migración (GET y POST para facilitar uso desde browser)
app.get('/api/migrar-archivos', async (req, res) => {
  migrarArchivosGitAPG().catch(e => console.warn('[migrar-git manual]', e.message));
  migrarArchivosSuapabaseAPG().catch(e => console.warn('[migrar-supa manual]', e.message));
  res.json({ ok: true, mensaje: 'Migración iniciada en segundo plano — revisa los logs del servidor' });
});
app.post('/api/migrar-archivos', async (req, res) => {
  migrarArchivosGitAPG().catch(e => console.warn('[migrar-git manual]', e.message));
  migrarArchivosSuapabaseAPG().catch(e => console.warn('[migrar-supa manual]', e.message));
  res.json({ ok: true, mensaje: 'Migración iniciada en segundo plano' });
});

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

const usuarioAuditoriaDesdeReq = (req) => ({
  id: req.get('X-Serviu-User-Id') || '',
  username: req.get('X-Serviu-Username') || '',
  nombre: req.get('X-Serviu-User-Name') || '',
});
const resumenValoresAuditoria = (values = {}) => {
  const omitidos = new Set(['documentos', 'data_url', 'archivoData', 'base64', 'contenido', 'buffer']);
  return Object.keys(values || {}).filter(k => !omitidos.has(k));
};
async function registrarAuditoriaAutomatica(req, accion, tabla, data = [], detalle = {}) {
  if (!pgPool || tabla === 'audit_log') return;
  try {
    const user = usuarioAuditoriaDesdeReq(req);
    const uid = String(user.id || '');
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
    const filas = Array.isArray(data) ? data : [data].filter(Boolean);
    const payload = {
      tabla,
      cantidad: filas.length,
      ids: filas.map(r => r?.id).filter(Boolean).slice(0, 20),
      ...detalle,
    };
    const result = await requirePg().query(
      `INSERT INTO audit_log(user_id, usuario, accion, entidad, entidad_id, detalle)
       SELECT u.id, u.nombre, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb)
       FROM app_users u
       WHERE u.activo = true
         AND (
           ($1::boolean = true AND u.id = $2::uuid)
           OR lower(u.username) = lower(trim(COALESCE($7, '')))
           OR lower(u.nombre) = lower(trim(COALESCE($8, '')))
         )
       ORDER BY CASE WHEN $1::boolean = true AND u.id = $2::uuid THEN 0 ELSE 1 END
       LIMIT 1`,
      [
        esUuid,
        esUuid ? uid : null,
        accion,
        tabla,
        payload.ids?.[0] || '',
        JSON.stringify(payload),
        user.username,
        user.nombre,
      ]
    );
    if (!result.rowCount) console.warn('[auditoria auto] Usuario no encontrado para', accion, tabla);
  } catch (e) {
    console.warn('[auditoria auto]', e.message);
  }
}

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
    await registrarAuditoriaAutomatica(req, 'api_insert', req.params.table, data);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post('/api/db/:table/upsert', async (req, res) => {
  try {
    const data = await pgInsert(req.params.table, req.body?.rows || req.body || [], { upsert: true });
    await registrarAuditoriaAutomatica(req, 'api_upsert', req.params.table, data);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/db/:table/update', async (req, res) => {
  try {
    const data = await pgUpdate(req.params.table, req.body?.filters || [], req.body?.values || {});
    await registrarAuditoriaAutomatica(req, 'api_update', req.params.table, data, {
      filtros: req.body?.filters || [],
      campos: resumenValoresAuditoria(req.body?.values || {}),
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/db/:table/delete', async (req, res) => {
  try {
    const data = await pgDelete(req.params.table, req.body?.filters || []);
    await registrarAuditoriaAutomatica(req, 'api_delete', req.params.table, data, {
      filtros: req.body?.filters || [],
    });
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
      try {
        const uid = String(body.p_user_id || '');
        const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
        const detalle = body.p_detalle || {};
        await requirePg().query(
          `INSERT INTO audit_log(user_id, usuario, accion, entidad, entidad_id, detalle)
           SELECT u.id, u.nombre, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb)
           FROM app_users u
           WHERE u.activo = true
             AND (
               ($1::boolean = true AND u.id = $2::uuid)
               OR lower(u.username) = lower(trim(COALESCE($7, '')))
               OR lower(u.nombre) = lower(trim(COALESCE($8, '')))
             )
           ORDER BY CASE WHEN $1::boolean = true AND u.id = $2::uuid THEN 0 ELSE 1 END
           LIMIT 1`,
          [
            esUuid,
            esUuid ? uid : null,
            body.p_accion,
            body.p_entidad,
            body.p_entidad_id,
            JSON.stringify(detalle),
            detalle.usuario || detalle.username || '',
            detalle.nombre_usuario || detalle.nombre || '',
          ]
        );
      } catch(e) { console.warn('[auditoria]', e.message); }
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

function normalizarArchivoLocal(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const archivoRegistroId = (personaId = '', carpeta = '', nombre = '') =>
  [personaId, carpeta, nombre].map(v => String(v || '').trim()).join('__');

function buscarArchivoLocal(carpetaRel, archivo) {
  const directo = safeDocsPath(carpetaRel, archivo);
  if (fs.existsSync(directo) && fs.statSync(directo).isFile()) return directo;
  const objetivo = normalizarArchivoLocal(path.basename(archivo));
  const carpetaBase = safeDocsPath(carpetaRel);
  const candidatos = [];
  const recorrer = (dir) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) recorrer(full);
      if (item.isFile() && normalizarArchivoLocal(item.name) === objetivo) candidatos.push(full);
    }
  };
  recorrer(carpetaBase);
  return candidatos[0] || null;
}

// Usar memoria para archivos — Render no tiene disco persistente
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/carpeta/{*path}', (req, res) => {
  const carpetaRel = getWildcard(req);
  const carpeta = safeDocsPath(carpetaRel);
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  res.json({ ok: true });
});

app.post('/subir/{*path}', upload.single('archivo'), async (req, res) => {
  try {
    const carpetaRel = getWildcard(req);
    const nombre = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const dataUrl = 'data:' + mimeType + ';base64,' + req.file.buffer.toString('base64');
    // persona_id enviado por el frontend (más confiable que extraer del RUT)
    const personaId = req.body?.persona_id || req.query?.persona_id || null;

    // Guardar en disco como caché
    try {
      const carpetaPath = safeDocsPath(carpetaRel);
      if (!fs.existsSync(carpetaPath)) fs.mkdirSync(carpetaPath, { recursive: true });
      fs.writeFileSync(path.join(carpetaPath, nombre), req.file.buffer);
    } catch(e) { console.warn('[subir] disco:', e.message); }

    // Guardar en PostgreSQL (fuente permanente)
    if (pgPool && personaId) {
      try {
        await requirePg().query(
          `INSERT INTO archivos_solicitante (id, persona_id, nombre, carpeta, data_url, mime_type)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT(id) DO UPDATE SET data_url=EXCLUDED.data_url, mime_type=EXCLUDED.mime_type, carpeta=EXCLUDED.carpeta`,
          [archivoRegistroId(personaId, carpetaRel, nombre), personaId, nombre, carpetaRel, dataUrl, mimeType]
        );
        console.log('[subir] Guardado en PG:', nombre, 'persona:', personaId);
      } catch(e) { console.warn('[subir] PG error:', e.message); }
    } else if (!personaId) {
      console.warn('[subir] Sin persona_id — solo en disco:', nombre);
    }

    // SQLite local
    try { db.prepare('INSERT OR REPLACE INTO archivos (id, carpeta, nombre) VALUES (?, ?, ?)').run(carpetaRel + '/' + nombre, carpetaRel, nombre); } catch {}

    res.json({ ok: true, nombre });
  } catch(e) {
    console.error('[subir] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/archivos/{*path}', async (req, res) => {
  const carpetaRel = getWildcard(req);
  const archivosSet = new Set();

  // 1. Filesystem (incluye archivos del repositorio git — siempre disponibles)
  const carpetaPath = safeDocsPath(carpetaRel);
  if (fs.existsSync(carpetaPath)) {
    try {
      fs.readdirSync(carpetaPath)
        .filter(item => { try { return fs.statSync(path.join(carpetaPath, item)).isFile(); } catch { return false; } })
        .forEach(n => archivosSet.add(n));
    } catch {}
  }

  // 2. SQLite local (archivos recientes en disco)
  try {
    db.prepare('SELECT nombre FROM archivos WHERE carpeta = ? ORDER BY creado DESC').all(carpetaRel)
      .forEach(r => archivosSet.add(r.nombre));
  } catch {}

  // 3. PostgreSQL (archivos guardados permanentemente — más importante)
  if (pgPool) {
    try {
      const { rows } = await requirePg().query(
        `SELECT nombre FROM archivos_solicitante WHERE carpeta=$1 AND nombre IS NOT NULL AND data_url IS NOT NULL`,
        [carpetaRel]
      );
      rows.forEach(r => archivosSet.add(r.nombre));
    } catch(e) { console.warn('[archivos list PG]', e.message); }
  }

  res.json([...archivosSet]);
});


// ─── HELPER CENTRAL: servir archivo desde PostgreSQL ─────────────────────────
async function servirDesdeDB(res, nombre, carpeta) {
  if (!pgPool) return false;
  try {
    // Buscar por carpeta exacta + nombre (más preciso)
    let rows = [];
    if (carpeta) {
      const r = await requirePg().query(
        `SELECT data_url, mime_type FROM archivos_solicitante
         WHERE nombre=$1 AND carpeta=$2 AND data_url IS NOT NULL LIMIT 1`,
        [nombre, carpeta]
      );
      rows = r.rows;
    }
    if (!rows.length || !rows[0].data_url) return false;
    const dataUrl = rows[0].data_url;
    const mime = rows[0].mime_type || 'application/octet-stream';
    if (dataUrl.startsWith('data:')) {
      const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(nombre) + '"');
      res.send(buf);
      return true;
    }
    res.setHeader('Content-Type', mime.includes('html') ? 'text/html' : mime);
    res.send(dataUrl);
    return true;
  } catch(e) { console.warn('[servirDesdeDB]', e.message); return false; }
}

// Servir archivo generado guardado en archivos_solicitante.data_url
app.get('/archivo-generado/:personaId/:nombre', async (req, res) => {
  try {
    const { personaId, nombre } = req.params;
    if (!pgPool) return res.status(503).json({ error: 'Sin conexión a BD' });
    const { rows } = await requirePg().query(
      'SELECT data_url, mime_type FROM archivos_solicitante WHERE persona_id=$1 AND nombre=$2 LIMIT 1',
      [personaId, decodeURIComponent(nombre)]
    );
    if (!rows.length || !rows[0].data_url) return res.status(404).json({ error: 'Archivo no encontrado' });
    const dataUrl = rows[0].data_url;
    const mimeType = rows[0].mime_type || 'application/octet-stream';
    // Puede ser dataUrl (data:...;base64,...) o HTML plano
    if (dataUrl.startsWith('data:')) {
      const [header, base64] = dataUrl.split(',');
      const mime = header.replace('data:', '').replace(';base64', '');
      const buf = Buffer.from(base64, 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(decodeURIComponent(nombre))}"`);
      return res.send(buf);
    }
    // HTML plano
    res.setHeader('Content-Type', mimeType.includes('html') ? 'text/html' : mimeType);
    res.send(dataUrl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/archivo-local/{*path}', async (req, res) => {
  try {
    const fullRel = getWildcard(req);
    const lastSlash = fullRel.lastIndexOf('/');
    if (lastSlash === -1) return res.status(400).json({ error: 'Ruta invalida' });
    const carpetaRel = fullRel.substring(0, lastSlash);
    const archivo = fullRel.substring(lastSlash + 1);
    // 1. Disco
    const encontrado = buscarArchivoLocal(carpetaRel, archivo);
    if (encontrado) return res.sendFile(encontrado);
    // 2. PostgreSQL
    if (await servirDesdeDB(res, archivo, carpetaRel)) return;
    res.status(404).json({ error: 'Archivo no encontrado.' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.delete('/archivos/{*path}', async (req, res) => {
  try {
    const fullRel = getWildcard(req);
    const lastSlash = fullRel.lastIndexOf('/');
    if (lastSlash === -1) return res.status(400).json({ error: 'Ruta inválida' });
    const carpetaRel = fullRel.substring(0, lastSlash);
    const archivo = fullRel.substring(lastSlash + 1);
    // 1. Archivar del disco (papelera)
    try { const fp = safeDocsPath(carpetaRel, archivo); archivarArchivoLocal(fp, carpetaRel, archivo); } catch {}
    // 2. SQLite
    try { db.prepare('DELETE FROM archivos WHERE carpeta = ? AND nombre = ?').run(carpetaRel, archivo); } catch {}
    // 3. PostgreSQL — marcar data_url como NULL (no borrar el registro para auditoría)
    if (pgPool) {
      try {
        await requirePg().query(
          `UPDATE archivos_solicitante SET data_url=NULL, mime_type=NULL WHERE carpeta=$1 AND nombre=$2`,
          [carpetaRel, archivo]
        );
      } catch(e) { console.warn('[delete PG]', e.message); }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Fallback /files/: disco → PostgreSQL
app.use('/files', async (req, res) => {
  try {
    const partes = req.path.split('/').filter(Boolean);
    const nombre = decodeURIComponent(partes.pop() || '');
    const carpeta = partes.join('/');
    if (!nombre) return res.status(404).json({ error: 'Nombre vacío.' });
    // 1. Buscar en disco con búsqueda fuzzy
    const encontrado = buscarArchivoLocal(carpeta, nombre);
    if (encontrado) return res.sendFile(encontrado);
    // 2. PostgreSQL
    if (await servirDesdeDB(res, nombre, carpeta)) return;
    res.status(404).json({ error: 'Archivo no encontrado.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  console.log('Base de datos: ' + (pgPool ? 'PostgreSQL Render' : 'serviu.db local'));
  console.log('Acceso en red: http://' + ip + ':' + PORT);
  // Migrar archivos del repositorio git a PostgreSQL (archivos históricos)
  setTimeout(() => migrarArchivosGitAPG().catch(e => console.warn('[migrar-git startup]', e.message)), 3000);
  // Migrar archivos de Supabase Storage a PostgreSQL
  setTimeout(() => migrarArchivosSuapabaseAPG().catch(e => console.warn('[migrar-supa startup]', e.message)), 8000);
});
