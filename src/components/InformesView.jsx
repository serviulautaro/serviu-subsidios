import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const API_BASE = (typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname))
  ? window.location.origin
  : "http://localhost:3001";

const PROGRAMAS_META_BASE = [
  { id: "habitabilidad", nombre: "Habitabilidad de Vivienda (Desmarque de Vivienda)", descripcion: "Desmarque", color: "#2563EB", colorLight: "#EFF6FF", icon: "H" },
  { id: "csp_urbano", nombre: "Construccion Sitio Propio Urbano", descripcion: "Subsidio de construccion en sitio propio - zona urbana", color: "#059669", colorLight: "#ECFDF5", icon: "U" },
  { id: "csp_rural", nombre: "Construccion Sitio Propio Rural", descripcion: "Subsidio de construccion en sitio propio - zona rural", color: "#D97706", colorLight: "#FFFBEB", icon: "R" },
  { id: "mave_rural", nombre: "Programa de Mejoramiento de Vivienda Rural y Ampliacion de Vivienda Existente (MAVE)", descripcion: "Mejoramiento y ampliacion de vivienda rural existente", color: "#7C3AED", colorLight: "#F5F3FF", icon: "M" },
  { id: "ampliacion_vivienda", nombre: "Programa Ampliacion de la Vivienda", descripcion: "Ampliacion de vivienda existente", color: "#0F766E", colorLight: "#CCFBF1", icon: "AV" },
  { id: "mejoramiento_termico", nombre: "Programa Mejoramiento Termico", descripcion: "Mejoramiento termico de vivienda", color: "#EA580C", colorLight: "#FFF7ED", icon: "MT" },
  { id: "mejoramiento_electrico", nombre: "Programa Mejoramiento Electrico", descripcion: "Mejoramiento electrico de vivienda", color: "#CA8A04", colorLight: "#FEFCE8", icon: "ME" },
  { id: "colector_solar", nombre: "Programa Colector Solar", descripcion: "Sistema de colector solar para vivienda", color: "#0284C7", colorLight: "#E0F2FE", icon: "CS" },
];

function combinarProgramasMeta(programasCustom = []) {
  const porId = new Map(PROGRAMAS_META_BASE.map(p => [p.id, { ...p }]));
  (programasCustom || []).forEach(p => {
    if (!p?.id) return;
    const base = porId.get(p.id) || {};
    porId.set(p.id, {
      ...base,
      ...p,
      colorLight: p.colorLight || p.colorlight || base.colorLight || "#F9FAFB",
      icon: p.icon || base.icon || "P",
    });
  });
  return Array.from(porId.values());
}

const PROGRAMAS = {
  habitabilidad: "Habitabilidad de Vivienda (Desmarque de Vivienda)",
  csp_rural: "Construcción Sitio Propio Rural",
  csp_urbano: "Construcción Sitio Propio Urbano",
};

const COMITES_BASE = [
  { codigo: "gr1R", nombre: "Comite de Vivienda Rural Mi Nuevo Hogar", familias: 30, tipo: "Rural", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curin Castro", pj: "P.J. 376054", venc: "Venc. 07/02/2028", directiva: [{ rol: "Presidente", nombre: "Juan Perez Gonzalez" }, { rol: "Secretario", nombre: "Carlos Hernan Paillaleo Paillaleo" }, { rol: "Tesorero", nombre: "Elias Fernando Apablaza Riffo" }, { rol: "1er Director", nombre: "Juan Carlos Huenchuan Mendez" }] },
  { codigo: "gr2R", nombre: "Comite de Vivienda Rural La Fuerza", familias: 30, tipo: "Rural", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.", pj: "P.J. 379826", venc: "Venc. 14/05/2028", directiva: [{ rol: "Presidente", nombre: "Liber Omar Cancino Campos" }, { rol: "Vicepresidente", nombre: "Orfelina Leonor Inostroza Burgos" }, { rol: "Secretario", nombre: "Alejandra Maribel Lefian Silva" }, { rol: "Tesorero", nombre: "Mirta Rosa Martin Vallejos" }, { rol: "1er Director", nombre: "Luis Fernando Sanchez Llancamil" }] },
  { codigo: "gr3R", nombre: "Comite de Vivienda Rural Kume Ruka", familias: 29, tipo: "Rural", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.", pj: "En tramite", venc: "-", directiva: [{ rol: "Presidente", nombre: "Rosa Llancapan Liempe" }, { rol: "Vicepresidente", nombre: "Maria Angelica Antinao Liempe" }, { rol: "Secretario", nombre: "Elias Rivas Espinoza" }, { rol: "Tesorero", nombre: "Monica Maribel Rubilar Antilaf" }, { rol: "1er Director", nombre: "Juan Miguel Tripainan Huenulao" }] },
  { codigo: "gr4R", nombre: "Comite de Vivienda Rural Newen Mapu", familias: 26, tipo: "Rural", constructora: "Falta Licitar", profesional: "Priscilla Curin Castro", pj: "-", venc: "-", directiva: [] },
  { codigo: "gr5R", nombre: "Comite de Vivienda Rural Kimey Ruca", familias: 28, tipo: "Rural", constructora: "Falta Licitar", profesional: "Jacqueline Ortega B.", pj: "-", venc: "-", directiva: [] },
  { codigo: "gr6R", nombre: "Comite de Vivienda Rural Por Constituir", familias: 25, tipo: "Rural", constructora: "Falta Licitar", profesional: "Priscilla Curin Castro", pj: "-", venc: "-", directiva: [] },
  { codigo: "gr1U", nombre: "Comite de Vivienda Urbano Pioneros de Lautaro", familias: 30, tipo: "Urbano", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curin Castro", pj: "P.J. 379720", venc: "Venc. 08/05/2028", directiva: [{ rol: "Presidente", nombre: "Luis Armando Espinoza Mendoza" }, { rol: "Vicepresidente", nombre: "Tomas Salvador Diaz Barrientos" }, { rol: "Secretario", nombre: "Margot Leticia Contreras Marquez" }, { rol: "Tesorero", nombre: "Iris del Carmen Godoy Morales" }, { rol: "1er Director", nombre: "Domingo Antonio Bucarey Torres" }] },
  { codigo: "gr2U", nombre: "Comite de Vivienda Urbano Por Constituir", familias: 8, tipo: "Urbano", constructora: "Falta Licitar", profesional: "Jacqueline Ortega B.", pj: "-", venc: "-", directiva: [] },
];

function norm(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function v(value, fallback = "-") {
  return value === 0 || (value && value.toString().trim()) ? value : fallback;
}

function rutKey(rut) {
  return (rut || "").toString().toLowerCase().replace(/[^0-9k]/g, "");
}

function formatRut(rut) {
  const clean = (rut || "").replace(/[^0-9kK]/g, "");
  if (clean.length < 2) return clean;
  const dv = clean.slice(-1).toUpperCase();
  const num = clean.slice(0, -1);
  return `${num.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

function validarRutChileno(rut) {
  const clean = (rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length < 8 || clean.length > 9) return false;
  const cuerpo = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === esperado;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function programaId(sol) {
  return sol?.programaId || sol?.programa_id || "";
}

function programaNombre(id, programas = PROGRAMAS_META_BASE) {
  return programas.find(p => p.id === id)?.nombre || PROGRAMAS[id] || id || "Programa";
}

function mergeComites(comitesSupa = []) {
  const base = COMITES_BASE.map(c => ({ ...c }));
  const usados = new Set(base.map(c => norm(c.nombre)));
  let nextR = base.filter(c => c.tipo === "Rural").length + 1;
  let nextU = base.filter(c => c.tipo === "Urbano").length + 1;

  (comitesSupa || []).forEach(sc => {
    if (!sc?.nombre) return;
    const existente = base.find(c => norm(c.nombre) === norm(sc.nombre));
    if (existente) {
      const directivaSupa = Array.isArray(sc.directiva) ? sc.directiva.filter(d => d?.rol || d?.cargo || d?.nombre) : [];
      existente.id = sc.id || existente.id;
      existente.programaId = sc.programaId || sc.programa_id || existente.programaId;
      existente.familias = Number(sc.familias || sc.cantidad_familias || existente.familias || 0);
      existente.tipo = sc.tipo || existente.tipo;
      existente.constructora = sc.constructora || sc.descripcion || existente.constructora;
      existente.profesional = sc.profesional || existente.profesional;
      existente.pj = sc.pj || sc.personalidad_juridica || existente.pj;
      existente.venc = sc.venc || sc.vencimiento || existente.venc;
      if (directivaSupa.length) existente.directiva = directivaSupa;
      return;
    }
    if (usados.has(norm(sc.nombre))) return;
    // Si el nombre nuevo de Supabase es una variante de uno base (ej: mayúsculas), ignorar
    const nsc = norm(sc.nombre);
    const esVarianteBase = COMITES_BASE.some(b => {
      const nb = norm(b.nombre);
      // Mismo inicio (primeras 15 chars) o contiene las mismas palabras clave
      return nsc.startsWith(nb.slice(0, 15)) || nb.startsWith(nsc.slice(0, 15));
    });
    if (esVarianteBase) return;
    const texto = `${sc.programaId || ""} ${sc.programa_id || ""} ${sc.tipo || ""} ${sc.nombre || ""}`.toUpperCase();
    const tipo = texto.includes("URBANO") ? "Urbano" : "Rural";
    const codigo = tipo === "Urbano" ? `gr${nextU++}U` : `gr${nextR++}R`;
    base.push({
      id: sc.id,
      codigo,
      nombre: sc.nombre,
      programaId: sc.programaId || sc.programa_id || "",
      familias: Number(sc.familias || sc.cantidad_familias || 0),
      tipo,
      constructora: sc.descripcion || sc.constructora || "-",
      profesional: sc.profesional || "-",
      pj: sc.pj || sc.personalidad_juridica || "-",
      venc: sc.venc || sc.vencimiento || "-",
      directiva: sc.directiva || [],
    });
    usados.add(norm(sc.nombre));
  });

  return base;
}

// Filtra comités de prueba y duplicados para los selectores de informes
function filtrarComitesValidos(lista = []) {
  const palabrasExcluir = ["prueba", "test", "demo", "borrar", "eliminar", "temporal"];
  const vistos = new Set();
  return lista.filter(c => {
    if (!c?.nombre) return false;
    const n = norm(c.nombre);
    // Excluir comités de prueba/temporales
    if (palabrasExcluir.some(p => n.includes(p))) return false;
    // Excluir duplicados por nombre normalizado
    if (vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

function personaEnComite(persona, comite) {
  return persona?.comiteId === comite.codigo ||
    persona?.comiteId === comite.id ||
    norm(persona?.comite) === norm(comite.nombre);
}

function miembrosComite(comite, personas) {
  return (personas || [])
    .filter(p => personaEnComite(p, comite))
    .sort((a, b) => norm(a?.nombre).localeCompare(norm(b?.nombre), "es"));
}

function programaComite(comite) {
  if (comite?.programaId || comite?.programa_id) return comite.programaId || comite.programa_id;
  if (comite?.tipo === "Urbano") return "csp_urbano";
  if (comite?.tipo === "Rural") return "csp_rural";
  return "";
}

function comitesPrograma(comites, programa) {
  const id = programa?.id || "";
  return (comites || []).filter(c => {
    const pid = programaComite(c);
    if (pid === id) return true;
    if (!pid && id === "csp_rural" && c.tipo === "Rural") return true;
    if (!pid && id === "csp_urbano" && c.tipo === "Urbano") return true;
    return false;
  });
}

function personasRelacionadas(persona, personas = []) {
  const rk = rutKey(persona?.rut);
  const nk = norm(persona?.nombre);
  return (personas || []).filter(p => {
    if (rk && rutKey(p.rut) === rk) return true;
    return !rk && nk && norm(p.nombre) === nk;
  });
}

function solPersonasRelacionadas(persona, solicitudes = [], personas = []) {
  const relacionadas = personasRelacionadas(persona, personas);
  const ids = new Set((relacionadas.length ? relacionadas : [persona]).map(p => p?.id).filter(Boolean));
  return (solicitudes || []).filter(s => ids.has(s.personaId) || ids.has(s.persona_id));
}

function programasDisponiblesPersona(persona, solicitudes = [], personas = []) {
  const ids = new Set(solPersonasRelacionadas(persona, solicitudes, personas).map(programaId).filter(Boolean));
  const relacionadas = personasRelacionadas(persona, personas);
  const base = relacionadas.length ? relacionadas : [persona];

  base.forEach(p => {
    const texto = `${p?.comiteId || ""} ${p?.comite || ""} ${p?.tipo_comite || ""} ${p?.tipoComite || ""}`.toUpperCase();
    if (p?.comiteId === "comite_desmarque" || texto.includes("DESMARQUE")) ids.add("habitabilidad");
    if (texto.includes("RURAL")) ids.add("csp_rural");
    if (texto.includes("URBANO")) ids.add("csp_urbano");
  });

  return [...ids].map(id => ({ id, nombre: programaNombre(id) }));
}

function docsSolicitud(sol) {
  return Array.isArray(sol?.documentos) ? sol.documentos : [];
}

function docNombreNorm(doc) {
  return (doc?.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function docTieneValor(doc) {
  return !!((doc?.valor || "").toString().trim() || doc?.entregado || doc?.estado === "completo" || doc?.vb || doc?.archivo || doc?.url);
}

function documentoCompleto(doc, docs) {
  if (!docs || !Array.isArray(docs)) docs = Array.isArray(doc?._docsContext) ? doc._docsContext : [];
  if (docTieneValor(doc)) return true;
  const n = docNombreNorm(doc);
  if (n.includes("fecha de nacimiento")) {
    return docs.some(d => {
      const dn = docNombreNorm(d);
      const partes = String(d.valor || "").split("|");
      return dn.includes("cedula") && partes[1] && partes[1].trim().length === 10;
    });
  }
  if (n.includes("titulo") || n.includes("dominio")) {
    return docs.some(d => {
      const dn = docNombreNorm(d);
      return (dn.includes("titulo") || dn.includes("dominio")) && docTieneValor(d);
    });
  }
  return false;
}

function solicitudFiltrada(persona, solicitudes, personas, programaFiltro) {
  const sols = solPersonasRelacionadas(persona, solicitudes, personas);
  if (!programaFiltro || programaFiltro === "todos") return sols;
  return sols.filter(s => programaId(s) === programaFiltro);
}

function estadisticasDocs(sols) {
  const docs = sols.flatMap(sol => docsSolicitud(sol).map(doc => ({ ...doc, _docsContext: docsSolicitud(sol) })));
  const total = docs.length;
  const completos = docs.filter(documentoCompleto).length;
  const faltanObligatorios = docs.filter(d => d?.obligatorio && !documentoCompleto(d)).length;
  const opcionalesPendientes = docs.filter(d => !d?.obligatorio && !documentoCompleto(d)).length;
  return { total, completos, faltanObligatorios, opcionalesPendientes };
}

function imprimirVentana(titulo, html) {
  const w = window.open("", "_blank");
  if (!w) return;
  const firma = `<div class="firma-footer">PROPIETARO DEL SOFTWEARE JORGE ANTONIO CAMPOS CAMPOS</div>`;
  const htmlConEncabezado = agregarEncabezadoInstitucional(html);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>${estilosImpresion()}</head><body><div class="print-actions"><button onclick="window.print()">Imprimir</button></div>${htmlConEncabezado}${firma}</body></html>`);
  w.document.close();
  w.focus();
}

function encabezadoInstitucionalHtml() {
  const logos = typeof window !== "undefined" ? window.SERVIU_LOGOS || {} : {};
  const logoMuni = logos.muni ? `<img src="${logos.muni}" alt="Municipalidad de Lautaro">` : "";
  const logoVivienda = logos.vivienda ? `<img src="${logos.vivienda}" alt="Unidad de Vivienda Lautaro">` : "";
  return `<div class="institutional-header">
    <div class="institutional-logo">${logoMuni}</div>
    <div class="institutional-title">
      <h1>Ilustre Municipalidad de Lautaro</h1>
      <div class="institutional-line"></div>
      <h2>Unidad de Vivienda Municipalidad de Lautaro</h2>
      <p>Entidad Patrocinante</p>
    </div>
    <div class="institutional-logo">${logoVivienda}</div>
  </div>`;
}

function agregarEncabezadoInstitucional(html) {
  const header = encabezadoInstitucionalHtml();
  if (!html || !html.includes('<div class="page">')) return `${header}${html || ""}`;
  return html.split('<div class="page">').join(`<div class="page">${header}`);
}

function formatFechaHora(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("es-CL");
  } catch {
    return value;
  }
}

function accionTexto(accion, detalle = {}) {
  const tabla = detalle?.tabla || "";
  if (accion === "api_insert" || accion === "api_upsert") {
    if (tabla === "personas") return "Solicitante guardado";
    if (tabla === "solicitudes") return "Solicitud guardada";
    if (tabla === "archivos_solicitante") return "Documento guardado";
  }
  if (accion === "api_update") {
    if (tabla === "personas") return "Solicitante actualizado";
    if (tabla === "solicitudes") return "Solicitud/documentos actualizados";
    if (tabla === "archivos_solicitante") return "Documento actualizado";
  }
  if (accion === "api_delete") {
    if (tabla === "archivos_solicitante") return "Documento enviado a papelera";
    if (tabla === "personas") return "Solicitante eliminado";
    if (tabla === "solicitudes") return "Solicitud eliminada";
  }
  const map = {
    ingreso_sistema: "Ingreso al sistema",
    cambio_clave: "Cambio de clave",
    crear_solicitante: "Creacion de solicitante",
    actualizar_solicitantes: "Actualizacion de solicitantes",
    crear_solicitud_automatica: "Solicitud automatica creada",
    subir_documento: "Documento subido",
    guardar_solicitudes: "Solicitud/documentos guardados",
    guardar_comites: "Comites guardados",
    crear_programa: "Programa creado",
    actualizar_programa: "Programa actualizado",
    eliminar_programa: "Programa eliminado",
    registrar_visita: "Visita registrada",
    mover_solicitante: "Solicitante movido",
    guardar_linea_tiempo_solicitante_csp: "Linea de tiempo CSP guardada",
    api_insert: "Registro creado",
    api_upsert: "Registro guardado",
    api_update: "Registro actualizado",
    api_delete: "Registro eliminado",
    crear_usuario_autorizado: "Usuario autorizado creado",
    bloquear_usuario_autorizado: "Usuario autorizado bloqueado",
    desbloquear_usuario_autorizado: "Usuario autorizado desbloqueado",
    eliminar_usuario_autorizado: "Usuario autorizado eliminado",
  };
  return map[accion] || accion || "-";
}

function detalleAuditoria(detalle, accion = "") {
  if (!detalle) return "";
  if (typeof detalle === "string") return detalle;
  if (detalle.accion_descripcion) return detalle.accion_descripcion;
  if (detalle.resumen) return detalle.resumen;
  if (accion === "guardar_linea_tiempo_solicitante_csp") {
    const solicitante = detalle.solicitante || detalle.persona || "";
    if (detalle.no_califica) {
      return `${solicitante ? solicitante + " " : ""}no califica en ${detalle.etapa_no_califica || "linea de tiempo CSP"} por: ${detalle.nota_no_califica || "Sin nota registrada"}`.trim();
    }
    const etapas = Array.isArray(detalle.marcadas) ? detalle.marcadas.join(", ") : "";
    return [
      solicitante ? `Solicitante: ${solicitante}` : "",
      etapas ? `Etapas marcadas: ${etapas}` : "Linea de tiempo CSP actualizada",
    ].filter(Boolean).join(" | ");
  }
  if (accion === "subir_documento") {
    const doc = detalle.archivo || detalle.documento || detalle.nombreArchivo || detalle.nombre_archivo || "";
    const solicitante = detalle.solicitante || detalle.persona || "";
    const carpeta = detalle.carpeta || detalle.tipo || "";
    return [
      doc ? `Documento subido: ${doc}` : "",
      solicitante ? `Solicitante: ${solicitante}` : "",
      carpeta ? `Carpeta: ${carpeta}` : "",
    ].filter(Boolean).join(" | ");
  }
  if (accion === "actualizar_solicitantes") {
    const cambios = Array.isArray(detalle.cambios) ? detalle.cambios.join("; ") : (detalle.resumen || "");
    return cambios ? `Actualizacion realizada: ${cambios}` : "";
  }
  if (accion === "guardar_solicitudes") {
    const docs = Array.isArray(detalle.documentos) ? detalle.documentos.join("; ") : (detalle.resumen || detalle.documento || "");
    return [
      detalle.programa ? `Programa: ${detalle.programa}` : "",
      docs ? `Solicitud/documentos: ${docs}` : "",
    ].filter(Boolean).join(" | ");
  }
  if (["api_insert", "api_upsert", "api_update", "api_delete"].includes(accion)) {
    return [
      detalle.solicitante ? `Solicitante: ${detalle.solicitante}` : "",
      detalle.documento ? `Documento: ${detalle.documento}` : "",
      detalle.programa ? `Programa: ${detalle.programa}` : "",
      detalle.tabla ? `Tabla: ${detalle.tabla}` : "",
      detalle.cantidad ? `Registros: ${detalle.cantidad}` : "",
      Array.isArray(detalle.campos) && detalle.campos.length ? `Campos: ${detalle.campos.join(", ")}` : "",
      Array.isArray(detalle.ids) && detalle.ids.length ? `IDs: ${detalle.ids.join(", ")}` : "",
    ].filter(Boolean).join(" | ");
  }
  const partes = [];
  Object.entries(detalle || {}).forEach(([k, val]) => {
    if (val === undefined || val === null || val === "") return;
    partes.push(`${k}: ${typeof val === "object" ? JSON.stringify(val) : val}`);
  });
  return partes.join(" | ");
}

function solicitanteAuditoria(log) {
  const d = log.detalle || {};
  if (typeof d === "string") return "";
  return d.solicitante || d.persona || d.nombre || d.personaNombre || d.persona_nombre || d.postulante || "";
}

function imprimirAuditoria(fechaInicio, fechaTermino, logs, usuarioFiltro = "Todos los usuarios") {
  const grupos = logs.reduce((acc, log) => {
    const usuario = log.usuario || "Usuario no identificado";
    if (!acc[usuario]) acc[usuario] = [];
    acc[usuario].push(log);
    return acc;
  }, {});
  const html = `<div class="page">
    <div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe de auditoria</h1><div class="muted">Desde: ${fechaInicio} - Hasta: ${fechaTermino}</div><div class="muted">Usuario: ${v(usuarioFiltro)}</div></div></div>
    <div class="stats">
      <div class="stat"><span class="k">Usuarios con actividad</span><b>${Object.keys(grupos).length}</b></div>
      <div class="stat"><span class="k">Modificaciones</span><b>${logs.length}</b></div>
      <div class="stat"><span class="k">Documentos subidos</span><b>${logs.filter(l => l.accion === "subir_documento" || ((l.accion === "api_insert" || l.accion === "api_upsert") && l.detalle?.tabla === "archivos_solicitante")).length}</b></div>
      <div class="stat"><span class="k">Generado</span><b style="font-size:16px">${new Date().toLocaleTimeString("es-CL")}</b></div>
    </div>
    ${Object.entries(grupos).map(([usuario, items]) => `<div class="program-box">
      <div class="program-title">${usuario} - ${items.length} accion(es)</div>
      <table><thead><tr><th>Fecha y hora</th><th>Accion</th><th>Solicitante</th><th>Detalle</th></tr></thead><tbody>
        ${items.map(log => `<tr><td>${formatFechaHora(log.creado)}</td><td>${accionTexto(log.accion, log.detalle)}</td><td>${v(solicitanteAuditoria(log))}</td><td>${v(detalleAuditoria(log.detalle, log.accion))}</td></tr>`).join("")}
      </tbody></table>
    </div>`).join("")}
  </div>`;
  imprimirVentana("Informe de auditoria", html);
}

function estilosImpresion() {
  return `<style>
    body{font-family:Arial,sans-serif;color:#111827;margin:0;padding:28px;background:#fff;font-size:12px}
    .page{max-width:940px;margin:0 auto;page-break-after:always}.page:last-child{page-break-after:auto}
    .institutional-header{display:grid;grid-template-columns:132px 1fr 132px;align-items:center;gap:28px;border-bottom:1px solid #d1d5db;padding:0 0 22px;margin:0 0 22px;text-align:center}
    .institutional-logo{width:132px;height:132px;display:flex;align-items:center;justify-content:center}
    .institutional-logo img{width:118px;height:118px;object-fit:contain;display:block}
    .institutional-title h1{margin:0;color:#173b67;font-size:24px;line-height:1.18;font-weight:900;text-transform:uppercase;letter-spacing:.03em}
    .institutional-title h2{margin:12px 0 6px;color:#2563eb;font-size:14px;line-height:1.2;font-weight:900;text-transform:uppercase}
    .institutional-title p{margin:0;color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
    .institutional-line{width:74px;height:4px;background:#2563eb;border-radius:999px;margin:12px auto 0}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid #333;padding-bottom:16px;margin-bottom:24px}
    h1{font-size:18px;margin:0 0 4px;text-transform:uppercase}.muted{color:#6b7280}.bar{background:#333;color:#fff;padding:14px 20px;border-radius:6px;margin-bottom:10px;display:flex;justify-content:space-between;gap:16px;font-size:14px;font-weight:700}
    .section{margin-top:22px}.section h2{font-size:12px;text-transform:uppercase;border-bottom:2px solid #d1d5db;padding-bottom:6px;letter-spacing:.03em}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.person-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:12px}.person-col{border:1px solid #d1d5db;border-radius:6px;padding:12px;background:#f9fafb}.person-col h3{font-size:11px;text-transform:uppercase;margin:0 0 10px;color:#374151;border-bottom:1px solid #d1d5db;padding-bottom:6px}.row{display:grid;grid-template-columns:42% 1fr;gap:8px;margin:6px 0}.card{border:1px solid #d1d5db;border-radius:6px;padding:12px;background:#f9fafb}.k{font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:700}.v{font-size:12px;font-weight:700;margin-top:3px;white-space:pre-wrap}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{border:1px solid #d1d5db;border-radius:6px;text-align:center;padding:12px;background:#f3f4f6}.stat b{display:block;font-size:28px;margin-top:8px;color:#4b5563}
    .program-box{border:1px solid #d1d5db;border-radius:7px;margin-top:12px;overflow:hidden}.program-title{background:#f3f4f6;border-bottom:1px solid #d1d5db;padding:9px 10px;font-weight:800;text-transform:uppercase}.pending td{background:#fef2f2;color:#991b1b;font-weight:700}.pending .estado{color:#dc2626}.complete .estado{color:#047857;font-weight:700}
    .print-actions{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e7eb;padding:10px 0;margin-bottom:12px;text-align:right}.print-actions button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-weight:800;cursor:pointer}
    .firma-footer{max-width:940px;margin:18px auto 0;border-top:1px solid #d1d5db;padding-top:10px;text-align:center;font-size:11px;font-weight:800;color:#374151}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #d1d5db;padding:7px;text-align:left;vertical-align:top}th{background:#f3f4f6;text-transform:uppercase;font-size:10px}
    @media print{body{padding:0}.page{max-width:none;margin:0;padding:22px}.print-actions{display:none}.firma-footer{max-width:none;margin:0 22px 0}}
  </style>`;
}

function campoHtml(label, value) {
  return `<div class="card"><div class="k">${label}</div><div class="v">${v(value)}</div></div>`;
}

function valorRsh(persona) {
  const raw = persona.puntajeRSH || persona.puntaje_rsh || persona.rsh || "";
  if (!raw && raw !== 0) return "";
  const txt = raw.toString().trim();
  return txt.endsWith("%") ? txt : `${txt}%`;
}

function fechaNacimientoPersona(persona) {
  return persona.fechaNacimiento || persona.fecha_nacimiento || persona.fecha_nac || persona.nacimiento || "";
}

function primerDato(...values) {
  const encontrado = values.find(value => value === 0 || (value && value.toString().trim()));
  return encontrado === undefined || encontrado === null ? "" : encontrado;
}

function mostrarSiNo(value) {
  const txt = (value || "").toString().trim().toUpperCase();
  if (txt === "S" || txt === "SI" || txt === "SÍ") return "Sí";
  if (txt === "N" || txt === "NO") return "No";
  return value || "";
}

function siglaDominio(value) {
  const txt = (value || "").toString().trim();
  if (!txt) return "";
  if (txt.toUpperCase() === "D.V.") return "DV";
  return txt;
}

function valorDominioDoc(doc) {
  const partes = String(doc?.valor || "").split("|");
  if (partes[0] === "Otro") return partes[1] ? `Otro: ${partes[1]}` : "Otro";
  return siglaDominio(partes[0]);
}

function valorCuentaDoc(doc) {
  const partes = String(doc?.valor || "").split("|");
  return partes[0] || "";
}

function fechaNacimientoDesdeSolicitudes(sols = []) {
  for (const sol of sols) {
    for (const doc of docsSolicitud(sol)) {
      const n = docNombreNorm(doc);
      const partes = String(doc?.valor || "").split("|");
      if (n.includes("cedula") && partes[1]) return partes[1];
      if (n.includes("fecha de nacimiento") && doc?.valor) return doc.valor;
    }
  }
  return "";
}

function documentoSolicitud(sols = [], predicate) {
  for (const sol of sols) {
    const found = docsSolicitud(sol).find(predicate);
    if (found) return found;
  }
  return null;
}

function dominioDesdeSolicitudes(sols = []) {
  const doc = documentoSolicitud(sols, d => {
    const n = docNombreNorm(d);
    return n.includes("dominio de la propiedad") || n.includes("titulo de dominio");
  });
  return valorDominioDoc(doc);
}

function cuentaDesdeSolicitudes(sols = []) {
  const doc = documentoSolicitud(sols, d => docNombreNorm(d).includes("cuenta de ahorro"));
  return valorCuentaDoc(doc);
}

function servicioAguaDesdeSolicitudes(sols = []) {
  const doc = documentoSolicitud(sols, d => {
    const n = docNombreNorm(d);
    return n.includes("boleta de agua") || n.includes("agua");
  });
  if (doc?.opcionSeleccionada === "Pozo" || String(doc?.valor || "").toLowerCase() === "pozo") return "N/A";
  const partes = String(doc?.valor || "").split("|");
  return partes[1] || "";
}

function sistemaAguaDesdeSolicitudes(sols = []) {
  const doc = documentoSolicitud(sols, d => {
    const n = docNombreNorm(d);
    return n.includes("boleta de agua") || n.includes("agua");
  });
  if (doc?.opcionSeleccionada === "Pozo" || String(doc?.valor || "").toLowerCase() === "pozo") return "Pozo";
  const partes = String(doc?.valor || "").split("|");
  return partes[0] || "";
}

function comiteDePersona(persona, comites = []) {
  return (comites || []).find(comite => personaEnComite(persona, comite)) || null;
}

function cargoEnComite(persona, comites = []) {
  const comite = comiteDePersona(persona, comites);
  const directiva = Array.isArray(comite?.directiva) ? comite.directiva : [];
  const miembroDirectiva = directiva.find(item => {
    const mismoRut = item?.rut && persona?.rut && rutKey(item.rut) === rutKey(persona.rut);
    const mismoNombre = item?.nombre && persona?.nombre && norm(item.nombre) === norm(persona.nombre);
    return mismoRut || mismoNombre;
  });
  return primerDato(miembroDirectiva?.rol, miembroDirectiva?.cargo, persona.cargoComite, persona.cargo_comite, "Socio");
}

function rutColoresDesdeDocumentos(sols = []) {
  for (const sol of sols) {
    const doc = docsSolicitud(sol).find(d => docNombreNorm(d).includes("cedula"));
    const partes = String(doc?.valor || "").split("|");
    if (partes[2] && partes[2].trim()) return partes[2].trim();
  }
  return "";
}

function detalleDocumento(doc) {
  const n = docNombreNorm(doc);
  if (doc?.opcionSeleccionada === "Pozo") return "Pozo";
  if (doc?.opcionSeleccionada === "Sin discapacidad") return "N/A";
  if (n.includes("dominio")) return valorDominioDoc(doc);
  if (n.includes("cuenta de ahorro")) return valorCuentaDoc(doc);
  return primerDato(doc.observacion, doc.detalle, doc.valor, doc.archivo, doc.url);
}

function filaInforme(tipo, estadoOk, dato) {
  const estado = estadoOk ? "Completo" : "Pendiente";
  const clase = estadoOk ? "complete" : "pending";
  return `<tr class="${clase}"><td>${v(tipo)}</td><td class="estado">${estado}</td><td>${v(dato)}</td></tr>`;
}

function filasDatosFicha(persona, sols, comites, programaTxt) {
  const comite = comiteDePersona(persona, comites);
  const rutColores = primerDato(persona.rutColores, persona.rutcolores, rutColoresDesdeDocumentos(sols));
  const sistemaAgua = primerDato(sistemaAguaDesdeSolicitudes(sols), persona.sistemaAgua, persona.sistemaagua);
  const nServicioAgua = sistemaAgua === "Pozo" ? "N/A" : primerDato(servicioAguaDesdeSolicitudes(sols), persona.nServicioAgua, persona.nservicioagua);
  const datos = [
    ["Programa informado", programaTxt],
    ["Nombre del Comité", primerDato(comite?.nombre, persona.comite)],
    ["Cargo en el Comité", cargoEnComite(persona, comites)],
    ["Nombre del solicitante", persona.nombre],
    ["Cédula de identidad", persona.rut],
    ["Colores RUT", rutColores],
    ["Fecha de nacimiento", primerDato(fechaNacimientoDesdeSolicitudes(sols), fechaNacimientoPersona(persona))],
    ["Adulto mayor", primerDato(persona.adultoMayor, persona.adulto_mayor)],
    ["Teléfono", persona.telefono],
    ["Correo electrónico", primerDato(persona.email, persona.correo)],
    ["Dirección", persona.direccion],
    ["Coordenadas", persona.coordenadas],
    ["RSH %", valorRsh(persona)],
    ["Comuna RSH", primerDato(persona.comunaRsh, persona.comuna_rsh, persona.comuna)],
    ["Estado civil", primerDato(persona.estadoCivil, persona.estado_civil, persona.estadocivil)],
    ["Numero de integrantes", primerDato(persona.integrantesFamiliares, persona.integrantes_familiares)],
    ["Subsidio anterior", mostrarSiNo(primerDato(persona.subsidioAnterior, persona.subsidio_anterior))],
    ["Rol de avalúo", primerDato(persona.rol, persona.rolAvaluo, persona.rol_avaluo)],
    ["Avalúo fiscal", primerDato(persona.avaluoFiscal, persona.avaluo_fiscal)],
    ["Sistema de agua", sistemaAgua],
    ["N° Servicio Agua", nServicioAgua],
    ["Dominio de la propiedad", primerDato(dominioDesdeSolicitudes(sols), persona.dominioPropiedad, persona.dominio_propiedad, persona.dominiopropiedad)],
    ["Número cuenta ahorro", primerDato(cuentaDesdeSolicitudes(sols), persona.numeroCuentaAhorro, persona.numero_cuenta_ahorro, persona.cuentaAhorro, persona.cuentaahorro)],
    ["Ingreso familiar UF", primerDato(persona.ingresoFamiliarUf, persona.ingreso_familiar_uf)],
    ["Observaciones", persona.observaciones],
  ];
  return datos.map(([tipo, dato]) => filaInforme(tipo, !!primerDato(dato), dato)).join("");
}

function tablaFichaHtml(persona, sols, comites, programaTxt) {
  const filasFicha = filasDatosFicha(persona, sols, comites, programaTxt);
  return `<table class="tabla-individual"><thead><tr><th>Tipo documento</th><th>Estado</th><th>Datos del solicitante</th></tr></thead><tbody>${filasFicha}</tbody></table>`;
}

function tablasDocumentosIndividualHtml(docs) {
  if (!docs.length) {
    return `<table class="tabla-individual"><thead><tr><th>Tipo documento</th><th>Estado</th><th>Datos del solicitante</th></tr></thead><tbody>${filaInforme("Documentos del programa", false, "Sin documentos registrados")}</tbody></table>`;
  }
  const docsVisibles = docs.filter(doc => {
    const n = docNombreNorm(doc);
    return !n.includes("titulo de dominio") && !n.includes("fecha de nacimiento");
  });
  if (!docsVisibles.length) {
    return `<table class="tabla-individual"><thead><tr><th>Tipo documento</th><th>Estado</th><th>Datos del solicitante</th></tr></thead><tbody>${filaInforme("Documentos del programa", false, "Sin documentos visibles para este programa")}</tbody></table>`;
  }
  const grupos = docsVisibles.reduce((acc, doc) => {
    const programa = doc.programa || "Programa";
    if (!acc[programa]) acc[programa] = [];
    acc[programa].push(doc);
    return acc;
  }, {});
  return Object.entries(grupos).map(([programa, items]) => `<div class="program-box">
    <div class="program-title">${programa}</div>
    <table class="tabla-individual"><thead><tr><th>Tipo documento</th><th>Estado</th><th>Datos del solicitante</th></tr></thead><tbody>
      ${items.map(doc => filaInforme(doc.nombre, documentoCompleto(doc), detalleDocumento(doc))).join("")}
    </tbody></table>
  </div>`).join("");
}

function tablaSeccionFicha(titulo, filas) {
  return `<div class="section"><h2>${titulo}</h2><table class="tabla-individual"><thead><tr><th>Tipo documento</th><th>Estado</th><th>Datos del solicitante</th></tr></thead><tbody>${filas.map(([tipo, dato]) => filaInforme(tipo, !!primerDato(dato), dato)).join("")}</tbody></table></div>`;
}

function seccionArchivosHtml(archivos = []) {
  if (!archivos.length) {
    return `<div class="section"><h2>Carpeta de documentos</h2><table class="tabla-individual"><thead><tr><th>Archivo</th><th>Estado</th></tr></thead><tbody><tr><td colspan="2" style="color:#9ca3af;text-align:center">Sin archivos en la carpeta de documentos</td></tr></tbody></table></div>`;
  }
  const ext = (nombre) => {
    const p = nombre.lastIndexOf(".");
    return p >= 0 ? nombre.slice(p + 1).toUpperCase() : "ARCH";
  };
  const tipo = (nombre) => {
    const e = ext(nombre);
    if (e === "PDF") return "PDF";
    if (["JPG","JPEG","PNG","WEBP","GIF"].includes(e)) return "Imagen";
    if (e === "HTML") return "Documento HTML";
    if (["DOC","DOCX"].includes(e)) return "Word";
    return e;
  };
  const filas = archivos.map(a =>
    `<tr><td style="word-break:break-all">${v(a.nombre)}</td><td style="color:#059669;font-weight:700">${tipo(a.nombre)} ✓</td></tr>`
  ).join("");
  return `<div class="section"><h2>Carpeta de documentos (${archivos.length} archivo${archivos.length === 1 ? "" : "s"})</h2><table class="tabla-individual"><thead><tr><th>Nombre del archivo</th><th>Tipo</th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

function bloquePersonaDetalleComiteHtml(persona, solicitudes, personas, comites, archivosPersona = []) {
  const sols = solicitudFiltrada(persona, solicitudes, personas, "todos");
  const comite = comiteDePersona(persona, comites);
  const docs = sols.flatMap(sol => {
    const docsSol = docsSolicitud(sol);
    return docsSol.map(doc => ({ ...doc, programa: programaNombre(programaId(sol)), _docsContext: docsSol }));
  });
  const sistemaAgua = primerDato(sistemaAguaDesdeSolicitudes(sols), persona.sistemaAgua, persona.sistemaagua);
  const nServicioAgua = sistemaAgua === "Pozo" ? "N/A" : primerDato(servicioAguaDesdeSolicitudes(sols), persona.nServicioAgua, persona.nservicioagua);
  return `<div class="page">
    <div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe detallado del solicitante</h1><div class="muted">${v(persona.nombre)} - ${new Date().toLocaleDateString("es-CL")}</div></div></div>
    <div class="bar"><span>${v(persona.nombre)}</span><span>${v(comite?.nombre || persona.comite)}</span></div>
    ${tablaSeccionFicha("Información General", [
      ["Nombre del Comité", primerDato(comite?.nombre, persona.comite)],
      ["Cargo en el Comité", cargoEnComite(persona, comites)],
      ["Nombre del solicitante", persona.nombre],
      ["Cédula de identidad", persona.rut],
      ["RUT colores", primerDato(persona.rutColores, persona.rutcolores, rutColoresDesdeDocumentos(sols))],
      ["Fecha de nacimiento", primerDato(fechaNacimientoDesdeSolicitudes(sols), fechaNacimientoPersona(persona))],
      ["Teléfono", persona.telefono],
      ["Correo electrónico", primerDato(persona.email, persona.correo)],
      ["Dirección", persona.direccion],
      ["Coordenadas", persona.coordenadas],
    ])}
    ${tablaSeccionFicha("Área Técnica", [
      ["Rol de avalúo", primerDato(persona.rol, persona.rolAvaluo, persona.rol_avaluo)],
      ["Avalúo fiscal", primerDato(persona.avaluoFiscal, persona.avaluo_fiscal)],
      ["Dominio de la propiedad", primerDato(dominioDesdeSolicitudes(sols), persona.dominioPropiedad, persona.dominio_propiedad, persona.dominiopropiedad)],
      ["Sistema de agua", sistemaAgua],
      ["N° Servicio Agua", nServicioAgua],
      ["Proveedor eléctrico", primerDato(persona.proveedorElectrico, persona.proveedorelectrico)],
      ["N° Cliente electricidad", primerDato(persona.nClienteElectricidad, persona.nclienteelectricidad)],
      ["Certificado ruralidad", primerDato(persona.certRuralidad, persona.certruralidad)],
      ["Informaciones previas", primerDato(persona.infPrevias, persona.infprevias)],
      ["Antecedentes vivienda", primerDato(persona.antecedentesVivienda, persona.antecedentesvivienda)],
    ])}
    ${tablaSeccionFicha("Área Social", [
      ["RSH %", valorRsh(persona)],
      ["Comuna RSH", primerDato(persona.comunaRsh, persona.comuna_rsh, persona.comuna)],
      ["Estado civil", primerDato(persona.estadoCivil, persona.estado_civil, persona.estadocivil)],
      ["Número de integrantes", primerDato(persona.integrantesFamiliares, persona.integrantes_familiares)],
      ["Subsidio anterior", mostrarSiNo(primerDato(persona.subsidioAnterior, persona.subsidio_anterior))],
      ["Adulto mayor", primerDato(persona.adultoMayor, persona.adulto_mayor)],
      ["Discapacidad", persona.discapacidad],
      ["Movilidad reducida", primerDato(persona.movilidadReducida, persona.movilidadreducida)],
      ["Credencial discapacidad", primerDato(persona.credencialDiscapacidad, persona.credencialdiscapacidad)],
      ["Número cuenta ahorro", primerDato(cuentaDesdeSolicitudes(sols), persona.numeroCuentaAhorro, persona.numero_cuenta_ahorro, persona.cuentaAhorro, persona.cuentaahorro)],
      ["Banco", persona.banco],
      ["Ingreso familiar UF", primerDato(persona.ingresoFamiliarUf, persona.ingreso_familiar_uf)],
    ])}
    <div class="section"><h2>Solicitudes activas</h2>${tablasDocumentosIndividualHtml(docs)}</div>
    ${seccionArchivosHtml(archivosPersona)}
  </div>`;
}

function bloquePersonaHtml(persona, solicitudes, personas, comites = [], programaFiltro = "todos") {
  const sols = solicitudFiltrada(persona, solicitudes, personas, programaFiltro);
  const stats = estadisticasDocs(sols);
  const programaTxt = programaFiltro === "todos" ? "Todos los programas" : programaNombre(programaFiltro);
  const docs = sols.flatMap(sol => {
    const docsSol = docsSolicitud(sol);
    return docsSol.map(doc => ({ ...doc, programa: programaNombre(programaId(sol)), _docsContext: docsSol }));
  });

  return `<div class="page">
    <div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Entidad Patrocinante: Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe Individual del Solicitante</h1><div class="muted">${v(persona.nombre)} - Generado el ${new Date().toLocaleDateString("es-CL")}</div></div></div>
    <div class="bar"><span>${v(persona.nombre)}</span><span>${programaTxt}</span></div>
    <div style="font-weight:800;text-transform:uppercase;margin-bottom:8px">Programa informado: ${programaTxt}</div>
    <div class="stats"><div class="stat">Total documentos<b>${stats.total}</b></div><div class="stat">Completados<b>${stats.completos}</b></div><div class="stat">Faltan obligatorios<b>${stats.faltanObligatorios}</b></div><div class="stat">Opcionales pendientes<b>${stats.opcionalesPendientes}</b></div></div>
    <div class="section"><h2>Ficha del solicitante</h2>${tablaFichaHtml(persona, sols, comites, programaTxt)}</div>
    <div class="section"><h2>Documentos por programa</h2>${tablasDocumentosIndividualHtml(docs)}</div>
  </div>`;
}

function imprimirIndividualMultiple(seleccionados, solicitudes, personas, comites = []) {
  if (!seleccionados.length) return;
  const html = seleccionados.map(item => {
    const persona = item.persona || item;
    return bloquePersonaHtml(persona, solicitudes, personas, comites, item.programaId || "todos");
  }).join("");
  imprimirVentana("Informe Individual del Solicitante", html);
}


async function imprimirDetalleComite(comite, personas, solicitudes, comites) {
  if (!comite) return;
  const miembros = miembrosComite(comite, personas);
  if (!miembros.length) {
    imprimirVentana("Informe detallado del comité", `<div class="page"><div class="muted">Sin solicitantes registrados.</div></div>`);
    return;
  }
  // Consultar archivos de todos los miembros en Supabase
  const idsPersonas = miembros.map(p => p.id).filter(Boolean);
  let archivosPorPersona = {};
  try {
    const { data: archivosDb } = await supabase
      .from("archivos_solicitante")
      .select("persona_id, nombre")
      .in("persona_id", idsPersonas)
      .order("creado", { ascending: false });
    if (archivosDb) {
      archivosDb.forEach(a => {
        if (!archivosPorPersona[a.persona_id]) archivosPorPersona[a.persona_id] = [];
        // Evitar duplicados por nombre
        if (!archivosPorPersona[a.persona_id].some(x => x.nombre === a.nombre)) {
          archivosPorPersona[a.persona_id].push(a);
        }
      });
    }
  } catch (err) {
    console.warn("[informe detallado] No se pudieron cargar archivos:", err.message);
  }
  const html = miembros.map(persona =>
    bloquePersonaDetalleComiteHtml(persona, solicitudes, personas, comites, archivosPorPersona[persona.id] || [])
  ).join("");
  imprimirVentana("Informe detallado del comité", html || `<div class="page"><div class="muted">Sin solicitantes registrados.</div></div>`);
}

function imprimirComite(comite, personas, solicitudes) {
  if (!comite) return;
  const miembros = miembrosComite(comite, personas);
  const filas = miembros.map((p, i) => {
    const stats = estadisticasDocs(solPersonasRelacionadas(p, solicitudes, personas));
    return `<tr><td>${i + 1}</td><td>${v(p.nombre)}</td><td>${v(p.rut)}</td><td>${v(p.telefono)}</td><td>${v(p.direccion)}</td><td>${v(p.coordenadas)}</td><td>${stats.completos}/${stats.total}</td></tr>`;
  }).join("");

  const directiva = (comite.directiva || []).map(d => `<tr><td>${v(d.rol)}</td><td>${v(d.nombre)}</td></tr>`).join("");
  imprimirVentana("Informe general", `<div class="page"><div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe general</h1><div class="muted">${new Date().toLocaleDateString("es-CL")}</div></div></div><div class="bar"><span>${v(comite.nombre)}</span><span>${v(comite.tipo)}</span></div><div class="grid">${campoHtml("Constructora", comite.constructora)}${campoHtml("Profesional", comite.profesional)}${campoHtml("Personalidad jurídica", comite.pj)}${campoHtml("Vencimiento", comite.venc)}</div><div class="section"><h2>Directiva</h2>${directiva ? `<table><tbody>${directiva}</tbody></table>` : `<div class="muted">Sin directiva registrada.</div>`}</div><div class="section"><h2>Solicitantes</h2><table><thead><tr><th>#</th><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>Dirección</th><th>Coordenadas</th><th>Documentos</th></tr></thead><tbody>${filas}</tbody></table></div></div>`);
}

function Section({ title, subtitle, color, children }) {
  return <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 22 }}>
    <div style={{ padding: "18px 24px", borderBottom: `3px solid ${color}`, background: `${color}12` }}>
      <h2 style={{ margin: 0, color, fontSize: 18 }}>{title}</h2>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{subtitle}</div>
    </div>
    <div style={{ padding: 24 }}>{children}</div>
  </section>;
}

function PanelOpcionesCsp({ tipo, comites, personas, solicitudes, color }) {
  const lista = comites.filter(c => c.tipo === tipo);
  const [comiteId, setComiteId] = useState("todos");
  const [contenido, setContenido] = useState("solo");
  const seleccionados = comiteId === "todos" ? lista : lista.filter(c => (c.id || c.codigo) === comiteId || c.codigo === comiteId);
  const totalPersonas = seleccionados.reduce((acc, c) => acc + miembrosComite(c, personas).length, 0);
  const pluralTipo = tipo === "Rural" ? "rurales" : "urbanos";

  const imprimir = () => {
    const html = seleccionados.map(c => {
      if (contenido === "solo") {
        return `<div class="page"><div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe CSP ${tipo}</h1><div class="muted">${new Date().toLocaleDateString("es-CL")}</div></div></div><div class="bar"><span>${v(c.nombre)}</span><span>${tipo}</span></div><div class="grid">${campoHtml("Constructora", c.constructora)}${campoHtml("Profesional", c.profesional)}${campoHtml("Familias", c.familias || miembrosComite(c, personas).length)}${campoHtml("Personalidad juridica", c.pj)}</div></div>`;
      }
      const miembros = miembrosComite(c, personas);
      const filas = miembros.map((p, i) => `<tr><td>${i + 1}</td><td>${v(p.nombre)}</td><td>${v(p.rut)}</td><td>${v(p.telefono)}</td><td>${v(p.direccion)}</td></tr>`).join("");
      return `<div class="page"><div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe CSP ${tipo}</h1><div class="muted">${new Date().toLocaleDateString("es-CL")}</div></div></div><div class="bar"><span>${v(c.nombre)}</span><span>${miembros.length} integrantes</span></div><div class="grid">${campoHtml("Constructora", c.constructora)}${campoHtml("Profesional", c.profesional)}${campoHtml("Familias", c.familias || miembros.length)}${campoHtml("Personalidad juridica", c.pj)}</div><div class="section"><h2>Integrantes</h2><table><thead><tr><th>#</th><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>Dirección</th></tr></thead><tbody>${filas}</tbody></table></div></div>`;
    }).join("");
    imprimirVentana(`Informe CSP ${tipo}`, html);
  };

  return <div>
    <div style={{ fontSize: 13, fontWeight: 800, color: "#1f2937", marginBottom: 8 }}>1. Selector de comité</div>
    <select value={comiteId} onChange={e => setComiteId(e.target.value)} style={{ width: "100%", padding: 10, border: `1px solid ${color}`, borderRadius: 8, fontSize: 14 }}>
      <option value="todos">Todos los comités {pluralTipo} ({lista.length})</option>
      {lista.map(c => <option key={c.id || c.codigo} value={c.id || c.codigo}>{c.nombre}</option>)}
    </select>
    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>{seleccionados.length} comités seleccionados · {totalPersonas} personas en total</div>

    <div style={{ fontSize: 13, fontWeight: 800, color: "#1f2937", margin: "22px 0 10px" }}>2. Contenido del informe</div>
    {[{ id: "solo", titulo: "Solo datos del comité", bajada: "Incluye datos del comité y directiva, sin listado de solicitantes" }, { id: "integrantes", titulo: "Incluir integrantes", bajada: "Incluye datos del comité y listado completo de solicitantes" }].map(op => <label key={op.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14, border: `1px solid ${contenido === op.id ? color : "#e5e7eb"}`, borderRadius: 8, background: contenido === op.id ? `${color}10` : "#fff", marginBottom: 10, cursor: "pointer" }}>
      <input type="radio" checked={contenido === op.id} onChange={() => setContenido(op.id)} />
      <span><strong style={{ color: contenido === op.id ? color : "#111827" }}>{op.titulo}</strong><br /><span style={{ color: "#6b7280", fontSize: 12 }}>{op.bajada}</span></span>
    </label>)}

    <button onClick={imprimir} style={{ width: "100%", padding: "14px 18px", border: "none", borderRadius: 8, background: color, color: "#fff", fontWeight: 800, cursor: "pointer" }}>
      Generar informe {comiteId === "todos" ? `Todos los comités ${pluralTipo}` : "del comité seleccionado"}
    </button>
  </div>;
}

function PanelInformePrograma({ programa, comites, personas, solicitudes }) {
  const color = programa?.color || "#2563eb";
  const lista = comitesPrograma(comites, programa);
  const [comiteId, setComiteId] = useState("todos");
  const [contenido, setContenido] = useState("solo");
  const [detalleId, setDetalleId] = useState("");
  const seleccionados = comiteId === "todos" ? lista : lista.filter(c => (c.id || c.codigo) === comiteId || c.codigo === comiteId);
  const totalPersonas = seleccionados.reduce((acc, c) => acc + miembrosComite(c, personas).length, 0);
  const comiteDetalle = lista.find(c => (c.id || c.codigo) === detalleId || c.codigo === detalleId) || null;

  const imprimir = () => {
    const html = seleccionados.map(c => {
      const miembros = miembrosComite(c, personas);
      if (contenido === "solo") {
        return `<div class="page"><div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe ${v(programa?.nombre)}</h1><div class="muted">${new Date().toLocaleDateString("es-CL")}</div></div></div><div class="bar"><span>${v(c.nombre)}</span><span>${v(programa?.nombre)}</span></div><div class="grid">${campoHtml("Constructora", c.constructora)}${campoHtml("Profesional", c.profesional)}${campoHtml("Familias", c.familias || miembros.length)}${campoHtml("Personalidad juridica", c.pj)}</div></div>`;
      }
      const filas = miembros.map((p, i) => `<tr><td>${i + 1}</td><td>${v(p.nombre)}</td><td>${v(p.rut)}</td><td>${v(p.telefono)}</td><td>${v(p.direccion)}</td><td>${v(p.coordenadas)}</td></tr>`).join("");
      return `<div class="page"><div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe ${v(programa?.nombre)}</h1><div class="muted">${new Date().toLocaleDateString("es-CL")}</div></div></div><div class="bar"><span>${v(c.nombre)}</span><span>${miembros.length} integrantes</span></div><div class="grid">${campoHtml("Constructora", c.constructora)}${campoHtml("Profesional", c.profesional)}${campoHtml("Familias", c.familias || miembros.length)}${campoHtml("Personalidad juridica", c.pj)}</div><div class="section"><h2>Integrantes</h2><table><thead><tr><th>#</th><th>Nombre</th><th>Cedula</th><th>Telefono</th><th>Direccion</th><th>Coordenadas</th></tr></thead><tbody>${filas}</tbody></table></div></div>`;
    }).join("");
    imprimirVentana(`Informe ${programa?.nombre || "programa"}`, html);
  };

  if (!programa) return null;

  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: programa.colorLight || `${color}18`, color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18 }}>{programa.icon || "P"}</div>
      <div>
        <div style={{ fontWeight: 900, color: "#111827", fontSize: 18 }}>{programa.nombre}</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>{programa.descripcion || "Selecciona comite, contenido y tipo de informe"}</div>
      </div>
    </div>

    <div style={{ fontSize: 13, fontWeight: 800, color: "#1f2937", marginBottom: 8 }}>1. Selector de comite</div>
    <select value={comiteId} onChange={e => setComiteId(e.target.value)} style={{ width: "100%", padding: 10, border: `1px solid ${color}`, borderRadius: 8, fontSize: 14 }}>
      <option value="todos">Todos los comites del programa ({lista.length})</option>
      {lista.map(c => <option key={c.id || c.codigo} value={c.id || c.codigo}>{c.nombre}</option>)}
    </select>
    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>{seleccionados.length} comites seleccionados - {totalPersonas} personas en total</div>

    <div style={{ fontSize: 13, fontWeight: 800, color: "#1f2937", margin: "22px 0 10px" }}>2. Contenido del informe</div>
    {[{ id: "solo", titulo: "Solo datos del comite", bajada: "Incluye datos del comite y directiva, sin listado de solicitantes" }, { id: "integrantes", titulo: "Incluir integrantes", bajada: "Incluye datos del comite y listado completo de solicitantes" }].map(op => <label key={op.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14, border: `1px solid ${contenido === op.id ? color : "#e5e7eb"}`, borderRadius: 8, background: contenido === op.id ? `${color}10` : "#fff", marginBottom: 10, cursor: "pointer" }}>
      <input type="radio" checked={contenido === op.id} onChange={() => setContenido(op.id)} />
      <span><strong style={{ color: contenido === op.id ? color : "#111827" }}>{op.titulo}</strong><br /><span style={{ color: "#6b7280", fontSize: 12 }}>{op.bajada}</span></span>
    </label>)}

    <button onClick={imprimir} disabled={!seleccionados.length} style={{ width: "100%", padding: "14px 18px", border: "none", borderRadius: 8, background: seleccionados.length ? color : "#d1d5db", color: "#fff", fontWeight: 800, cursor: seleccionados.length ? "pointer" : "not-allowed" }}>
      Generar informe {comiteId === "todos" ? "de todos los comites" : "del comite seleccionado"}
    </button>

    <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#1f2937", marginBottom: 8 }}>3. Informe detallado por solicitante del comite</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
        <select value={detalleId} onChange={e => setDetalleId(e.target.value)} style={{ padding: 10, border: `1px solid ${color}`, borderRadius: 8, fontSize: 14 }}>
          <option value="">Selecciona un comite</option>
          {lista.map(c => <option key={c.id || c.codigo} value={c.id || c.codigo}>{c.nombre} ({miembrosComite(c, personas).length})</option>)}
        </select>
        <button onClick={() => imprimirDetalleComite(comiteDetalle, personas, solicitudes, comites)} disabled={!comiteDetalle} style={{ padding: "10px 18px", border: "none", borderRadius: 8, background: comiteDetalle ? "#1d4ed8" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: comiteDetalle ? "pointer" : "not-allowed" }}>Informe detallado</button>
      </div>
    </div>
  </div>;
}

function PanelIndividual({ personas, solicitudes, comites, onSavePersonas }) {
  const [busqueda, setBusqueda] = useState("");
  const [seleccionados, setSeleccionados] = useState([]);
  const [comiteInformeId, setComiteInformeId] = useState("");
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", rut: "", telefono: "", direccion: "", email: "", comiteId: "" });
  const term = norm(busqueda);
  const resultados = personas.filter(p => !term || norm(`${p.nombre || ""} ${p.rut || ""} ${p.comite || ""}`).includes(term)).slice(0, 25);
  const seleccionIds = new Set(seleccionados.map(item => (item.persona || item).id));

  const agregar = persona => {
    if (seleccionIds.has(persona.id)) return;
    const programas = programasDisponiblesPersona(persona, solicitudes, personas);
    setSeleccionados([...seleccionados, { persona, programaId: programas.length === 1 ? programas[0].id : "todos" }]);
  };

  const cambiarPrograma = (personaId, programaId) => {
    setSeleccionados(seleccionados.map(item => item.persona.id === personaId ? { ...item, programaId } : item));
  };

  const agregarComite = () => {
    const comite = comites.find(c => (c.id || c.codigo) === comiteInformeId || c.codigo === comiteInformeId);
    if (!comite) return;
    const actuales = new Set(seleccionados.map(item => item.persona.id));
    const nuevos = miembrosComite(comite, personas)
      .filter(persona => !actuales.has(persona.id))
      .map(persona => ({ persona, programaId: "todos" }));
    setSeleccionados([...seleccionados, ...nuevos]);
  };

  const guardarNuevoSolicitante = async () => {
    const nombre = nuevo.nombre.trim().toUpperCase();
    const rut = nuevo.rut.trim();
    if (!nombre || !rut) {
      alert("Ingresa nombre y cédula de identidad.");
      return;
    }
    if (!validarRutChileno(rut)) {
      alert("La cédula de identidad no es válida para Chile. Revisa el dígito verificador.");
      return;
    }
    if (personas.some(p => rutKey(p.rut) === rutKey(rut))) {
      alert("Ya existe un solicitante con esa cédula de identidad.");
      return;
    }
    const comite = comites.find(c => (c.id || c.codigo) === nuevo.comiteId || c.codigo === nuevo.comiteId);
    const persona = {
      id: uid(),
      nombre,
      rut: formatRut(rut),
      telefono: nuevo.telefono.trim(),
      direccion: nuevo.direccion.trim(),
      email: nuevo.email.trim(),
      comiteId: comite ? (comite.id || comite.codigo) : "",
      comite: comite?.nombre || "",
      tipo_comite: comite?.tipo || "",
      fechaIngreso: new Date().toLocaleDateString("es-CL"),
    };
    await onSavePersonas?.([...personas, persona]);
    setSeleccionados([...seleccionados, { persona, programaId: "todos" }]);
    setNuevo({ nombre: "", rut: "", telefono: "", direccion: "", email: "", comiteId: "" });
    setMostrarNuevo(false);
  };

  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 14 }}>
      <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre, cédula o comité" style={{ padding: 10, border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }} />
      <button onClick={() => imprimirIndividualMultiple(seleccionados, solicitudes, personas, comites)} disabled={!seleccionados.length} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: seleccionados.length ? "#2563eb" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: seleccionados.length ? "pointer" : "not-allowed" }}>Generar informe</button>
    </div>

    <div style={{ marginBottom: 14 }}>
      <button onClick={() => setMostrarNuevo(!mostrarNuevo)} style={{ padding: "9px 14px", border: "1px solid #bfdbfe", borderRadius: 8, background: "#eff6ff", color: "#1d4ed8", fontWeight: 800, cursor: "pointer" }}>
        + Ingresar nuevo solicitante
      </button>
      {mostrarNuevo && <div style={{ marginTop: 10, border: "1px solid #dbeafe", background: "#f8fbff", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 160px 150px", gap: 8, marginBottom: 8 }}>
          <input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre del solicitante" style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }} />
          <input value={nuevo.rut} onChange={e => setNuevo({ ...nuevo, rut: e.target.value })} placeholder="Cédula identidad" style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }} />
          <input value={nuevo.telefono} onChange={e => setNuevo({ ...nuevo, telefono: e.target.value })} placeholder="Teléfono" style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 260px auto", gap: 8 }}>
          <input value={nuevo.direccion} onChange={e => setNuevo({ ...nuevo, direccion: e.target.value })} placeholder="Dirección" style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }} />
          <input value={nuevo.email} onChange={e => setNuevo({ ...nuevo, email: e.target.value })} placeholder="Correo" style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }} />
          <select value={nuevo.comiteId} onChange={e => setNuevo({ ...nuevo, comiteId: e.target.value })} style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8 }}>
            <option value="">Sin comité</option>
            {comites.map(c => <option key={c.id || c.codigo} value={c.id || c.codigo}>{c.nombre}</option>)}
          </select>
          <button onClick={guardarNuevoSolicitante} disabled={!onSavePersonas} style={{ padding: "9px 14px", border: "none", borderRadius: 8, background: onSavePersonas ? "#059669" : "#d1d5db", color: "#fff", fontWeight: 900, cursor: onSavePersonas ? "pointer" : "not-allowed" }}>Guardar</button>
        </div>
      </div>}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 14 }}>
      <select value={comiteInformeId} onChange={e => setComiteInformeId(e.target.value)} style={{ padding: 10, border: "1px solid #93c5fd", borderRadius: 8, fontSize: 14 }}>
        <option value="">Agregar todos los solicitantes de un comité</option>
        {comites.map(c => <option key={c.id || c.codigo} value={c.id || c.codigo}>{c.nombre} ({miembrosComite(c, personas).length})</option>)}
      </select>
      <button onClick={agregarComite} disabled={!comiteInformeId} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: comiteInformeId ? "#1d4ed8" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: comiteInformeId ? "pointer" : "not-allowed" }}>Agregar comité</button>
    </div>

    {seleccionados.length > 0 && <div style={{ border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 8, padding: 10, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, color: "#1e40af", marginBottom: 8 }}>Solicitantes seleccionados</div>
      {seleccionados.map(item => {
        const p = item.persona;
        const programas = programasDisponiblesPersona(p, solicitudes, personas);
        return <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 280px auto", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid #bfdbfe" }}>
          <div><strong>{p.nombre}</strong><div style={{ fontSize: 12, color: "#6b7280" }}>Cédula: {v(p.rut)} · {v(p.comite)}</div></div>
          <select value={item.programaId || "todos"} onChange={e => cambiarPrograma(p.id, e.target.value)} style={{ padding: 8, border: "1px solid #93c5fd", borderRadius: 8 }}>
            <option value="todos">Todos los programas</option>
            {programas.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
          </select>
          <button onClick={() => setSeleccionados(seleccionados.filter(x => x.persona.id !== p.id))} style={{ border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>Quitar</button>
        </div>;
      })}
    </div>}

    <div style={{ display: "grid", gap: 8, maxHeight: 360, overflow: "auto" }}>
      {resultados.map(p => {
        const stats = estadisticasDocs(solPersonasRelacionadas(p, solicitudes, personas));
        return <div key={p.id} onClick={() => agregar(p)} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer", background: seleccionIds.has(p.id) ? "#f0fdf4" : "#fff" }}>
          <div><strong>{p.nombre}</strong><div style={{ fontSize: 12, color: "#6b7280" }}>Cédula: {v(p.rut)} · {v(p.comite)}</div></div>
          <div style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>{stats.completos}/{stats.total} documentos</div>
        </div>;
      })}
    </div>
  </div>;
}

function PanelAuditoriaUsuarios({ currentUser }) {
  const hoyIso = new Date().toISOString().slice(0, 10);
  const [fechaInicio, setFechaInicio] = useState(hoyIso);
  const [fechaTermino, setFechaTermino] = useState(hoyIso);
  const [usuarioFiltro, setUsuarioFiltro] = useState("todos");
  const [usuarios, setUsuarios] = useState([]);
  const [logs, setLogs] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const esAdmin = (currentUser?.rol || "").toLowerCase() === "admin";

  useEffect(() => {
    if (!esAdmin) return;
    const cargarUsuarios = async () => {
      const { data } = await supabase.rpc("admin_listar_app_users", { p_admin_key: "196560" });
      setUsuarios(Array.isArray(data) ? data : []);
    };
    cargarUsuarios();
  }, [esAdmin]);

  useEffect(() => {
    if (!esAdmin) return;
    let cancelado = false;
    const cargar = async () => {
      setCargando(true);
      setError("");
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);
      try {
        const inicio = new Date((fechaInicio || hoyIso) + "T00:00:00");
        const fin = new Date((fechaTermino || fechaInicio || hoyIso) + "T00:00:00");
        fin.setDate(fin.getDate() + 1);
        const params = new URLSearchParams({
          select: "*",
          orderBy: "creado",
          orderAsc: "false",
        });
        params.set("gte[creado]", inicio.toISOString());
        params.set("lt[creado]", fin.toISOString());
        params.set("neq[accion]", "ingreso_sistema");
        const res = await fetch(`${API_BASE}/api/db/audit_log?${params.toString()}`, { signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) throw new Error(json.error || res.statusText || "No se pudo leer auditoria");
        if (!cancelado) setLogs(Array.isArray(json.data) ? json.data : []);
      } catch (err) {
        if (!cancelado) {
          setError(err.name === "AbortError" ? "La consulta de auditoria tardo demasiado. Intente nuevamente." : err.message);
          setLogs([]);
        }
      } finally {
        window.clearTimeout(timer);
        if (!cancelado) setCargando(false);
      }
    };
    cargar();
    return () => { cancelado = true; };
  }, [esAdmin, fechaInicio, fechaTermino, hoyIso]);

  const usuarioSeleccionado = usuarios.find(u => u.id === usuarioFiltro);
  const logsFiltrados = usuarioFiltro === "todos"
    ? logs
    : logs.filter(log => log.user_id === usuarioFiltro || log.usuario === usuarioSeleccionado?.nombre || log.usuario === usuarioSeleccionado?.username);
  const grupos = logsFiltrados.reduce((acc, log) => {
    const usuario = log.usuario || "Usuario no identificado";
    if (!acc[usuario]) acc[usuario] = [];
    acc[usuario].push(log);
    return acc;
  }, {});
  const modificaciones = logsFiltrados.length;
  const documentosSubidos = logsFiltrados.filter(l =>
    l.accion === "subir_documento" ||
    ((l.accion === "api_insert" || l.accion === "api_upsert") && l.detalle?.tabla === "archivos_solicitante")
  ).length;

  if (!esAdmin) {
    return <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, color: "#991b1b", fontWeight: 800 }}>
      Solo el administrador puede visualizar o imprimir informes de auditoria.
    </div>;
  }

  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "180px 180px 1fr auto", gap: 10, alignItems: "end", marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", marginBottom: 5 }}>Fecha inicio</div>
        <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
          style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }} />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", marginBottom: 5 }}>Fecha termino</div>
        <input type="date" value={fechaTermino} onChange={e => setFechaTermino(e.target.value)}
          style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }} />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", marginBottom: 5 }}>Usuario autorizado</div>
        <select value={usuarioFiltro} onChange={e => setUsuarioFiltro(e.target.value)}
          style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}>
          <option value="todos">Todos los usuarios</option>
          {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre} ({u.rol})</option>)}
        </select>
      </div>
      <button onClick={() => imprimirAuditoria(fechaInicio, fechaTermino, logsFiltrados, usuarioSeleccionado?.nombre || "Todos los usuarios")} disabled={!logsFiltrados.length}
        style={{ width: 210, padding: "10px 18px", border: "none", borderRadius: 8, background: logsFiltrados.length ? "#0f766e" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: logsFiltrados.length ? "pointer" : "not-allowed" }}>
        Generar informe
      </button>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>USUARIO ACTUAL</div><div style={{ fontWeight: 900, marginTop: 4 }}>{currentUser?.nombre || "-"}</div></div>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>USUARIOS CON ACTIVIDAD</div><div style={{ fontSize: 22, fontWeight: 900, color: "#0f766e" }}>{Object.keys(grupos).length}</div></div>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>DOCUMENTOS SUBIDOS</div><div style={{ fontSize: 22, fontWeight: 900, color: "#2563eb" }}>{documentosSubidos}</div></div>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>MODIFICACIONES</div><div style={{ fontSize: 22, fontWeight: 900, color: "#d97706" }}>{modificaciones}</div></div>
    </div>

    {cargando && <div style={{ color: "#6b7280", fontSize: 13 }}>Cargando auditoria...</div>}
    {error && <div style={{ color: "#b91c1c", fontWeight: 800, fontSize: 13 }}>Error al leer auditoria: {error}</div>}
    {!cargando && !error && logsFiltrados.length === 0 && <div style={{ color: "#6b7280", fontSize: 13 }}>No hay modificaciones registradas para las fechas seleccionadas.</div>}

    <div style={{ display: "grid", gap: 10, maxHeight: 520, overflow: "auto" }}>
      {Object.entries(grupos).map(([usuario, items]) => <div key={usuario} style={{ border: "1px solid #d1d5db", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
        <div style={{ background: "#f3f4f6", padding: "10px 12px", fontWeight: 900, color: "#111827" }}>{usuario} <span style={{ color: "#6b7280", fontWeight: 700 }}>- {items.length} accion(es)</span></div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f9fafb" }}><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Fecha y hora</th><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Accion</th><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Solicitante</th><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Detalle</th></tr></thead>
          <tbody>{items.map(log => <tr key={log.id}>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{formatFechaHora(log.creado)}</td>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb", fontWeight: 800 }}>{accionTexto(log.accion, log.detalle)}</td>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb" }}>{v(solicitanteAuditoria(log))}</td>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb" }}>{v(detalleAuditoria(log.detalle, log.accion))}</td>
          </tr>)}</tbody>
        </table>
      </div>)}
    </div>
  </div>;
}

function TarjetaInforme({ item, active, onClick }) {
  return <button type="button" onClick={onClick} style={{
    border: `2px solid ${active ? item.color : "#e5e7eb"}`,
    background: active ? item.colorLight || "#eff6ff" : "#fff",
    borderRadius: 12,
    padding: 16,
    minHeight: 150,
    cursor: "pointer",
    textAlign: "center",
    boxShadow: active ? "0 10px 24px rgba(15,23,42,0.12)" : "0 2px 8px rgba(15,23,42,0.04)",
  }}>
    <div style={{ width: 58, height: 58, borderRadius: 18, background: item.colorLight || "#f3f4f6", color: item.color, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 22 }}>
      {item.icon}
    </div>
    <div style={{ color: "#1f2937", fontWeight: 900, fontSize: 15, lineHeight: 1.25 }}>{item.nombre}</div>
    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6, lineHeight: 1.25 }}>{item.descripcion}</div>
  </button>;
}

export default function InformesView({ personas = [], comites: comitesSupa = [], solicitudes = [], currentUser, soloAuditoria = false, onSavePersonas, programasCustom = [] }) {
  const comites = useMemo(() => filtrarComitesValidos(mergeComites(comitesSupa)), [comitesSupa]);
  const programas = useMemo(() => combinarProgramasMeta(programasCustom), [programasCustom]);
  const tarjetas = useMemo(() => ([
    { id: "individual", nombre: "Informe Individual", descripcion: "Informe por persona o por solicitantes de un comite", color: "#2563eb", colorLight: "#eff6ff", icon: "👤" },
    { id: "completo", nombre: "Informe Completo del Comité", descripcion: "Informe general o detallado de un comité", color: "#7c3aed", colorLight: "#f5f3ff", icon: "📋" },
    ...programas,
  ]), [programas]);
  const [vistaActiva, setVistaActiva] = useState("");
  const [comiteSelId, setComiteSelId] = useState("");
  const comiteSel = comites.find(c => c.codigo === comiteSelId || c.id === comiteSelId) || null;
  const programaActivo = programas.find(p => p.id === vistaActiva);

  if (soloAuditoria) {
    return <div style={{ padding: 24, background: "#f3f4f6", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 6px", color: "#111827" }}>Auditoría diaria</h1>
        <div style={{ color: "#6b7280", marginBottom: 22 }}>Ingresos al sistema y modificaciones realizadas por cada usuario.</div>
        <Section title="Informe diario de usuarios" subtitle="Selecciona una fecha y genera el informe solo cuando sea necesario" color="#0f766e">
          <PanelAuditoriaUsuarios currentUser={currentUser} />
        </Section>
      </div>
    </div>;
  }

  return <div style={{ padding: 24, background: "#f3f4f6", minHeight: "100vh" }}>
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 6px", color: "#111827" }}>Informes</h1>
      <div style={{ color: "#6b7280", marginBottom: 22 }}>Elige el tipo de informe. Los programas muestran sus comites para generar el informe que corresponda.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 22 }}>
        {tarjetas.map(item => <TarjetaInforme key={item.id} item={item} active={vistaActiva === item.id} onClick={() => setVistaActiva(vistaActiva === item.id ? "" : item.id)} />)}
      </div>

      {!vistaActiva && <div style={{ background: "#fff", border: "1px dashed #cbd5e1", borderRadius: 14, padding: "28px 24px", color: "#64748b", fontSize: 14, textAlign: "center", marginBottom: 18 }}>
        Selecciona una ventana de informe para desplegar sus opciones.
      </div>}

      {vistaActiva === "individual" && <Section title="Informe Individual del Solicitante" subtitle="Selecciona uno o mas solicitantes, o agrega todos los solicitantes de un comite" color="#2563eb">
        <PanelIndividual personas={personas} solicitudes={solicitudes} comites={comites} onSavePersonas={onSavePersonas} />
      </Section>}

      {programaActivo && <Section title={`Informes - ${programaActivo.nombre}`} subtitle="Selecciona comite, contenido del informe o informe detallado por solicitante" color={programaActivo.color || "#2563eb"}>
        <PanelInformePrograma programa={programaActivo} comites={comites} personas={personas} solicitudes={solicitudes} />
      </Section>}

      <div style={{ display: "none" }}>
      <div style={{ color: "#6b7280", marginBottom: 22 }}>Generación de informes individuales, comités rurales, comités urbanos y resumen completo.</div>

      <Section title="Informe Individual del Solicitante" subtitle="Selecciona uno o mas solicitantes y el programa que debe informar cada uno" color="#2563eb">
        <PanelIndividual personas={personas} solicitudes={solicitudes} comites={comites} onSavePersonas={onSavePersonas} />
      </Section>

      <Section title="Informe CSP Rural" subtitle="Construcción Sitio Propio Rural - selecciona comité, contenido y detalle de documentos" color="#d97706">
        <PanelOpcionesCsp tipo="Rural" comites={comites} personas={personas} solicitudes={solicitudes} color="#d97706" />
      </Section>

      <Section title="Informe CSP Urbano" subtitle="Construcción Sitio Propio Urbano - selecciona comité, contenido y detalle de documentos" color="#059669">
        <PanelOpcionesCsp tipo="Urbano" comites={comites} personas={personas} solicitudes={solicitudes} color="#059669" />
      </Section>

      </div>

      {vistaActiva === "completo" && <Section title="Informe Completo del Comité" subtitle="Datos completos del comité y listado de postulantes" color="#7c3aed">
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10 }}>
          <select value={comiteSelId} onChange={e => setComiteSelId(e.target.value)} style={{ padding: 10, border: "1px solid #c4b5fd", borderRadius: 8, fontSize: 14 }}>
            <option value="">Selecciona un comité</option>
            {comites.map(c => <option key={c.id || c.codigo} value={c.id || c.codigo}>{c.nombre} ({c.tipo})</option>)}
          </select>
          <button onClick={() => imprimirComite(comiteSel, personas, solicitudes)} disabled={!comiteSel} style={{ padding: "10px 18px", border: "none", borderRadius: 8, background: comiteSel ? "#7c3aed" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: comiteSel ? "pointer" : "not-allowed" }}>Informe general</button>
          <button onClick={() => imprimirDetalleComite(comiteSel, personas, solicitudes, comites)} disabled={!comiteSel} style={{ padding: "10px 18px", border: "none", borderRadius: 8, background: comiteSel ? "#1d4ed8" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: comiteSel ? "pointer" : "not-allowed" }}>Informe detallado</button>
        </div>
        {comiteSel && <div style={{ marginTop: 12, color: "#6b7280", fontSize: 13 }}><strong>{comiteSel.nombre}</strong> · {miembrosComite(comiteSel, personas).length} postulantes</div>}
      </Section>}
    </div>
  </div>;
}
