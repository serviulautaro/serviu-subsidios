const fs = require('fs');
const path = require('path');

const API = String(process.env.SERVIU_API || 'https://serviu-subsidios-demo.onrender.com').replace(/\/+$/, '');
const ADMIN_KEY = process.env.SERVIU_ADMIN_KEY || Buffer.from('MTk2NTYw', 'base64').toString('utf8');
const ejecutar = process.argv.includes('--ejecutar');
const soloDocumentos = process.argv.includes('--solo-documentos');
const soloRegistros = process.argv.includes('--solo-registros');
const loteDocumentos = Math.max(1, Math.min(Number(process.env.SERVIU_AUDIT_BATCH || 25), 50));
const loteRegistros = Math.max(1, Math.min(Number(process.env.SERVIU_REGISTER_BATCH || 50), 100));

const post = async (ruta, body) => {
  const res = await fetch(API + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ admin_key: ADMIN_KEY, ...body }),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${ruta}: HTTP ${res.status} ${json.error || text.slice(0, 200)}`);
  return json;
};

const acumular = (destino, resumen = {}) => {
  Object.entries(resumen).forEach(([estado, cantidad]) => {
    destino[estado] = (destino[estado] || 0) + Number(cantidad || 0);
  });
};

const procesar = async ({ ruta, limit, nombre }) => {
  let offset = 0;
  const resumen = {};
  const incidencias = [];
  let total = null;
  do {
    const respuesta = await post(ruta, { ejecutar, offset, limit });
    total = respuesta.total;
    acumular(resumen, respuesta.resumen);
    (respuesta.resultados || [])
      .filter(item => ['error', 'sin_fuente_recuperable', 'referencia_r2_no_encontrada'].includes(item.estado))
      .forEach(item => incidencias.push(item));
    const procesados = (respuesta.resultados || []).length;
    offset = respuesta.siguiente_offset;
    console.log(`[${nombre}] ${Math.min(Number(respuesta.offset || 0) + procesados, total)}/${total}`, respuesta.resumen);
  } while (offset !== null && offset !== undefined);
  return { total, resumen, incidencias };
};

async function main() {
  const inicio = new Date().toISOString();
  const reporte = {
    inicio,
    api: API,
    ejecutar,
    documentos: null,
    registros_solicitantes: null,
  };
  if (!soloRegistros) {
    reporte.documentos = await procesar({
      ruta: '/api/r2/auditar-documentos-lote',
      limit: loteDocumentos,
      nombre: 'documentos',
    });
  }
  if (!soloDocumentos) {
    reporte.registros_solicitantes = await procesar({
      ruta: '/api/r2/registrar-solicitantes-lote',
      limit: loteRegistros,
      nombre: 'solicitantes',
    });
  }
  reporte.finalizado = new Date().toISOString();
  const dir = path.resolve('outputs', 'auditoria_r2');
  fs.mkdirSync(dir, { recursive: true });
  const sello = reporte.finalizado.replace(/[:.]/g, '-');
  const archivo = path.join(dir, `auditoria_${ejecutar ? 'ejecutada' : 'solo_lectura'}_${sello}.json`);
  fs.writeFileSync(archivo, JSON.stringify(reporte, null, 2));
  console.log(JSON.stringify({ ...reporte, archivo }, null, 2));
  const errores = [
    ...(reporte.documentos?.incidencias || []),
    ...(reporte.registros_solicitantes?.incidencias || []),
  ];
  if (errores.some(item => item.estado === 'error')) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
