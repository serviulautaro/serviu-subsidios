-- ============================================================
-- STORAGE DOCUMENTOS SOLICITANTES - SERVIU Subsidios
-- Ejecutar en Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos-solicitantes',
  'documentos-solicitantes',
  true,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/html',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 52428800,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE archivos_solicitante
  ADD COLUMN IF NOT EXISTS storage_bucket text DEFAULT 'documentos-solicitantes',
  ADD COLUMN IF NOT EXISTS storage_path text DEFAULT '',
  ADD COLUMN IF NOT EXISTS mime_type text DEFAULT '',
  ADD COLUMN IF NOT EXISTS tamano_bytes bigint DEFAULT 0;

DROP POLICY IF EXISTS documentos_solicitantes_select ON storage.objects;
CREATE POLICY documentos_solicitantes_select
ON storage.objects FOR SELECT
USING (bucket_id = 'documentos-solicitantes');

DROP POLICY IF EXISTS documentos_solicitantes_insert ON storage.objects;
CREATE POLICY documentos_solicitantes_insert
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documentos-solicitantes');

DROP POLICY IF EXISTS documentos_solicitantes_update ON storage.objects;
CREATE POLICY documentos_solicitantes_update
ON storage.objects FOR UPDATE
USING (bucket_id = 'documentos-solicitantes')
WITH CHECK (bucket_id = 'documentos-solicitantes');

DROP POLICY IF EXISTS documentos_solicitantes_delete ON storage.objects;
CREATE POLICY documentos_solicitantes_delete
ON storage.objects FOR DELETE
USING (bucket_id = 'documentos-solicitantes');

SELECT 'Storage documentos-solicitantes listo' AS resultado;
