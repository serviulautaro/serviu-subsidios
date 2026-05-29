import { createClient } from '@supabase/supabase-js';
import { demoSupabase } from './demoSupabaseClient';

const SUPABASE_URL = 'https://qirjfgjesjzikouehmib.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcmpmZ2plc2p6aWtvdWVobWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NjgxMTUsImV4cCI6MjA5MzI0NDExNX0.7bDpXPZyc-Ovt-EWBqCl3RsbPqiU_eSAa98F_ufbVqU';

const realSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const API = (typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname))
  ? window.location.origin
  : "http://localhost:3001";
const USE_API_DB = process.env.REACT_APP_USE_API_DB !== "false";
export const IS_DEMO_MODE = process.env.REACT_APP_DEMO_MODE === 'true' && !USE_API_DB;

class ApiQuery {
  constructor(table) {
    this.table = table;
    this.action = "select";
    this.selectCols = "*";
    this.filters = [];
    this.orderBy = null;
    this.ascending = true;
    this.rangeFrom = null;
    this.rangeTo = null;
    this.limitCount = null;
    this.payload = null;
  }

  select(cols = "*") {
    this.action = this.action === "insert" || this.action === "upsert" ? this.action : "select";
    this.selectCols = cols || "*";
    return this;
  }

  insert(rows) {
    this.action = "insert";
    this.payload = rows;
    return this;
  }

  upsert(rows) {
    this.action = "upsert";
    this.payload = rows;
    return this;
  }

  update(values) {
    this.action = "update";
    this.payload = values;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(col, value) {
    this.filters.push({ col, value });
    return this;
  }

  order(col, options = {}) {
    this.orderBy = col;
    this.ascending = options.ascending !== false;
    return this;
  }

  range(from, to) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  async execute() {
    try {
      if (this.action === "select") {
        const params = new URLSearchParams();
        params.set("select", this.selectCols);
        this.filters.forEach(f => params.append(`eq[${f.col}]`, f.value ?? ""));
        if (this.orderBy) {
          params.set("order", this.orderBy);
          params.set("ascending", String(this.ascending));
        }
        if (this.limitCount !== null) params.set("limit", String(this.limitCount));
        if (this.rangeFrom !== null && this.rangeTo !== null) {
          params.set("from", String(this.rangeFrom));
          params.set("to", String(this.rangeTo));
        }
        const res = await fetch(`${API}/api/db/${encodeURIComponent(this.table)}?${params.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) return { data: null, error: { message: json.error || "Error consultando backend" } };
        return { data: json.data || [], error: null };
      }

      if ((this.action === "update" || this.action === "delete") && !this.filters.length) {
        return { data: null, error: { message: `${this.action} sin filtros bloqueado por seguridad` } };
      }

      const method = this.action === "update" ? "PATCH" : this.action === "delete" ? "DELETE" : "POST";
      const endpoint = this.action === "update" ? "update" : this.action === "delete" ? "delete" : this.action;
      const body = this.action === "update"
        ? { filters: this.filters, values: this.payload || {} }
        : this.action === "delete"
          ? { filters: this.filters }
          : { rows: this.payload };
      const res = await fetch(`${API}/api/db/${encodeURIComponent(this.table)}/${endpoint}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) return { data: null, error: { message: json.error || "Error escribiendo backend" } };
      return { data: json.data || [], error: null };
    } catch (err) {
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

const apiDbClient = {
  from: (table) => new ApiQuery(table),
  rpc: async (fn, params = {}) => {
    try {
      const res = await fetch(`${API}/api/rpc/${encodeURIComponent(fn)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) return { data: null, error: { message: json.error || "Error ejecutando RPC" } };
      return { data: json.data, error: null };
    } catch (err) {
      return { data: null, error: { message: err?.message || String(err) } };
    }
  },
  storage: realSupabase.storage,
};

export const supabase = IS_DEMO_MODE ? demoSupabase : (USE_API_DB ? apiDbClient : realSupabase);
