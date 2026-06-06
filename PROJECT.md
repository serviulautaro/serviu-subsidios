# SERVIU Subsidios

> Sistema web para gestionar solicitudes, postulaciones, asignaciones y beneficiarios de subsidios habitacionales del SERVIU (JCC).

**Última actualización:** 2026-06-05  
**IA utilizada:** Claude y Codex (ambos leen este archivo antes de tocar código)

---

## Stack & Arquitectura

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Frontend | React (Create React App) | Desplegado en Render |
| Backend/API | Node.js en Render | Expone rutas `/api/db/...` y `/api/rpc/...` |
| Base de datos (DATOS) | PostgreSQL en **Render** | Solicitudes, beneficiarios, etc. (via proxy en supabaseClient.js) |
| Login / Auth | **Supabase** ⚠️ | El inicio de sesión TODAVÍA usa Supabase (`realSupabase.auth`) — NO BORRAR |
| Hosting/Deploy | Render | URL: serviu-subsidios-demo.onrender.com |
| Repositorio | GitHub | serviulautaro/serviu-subsidios |
| Entorno local | VS Code | C:\Users\JORGE\Desktop\serviu-subsidios |

### ⚠️ Importante: la migración quedó a medias
- Los **DATOS** (tablas: solicitudes, beneficiarios, etc.) → ya están en **Render**
- El **LOGIN/AUTH** (inicio de sesión de usuarios) → TODAVÍA usa **Supabase**
- Por eso `supabaseClient.js` mantiene la conexión `realSupabase` viva: la usa SOLO para `auth`
- **NO borrar la conexión a Supabase** hasta que el login se mueva a Render (tarea pendiente)

### Flujo de trabajo
```
VS Code (edición) → git push → GitHub → Render (deploy automático)
```

### Cómo funciona la conexión a la base de datos
- El frontend NO se conecta directo a PostgreSQL
- `src/supabaseClient.js` tiene un flag `USE_API_DB`:
  - `true` (por defecto) → usa `makeProxyClient()` → llama a `/api/db/<tabla>/...` en Render (PRODUCCIÓN)
  - `false` → usa `demoSupabase` → datos locales de prueba (DESARROLLO SIN INTERNET)
- El flag se controla con la variable `REACT_APP_USE_API_DB` (si no existe, vale `true`)
- No existe archivo `.env` — las credenciales están escritas en `src/supabaseClient.js`
- La `SUPABASE_KEY` que aparece en el archivo es la "anon key" (diseñada para ser pública), pero igual conviene moverla a un `.env` más adelante
- ⚠️ **Nunca subir credenciales reales (privadas) a GitHub**

### Estructura de carpetas real
```
serviu-subsidios/
├── public/
├── src/
│   ├── components/
│   │   ├── ComitesVivienda.jsx   (20 KB)
│   │   └── InformesView.jsx      (79 KB)
│   ├── App.js                    (732 KB — contiene casi todo el sistema)
│   ├── ComitesVivienda.jsx       (copia en raíz de src)
│   ├── supabaseClient.js         (cliente DB — DATOS→Render, AUTH→Supabase)
│   └── demoSupabaseClient.js     (datos demo para pruebas)
├── build/                        (generado por npm run build)
├── docs/
├── documentos/
├── respaldos/
├── scripts/
├── package.json
└── PROJECT.md                    ← este archivo
```

### ⚠️ Problema conocido — App.js gigante
- `App.js` tiene más de 7.000 líneas y pesa 732 KB
- Esto causa lentitud, errores difíciles de encontrar y conflictos con Claude/Codex
- **No tocar la estructura de App.js sin planificar primero**
- **No agregar más código a App.js** — siempre crear un componente separado

### ⚠️ Archivos sueltos por revisar (en la raíz del proyecto)
- Existen archivos con nombres raros en la raíz: `((`, `a version funcional`, `programa`, `pm2`
- Posiblemente creados por error al escribir mal comandos en la terminal
- **No borrar todavía** — revisar uno por uno antes de limpiar

---

## Módulos del Sistema

1. **Solicitudes** — Registro de nuevas solicitudes de subsidio
2. **Beneficiarios** — Registro y consulta de personas beneficiarias
3. **Postulaciones** — Gestión del proceso de postulación
4. **Asignaciones** — Control de subsidios asignados
5. **Comités de Vivienda** — Gestión de comités (`ComitesVivienda.jsx`)
6. **Informes** — Reportes y vistas de datos (`InformesView.jsx`)

---

## Convenciones de Código

### Naming
- Variables y funciones: `camelCase`
- Componentes React: `PascalCase`
- Archivos de componentes: `PascalCase.jsx`
- Archivos de servicios/utils: `camelCase.js`

### Patrones usados
- Componentes funcionales con hooks (no clases)
- Estado local con `useState`, efectos con `useEffect`
- Llamadas a DB siempre a través de `supabase` exportado desde `supabaseClient.js`

### Lo que NO hacer
- No conectarse directo a PostgreSQL desde el frontend — siempre usar `supabaseClient.js`
- No agregar más código a `App.js` sin consultar primero
- No subir credenciales ni tokens a GitHub
- **No borrar la conexión a Supabase** (`realSupabase`) — el login todavía la usa

---

## Decisiones Técnicas

### 2026-06-05 — El login se queda en Supabase (por ahora)
**Contexto:** Al migrar la DB a Render, los datos se movieron pero el login (auth) se quedó en Supabase  
**Decisión:** Dejar el login en Supabase por ahora; NO tocarlo porque funciona  
**Razón:** Mover el login es riesgoso y el sistema está en producción; primero estabilizar lo demás  
**Consecuencias:** `supabaseClient.js` mantiene `realSupabase` activo solo para `auth`. Queda como tarea pendiente mover el login a Render más adelante.

### 2026-06-04 — Migración de Supabase a Render
**Contexto:** La DB estaba en Supabase; se migró a PostgreSQL en Render  
**Decisión:** Crear un proxy client en `supabaseClient.js` que imita la API de Supabase pero llama a `/api/db/...` en Render  
**Razón:** Permite cambiar el backend sin reescribir todo el código que ya usaba Supabase  
**Consecuencias:** El código de DATOS parece usar Supabase pero en realidad apunta a Render; no hay `.env`. El login sí sigue en Supabase.

### 2026-06-04 — Todo el sistema en App.js
**Contexto:** El sistema creció sin separar en módulos  
**Decisión:** Por ahora no refactorizar — demasiado riesgo de romper algo  
**Razón:** Usuario principiante, sistema en producción  
**Consecuencias:** App.js tiene 7.000+ líneas; cambios deben ser muy específicos y quirúrgicos

---

## Errores Resueltos

> (agregar aquí cada vez que se resuelva un bug)

---

## Estado Actual

**En progreso:**
- [ ] Verificar que los 6 módulos estén funcionales en producción

**Completado:**
- [x] Deploy en Render funcionando
- [x] Repositorio GitHub configurado
- [x] Flujo git push → deploy automático operativo
- [x] Migración de DATOS de Supabase a Render completada
- [x] PROJECT.md inicializado con contexto real del proyecto
- [x] Aclarado que el LOGIN todavía usa Supabase (2026-06-05)

**Deuda técnica (no urgente pero importante):**
- [ ] **Mover el login/auth de Supabase a Render** (decidido el 2026-06-05: hacerlo más adelante)
- [ ] Dividir App.js en módulos separados (actualmente 7.000+ líneas)
- [ ] Crear archivo `.env` para manejar credenciales correctamente
- [ ] Revisar y limpiar archivos sueltos raros en la raíz (`((`, `a version funcional`, `programa`, `pm2`)

---

## Instrucciones para IA

> **LEER ESTO ANTES DE GENERAR CUALQUIER CÓDIGO**

1. El usuario es principiante — instrucciones simples, paso a paso, sin jerga
2. Flujo: editar en VS Code → `git push` → deploy automático en Render
3. **No sugerir cambiar el stack** sin preguntar primero
4. Los DATOS están en PostgreSQL en Render — se accede via proxy en `src/supabaseClient.js`
5. El LOGIN/AUTH todavía está en Supabase — **NO borrar la conexión `realSupabase`**
6. **No agregar código a App.js** — es demasiado grande; proponer siempre un componente separado
7. Antes de proponer solución a un bug, revisar "Errores Resueltos"
8. Al terminar cambios, recordar al usuario actualizar este PROJECT.md
9. Siempre indicar **en qué archivo exacto** hacer cada cambio

---

## Bloque de Inicio de Sesión

> Copiar y pegar al comenzar con Claude o Codex en sesión nueva:

```
PROYECTO: SERVIU Subsidios — gestión de subsidios habitacionales (JCC)
STACK: React (CRA) + PostgreSQL en Render + API proxy en Render
REPO: serviulautaro/serviu-subsidios
LOCAL: C:\Users\JORGE\Desktop\serviu-subsidios
DEPLOY: git push → Render automático → serviu-subsidios-demo.onrender.com
DB DATOS: PostgreSQL en Render (via proxy en src/supabaseClient.js, USE_API_DB=true)
DB LOGIN/AUTH: todavía en Supabase (realSupabase.auth) — NO BORRAR
ARCHIVO PRINCIPAL: src/App.js (7000+ líneas — NO agregar código ahí, crear componente separado)
MÓDULOS: Solicitudes, Beneficiarios, Postulaciones, Asignaciones, Comités, Informes
USUARIO: principiante — instrucciones simples y paso a paso
REGLAS: 1) No cambiar el stack sin preguntar. 2) Indicar siempre en qué archivo exacto hacer cada cambio. 3) Antes de proponer solución a un bug, revisar "Errores Resueltos" en PROJECT.md. 4) Al terminar cambios, recordar actualizar PROJECT.md. 5) NO borrar la conexión a Supabase (el login la usa).
LEER el archivo PROJECT.md para decisiones técnicas y errores resueltos.
```
