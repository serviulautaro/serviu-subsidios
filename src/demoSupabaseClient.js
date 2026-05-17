const DEMO_ADMIN_KEY = "196560";
const DEMO_DB_KEY = "serviu_demo_db_v1";

const seedDb = () => ({
  personas: [],
  solicitudes: [],
  comites: [],
  programas_custom: [],
  visitas: [],
  archivos_solicitante: [],
  audit_log: [],
  app_users: [
    {
      id: "demo-admin",
      nombre: "Administrador Demo",
      username: "admin.demo",
      password: "Demo2026",
      rol: "admin",
      activo: true,
      debe_cambiar_clave: false,
    },
    {
      id: "demo-user",
      nombre: "Usuario Demo",
      username: "usuario.demo",
      password: "Demo2026",
      rol: "usuario",
      activo: true,
      debe_cambiar_clave: false,
    },
  ],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const loadDb = () => {
  try {
    const raw = localStorage.getItem(DEMO_DB_KEY);
    return raw ? { ...seedDb(), ...JSON.parse(raw) } : seedDb();
  } catch {
    return seedDb();
  }
};

const saveDb = (db) => {
  try { localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db)); } catch {}
};

const toSnake = (key = "") => key.replace(/[A-Z]/g, m => "_" + m.toLowerCase());
const valueFor = (row, key) => row?.[key] ?? row?.[toSnake(key)];

class DemoQuery {
  constructor(table) {
    this.table = table;
    this.op = "select";
    this.payload = null;
    this.filters = [];
    this.orderSpec = null;
    this.returnSelect = false;
  }

  select() {
    if (["insert", "upsert", "update"].includes(this.op)) this.returnSelect = true;
    else this.op = "select";
    return this;
  }

  insert(payload) { this.op = "insert"; this.payload = Array.isArray(payload) ? payload : [payload]; return this; }
  upsert(payload) { this.op = "upsert"; this.payload = Array.isArray(payload) ? payload : [payload]; return this; }
  update(payload) { this.op = "update"; this.payload = payload || {}; return this; }
  delete() { this.op = "delete"; return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  neq(key, value) { this.filters.push({ key, value, op: "neq" }); return this; }
  gte(key, value) { this.filters.push({ key, value, op: "gte" }); return this; }
  lt(key, value) { this.filters.push({ key, value, op: "lt" }); return this; }
  order(key, opts = {}) { this.orderSpec = { key, ascending: opts.ascending !== false }; return this; }

  matches(row) {
    return this.filters.every(f => {
      const actual = valueFor(row, f.key) ?? "";
      if (f.op === "neq") return String(actual) !== String(f.value ?? "");
      if (f.op === "gte") return String(actual) >= String(f.value ?? "");
      if (f.op === "lt") return String(actual) < String(f.value ?? "");
      return String(actual) === String(f.value ?? "");
    });
  }

  normalize(row) {
    return { ...row };
  }

  execute() {
    const db = loadDb();
    const rows = Array.isArray(db[this.table]) ? db[this.table] : [];
    let data = null;

    if (this.op === "select") {
      data = rows.filter(row => this.matches(row)).map(clone);
      if (this.orderSpec) {
        const { key, ascending } = this.orderSpec;
        data.sort((a, b) => {
          const av = valueFor(a, key) || "";
          const bv = valueFor(b, key) || "";
          return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
      }
      return { data, error: null };
    }

    if (this.op === "insert") {
      const inserted = this.payload.map(item => this.normalize(item));
      db[this.table] = [...rows, ...inserted];
      saveDb(db);
      return { data: this.returnSelect ? clone(inserted) : null, error: null };
    }

    if (this.op === "upsert") {
      const saved = [];
      const next = [...rows];
      this.payload.forEach(item => {
        const normalized = this.normalize(item);
        const idx = next.findIndex(row => row.id === normalized.id);
        if (idx >= 0) next[idx] = { ...next[idx], ...normalized };
        else next.push(normalized);
        saved.push(normalized);
      });
      db[this.table] = next;
      saveDb(db);
      return { data: this.returnSelect ? clone(saved) : null, error: null };
    }

    if (this.op === "update") {
      const updated = [];
      db[this.table] = rows.map(row => {
        if (!this.matches(row)) return row;
        const next = { ...row, ...this.payload };
        updated.push(next);
        return next;
      });
      saveDb(db);
      return { data: this.returnSelect ? clone(updated) : null, error: null };
    }

    if (this.op === "delete") {
      db[this.table] = rows.filter(row => !this.matches(row));
      saveDb(db);
      return { data: null, error: null };
    }

    return { data: null, error: null };
  }

  then(resolve, reject) {
    try { return Promise.resolve(this.execute()).then(resolve, reject); }
    catch (err) { return Promise.reject(err).then(resolve, reject); }
  }
}

const rpc = async (fn, params = {}) => {
  const db = loadDb();
  if (fn === "login_app_user") {
    const username = String(params.p_username || "").trim().toLowerCase();
    const user = db.app_users.find(u => u.username === username && u.password === params.p_password && u.activo);
    if (!user) return { data: [], error: null };
    const { password, ...publicUser } = user;
    return { data: [clone(publicUser)], error: null };
  }
  if (fn === "cambiar_clave_app_user") {
    const idx = db.app_users.findIndex(u => u.id === params.p_user_id && u.password === params.p_actual);
    if (idx < 0) return { data: null, error: { message: "Clave actual incorrecta." } };
    db.app_users[idx] = { ...db.app_users[idx], password: params.p_nueva, debe_cambiar_clave: false };
    saveDb(db);
    return { data: null, error: null };
  }
  if (fn === "admin_listar_app_users") {
    if (params.p_admin_key !== DEMO_ADMIN_KEY) return { data: [], error: { message: "Clave admin incorrecta." } };
    return { data: db.app_users.map(({ password, ...u }) => clone(u)), error: null };
  }
  if (fn === "admin_crear_app_user") {
    if (params.p_admin_key !== DEMO_ADMIN_KEY) return { data: null, error: { message: "Clave admin incorrecta." } };
    const username = String(params.p_username || "").trim().toLowerCase();
    if (db.app_users.some(u => u.username === username)) return { data: null, error: { message: "Usuario ya existe." } };
    const user = { id: `demo-user-${Date.now()}`, nombre: params.p_nombre, username, password: params.p_password, rol: params.p_rol || "usuario", activo: true, debe_cambiar_clave: true };
    db.app_users.push(user);
    saveDb(db);
    const { password, ...publicUser } = user;
    return { data: [clone(publicUser)], error: null };
  }
  if (fn === "admin_estado_app_user") {
    if (params.p_admin_key !== DEMO_ADMIN_KEY) return { data: null, error: { message: "Clave admin incorrecta." } };
    db.app_users = db.app_users.map(u => u.id === params.p_user_id ? { ...u, activo: !!params.p_activo } : u);
    saveDb(db);
    return { data: null, error: null };
  }
  if (fn === "admin_eliminar_app_user") {
    if (params.p_admin_key !== DEMO_ADMIN_KEY) return { data: null, error: { message: "Clave admin incorrecta." } };
    db.app_users = db.app_users.filter(u => u.id !== params.p_user_id);
    saveDb(db);
    return { data: null, error: null };
  }
  if (fn === "registrar_auditoria") {
    db.audit_log.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      creado: new Date().toISOString(),
      usuario: params.p_user_id,
      accion: params.p_accion,
      entidad: params.p_entidad,
      entidad_id: params.p_entidad_id,
      detalle: params.p_detalle || {},
    });
    saveDb(db);
    return { data: null, error: null };
  }
  return { data: null, error: null };
};

export const demoSupabase = {
  from: (table) => new DemoQuery(table),
  rpc,
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: { message: "Demo usa archivos locales en base64." } }),
      getPublicUrl: (path) => ({ data: { publicUrl: "" + path } }),
    }),
  },
};
