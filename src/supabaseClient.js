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

function makeProxyClient() {
  return {
    auth: realSupabase.auth,
    from: (tabla) => ({
      select: (cols = '*') => ({
        eq: (col, val) => apiCall('GET', `/api/db/${tabla}?${col}=eq.${val}&select=${cols}`)
          .then(r => ({ data: r.data || r, error: null }))
          .catch(e => ({ data: null, error: e })),
        then: (resolve) => apiCall('GET', `/api/db/${tabla}?select=${cols}`)
          .then(r => resolve({ data: r.data || r, error: null }))
          .catch(e => resolve({ data: null, error: e })),
      }),
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
      update: (values) => ({
        eq: (col, val) => ({
          then: (resolve) => {
            apiCall('PATCH', `/api/db/${tabla}/update`, { filters: [{ col, value: val }], values })
              .then(() => resolve({ data: null, error: null }))
              .catch(e => resolve({ data: null, error: e }));
          }
        })
      }),
      delete: () => ({
        eq: (col, val) => ({
          then: (resolve) => {
            apiCall('DELETE', `/api/db/${tabla}/delete`, { filters: [{ col, value: val }] })
              .then(() => resolve({ data: null, error: null }))
              .catch(e => resolve({ data: null, error: e }));
          }
        })
      }),
    }),
    rpc: (fn, params) => ({
      then: (resolve) => apiCall('POST', `/api/rpc/${fn}`, params)
        .then(r => resolve({ data: r.data || r, error: null }))
        .catch(e => resolve({ data: null, error: e }))
    }),
  };
}

export const supabase = USE_API_DB ? makeProxyClient() : demoSupabase;
