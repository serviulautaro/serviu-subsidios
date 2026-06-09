const fs = require('fs');
const path = require('path');

const API = process.env.SERVIU_API || 'https://serviu-subsidios-demo.onrender.com';
const DESKTOP = path.join(process.env.USERPROFILE || 'C:\\Users\\JORGE', 'Desktop');
const ROOT = process.env.SERVIU_BACKUP_DIR || path.join(DESKTOP, 'Respaldo de documentos');

const PROGRAMAS = {
  habitabilidad: 'Habitabilidad de Vivienda (DESMARQUE DE VIVIENDA)',
  csp_rural: 'Construccion Sitio Propio Rural',
  csp_urbano: 'Construccion Sitio Propio Urbano',
};

const COMITES_FIJOS = [
  { id: 'gr1R', nombre: 'COMITE DE VIVIENDA RURAL MI NUEVO HOGAR', programa_id: 'csp_rural', aliases: ['comite_0'] },
  { id: 'gr2R', nombre: 'COMITE DE VIVIENDA RURAL LA FUERZA', programa_id: 'csp_rural', aliases: ['comite_1'] },
  { id: 'gr3R', nombre: 'COMITE DE VIVIENDA RURAL KUME RUKA', programa_id: 'csp_rural', aliases: ['comite_2'] },
  { id: 'gr4R', nombre: 'COMITE DE VIVIENDA RURAL NEWEN MAPU', programa_id: 'csp_rural', aliases: ['comite_3'] },
  { id: 'gr5R', nombre: 'COMITE DE VIVIENDA RURAL KIMEY RUCA', programa_id: 'csp_rural', aliases: ['comite_4'] },
  { id: 'gr6R', nombre: 'COMITE DE VIVIENDA RURAL FALTA CONSTITUIRLO', programa_id: 'csp_rural', aliases: ['comite_5'] },
  { id: 'gr1U', nombre: 'COMITE DE VIVIENDA URBANO PIONEROS DE LAUTARO', programa_id: 'csp_urbano', aliases: ['comite_6'] },
  { id: 'gr2U', nombre: 'COMITE DE VIVIENDA URBANO FALTA CONSTITUIRLO', programa_id: 'csp_urbano', aliases: ['comite_7'] },
  { id: 'comite_desmarque', nombre: 'DESMARQUE DE VIVIENDA', programa_id: 'habitabilidad', aliases: [] },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchConTimeout = async (url, options = {}, timeoutMs = 45000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};
const norm = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function sanitize(value, fallback = 'SIN NOMBRE', max = 120) {
  let text = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  if (text.length > max) text = text.slice(0, max).replace(/[. ]+$/g, '');
  return text || fallback;
}

function extFromMime(mime = '') {
  const type = String(mime).toLowerCase();
  if (type.includes('pdf')) return '.pdf';
  if (type.includes('html')) return '.html';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('png')) return '.png';
  if (type.includes('word')) return '.docx';
  return '';
}

function dataToBuffer(doc = {}) {
  let value = doc.archivoData || doc.dataUrl || doc.data || doc.contenido || '';
  if (!value && typeof doc.archivo === 'string' && doc.archivo.startsWith('data:')) value = doc.archivo;
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  return {
    buffer: match[2] ? Buffer.from(match[3] || '', 'base64') : Buffer.from(decodeURIComponent(match[3] || ''), 'utf8'),
    mime: match[1] || doc.archivoTipo || '',
  };
}

function docName(doc = {}, index = 0, mime = '') {
  let name = doc.nombre || doc.archivo || `documento_${index + 1}`;
  if (String(name).startsWith('data:')) name = `documento_${index + 1}`;
  if (!path.extname(String(name))) name += extFromMime(mime || doc.archivoTipo || '') || '.bin';
  return sanitize(name, 'documento');
}

function targetPath(dir, name, buffer) {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let file = path.join(dir, name);
  if (fs.existsSync(file)) {
    try {
      if (fs.statSync(file).size === buffer.length) return { file, skip: true };
    } catch {}
    let i = 2;
    do {
      file = path.join(dir, `${stem} (${i++})${ext}`);
    } while (fs.existsSync(file));
  }
  return { file, skip: false };
}

async function getJson(route, tries = 10) {
  let last = '';
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetchConTimeout(API + route, { headers: { accept: 'application/json' } });
      const text = await res.text();
      last = `${res.status} ${text.slice(0, 120)}`;
      if (res.ok && text.trim().startsWith('{')) return JSON.parse(text);
    } catch (error) {
      last = error.message;
    }
    await sleep(1500 * i);
  }
  throw new Error(last);
}

function idsComite(comite) {
  return [comite.id, comite.codigo, comite.nombre, ...(comite.aliases || [])].filter(Boolean).map(String);
}

function personaEnComite(persona, comite) {
  const valores = [persona.comiteId, persona.comite_id, persona.comite, persona.codigo_comite].filter(Boolean).map(String);
  const ids = idsComite(comite);
  if (valores.some(v => ids.includes(v))) return true;
  return valores.some(v => norm(v) === norm(comite.nombre));
}

function solEnComite(sol, comite) {
  const valores = [sol.comite, sol.codigo_comite, sol.comiteId, sol.codigoComite].filter(Boolean).map(String);
  const ids = idsComite(comite);
  if (valores.some(v => ids.includes(v))) return true;
  return valores.some(v => norm(v) === norm(comite.nombre));
}

function unirComites(dbComites = []) {
  const comites = COMITES_FIJOS.map(c => ({ ...c, aliases: [...(c.aliases || [])] }));
  for (const raw of dbComites) {
    if (!raw.nombre) continue;
    const programa = raw.programa_id || raw.programaId || (norm(raw.nombre).includes('URBANO') ? 'csp_urbano' : norm(raw.nombre).includes('RURAL') ? 'csp_rural' : '');
    if (!PROGRAMAS[programa]) continue;
    const nombre = sanitize(raw.nombre).toUpperCase();
    const existente = comites.find(c => norm(c.nombre) === norm(nombre) || (c.aliases || []).includes(raw.id));
    if (existente) {
      [raw.id, raw.codigo].filter(Boolean).forEach(id => {
        if (!existente.aliases.includes(id)) existente.aliases.push(id);
      });
    } else {
      comites.push({ id: raw.id, codigo: raw.codigo, nombre, programa_id: programa, aliases: [] });
    }
  }
  return comites;
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const logDir = path.join(ROOT, '_logs');
  fs.mkdirSync(logDir, { recursive: true });

  const bootstrap = await getJson('/api/bootstrap');
  const personas = bootstrap.personas || [];
  const comites = unirComites(bootstrap.comites || []);
  const solicitudes = (await getJson('/api/db/solicitudes?select=id,persona_id,persona_nombre,programa_id,comite,codigo_comite')).data || [];
  const solsByPerson = new Map();
  solicitudes.forEach(sol => {
    const pid = sol.persona_id || sol.personaId;
    if (!solsByPerson.has(pid)) solsByPerson.set(pid, []);
    solsByPerson.get(pid).push(sol);
  });

  const manifest = [];
  const faltantes = [];
  let saved = 0;
  let skipped = 0;
  let missing = 0;
  let errors = 0;
  let bytes = 0;

  for (const comite of comites) {
    const programaNombre = PROGRAMAS[comite.programa_id];
    if (!programaNombre) continue;
    const miembros = new Set();
    personas.forEach(persona => {
      if (personaEnComite(persona, comite)) miembros.add(persona.id);
    });
    solicitudes.forEach(sol => {
      if (sol.programa_id === comite.programa_id && solEnComite(sol, comite)) miembros.add(sol.persona_id);
    });

    for (const personaId of miembros) {
      const persona = personas.find(p => p.id === personaId) || {};
      const personaNombre = sanitize(persona.nombre || solicitudes.find(s => s.persona_id === personaId)?.persona_nombre || personaId);
      const dir = path.join(ROOT, sanitize(programaNombre), sanitize(comite.nombre), personaNombre);
      fs.mkdirSync(dir, { recursive: true });
      const sols = (solsByPerson.get(personaId) || []).filter(s => s.programa_id === comite.programa_id);

      for (const lite of sols) {
        try {
          const full = (await getJson(`/api/db/solicitudes?select=*&eq[id]=${encodeURIComponent(lite.id)}`)).data?.[0];
          const docs = Array.isArray(full?.documentos) ? full.documentos : [];
          for (let i = 0; i < docs.length; i++) {
            const bin = dataToBuffer(docs[i]);
            if (!bin?.buffer?.length) {
              missing++;
              continue;
            }
            const out = targetPath(dir, docName(docs[i], i, bin.mime), bin.buffer);
            if (out.skip) {
              skipped++;
              continue;
            }
            fs.writeFileSync(out.file, bin.buffer);
            saved++;
            bytes += bin.buffer.length;
            manifest.push({
              programa: programaNombre,
              comite: comite.nombre,
              solicitante: personaNombre,
              solicitud: lite.id,
              documento: path.basename(out.file),
              ruta: out.file,
              bytes: bin.buffer.length,
            });
          }
        } catch (error) {
          errors++;
          faltantes.push({ solicitud: lite.id, solicitante: personaNombre, comite: comite.nombre, error: error.message });
        }
      }
    }
  }

  const resumen = {
    fecha: new Date().toISOString(),
    api: API,
    carpeta: ROOT,
    guardados: saved,
    ya_existian: skipped,
    sin_archivo_interno: missing,
    errores: errors,
    mb_nuevos: +(bytes / 1048576).toFixed(2),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(logDir, `backup_documentos_${stamp}.json`), JSON.stringify({ resumen, documentos: manifest, faltantes }, null, 2));
  fs.writeFileSync(path.join(ROOT, 'ULTIMO_RESPALDO_AUTOMATICO.txt'), [
    'RESPALDO AUTOMATICO DE DOCUMENTOS SERVIU',
    `Fecha: ${resumen.fecha}`,
    `Documentos nuevos guardados: ${resumen.guardados}`,
    `Documentos ya existentes: ${resumen.ya_existian}`,
    `Registros sin archivo interno: ${resumen.sin_archivo_interno}`,
    `Errores: ${resumen.errores}`,
    `MB nuevos: ${resumen.mb_nuevos}`,
    `Carpeta: ${ROOT}`,
  ].join('\r\n'));
  console.log(JSON.stringify(resumen, null, 2));
  if (errors) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
