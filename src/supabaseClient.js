import { createClient } from '@supabase/supabase-js';
import { demoSupabase } from './demoSupabaseClient';

const SUPABASE_URL = 'https://qirjfgjesjzikouehmib.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcmpmZ2plc2p6aWtvdWVobWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NjgxMTUsImV4cCI6MjA5MzI0NDExNX0.7bDpXPZyc-Ovt-EWBqCl3RsbPqiU_eSAa98F_ufbVqU';
const realSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const API = (typeof window !== 'undefined' && !['localhost','127.0.0.1'].includes(window.location.hostname))
  ? window.location.origin
  : 'http://localhost:3001';

const USE_API_DB = process.env.REACT_APP_USE_API_DB !== 'false';
export const IS_DEMO_MODE = process.env.REACT_APP_DEMO_MODE === 'true' && !USE_API_DB;

async function apiCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// Cadena de filtros acumulable: soporta múltiples .eq() encadenados
function makeFilterChain(method, tabla, action, payload) {
  const filters = [];

  const chain = {
    eq: (col, val) => {
      filters.push({ col, op: 'eq', value: val });
      return chain;
    },
    // Permite usar como promesa directamente (await o .then())
    then: (resolve, reject) => {
      let promise;
      if (method === 'DELETE') {
        promise = apiCall('DELETE', `/api/db/${tabla}/delete`, { filters });
      } else if (method === 'UPDATE') {
        promise = apiCall('PATCH', `/api/db/${tabla}/update`, { filters, values: payload });
      } else if (method === 'SELECT') {
        const qp = filters.map(f => `eq[${f.col}]=${encodeURIComponent(f.value)}`).join('&');
        const cols = payload || '*';
        promise = apiCall('GET', `/api/db/${tabla}?${qp}&select=${cols}`);
      } else {
        promise = Promise.reject(new Error('Método no soportado: ' + method));
      }
      return promise
        .then(r => resolve({ data: r.data || r, error: null }))
        .catch(e => resolve({ data: null, error: e }));
    }
  };

  return chain;
}

function makeSelectChain(tabla, cols) {
  const filters = [];
  let orderCol = null, orderAsc = true;

  const chain = {
    eq: (col, val) => { filters.push({ col, op: 'eq', value: val }); return chain; },
    neq: (col, val) => { filters.push({ col, op: 'neq', value: val }); return chain; },
    gte: (col, val) => { filters.push({ col, op: 'gte', value: val }); return chain; },
    lt: (col, val) => { filters.push({ col, op: 'lt', value: val }); return chain; },
    order: (col, opts = {}) => { orderCol = col; orderAsc = opts.ascending !== false; return chain; },
    then: (resolve) => {
      const qp = filters.map(f => `${f.op || 'eq'}[${f.col}]=${encodeURIComponent(f.value)}`).join('&');
      const orderPart = orderCol ? `&orderBy=${orderCol}&orderAsc=${orderAsc}` : '';
      return apiCall('GET', `/api/db/${tabla}?${qp}&select=${cols || '*'}${orderPart}`)
        .then(r => resolve({ data: r.data || r, error: null }))
        .catch(e => resolve({ data: null, error: e }));
    }
  };
  return chain;
}

function makeProxyClient() {
  return {
    auth: realSupabase.auth,
    // storage stub: no hace nada, evita crash
    storage: {
      from: () => ({
        remove: async () => ({ error: null }),
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      })
    },
    from: (tabla) => ({
      select: (cols = '*') => makeSelectChain(tabla, cols),
      insert: (rows) => ({
        then: (resolve) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          apiCall('POST', `/api/db/${tabla}/insert`, arr)
            .then(() => resolve({ data: null, error: null }))
            .catch(e => resolve({ data: null, error: e }));
        }
      }),
      upsert: (rows, opts) => ({
        then: (resolve) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          apiCall('POST', `/api/db/${tabla}/upsert`, { rows: arr, ...opts })
            .then(() => resolve({ data: null, error: null }))
            .catch(e => resolve({ data: null, error: e }));
        }
      }),
      update: (values) => makeFilterChain('UPDATE', tabla, 'update', values),
      delete: () => makeFilterChain('DELETE', tabla, 'delete', null),
    }),
    rpc: (fn, params) => ({
      then: (resolve) => apiCall('POST', `/api/rpc/${fn}`, params)
        .then(r => resolve({ data: r.data || r, error: null }))
        .catch(e => resolve({ data: null, error: e }))
    }),
  };
}

export const supabase = USE_API_DB ? makeProxyClient() : demoSupabase;
