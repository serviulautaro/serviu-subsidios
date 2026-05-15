-- ============================================================
-- ADMINISTRACION DE USUARIOS AUTORIZADOS - SERVIU Subsidios
-- Ejecutar en Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION admin_listar_app_users(p_admin_key text)
RETURNS TABLE(
  id uuid,
  nombre text,
  username text,
  rol text,
  activo boolean,
  debe_cambiar_clave boolean,
  creado timestamptz,
  actualizado timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_admin_key <> '196560' THEN
    RAISE EXCEPTION 'Clave de administrador incorrecta';
  END IF;

  RETURN QUERY
  SELECT u.id, u.nombre, u.username, u.rol, u.activo, u.debe_cambiar_clave, u.creado, u.actualizado
  FROM app_users u
  ORDER BY u.nombre ASC;
END;
$$;

CREATE OR REPLACE FUNCTION admin_crear_app_user(
  p_admin_key text,
  p_nombre text,
  p_username text,
  p_password text,
  p_rol text DEFAULT 'usuario'
)
RETURNS TABLE(id uuid, nombre text, username text, rol text, activo boolean, debe_cambiar_clave boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  nueva_salt text;
  nuevo_id uuid;
BEGIN
  IF p_admin_key <> '196560' THEN
    RAISE EXCEPTION 'Clave de administrador incorrecta';
  END IF;
  IF length(coalesce(p_nombre, '')) < 3 OR length(coalesce(p_username, '')) < 3 THEN
    RAISE EXCEPTION 'Nombre y usuario son obligatorios';
  END IF;
  IF length(coalesce(p_password, '')) < 8 THEN
    RAISE EXCEPTION 'La clave inicial debe tener al menos 8 caracteres';
  END IF;

  nueva_salt := encode(gen_random_bytes(16), 'hex');

  INSERT INTO app_users(nombre, username, password_salt, password_hash, rol, activo, debe_cambiar_clave)
  VALUES (
    trim(p_nombre),
    lower(trim(p_username)),
    nueva_salt,
    encode(digest(nueva_salt || p_password, 'sha256'), 'hex'),
    CASE WHEN lower(coalesce(p_rol, 'usuario')) = 'admin' THEN 'admin' ELSE 'usuario' END,
    true,
    true
  )
  RETURNING app_users.id INTO nuevo_id;

  RETURN QUERY
  SELECT u.id, u.nombre, u.username, u.rol, u.activo, u.debe_cambiar_clave
  FROM app_users u
  WHERE u.id = nuevo_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_estado_app_user(
  p_admin_key text,
  p_user_id uuid,
  p_activo boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_admin_key <> '196560' THEN
    RAISE EXCEPTION 'Clave de administrador incorrecta';
  END IF;

  UPDATE app_users
  SET activo = p_activo,
      actualizado = now()
  WHERE id = p_user_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION admin_eliminar_app_user(
  p_admin_key text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_admin_key <> '196560' THEN
    RAISE EXCEPTION 'Clave de administrador incorrecta';
  END IF;

  UPDATE audit_log
  SET user_id = NULL
  WHERE user_id = p_user_id;

  DELETE FROM app_users
  WHERE id = p_user_id;

  RETURN FOUND;
END;
$$;
