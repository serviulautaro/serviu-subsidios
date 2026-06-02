import { createClient } from '@supabase/supabase-js';
import { demoSupabase } from './demoSupabaseClient';

const SUPABASE_URL = 'https://qirjfgjesjzikouehmib.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcmpmZ2plc2p6aWtvdWVobWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NjgxMTUsImV4cCI6MjA5MzI0NDExNX0.7bDpXPZyc-Ovt-EWBqCl3RsbPqiU_eSAa98F_ufbVqU';

const realSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const API = (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname))
  ? window.location.origin
  : 'http://localhost:3001';

const USE_API_DB = process.env.REACT_APP_USE_API_DB !== 'false';
export const IS_DEMO_MODE = process.env.REACT_APP_DEMO_MODE === 'true' && !USE_API_DB;

// Cliente proxy: todas las escrituras van por el servidor Render (PostgreSQL directo)
// Las lecturas usan Supabase cuando está disponible
const apiCall = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data || json || [];
};

// Proxy que intercepta .from() y redirige escrituras al servidor Render
function makeProxyClient(base) {
  return {
    // Storage pasa directo a Supabase (no hay proxy para archivos)
    storage: base.storage,

    // RPC pasa directo al servidor Render
    rpc: (fn, params) => ({
      then: (resolve, reject) => 
        apiCall('POST', `/api/rpc/${fn}`, params).then(d => resolve({ data: d, error: null })).catch(e => resolve({ data: null, error: e }))
    }),

    from: (tabla) => {
      const tablasSoloSupabase = ['audit_log']; // tablas que solo van a Supabase
      const usarRender = !tablasSoloSupabase.includes(tabla);

      return {
        // SELECT — usa Supabase directo (lecturas sin CORS problem en GET)
        select: (cols) => base.from(tabla).select(cols),

        // INSERT — via servidor Render
        insert: (rows) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          if (!usarRender) return base.from(tabla).insert(arr);
          return {
            then: (resolve, reject) => {
              const tryRender = async () => {
                for (let i = 0; i < 3; i++) {
                  if (i > 0) await new Promise(r => setTimeout(r, 1500));
                  try {
                    await apiCall('POST', `/api/db/${tabla}/insert`, arr);
                    return resolve({ data: arr, error: null });
                  } catch (e) {
                    if (i === 2) {
                      // Último intento: Supabase directo
                      const result = await base.from(tabla).insert(arr);
                      return resolve(result);
                    }
                  }
                }
              };
              tryRender().catch(e => resolve({ data: null, error: e }));
            }
          };
        },

        // UPDATE — via servidor Render
        update: (values) => ({
          eq: (col, val) => {
            if (!usarRender) return base.from(tabla).update(values).eq(col, val);
            return {
              then: (resolve) => {
                const tryRender = async () => {
                  for (let i = 0; i < 3; i++) {
                    if (i > 0) await new Promise(r => setTimeout(r, 1500));
                    try {
                      // Pasar valores tal cual - el servidor maneja la serialización
                      const vals = { ...values };
                      await apiCall('PATCH', `/api/db/${tabla}/update`, {
                        filters: [{ col, value: val }],
                        values: vals
                      });
                      return resolve({ data: null, error: null });
                    } catch (e) {
                      if (i === 2) {
                        const result = await base.from(tabla).update(values).eq(col, val);
                        return resolve(result);
                      }
                    }
                  }
                };
                tryRender().catch(e => resolve({ data: null, error: e }));
              }
            };
          }
        }),

        // UPSERT — via servidor Render
        upsert: (rows, opts) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          if (!usarRender) return base.from(tabla).upsert(arr, opts);
          return {
            then: (resolve) => {
              const tryRender = async () => {
                for (let i = 0; i < 3; i++) {
                  if (i > 0) await new Promise(r => setTimeout(r, 1500));
                  try {
                    await apiCall('POST', `/api/db/${tabla}/upsert`, arr);
                    return resolve({ data: arr, error: null });
                  } catch (e) {
                    if (i === 2) {
                      const result = await base.from(tabla).upsert(arr, opts);
                      return resolve(result);
                    }
                  }
                }
              };
              tryRender().catch(e => resolve({ data: null, error: e }));
            }
          };
        },

        // DELETE — via servidor Render
        delete: () => ({
          eq: (col, val) => {
            if (!usarRender) return base.from(tabla).delete().eq(col, val);
            return {
              then: (resolve) => {
                apiCall('DELETE', `/api/db/${tabla}/delete`, { filters: [{ col, value: val }] })
                  .then(() => resolve({ data: null, error: null }))
                  .catch(async () => {
                    const result = await base.from(tabla).delete().eq(col, val);
                    resolve(result);
                  });
              }
            };
          }
        }),
      };
    }
  };
}

export const supabase = USE_API_DB ? makeProxyClient(realSupabase) : demoSupabase;
