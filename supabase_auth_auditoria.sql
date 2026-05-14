-- ============================================================
-- AUTENTICACION Y AUDITORIA - SERVIU Subsidios
-- Ejecutar en Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  username text UNIQUE NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  rol text NOT NULL DEFAULT 'usuario',
  activo boolean NOT NULL DEFAULT true,
  debe_cambiar_clave boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_users(id),
  usuario text,
  accion text NOT NULL,
  entidad text,
  entidad_id text,
  detalle jsonb DEFAULT '{}'::jsonb,
  creado timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_app_users ON app_users;
CREATE POLICY deny_direct_app_users ON app_users FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS allow_insert_audit ON audit_log;
CREATE POLICY allow_insert_audit ON audit_log FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS allow_select_audit ON audit_log;
CREATE POLICY allow_select_audit ON audit_log FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION login_app_user(p_username text, p_password text)
RETURNS TABLE(id uuid, nombre text, username text, rol text, debe_cambiar_clave boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.nombre, u.username, u.rol, u.debe_cambiar_clave
  FROM app_users u
  WHERE lower(u.username) = lower(trim(p_username))
    AND u.activo = true
    AND u.password_hash = encode(digest(u.password_salt || p_password, 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION cambiar_clave_app_user(p_user_id uuid, p_actual text, p_nueva text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  nueva_salt text;
BEGIN
  IF length(coalesce(p_nueva, '')) < 8 THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_users u
    WHERE u.id = p_user_id
      AND u.activo = true
      AND u.password_hash = encode(digest(u.password_salt || p_actual, 'sha256'), 'hex')
  ) THEN
    RETURN false;
  END IF;

  nueva_salt := encode(gen_random_bytes(16), 'hex');

  UPDATE app_users
  SET password_salt = nueva_salt,
      password_hash = encode(digest(nueva_salt || p_nueva, 'sha256'), 'hex'),
      debe_cambiar_clave = false,
      actualizado = now()
  WHERE id = p_user_id;

  INSERT INTO audit_log(user_id, usuario, accion, entidad, entidad_id, detalle)
  SELECT id, nombre, 'cambio_clave', 'app_users', id::text, '{"resultado":"ok"}'::jsonb
  FROM app_users
  WHERE id = p_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_auditoria(
  p_user_id uuid,
  p_accion text,
  p_entidad text,
  p_entidad_id text,
  p_detalle jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_log(user_id, usuario, accion, entidad, entidad_id, detalle)
  SELECT u.id, u.nombre, p_accion, p_entidad, p_entidad_id, coalesce(p_detalle, '{}'::jsonb)
  FROM app_users u
  WHERE u.id = p_user_id AND u.activo = true;
END;
$$;

INSERT INTO app_users(nombre, username, password_salt, password_hash, rol, activo, debe_cambiar_clave)
VALUES
  ('Marcelo Cifuentes Vasquez', 'marcelo.cifuentes', 'febf9044e1b22a7a9e93d33bbdff9213', '4c3b9ed937cebebb3cb1326eb88642a871080bec5ac32270036ce698e39c3b9a', 'usuario', true, true),
  ('Jacqueline Ortega', 'jacqueline.ortega', '12e5262ce35efec1c8833b6c2adfbaf3', 'ac7e6fb5554aeccc8e2c26332864ad74269d47609d123837026895bca5625efc', 'usuario', true, true),
  ('Priscilla Curin Castro', 'priscilla.curin', '8141d3cd3471b079a9356db45cda196a', 'fb9c8e2d6e6127ef9d428d2ffb2a67998f1498c88513ad3c32cd6f9782ed9763', 'usuario', true, true),
  ('Jonathan Rodriguez', 'jonathan.rodriguez', 'a5e80f9eb67aae411e591f6ca4e5abf5', '560064cea80a12810187d6c37cf05ba723026b1cdfea448480896561fe931e8e', 'usuario', true, true),
  ('Onoria Retamal', 'onoria.retamal', 'c3595cb9d59c1367d445172829083089', '2b01d259512fc3e25b36959f45dcfa4a5d042b71856172d44ad15cf6ce1414a7', 'usuario', true, true),
  ('Jorge Campos Campos', 'jorge.campos', 'f623de85221a4e472c06f2078404615f', 'b0847c0d4574aebd479d1f601c8d5699a3447c19c89ab4517ddf4be945581118', 'admin', true, true)
ON CONFLICT (username) DO NOTHING;
