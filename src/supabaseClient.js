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
