# Demo SERVIU Subsidios

Esta version demo usa el mismo software, pero no carga ni guarda datos reales de Supabase.

## Caracteristicas

- URL separada recomendada: crear otro servicio web en Render, por ejemplo `serviu-subsidios-demo`.
- Variable de entorno obligatoria en Render: `REACT_APP_DEMO_MODE=true`.
- Comando de build: `npm run build:demo`.
- Comando de inicio: `node server.js`.
- Datos de solicitantes: vacios al iniciar.
- Limite comercial: maximo 5 solicitantes.
- Los datos quedan solo como datos locales demo del navegador que usa la entidad.

## Usuarios demo

- Administrador: `admin.demo`
- Clave: `Demo2026`
- Usuario normal: `usuario.demo`
- Clave: `Demo2026`

## Importante

La demo no debe usar la URL de produccion `https://serviu-subsidios.onrender.com/`.
Debe publicarse como un servicio distinto para ofrecerla a otras entidades patrocinantes sin exponer datos reales.
