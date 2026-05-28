const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const backupDir = process.argv[2];
const supabase = createClient('https://qirjfgjesjzikouehmib.supabase.co', 'sb_publishable_SSAA2undzTyVsgCjMgbXBw_Bu9D_lvt');
const tables = ['personas', 'solicitudes', 'comites', 'archivos_solicitante', 'programas_custom'];
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
async function fetchAll(table) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1);
    if (error) throw new Error(table + ': ' + error.message);
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
(async () => {
  const manifest = { fecha: new Date().toISOString(), tablas: {}, nota: 'Respaldo exportado desde Supabase con clave publica configurada en la app.' };
  for (const table of tables) {
    const rows = await fetchAll(table);
    manifest.tablas[table] = rows.length;
    fs.writeFileSync(path.join(backupDir, table + '.json'), JSON.stringify(rows, null, 2), 'utf8');
    const columns = [...rows.reduce((set, row) => { Object.keys(row || {}).forEach(k => set.add(k)); return set; }, new Set())];
    const csv = [columns.join(',')].concat(rows.map(row => columns.map(col => csvEscape(row[col])).join(','))).join('\n');
    fs.writeFileSync(path.join(backupDir, table + '.csv'), csv, 'utf8');
  }
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
})().catch(err => { console.error(err.stack || err.message); process.exit(1); });
