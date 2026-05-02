import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qirjfgjesjzikouehmib.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SSAA2undzTyVsgCjMgbXBw_Bu9D_lvt';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
