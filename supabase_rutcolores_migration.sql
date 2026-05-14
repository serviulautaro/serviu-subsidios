-- Ejecutar en Supabase SQL Editor para guardar permanentemente el estado RUT colores / RUT ByN.
-- No borra ni modifica datos existentes.
ALTER TABLE personas ADD COLUMN IF NOT EXISTS rutcolores text DEFAULT '';
