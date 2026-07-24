const fs = require('fs');
const path = require('path');

const API = String(process.env.SERVIU_API || 'https://serviu-subsidios-demo.onrender.com').replace(/\/+$/, '');
const USER_DIR = process.env.USERPROFILE || 'C:\\Users\\JORGE';
const ROOT = process.env.SERVIU_R2_LOCAL_DIR ||
  path.join(USER_DIR, 'Documents', 'Documentos Entidad Patrocinante R2');
const BUCKET_DEFINITIVO = 'documentosentidadpatrocinantemunilautaro';
const CONCURRENCIA = Math.max(1, Math.min(Number(process.env.SERVIU_R2_SYNC_CONCURRENCY || 3), 5));

const limpiarSegmento = (valor = '', fallback = 'sin_dato') => {
  let texto = String(valor || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (texto.length > 150) texto = texto.slice(0, 150).replace(/[. ]+$/g, '');
  return texto || fallback;
};

const rutaLocalParaKey = (key = '') => {
  const partes = String(key || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(parte => parte && parte !== '.' && parte !== '..')
    .map(parte => limpiarSegmento(parte));
  if (!partes.length) throw new Error('Ruta R2 vacia.');
  const destino = path.resolve(ROOT, ...partes);
  const raiz = path.resolve(ROOT) + path.sep;
  if (!destino.startsWith(raiz)) throw new Error('Ruta R2 fuera de la carpeta autorizada.');
  return destino;
};

const fetchJson = async ruta => {
  const res = await fetch(API + ruta, { headers: { accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 180)}`);
  return JSON.parse(text);
};

const escribirJsonAtomico = (archivo, valor) => {
  fs.writeFileSync(archivo, JSON.stringify(valor, null, 2));
};

const descargar = async item => {
  const destino = rutaLocalParaKey(item.r2_key);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (fs.existsSync(destino) && fs.statSync(destino).size > 0) {
    return { estado: 'existente', key: item.r2_key, ruta: destino, bytes: fs.statSync(destino).size };
  }
  const url = API + '/api/r2/archivo/' +
    item.r2_key.split('/').map(encodeURIComponent).join('/') +
    `?bucket=${encodeURIComponent(item.r2_bucket || BUCKET_DEFINITIVO)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${item.r2_key}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error(`Archivo vacio: ${item.r2_key}`);
  const temporal = destino + '.descarga';
  fs.writeFileSync(temporal, buffer, { flag: 'wx' });
  fs.renameSync(temporal, destino);
  return { estado: 'descargado', key: item.r2_key, ruta: destino, bytes: buffer.length };
};

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const logsDir = path.join(ROOT, '_estado');
  fs.mkdirSync(logsDir, { recursive: true });
  const estadoPath = path.join(logsDir, 'estado_actual.json');
  const inicio = new Date().toISOString();
  const respuesta = await fetchJson(
    '/api/db/archivos_solicitante' +
    '?select=id,persona_id,nombre,r2_key,r2_bucket,storage_fuente' +
    '&soloDisponibles=true&limit=10000'
  );
  const unicos = new Map();
  for (const row of respuesta.data || []) {
    if (!row.r2_key || row.r2_bucket !== BUCKET_DEFINITIVO) continue;
    unicos.set(`${row.r2_bucket}|${row.r2_key}`, row);
  }
  const items = [...unicos.values()];
  const estado = {
    inicio,
    actualizado: inicio,
    api: API,
    bucket: BUCKET_DEFINITIVO,
    carpeta_local: ROOT,
    encontrados: items.length,
    procesados: 0,
    descargados: 0,
    existentes: 0,
    archivos_descargados: [],
    errores: [],
    completo: false,
  };
  escribirJsonAtomico(estadoPath, estado);

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const indice = cursor++;
      if (indice >= items.length) return;
      const item = items[indice];
      try {
        const resultado = await descargar(item);
        if (resultado.estado === 'descargado') {
          estado.descargados += 1;
          estado.archivos_descargados.push({
            key: resultado.key,
            ruta: resultado.ruta,
            bytes: resultado.bytes,
          });
        } else {
          estado.existentes += 1;
        }
      } catch (error) {
        estado.errores.push({ key: item.r2_key, error: error.message });
      } finally {
        estado.procesados += 1;
        estado.actualizado = new Date().toISOString();
        if (estado.procesados % 10 === 0 || estado.procesados === items.length) {
          escribirJsonAtomico(estadoPath, estado);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCIA }, worker));
  estado.completo = estado.procesados === estado.encontrados && estado.errores.length === 0;
  estado.finalizado = new Date().toISOString();
  estado.actualizado = estado.finalizado;
  escribirJsonAtomico(estadoPath, estado);
  const sello = estado.finalizado.replace(/[:.]/g, '-');
  escribirJsonAtomico(path.join(logsDir, `sincronizacion_${sello}.json`), estado);
  console.log(JSON.stringify(estado, null, 2));
  if (estado.errores.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
