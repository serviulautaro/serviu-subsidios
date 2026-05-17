import { createClient } from '@supabase/supabase-js';
import { demoSupabase } from './demoSupabaseClient';

const SUPABASE_URL = 'https://qirjfgjesjzikouehmib.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SSAA2undzTyVsgCjMgbXBw_Bu9D_lvt';

export const IS_DEMO_MODE = process.env.REACT_APP_DEMO_MODE === 'true';

export const supabase = IS_DEMO_MODE ? demoSupabase : createClient(SUPABASE_URL, SUPABASE_KEY);
