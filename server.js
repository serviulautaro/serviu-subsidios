const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/archivos', express.static(path.join(__dirname, 'documentos')));

// Crear carpeta documentos si no existe
const docsDir = path.join(__dirname, 'documentos');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir);

// Inicializar base de datos
const db = new Database(path.join(__dirname, 'serviu.db'));

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
`);

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

// API ARCHIVOS
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const carpeta = path.join(docsDir, req.params.persona);
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
    cb(null, carpeta);
  },
  filename: (req, file, cb) => {
    const nombre = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, nombre);
  }
});
const upload = multer({ storage });

app.post('/carpeta/:persona', (req, res) => {
  const carpeta = path.join(docsDir, req.params.persona);
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  res.json({ ok: true });
});

app.post('/subir/:persona', upload.single('archivo'), (req, res) => {
  res.json({ ok: true, nombre: req.file.filename });
});

app.get('/archivos/:persona', (req, res) => {
  const carpeta = path.join(docsDir, req.params.persona);
  if (!fs.existsSync(carpeta)) return res.json([]);
  res.json(fs.readdirSync(carpeta));
});

app.delete('/archivos/:persona/:archivo', (req, res) => {
  const archivo = path.join(docsDir, req.params.persona, req.params.archivo);
  if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  res.json({ ok: true });
});

// SERVIR REACT
const buildPath = path.join(__dirname, 'build');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.use(function(req, res) {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

const PORT = 3001;
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
