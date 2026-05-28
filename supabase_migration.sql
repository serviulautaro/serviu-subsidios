-- ============================================================
-- MIGRACIÓN SUPABASE — SERVIU Subsidios
-- Ejecutar en: Dashboard Supabase → SQL Editor → New Query
-- ============================================================

-- 1. TABLA VISITAS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitas (
  id             text PRIMARY KEY,
  persona_id     text REFERENCES personas(id) ON DELETE CASCADE,
  fecha          text,
  profesional    text,
  solicitud      text,
  compromiso     text,
  docs_recibidos text,
  profesional_recibio text,
  creado         timestamptz DEFAULT now()
);

ALTER TABLE visitas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='visitas' AND policyname='allow_all_visitas') THEN
    CREATE POLICY allow_all_visitas ON visitas FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS visitas_persona_id_idx ON visitas(persona_id);


-- 2. COLUMNAS FALTANTES EN PERSONAS (campos de fichas técnicas)
-- --------------------------------------------------------
ALTER TABLE personas ADD COLUMN IF NOT EXISTS dominiopropiedad        text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nfjs                    text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS sistemaagua             text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nservicioagua           text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS proveedorelectrico      text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nclienteelectricidad    text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS certruralidad           text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS avaluofiscal            text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS informacionesprevias    text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS infprevias              text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS antecedentesvivienda    text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS discapacidad            text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS movilidadreducida       text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS credencialdiscapacidad  text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS cuentaahorro            text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS rutcolores              text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS banco                   text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS subsidio_anterior       text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS estadocivil             text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS ahorropostular          text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS adultomayor             text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS cargo_comite            text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS numero_lista            text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS rol                     text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS permisoedificacion      text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS recepciondefinitiva     text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS constructoraseleccionada text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS metrosoriginal          text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS metrosampl              text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS metrosnoregul           text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS totalmetros             text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS modalidadpostulacion    text DEFAULT '';


-- 3. COLUMNA FECHA_VISITA EN SOLICITUDES
-- --------------------------------------------------------
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS fecha_visita text DEFAULT '';


-- 4. VERIFICACIÓN FINAL
-- --------------------------------------------------------
SELECT 'personas columns' AS tabla,
       column_name, data_type
FROM information_schema.columns
WHERE table_name = 'personas'
ORDER BY ordinal_position;

SELECT 'visitas exists' AS check_result, COUNT(*) FROM visitas;
