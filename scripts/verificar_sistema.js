const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "src", "App.js");
const serverPath = path.join(root, "server.js");
const pkgPath = path.join(root, "package.json");

const read = (file) => fs.readFileSync(file, "utf8");

const checks = [];
const warnings = [];

function ok(name, condition, detail = "") {
  checks.push({ name, condition: !!condition, detail });
}

function warn(name, condition, detail = "") {
  if (!condition) warnings.push({ name, detail });
}

function contains(text, needle) {
  return text.includes(needle);
}

function regex(text, pattern) {
  return pattern.test(text);
}

function main() {
  const requiredFiles = [appPath, serverPath, pkgPath];
  requiredFiles.forEach((file) => ok(`Existe ${path.relative(root, file)}`, fs.existsSync(file)));

  if (!fs.existsSync(appPath)) throw new Error("No existe src/App.js");

  const app = read(appPath);
  const server = fs.existsSync(serverPath) ? read(serverPath) : "";
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(read(pkgPath)) : {};

  ok("Script verificar disponible en package.json", pkg.scripts && pkg.scripts.verificar === "node scripts/verificar_sistema.js");

  ok("No aparece texto antiguo Control de Subsidios", !contains(app, "Control de Subsidios"));
  ok("No aparece Pitrufquén en App.js", !regex(app, /Pitrufqu[eé]n/i));
  ok("Menu lateral usa nombre oficial del sistema", contains(app, "Sistema de Gestión de Subsidios Habitacionales"));

  ok("Visitas no se vacían ante error de carga", !contains(app, "setVisitas([])"));
  ok("Visitas tienen respaldo interno en solicitudes", contains(app, "__registro_visitas_oficina__"));
  ok("Visitas se fusionan desde tabla y respaldo", contains(app, "fusionarVisitas"));
  ok("Guardar visita no cierra formulario si falla persistencia", contains(app, "evitar pérdida de datos"));
  ok("Guardar visita reintenta con columnas mínimas", contains(app, "[visitas insert retry]"));

  ok("Documentos HTML generados se abren desde respaldo", contains(app, "data:text/html") && contains(app, "setHtmlPreview(html)"));
  ok("Borrar documento limpia respaldo interno", contains(app, "quitarRegistroInterno"));
  ok("Borrar documento limpia solicitud sin borrar otros datos", contains(app, "archivoData: \"\"") && contains(app, "storagePath: \"\""));
  ok("Archivos guardados conservan respaldo data/storage", contains(app, "archivoData: dataUrl") && contains(app, "storagePath"));
  ok("Documentos no pierden archivoData por aligerado", contains(app, "const aliviarDocumento = (doc = {}) => doc"));
  ok("Visor usa archivoData antes que Supabase Storage", contains(app, "dataUrl: d.archivoData || \"\""));
  ok("Visor no descarga documentos desde Supabase", !contains(app, "const abrirDesdeStorage"));
  ok("Carpeta recarga cuando llegan respaldos completos", contains(app, "firmaArchivosSolicitudes") && contains(app, "[carpeta, firmaArchivosSolicitudes]"));
  ok("Carpeta documentos busca rutas historicas registradas", contains(app, "carpetasDocumentosPersona") && contains(app, "carpetasRegistradas") && contains(app, "select=nombre,carpeta,mime_type,data_url") && contains(app, "carpetasBusqueda"));
  ok("Carpeta documentos muestra referencias historicas sin data_url", contains(app, ".filter(d => d.archivo)") && !contains(app, ".filter(d => d.archivo && (d.archivoData || d.storagePath))"));

  ok("Solicitud 2026 usa plantilla oficial", contains(app, "formulario_solicitud_habilitacion_inhabitabilidad_2026.pdf"));
  ok("Carta SERVIU tiene destinatario Marco Seguel", contains(app, "SEÑOR MARCO SEGUEL REYES"));
  ok("Carta SERVIU permite destinatario Otro", contains(app, "<option value=\"otro\">Otro</option>"));

  ok("No hay localStorage.clear", !contains(app, "localStorage.clear"));
  ok("No hay window.location.reload forzado", !contains(app, "window.location.reload"));
  ok("Update backend sin filtros bloqueado", contains(server, "Update sin filtros bloqueado"));
  ok("Rutas de documentos quedan dentro de carpeta documentos", contains(server, "safeDocsPath"));
  ok("Visor prioriza documentos locales sobre Supabase", contains(app, "/archivo-local/") && contains(app, "esUrlSupabaseStorage") && contains(server, "buscarArchivoLocal"));
  ok("Eliminar archivo local mueve a papelera interna", contains(server, "archivarArchivoLocal") && !contains(server, "unlinkSync"));
  ok("Cliente API bloquea update/delete sin filtros", contains(read(path.join(root, "src", "supabaseClient.js")), "sin filtros bloqueado por seguridad"));
  ok("Comités por constituir se reconocen por alias", contains(app, "codigoComitePorConstituir") && contains(app, "falta constituir"));
  ok("Linea de tiempo CSP requiere confirmacion", contains(app, "¿Está seguro de guardar los cambios de la línea de tiempo"));
  ok("Linea de tiempo CSP se guarda en comites", contains(app, "linea_tiempo") && contains(server, "ADD COLUMN IF NOT EXISTS \"linea_tiempo\""));
  ok("Linea de tiempo CSP se guarda por solicitante", contains(app, "Línea de tiempo CSP del solicitante") && contains(server, "ADD COLUMN IF NOT EXISTS \"linea_tiempo_csp\""));
  ok("Linea de tiempo CSP persiste en Render PostgreSQL", contains(app, "/api/db/personas/update") && contains(app, "linea_tiempo_csp") && contains(app, "guardadoRender"));
  ok("Carga principal usa Render antes de respaldo local", contains(app, "fetch(API + \"/api/bootstrap\"") && contains(app, "fetch(API + \"/api/solicitudes") && contains(app, "if (false && !silencioso && !datosBaseListos)"));
  ok("Mensaje de carga no culpa Supabase como base principal", !contains(app, "No se pudieron cargar los datos desde Supabase") && !contains(app, "Supabase no responde. Se muestran datos"));
  ok("Linea de tiempo CSP usa etapas oficiales nuevas", contains(app, "Solicitud de documentos") && contains(app, "Calificación SERVIU") && contains(app, "Ejecución de las obras"));
  ok("Linea de tiempo CSP permite VB por reuniones", contains(app, "_reunion_") && contains(app, "/5 VB"));
  ok("Linea de tiempo CSP corta avance por no califica", contains(app, "lineaTiempoCspCortada") && contains(app, "Avance cortado por No califica"));
  ok("Linea de tiempo CSP exige modificar antes de guardar", contains(app, "Modificar línea de tiempo") && contains(app, "¿Está seguro de guardar los cambios de la línea de tiempo"));
  ok("Nombre de solicitante se normaliza en mayusculas", contains(app, "normalizarNombreSolicitante") && contains(app, "APELLIDOS PRIMERO, LUEGO NOMBRES"));
  ok("Editar ficha desmarque actualiza nombre en solicitudes activas", contains(app, "solicitudesRenombradas") && contains(app, "persona_nombre: nombreNormalizado"));
  ok("Comite desmarque incluye solicitudes habitabilidad aunque falte comite_id", contains(app, "esComiteDesmarqueRef") && contains(app, "(s.programaId || s.programa_id) === \"habitabilidad\""));
  ok("Nuevo solicitante con comite crea solicitud desde flujo unico", contains(app, "crear_solicitud_automatica") && !contains(app, "programaComite && [\"csp_rural\", \"csp_urbano\"].includes(programaComite.id)"));
  ok("Repara solicitudes activas faltantes sin borrar existentes", contains(app, "repararSolicitudesActivasFaltantes") && contains(app, "solicitudActivaEsperada") && contains(app, "/api/db/solicitudes/insert") && contains(app, "normalExistente"));
  ok("VB Respuesta SERVIU exige clave y resultado paso 9", contains(app, "Marcar VB Respuesta SERVIU") && contains(app, "abrirResultadoRespuestaServiuConClave") && contains(app, "confirmarClaveVbDesmarque"));
  ok("Califica para visita persiste en Render", contains(app, "guardarCalificacionDesmarque") && contains(app, "actualizarSolicitudEnDb(sol.id, { documentos, calificacion_desmarque: valor })") && contains(app, "syncPersona({ estado_desmarque: nuevoEstado, estadoDesmarque: nuevoEstado })"));
  ok("Califica para visita no se filtra de la linea", (contains(app, "!usados.has(i) && d?.interno") || contains(app, "extrasFueraPrograma.filter(d => d?.interno)")) && contains(app, "docCalificacionDesmarque"));
  ok("Desmarque usa campos directos en solicitudes Render", contains(server, "calificacion_desmarque") && contains(server, "respuesta_serviu_estado") && contains(app, "calificacion_desmarque") && contains(app, "respuesta_serviu_estado") && contains(app, "respuestaDirecta"));
  ok("Respuesta SERVIU marca VB y estado local robusto", contains(app, "docKey: \"respuesta_serviu\"") && contains(app, "vb: true") && contains(app, "String(p.id) !== String(persona.id)") && contains(app, "estadoDesmarque:       \"estado_desmarque\""));
  ok("Resultado directo marca documento Respuesta SERVIU", contains(app, "aplicarEstadoDirectoDesmarqueSolicitud") && contains(app, "respuestaEstado") && contains(app, "entregado: true") && contains(app, "solicitudDesmarcada ? \"Desmarcado\""));
  ok("Cabecera de solicitante usa estado directo de solicitud desmarque", contains(app, "estadoActualDesmarqueSolicitud") && contains(app, "aplicarEstadoDirectoDesmarqueSolicitud(sol)") && contains(app, "const est = estadoActualDesmarqueSolicitud(solDesmarque, persona);"));
  ok("Estado desmarque siempre sale de pasos 1 a 9", contains(app, "estadoDesdePasosLineaDesmarque") && contains(app, "pasoEstado(9, \"DESMARCADO\", \"Desmarcado\"") && contains(app, "const estadoActualLineaDesmarque = (sol = {}, fallback = \"\") => estadoDesdePasosLineaDesmarque(sol, fallback);") && contains(app, "const estadoActualLineaDesmarqueConManual = (sol = {}, fallback = \"\") => estadoActualLineaDesmarque(sol, fallback);"));
  ok("VB de documentos persiste solicitudes en Render", contains(app, "const marcarDocEntregado") && contains(app, "actualizarDocumentoSolicitud(solId, idx, { entregado }, docBase)") && contains(app, "/api/db/solicitudes/update"));
  ok("Respuesta SERVIU guarda ordinario y fecha en documento real", contains(app, "abrirResultadoRespuestaServiuConClave(sol.id)") && contains(app, "String(s.id) === String(respuestaServiuSolicitudId)") && contains(app, "{ num_ord: e.target.value }, doc") && contains(app, "{ fecha_resp: e.target.value }, doc") && !contains(app, "i2!==i") && !contains(app, "i2 !== i"));
  ok("Documentos visibles faltantes se materializan al marcar", contains(app, "docs.push({ ...docBase, ...patch })") && contains(app, "toggleDoc(sol.id, docIdx, doc)") && contains(app, "marcarDocEntregado(sol.id, docIdx, true, doc)"));
  ok("Renombrar requisito no duplica documento en solicitudes", contains(app, "claveDocumentoPrograma") && contains(app, "fusionarDocumentoPrograma") && contains(app, "documentoProgramaConClave"));
  ok("Cuenta de ahorro no mezcla opciones de discapacidad", contains(app, "esCuentaAhorroNombre ? null") && contains(app, "tipo: null") && contains(app, "bancosCuentaAhorroPermitidos"));
  ok("Cuenta de ahorro guarda usando indice real del documento", contains(app, "i2 !== docIdx ? d2 : { ...d2, valor: newValor }") && !contains(app, "i2 !== i ? d2 : { ...d2, valor: newValor }"));
  ok("Cuenta de ahorro permite escribir numero antes de guardar", contains(app, "cuentaAhorroDrafts") && contains(app, "inputMode=\"numeric\"") && contains(app, "onBlur={async () =>") && contains(app, "guardarCuentaAhorroSolicitud"));
  ok("Programas base editados mantienen todos sus requisitos", contains(app, "completarDocumentosProgramaBase") && contains(app, "completarSolicitudActiva"));
  ok("Solicitudes activas muestran documentos completos sin filtro de indices", contains(app, "const solVistaBase = documentosVista === sol.documentos") && contains(app, "const solVista = aplicarEstadoDirectoDesmarqueSolicitud(solVistaBase)") && contains(app, "const docsVisibles = (solVista.documentos || []).filter((doc) => !doc.interno)") && !contains(app, "visibles.has(i) && !doc.interno"));
  ok("Solicitudes activas muestran solo requisitos oficiales del programa", contains(app, "incluirExtras: false") && contains(app, "informaciones_previas") && contains(app, "antecedentes_vivienda") && contains(app, "indiceDocumentoSolicitud") && contains(app, "candidatos[candidatos.length - 1]"));
  ok("Requisitos exactos sin tipo canonico conservan datos existentes", contains(app, "if (matchDirecto || compatible)"));
  ok("Reparacion materializa requisitos editados en solicitudes existentes sin borrar extras", contains(app, "conservarExtrasComoInternos") && contains(app, "ocultoPorPrograma") && contains(app, "interno: false") && contains(app, "reparar_requisitos_solicitudes_activas") && contains(app, "API + \"/api/db/solicitudes/update\""));
  ok("Conteo solicitudes activas usa todos los documentos visibles del programa", contains(app, "const docsParaConteoSolicitud = (docs = [], programaId = \"\") =>") && contains(app, "(docs || []).filter(d => !d.interno)") && !contains(app, "if (programaId === \"habitabilidad\") return (docs || []).filter(esDocConteoHabitabilidad)") && !contains(app, "if (d.obligatorio === false) return false"));
  ok("Solicitudes activas comparan persona_id y personaId de forma robusta", contains(app, "const esSolicitudDePersona") && contains(app, "const misSols = solicitudes.filter(s => esSolicitudDePersona(s, personaId));") && !contains(app, "const misSols = solicitudes.filter(s => s.personaId === personaId);"));
  ok("Solicitudes activas usan programa_id normalizado para completar requisitos", contains(app, "const solProgramaId = solicitudProgramaId(sol);") && contains(app, "todosProgramas.find(p => p.id === solProgramaId)") && contains(app, "conteoDocumentosSolicitud(solVista.documentos, solProgramaId)"));
  ok("CSP Rural mantiene nueve requisitos oficiales", contains(app, "id: \"csp_rural\"") && contains(app, "Dominio de la propiedad") && contains(app, "Certificado de ruralidad") && contains(app, "Cuenta de ahorro para la vivienda"));
  ok("CSP Rural se normaliza a requisitos oficiales en solicitudes", contains(app, "REQUISITOS_CSP_RURAL_OFICIALES") && contains(app, "normalizarProgramaBaseParaSolicitudes") && contains(app, "completarDocumentosProgramaBase(REQUISITOS_CSP_RURAL_OFICIALES"));
  ok("Solicitudes Render cargan por paginas para evitar 504", contains(app, "pageSizeRender") && contains(app, "/api/solicitudes?") && contains(server, "paginado: tieneRango") && contains(server, "LIMIT $1 OFFSET $2"));
  ok("Solicitudes paginadas evitan ordenamiento pesado por fecha", contains(server, "WITH pagina AS") && contains(server, "FROM pagina") && contains(server, "ORDER BY \"id\" ASC") && !contains(server, "ORDER BY \"fecha\" DESC NULLS LAST, \"id\" ASC"));
  ok("Migraciones de documentos no corren automaticamente en startup", contains(server, "RUN_DOC_MIGRATIONS_ON_STARTUP") && contains(server, "Migraciones pesadas: ejecutar solo bajo demanda"));
  ok("Editar documentos de programa guarda lista exacta en Render", contains(app, "__listaExactaPrograma") && contains(app, "/api/db/programas_custom/upsert") && contains(app, "documentosExactos ? normalizado.documentos"));
  ok("Detalle solicitante permite elegir programa a revisar", contains(app, "Programa a revisar") && contains(app, "solsTrabajo.map"));

  const deleteCalls = [...app.matchAll(/supabase\.from\([^)]+\)\.delete\(\)([^;]+)/g)].map((m) => m[0]);
  deleteCalls.forEach((call, index) => {
    ok(`Delete Supabase ${index + 1} tiene filtro eq`, call.includes(".eq("), call);
  });

  warn(
    "server.js mantiene DELETE FROM actividades",
    !contains(server, "DELETE FROM actividades WHERE personaId"),
    "Existe endpoint antiguo que reemplaza actividades por persona. No afecta visitas, pero revisar si se vuelve a usar actividades."
  );

  const failed = checks.filter((c) => !c.condition);
  console.log("\nVerificación SERVIU Subsidios");
  console.log("================================");
  checks.forEach((c) => {
    console.log(`${c.condition ? "OK " : "ERR"} ${c.name}${c.detail && !c.condition ? `\n    ${c.detail}` : ""}`);
  });

  if (warnings.length) {
    console.log("\nAdvertencias");
    warnings.forEach((w) => console.log(`WARN ${w.name}${w.detail ? `\n    ${w.detail}` : ""}`));
  }

  if (failed.length) {
    console.error(`\nFalló la verificación: ${failed.length} regla(s) crítica(s). No publicar hasta reparar.`);
    process.exit(1);
  }

  console.log("\nVerificación aprobada. Puede continuar con npm run build.");
}

main();
