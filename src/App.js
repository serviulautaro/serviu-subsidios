import { useState, useEffect, useRef } from "react";
import { supabase, IS_DEMO_MODE } from "./supabaseClient";
import ComitesVivienda from "./components/ComitesVivienda";
import InformesView from "./components/InformesView";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Formatear RUT chileno: 10398338-K -> 10.398.338-K
const formatRut = (rut) => {
  if (!rut) return "";
  const clean = rut.replace(/[^0-9kK]/g, "");
  if (clean.length < 2) return clean;
  const dv = clean.slice(-1).toUpperCase();
  const num = clean.slice(0, -1);
  if (!num) return dv;
  const formatted = num.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return formatted + "-" + dv;
};
const limpiarRut = (rut) => rut.replace(/[^0-9kK-]/g, "").toUpperCase();
const validarRutChileno = (rut) => {
  const clean = (rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length < 8 || clean.length > 9) return false;
  const cuerpo = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const dvEsperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === dvEsperado;
};
const rutFormatoChilenoValido = (rut) => {
  const formatted = formatRut(rut);
  return /^\d{1,2}\.\d{3}\.\d{3}-[0-9K]$/.test(formatted) && validarRutChileno(formatted);
};
const rutNumeroGuionValido = (rut) => {
  const limpio = limpiarRut(rut || "");
  return /^\d{7,8}-[0-9K]$/.test(limpio) && validarRutChileno(limpio);
};


const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => new Date().toLocaleDateString("es-CL");
const todayISO = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
const normalizarFechaInput = (value) => {
  const v = String(value || "").trim();
  if (!v) return "";
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const cl = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (cl) return `${cl[3]}-${String(cl[2]).padStart(2, "0")}-${String(cl[1]).padStart(2, "0")}`;
  return "";
};
const formatPesosChilenos = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? "$" + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
};
const mostrarSiNo = (value) => {
  const txt = String(value || "").trim().toUpperCase();
  if (txt === "S" || txt === "SI" || txt === "SÍ") return "Sí";
  if (txt === "N" || txt === "NO") return "No";
  return value || "";
};
const textoAdultoMayor = (fechaNac) => {
  const edad = calcularEdad(fechaNac);
  if (edad === null) return "";
  return `${edad >= 60 ? "SI" : "NO"}/ ${edad} años`;
};
const docNombreNorm = (doc) => (doc?.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const docNombreCanonico = (doc) => {
  const n = docNombreNorm(doc).replace(/\s+/g, " ").trim();
  if (!n) return "";
  if (n.includes("antecedentes de la vivienda") || n.includes("certificado de la vivienda")) return "certificados_antecedentes_vivienda";
  if (n.includes("cedula") && n.includes("identidad")) return "cedula_identidad";
  return n;
};
const docTieneDatosGuardados = (doc = {}) => !!(
  doc.entregado ||
  doc.archivo ||
  doc.storagePath ||
  doc.archivoData ||
  String(doc.valor || "").trim() ||
  doc.opcionSeleccionada
);
const indicesDocumentosVisibles = (documentos = []) => {
  const elegidos = new Map();
  (documentos || []).forEach((doc, idx) => {
    if (!doc || doc.interno) return;
    const key = docNombreCanonico(doc) || "__doc_" + idx;
    const previo = elegidos.get(key);
    if (previo === undefined || (!docTieneDatosGuardados(documentos[previo]) && docTieneDatosGuardados(doc))) {
      elegidos.set(key, idx);
    }
  });
  return new Set(elegidos.values());
};
const DOC_PRIORIDAD_SOLICITANTE = "__prioridad_solicitante";
const prioridadSolicitud = (sol = {}) => {
  const doc = (sol.documentos || []).find(d => d.nombre === DOC_PRIORIDAD_SOLICITANTE);
  return doc?.valor === "prioridad" ? "prioridad" : "normal";
};
const solicitantePrioritario = (personaId, solicitudes = []) => (solicitudes || []).some(s =>
  s.personaId === personaId && prioridadSolicitud(s) === "prioridad"
);
const documentosConPrioridad = (docs = [], valor = "normal") => {
  const base = Array.isArray(docs) ? docs : [];
  const existe = base.some(d => d.nombre === DOC_PRIORIDAD_SOLICITANTE);
  const doc = { nombre: DOC_PRIORIDAD_SOLICITANTE, interno: true, obligatorio: false, entregado: true, valor };
  return existe
    ? base.map(d => d.nombre === DOC_PRIORIDAD_SOLICITANTE ? { ...d, ...doc } : d)
    : [...base, doc];
};
const DOC_CORREO_SOLICITANTE = { nombre: "Correo del solicitante", obligatorio: true, requiereTexto: true, etiquetaTexto: "Correo electrónico" };
const asegurarCorreoSolicitante = (documentos = []) => {
  const docs = Array.isArray(documentos) ? documentos : [];
  const tieneCorreo = docs.some(d => {
    const n = docNombreNorm(d);
    return n.includes("correo") && n.includes("solicitante");
  });
  return tieneCorreo ? docs : [...docs, { ...DOC_CORREO_SOLICITANTE, entregado: false, valor: "" }];
};
const rutColoresDesdeSolicitudes = (sols = []) => {
  for (const sol of sols || []) {
    for (const doc of sol.documentos || []) {
      const n = docNombreNorm(doc);
      if (!n.includes("cedula")) continue;
      const valor = String(doc.valor || "").split("|")[2];
      if (valor) return valor;
    }
  }
  return "";
};
const docTieneValor = (doc) => !!((doc?.valor || "").toString().trim() || doc?.entregado || doc?.archivo || doc?.url);
const aliviarDocumento = (doc = {}) => (
  doc.storagePath && doc.archivoData ? { ...doc, archivoData: "" } : doc
);
const aliviarDocumentosSolicitud = (documentos = []) => (documentos || []).map(aliviarDocumento);
const tieneDocumentoPesadoConStorage = (documentos = []) => (documentos || []).some(d => d?.storagePath && d?.archivoData);
const docCompletoEquivalente = (doc, docs = []) => {
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
};
const esDocConteoHabitabilidad = (doc = {}) => {
  if (doc.interno) return false;
  const n = docNombreNorm(doc);
  if (n.includes("memo") || n.includes("carta") || n.includes("informe dom") || n.includes("respuesta serviu")) return false;
  if (n.includes("calificacion") || n.includes("fecha de visita")) return false;
  return n.includes("cedula") ||
    n.includes("titulo") || n.includes("dominio") || n.includes("derecho real") || n.includes("usufructo") || n.includes("goce") ||
    n.includes("avaluo") ||
    (n.includes("correo") && n.includes("solicitante"));
};
const docsParaConteoSolicitud = (docs = [], programaId = "") => {
  if (programaId === "habitabilidad") return (docs || []).filter(esDocConteoHabitabilidad);
  return (docs || []).filter(d => {
  if (d.interno) return false;
  if (d.obligatorio === false) return false;
  return true;
  });
};
const conteoDocumentosSolicitud = (docs = [], programaId = "") => {
  const visibles = docsParaConteoSolicitud(docs, programaId);
  const completos = visibles.filter(d => docCompletoEquivalente(d, visibles)).length;
  return { visibles, completos, total: visibles.length };
};
const pct = (docs = [], programaId = "") => {
  const { completos, total } = conteoDocumentosSolicitud(docs, programaId);
  return total ? Math.round(completos / total * 100) : 0;
};
const statusColor = (p) => p === 100 ? "#059669" : p >= 50 ? "#D97706" : "#DC2626";
const statusLabel = (p) => p === 100 ? "Completo" : p >= 50 ? "En proceso" : "Incompleto";
const statusBg = (p) => p === 100 ? "#ECFDF5" : p >= 50 ? "#FFFBEB" : "#FEF2F2";
const API = (typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname))
  ? window.location.origin
  : "http://localhost:3001";
const SOLICITUDES_SELECT_BASE = "id,persona_id,persona_nombre,programa_id,fecha,comite,codigo_comite,tipo_comite,profesional_comite,fecha_visita";
const SOLICITUDES_SELECT_LISTADO = `${SOLICITUDES_SELECT_BASE},documentos`;
const encodePathPart = (value) => encodeURIComponent(String(value || ""));
const encodeRoutePath = (value) => String(value || "").split("/").filter(Boolean).map(encodePathPart).join("/");
const apiPath = (prefix, routePath = "", fileName = "") =>
  API + prefix + encodeRoutePath(routePath) + (fileName ? "/" + encodePathPart(fileName) : "");
const STORAGE_BUCKET = "documentos-solicitantes";
const safeStorageSegment = (value = "") => {
  const base = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (base || "archivo").slice(0, 90);
};
const storageObjectPath = (carpeta = "", nombre = "") =>
  [carpeta, nombre]
    .filter(Boolean)
    .join("/")
    .replace(/^\/+/, "")
    .split("/")
    .map(safeStorageSegment)
    .join("/");
const storagePublicUrl = (objectPath = "", bucket = STORAGE_BUCKET) =>
  objectPath ? supabase.storage.from(bucket || STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl : "";
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo."));
  reader.readAsDataURL(file);
});
const htmlToDataUrl = (html) => "data:text/html;charset=utf-8," + encodeURIComponent(html || "");
const bytesToDataUrl = (bytes, mimeType = "application/pdf") => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};
const LOGO_MUNI = "data:image/png;base64,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";
const LOGO_VIVIENDA = "data:image/png;base64,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";
const SII_MAPAS_URL = "https://www4.sii.cl/mapasui/internet/#/contenido/index.html";

if (typeof window !== "undefined") {
  window.SERVIU_LOGOS = { muni: LOGO_MUNI, vivienda: LOGO_VIVIENDA };
}

const ESTADO_DESMARQUE = {
  "DESMARCADO":                { color: "#0891B2", bg: "#E0F7FA", label: "Desmarcado" },
  "INFORME EN DOM":            { color: "#7C3AED", bg: "#F5F3FF", label: "Informe en DOM" },
  "NO CALIFICA":               { color: "#DC2626", bg: "#FEF2F2", label: "No Califica" },
  "Informe DOM aprobado":      { color: "#047857", bg: "#ECFDF5", label: "Informe DOM aprobado" },
  "INFORME DOM APROBADO":      { color: "#047857", bg: "#ECFDF5", label: "Informe DOM aprobado" },
  "INFORME EN SERVIU":         { color: "#3D5A23", bg: "#ECFDF5", label: "Informe en SERVIU" },
  "VISITA HECHA FALTA INFORME":{ color: "#C2693A", bg: "#FFF3E0", label: "Visita hecha falta informe" },
  "EN DOM POR RETIRAR":        { color: "#C2185B", bg: "#FCE4EC", label: "En DOM por retirar" },
  "POSTULANDO":                { color: "#059669", bg: "#ECFDF5", label: "Postulando" },
  "APELAR SERVIU":             { color: "#B45309", bg: "#FFFBEB", label: "Apelar SERVIU" },
  "RECHAZADO APELABLE":        { color: "#B45309", bg: "#FFFBEB", label: "Rechazado apelable" },
  "RECHAZADO DOM":             { color: "#DC2626", bg: "#FEF2F2", label: "Rechazado DOM" },
  "DESMARQUE RECHAZADO":       { color: "#DC2626", bg: "#FEF2F2", label: "Desmarque rechazado" },
  "NO VISITADO":               { color: "#555", bg: "#F5F5F5", label: "No Visitado" },
};

// Calcula estado desmarque automáticamente según documentos ingresados
const calcularEstadoDesmarque = (sol, estadoActual) => {
  if (!sol || sol.programaId !== "habitabilidad") return estadoActual;
  if (["NO CALIFICA","APELAR SERVIU","RECHAZADO APELABLE","RECHAZADO DOM","DESMARQUE RECHAZADO","DESMARCADO","Informe DOM aprobado","INFORME DOM APROBADO"].includes(estadoActual)) return estadoActual;
  const docs = sol.documentos || [];
  const tieneCarta = docs.some(d => d.nombre && d.nombre.includes("Carta SERVIU") && d.entregado && d.valor);
  const tieneMemo = docs.some(d => d.nombre && d.nombre.includes("Memo DOM") && d.entregado && d.valor);
  const tieneVisita = !!fechaVisitaSolicitud(sol);
  if (tieneCarta) return "INFORME EN SERVIU";
  if (tieneMemo) return "INFORME EN DOM";
  if (tieneVisita) return "VISITA HECHA FALTA INFORME";
  return estadoActual || "NO VISITADO";
};

const DOC_CALIFICACION_DESMARQUE = "Calificacion para visita";
const FECHA_VISITA_DESMARQUE_KEY = "__fecha_visita_desmarque__";
const buscarDocDesmarque = (docs = [], patterns = []) => docs.find(d => {
  const n = docNombreNorm(d);
  return patterns.every(p => n.includes(p));
});
const docFechaVisitaDesmarque = (docs = []) => docs.find(d => d?.interno && d?.tipo === FECHA_VISITA_DESMARQUE_KEY);
const fechaVisitaSolicitud = (sol = {}) => normalizarFechaInput(sol.fecha_visita || docFechaVisitaDesmarque(sol.documentos || [])?.valor || "");
const documentosConFechaVisita = (docs = [], fecha = "") => {
  const base = Array.isArray(docs) ? docs : [];
  const idx = base.findIndex(d => d?.interno && d?.tipo === FECHA_VISITA_DESMARQUE_KEY);
  const registro = {
    nombre: "Fecha de visita desmarque",
    obligatorio: false,
    entregado: !!fecha,
    interno: true,
    tipo: FECHA_VISITA_DESMARQUE_KEY,
    valor: fecha || ""
  };
  return idx >= 0
    ? base.map((d, i) => i === idx ? { ...d, ...registro } : d)
    : [...base, registro];
};
const docConVb = (doc) => !!doc?.entregado;
const docCalificacionDesmarque = (docs = []) => docs.find(d => docNombreNorm(d).includes("calificacion para visita"));
const leerCalificacionDesmarque = (sol) => {
  const raw = String(docCalificacionDesmarque(sol?.documentos || [])?.valor || "");
  const [estado, ...detalle] = raw.split("|");
  return { estado: estado || "", detalle: detalle.join("|") || "" };
};
const valorDocTexto = (doc) => String(doc?.valor || "").toUpperCase();
const detalleResultadoDoc = (doc) => {
  const raw = String(doc?.valor || "");
  if (!raw.trim()) return "";
  const partes = raw.split(" - ");
  return partes.length > 1 ? partes.slice(1).join(" - ").trim() : "";
};
const estadoLineaDesmarque = (sol = {}) => {
  const docs = sol.documentos || [];
  const cedula = buscarDocDesmarque(docs, ["cedula"]);
  const tituloDominio = docs.find(d => {
    const n = docNombreNorm(d);
    return n.includes("titulo") || n.includes("dominio") || n.includes("derecho real") || n.includes("usufructo") || n.includes("goce");
  });
  const docsCompletos = docConVb(cedula) && docConVb(tituloDominio);
  const calificacion = leerCalificacionDesmarque(sol);
  const visitado = !!fechaVisitaSolicitud(sol);
  const memoDom = buscarDocDesmarque(docs, ["memo", "dom"]);
  const solicitudDom = docConVb(memoDom);
  const informeDom = buscarDocDesmarque(docs, ["informe", "dom"]);
  const informeTexto = valorDocTexto(informeDom);
  const informeDetalle = detalleResultadoDoc(informeDom);
  const informeIngresado = docConVb(informeDom);
  const informeAprobado = informeIngresado && informeTexto.includes("APROBADO");
  const informeRechazadoApelable = informeTexto.includes("APELAR") || informeTexto.includes("APELABLE");
  const informeRechazado = informeTexto.includes("RECHAZADO") && !informeRechazadoApelable;
  const cartaServiu = buscarDocDesmarque(docs, ["carta", "serviu"]);
  const ingresadoServiu = docConVb(cartaServiu);
  const respuestaServiu = buscarDocDesmarque(docs, ["respuesta", "serviu"]);
  const respuestaTexto = valorDocTexto(respuestaServiu);
  const respuestaDetalle = detalleResultadoDoc(respuestaServiu);
  const respuestaIngresada = docConVb(respuestaServiu);
  const desmarcado = respuestaIngresada && (respuestaTexto.includes("DESMARCADO") || respuestaTexto.includes("APROBADO"));
  const serviuRechazadoApelable = respuestaTexto.includes("APELAR") || respuestaTexto.includes("APELABLE");
  const serviuRechazado = respuestaTexto.includes("RECHAZADO") && !serviuRechazadoApelable;
  let corte = "";
  if (calificacion.estado === "NO_CALIFICA") corte = "NO_CALIFICA";
  if (informeRechazado) corte = "RECHAZADO_DOM";
  if (serviuRechazado || serviuRechazadoApelable || desmarcado) corte = "FINAL";
  return {
    docsCompletos, calificacion, visitado, solicitudDom, informeIngresado, informeAprobado, informeRechazadoApelable,
    informeRechazado, informeDetalle, ingresadoServiu, respuestaIngresada, desmarcado, serviuRechazadoApelable, serviuRechazado, respuestaDetalle, corte,
  };
};

const estadoActualLineaDesmarque = (sol = {}, fallback = "") => {
  const st = estadoLineaDesmarque(sol);
  let actual = { key: "INGRESO_SOLICITANTE", label: "Ingreso solicitante", bg: "#EFF6FF", color: "#1D4ED8" };
  if (st.docsCompletos) actual = { key: "DOCUMENTOS_OBLIGATORIOS", label: "Documentos obligatorios", bg: "#ECFDF5", color: "#047857" };
  if (st.calificacion.estado === "CALIFICA") actual = { key: "CALIFICA_PARA_VISITA", label: "Califica para visita", bg: "#ECFDF5", color: "#047857" };
  if (st.docsCompletos && st.calificacion.estado === "CALIFICA") actual = { key: "LISTO_PARA_VISITA", label: "Listo para visita", bg: "#ECFDF5", color: "#047857" };
  if (st.visitado) actual = { key: "SOLICITANTE_VISITADO", label: "Solicitante visitado", bg: "#FFF3E0", color: "#C2693A" };
  if (st.solicitudDom) actual = { key: "SOLICITUD_EN_DOM", label: "Solicitud en DOM", bg: "#F5F3FF", color: "#7C3AED" };
  if (st.informeIngresado) actual = { key: "INFORME_DOM", label: "Informe DOM ingresado", bg: "#ECFDF5", color: "#047857" };
  if (st.informeAprobado) actual = { key: "INFORME_DOM_APROBADO", label: "Informe DOM aprobado", bg: "#ECFDF5", color: "#047857" };
  if (st.informeRechazadoApelable) actual = { key: "INFORME_DOM_RECHAZADO_APELABLE", label: "Informe DOM rechazado apelable", bg: "#FFFBEB", color: "#B45309" };
  if (st.ingresadoServiu) actual = { key: "INFORME EN SERVIU", label: "Informe en SERVIU", bg: "#ECFDF5", color: "#3D5A23" };
  if (st.respuestaIngresada) actual = { key: "RESPUESTA_SERVIU", label: "Respuesta SERVIU ingresada", bg: "#ECFDF5", color: "#047857" };
  if (st.calificacion.estado === "NO_CALIFICA") actual = { key: "NO CALIFICA", label: "No califica", bg: "#FEF2F2", color: "#B91C1C" };
  if (st.informeRechazado) actual = { key: "RECHAZADO DOM", label: "Rechazado DOM", bg: "#FEF2F2", color: "#B91C1C" };
  if (st.desmarcado) actual = { key: "DESMARCADO", label: "Desmarcado", bg: "#E0F7FA", color: "#0E7490" };
  if (st.serviuRechazadoApelable) actual = { key: "RECHAZADO APELABLE", label: "Rechazado apelable", bg: "#FFFBEB", color: "#B45309" };
  if (st.serviuRechazado) actual = { key: "DESMARQUE RECHAZADO", label: "Desmarque rechazado", bg: "#FEF2F2", color: "#B91C1C" };
  if (!sol || !Array.isArray(sol.documentos)) {
    const est = ESTADO_DESMARQUE[fallback] || ESTADO_DESMARQUE["NO VISITADO"];
    return { key: fallback || "NO VISITADO", label: est.label, bg: est.bg, color: est.color };
  }
  return actual;
};

const DOCUMENTOS_MAVE = [
  { nombre: "Cedula de identidad vigente del postulante", obligatorio: true },
  { nombre: "Cuenta de ahorro de vivienda", obligatorio: true },
  { nombre: "Fotocopia Escritura completa (DV, DRU, GOCE, USUFRUCTO, OTRO INDICAR)", obligatorio: true },
  { nombre: "Certificado de antecedentes de la vivienda", obligatorio: true },
  { nombre: "Certificado Avaluo Fiscal Detallado", obligatorio: true },
  { nombre: "Certificado de Informaciones previas", obligatorio: true },
  { nombre: "Boleta del suministro electrico", obligatorio: true, tipo: "luz", opciones: ["FRONTEL", "CODINER", "CGE"] },
  { nombre: "Boleta del agua potable", obligatorio: true, tipo: "agua", opciones: ["Aguas Araucania", "Aguas San Isidro", "APR", "Pozo"] },
  { nombre: "Registro Social de Hogares", obligatorio: true },
  { nombre: "Correo electronico del solicitante", obligatorio: true },
  { nombre: "Telefono de contacto", obligatorio: true }
];

const DOCUMENTOS_AMPLIACION_VIVIENDA = [
  { nombre: "Cedula de identidad vigente del postulante", obligatorio: true },
  { nombre: "Cuenta de ahorro de vivienda", obligatorio: true },
  { nombre: "Fotocopia Escritura completa (DV, DRU, GOCE, USUFRUCTO, OTRO INDICAR)", obligatorio: true },
  { nombre: "Certificado de antecedentes de la vivienda", obligatorio: true },
  { nombre: "Certificado de Informaciones previas", obligatorio: true },
  { nombre: "Certificado Avaluo Fiscal Detallado", obligatorio: true },
  { nombre: "Registro Social de Hogares", obligatorio: true },
  { nombre: "Telefono de contacto", obligatorio: true },
  { nombre: "Correo electronico del solicitante", obligatorio: true },
  { nombre: "Boleta del suministro electrico", obligatorio: true, tipo: "luz", opciones: ["FRONTEL", "CODINER", "CGE"] },
  { nombre: "Boleta del agua potable", obligatorio: true, tipo: "agua", opciones: ["Aguas Araucania", "Aguas San Isidro", "APR", "Pozo"] }
];

const DOCUMENTOS_MEJORAMIENTO_TERMICO = [
  { nombre: "Cedula de identidad vigente del postulante", obligatorio: true },
  { nombre: "Cuenta de ahorro de vivienda", obligatorio: true },
  { nombre: "Fotocopia Escritura completa (DV, DRU, GOCE, USUFRUCTO, OTRO INDICAR)", obligatorio: true },
  { nombre: "Certificado de antecedentes de la vivienda", obligatorio: true },
  { nombre: "Certificado de Informaciones previas", obligatorio: true },
  { nombre: "Certificado Avaluo Fiscal Detallado", obligatorio: true },
  { nombre: "Registro Social de Hogares", obligatorio: true },
  { nombre: "Telefono de contacto", obligatorio: true },
  { nombre: "Correo electronico del solicitante", obligatorio: true }
];

const DOCUMENTOS_MEJORAMIENTO_ELECTRICO = [
  { nombre: "Cedula de identidad vigente del postulante", obligatorio: true },
  { nombre: "Cuenta de ahorro de vivienda", obligatorio: true },
  { nombre: "Fotocopia Escritura completa (DV, DRU, GOCE, USUFRUCTO, OTRO INDICAR)", obligatorio: true },
  { nombre: "Certificado de antecedentes de la vivienda", obligatorio: true },
  { nombre: "Certificado de Informaciones previas", obligatorio: true },
  { nombre: "Certificado Avaluo Fiscal Detallado", obligatorio: true },
  { nombre: "Telefono de contacto", obligatorio: true },
  { nombre: "Correo electronico del solicitante", obligatorio: true },
  { nombre: "Boleta del suministro electrico", obligatorio: true, tipo: "luz", opciones: ["FRONTEL", "CODINER", "CGE"] },
  { nombre: "Registro Social de Hogares", obligatorio: true }
];

const DOCUMENTOS_COLECTOR_SOLAR = [
  { nombre: "Cedula de identidad vigente del postulante", obligatorio: true },
  { nombre: "Cuenta de ahorro de vivienda", obligatorio: true },
  { nombre: "Fotocopia Escritura completa (DV, DRU, GOCE, USUFRUCTO, OTRO INDICAR)", obligatorio: true },
  { nombre: "Certificado de antecedentes de la vivienda", obligatorio: true },
  { nombre: "Certificado de Informaciones previas", obligatorio: true },
  { nombre: "Certificado Avaluo Fiscal Detallado", obligatorio: true },
  { nombre: "Registro Social de Hogares", obligatorio: true },
  { nombre: "Telefono de contacto", obligatorio: true },
  { nombre: "Correo electronico del solicitante", obligatorio: true },
  { nombre: "Boleta del agua potable", obligatorio: true, tipo: "agua", opciones: ["Aguas Araucania", "Aguas San Isidro", "APR", "Pozo"] }
];

const PROGRAMAS = [
  {
    id: "habitabilidad",
    nombre: "Habitabilidad de Vivienda (DESMARQUE DE VIVIENDA)",
    descripcion: "Evaluacion de condiciones habitables de la vivienda",
    color: "#2563EB", colorLight: "#EFF6FF", icon: "H",
    documentos: [
      { nombre: "Cedula de identidad (escaneada a color)", obligatorio: true },
      { ...DOC_CORREO_SOLICITANTE },
      { nombre: "Titulo de dominio / Derecho real de uso / Usufructo / Goce de tierra", obligatorio: true },
      { nombre: "Certificado de avaluo detallado de la propiedad", obligatorio: true },
      { nombre: "Informe DOM", obligatorio: false, valor: "" },
      { nombre: "N° Memo DOM", obligatorio: false, valor: "" },
      { nombre: "N° Carta SERVIU", obligatorio: false, valor: "" },
      { nombre: "Respuesta SERVIU", obligatorio: false, valor: "" }
    ]
  },
  {
    id: "csp_urbano",
    nombre: "Construccion Sitio Propio Urbano",
    descripcion: "Subsidio de construccion en sitio propio - zona urbana",
    color: "#059669", colorLight: "#ECFDF5", icon: "U",
    documentos: [
      { nombre: "Cedula de identidad", obligatorio: true },
      { ...DOC_CORREO_SOLICITANTE },
      { nombre: "Titulo de dominio del terreno", obligatorio: true },
      { nombre: "Registro Social de Hogares en la comuna", obligatorio: true },
      { nombre: "Certificado de avaluo detallado de la propiedad", obligatorio: true },
      { nombre: "Informaciones previas", obligatorio: true },
      { nombre: "Certificados de antecedentes de la vivienda", obligatorio: true },
      { nombre: "Boleta de luz", obligatorio: true, tipo: "luz", opciones: ["Con empalme", "Sin empalme"] },
      { nombre: "Boleta de agua (APR o Pozo)", obligatorio: true, tipo: "agua", opciones: ["Con arranque", "Pozo"] },
      { nombre: "Cuenta de ahorro para la vivienda", obligatorio: true }
    ]
  },
  {
    id: "csp_rural",
    nombre: "Construccion Sitio Propio Rural",
    descripcion: "Subsidio de construccion en sitio propio - zona rural",
    color: "#D97706", colorLight: "#FFFBEB", icon: "R",
    documentos: [
      { nombre: "Cedula de identidad", obligatorio: true },
      { ...DOC_CORREO_SOLICITANTE },
      { nombre: "Dominio de la propiedad", obligatorio: true },
      { nombre: "Registro Social de Hogares en la comuna", obligatorio: true },
      { nombre: "Certificado de ruralidad", obligatorio: true },
      { nombre: "Certificado de avaluo detallado de la propiedad", obligatorio: true },
      { nombre: "Boleta de luz", obligatorio: true, tipo: "luz", opciones: ["Con empalme", "Sin empalme"] },
      { nombre: "Boleta de agua (APR o Pozo)", obligatorio: true, tipo: "agua", opciones: ["Con arranque", "Pozo"] },
      { nombre: "Cuenta de ahorro para la vivienda", obligatorio: true }
    ]
  },
  {
    id: "mave_rural",
    nombre: "Programa de Mejoramiento de Vivienda Rural y Ampliacion de Vivienda Existente (MAVE)",
    descripcion: "Mejoramiento y ampliacion de vivienda rural existente",
    color: "#7C3AED", colorLight: "#F5F3FF", icon: "M",
    documentos: DOCUMENTOS_MAVE
  },
  {
    id: "ampliacion_vivienda",
    nombre: "Programa Ampliacion de la Vivienda",
    descripcion: "Ampliacion de vivienda existente",
    color: "#0F766E", colorLight: "#CCFBF1", icon: "AV",
    documentos: DOCUMENTOS_AMPLIACION_VIVIENDA
  },
  {
    id: "mejoramiento_termico",
    nombre: "Programa Mejoramiento Termico",
    descripcion: "Mejoramiento termico de vivienda",
    color: "#EA580C", colorLight: "#FFF7ED", icon: "MT",
    documentos: DOCUMENTOS_MEJORAMIENTO_TERMICO
  },
  {
    id: "mejoramiento_electrico",
    nombre: "Programa Mejoramiento Electrico",
    descripcion: "Mejoramiento electrico de vivienda",
    color: "#CA8A04", colorLight: "#FEFCE8", icon: "ME",
    documentos: DOCUMENTOS_MEJORAMIENTO_ELECTRICO
  },
  {
    id: "colector_solar",
    nombre: "Programa Colector Solar",
    descripcion: "Sistema de colector solar para vivienda",
    color: "#0284C7", colorLight: "#E0F2FE", icon: "CS",
    documentos: DOCUMENTOS_COLECTOR_SOLAR
  }
];

function combinarProgramas(programasCustom = []) {
  const base = PROGRAMAS.map(p => ({ ...p, esCustom: false, esBase: true }));
  const porId = new Map(base.map(p => [p.id, p]));
  (programasCustom || []).forEach(p => {
    const normalizado = {
      ...p,
      colorLight: p.colorLight || p.colorlight || "#F9FAFB",
      documentos: Array.isArray(p.documentos) ? p.documentos : [],
    };
    if (porId.has(p.id)) {
      const anterior = porId.get(p.id);
      porId.set(p.id, {
        ...anterior,
        ...normalizado,
        documentos: normalizado.documentos.length ? normalizado.documentos : anterior.documentos,
        esCustom: false,
        esBase: true,
        editadoAdmin: true,
      });
    } else {
      porId.set(p.id, { ...normalizado, esCustom: true, esBase: false });
    }
  });
  return Array.from(porId.values());
}

const COMITES_FIJOS = [
  { codigo:"gr1R", nombre:"Comité de Vivienda Rural Mi Nuevo Hogar",         tipo:"RURAL"  },
  { codigo:"gr2R", nombre:"Comité de Vivienda Rural La Fuerza",               tipo:"RURAL"  },
  { codigo:"gr3R", nombre:"Comité de Vivienda Rural Küme Ruka",               tipo:"RURAL"  },
  { codigo:"gr4R", nombre:"Comité de Vivienda Rural Newen Mapu",              tipo:"RURAL"  },
  { codigo:"gr5R", nombre:"Comité de Vivienda Rural Kimey Ruca",              tipo:"RURAL"  },
  { codigo:"gr6R", nombre:"Comité de Vivienda Rural (Por Constituir)",        tipo:"RURAL"  },
  { codigo:"gr1U", nombre:"Comité de Vivienda Urbano Pioneros de Lautaro",    tipo:"URBANO" },
  { codigo:"gr2U", nombre:"Comité de Vivienda Urbano (Por Constituir)",       tipo:"URBANO" },
];

// Directiva de cada comité (fuente de verdad para el cargo automático)
const COMITES_DIRECTIVA = [
  { codigo:"gr1R", directiva:[{rol:"Presidente",nombre:"Juan Pérez González"},{rol:"Secretario",nombre:"Carlos Hernán Paillaleo Paillaleo"},{rol:"Tesorero",nombre:"Elías Fernando Apablaza Riffo"},{rol:"1er Director",nombre:"Juan Carlos Huenchuan Méndez"}]},
  { codigo:"gr2R", directiva:[{rol:"Presidente",nombre:"Liber Omar Cancino Campos"},{rol:"Vicepresidente",nombre:"Orfelina Leonor Inostroza Burgos"},{rol:"Secretario",nombre:"Alejandra Maribel Lefián Silva"},{rol:"Tesorero",nombre:"Mirta Rosa Martín Vallejos"},{rol:"1er Director",nombre:"Luis Fernando Sánchez Llancamil"}]},
  { codigo:"gr3R", directiva:[{rol:"Presidente",nombre:"Rosa Llancapan Liempe"},{rol:"Vicepresidente",nombre:"María Angélica Antinao Liempe"},{rol:"Secretario",nombre:"Elías Rivas Espinoza"},{rol:"Tesorero",nombre:"Mónica Maribel Rubilar Antilaf"},{rol:"1er Director",nombre:"Juan Miguel Tripaiñan Huenulao"}]},
  { codigo:"gr4R", directiva:[]},
  { codigo:"gr5R", directiva:[]},
  { codigo:"gr6R", directiva:[]},
  { codigo:"gr1U", directiva:[{rol:"Presidente",nombre:"Luis Armando Espinoza Mendoza"},{rol:"Vicepresidente",nombre:"Tomás Salvador Díaz Barrientos"},{rol:"Secretario",nombre:"Margot Leticia Contreras Márquez"},{rol:"Tesorero",nombre:"Iris del Carmen Godoy Morales"},{rol:"1er Director",nombre:"Domingo Antonio Bucarey Torres"}]},
  { codigo:"gr2U", directiva:[]},
];

const COMITES_BASE_DATOS = [
  { codigo: "gr1R", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curín Castro", pj: "P.J. 376054", vencimiento: "07/02/2028" },
  { codigo: "gr2R", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.", pj: "P.J. 379826", vencimiento: "14/05/2028" },
  { codigo: "gr3R", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.", pj: "En trámite", vencimiento: "-" },
  { codigo: "gr4R", constructora: "Falta Licitar", profesional: "Priscilla Curín Castro", pj: "-", vencimiento: "-" },
  { codigo: "gr5R", constructora: "Falta Licitar", profesional: "Jacqueline Ortega B.", pj: "-", vencimiento: "-" },
  { codigo: "gr6R", constructora: "Falta Licitar", profesional: "Priscilla Curín Castro", pj: "-", vencimiento: "-" },
  { codigo: "gr1U", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curín Castro", pj: "P.J. 379720", vencimiento: "08/05/2028" },
  { codigo: "gr2U", constructora: "Falta Licitar", profesional: "Jacqueline Ortega B.", pj: "-", vencimiento: "-" },
];

// Normaliza nombre para comparación (sin tildes, minúsculas, sin caracteres especiales)
function normNomDirectiva(s) {
  return (s||"").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g,"")
    .replace(/[^a-z\s]/g,"").replace(/\s+/g," ");
}

// Infiere el cargo de un solicitante comparando su nombre con la directiva del comité
const comitesBaseCompletos = () => COMITES_FIJOS.map(c => {
  const datos = COMITES_BASE_DATOS.find(d => d.codigo === c.codigo) || {};
  const directiva = COMITES_DIRECTIVA.find(d => d.codigo === c.codigo)?.directiva || [];
  return { ...c, ...datos, id: c.codigo, directiva };
});

const buscarComitePersona = (comites = [], persona = {}) => {
  const base = comitesBaseCompletos();
  const todos = [...base, ...(comites || [])];
  const encontrado = todos.find(c =>
    c.id === persona.comiteId ||
    c.codigo === persona.comiteId ||
    normNomDirectiva(c.nombre) === normNomDirectiva(persona.comite)
  );
  if (!encontrado) return null;
  const baseRelacionado = base.find(c =>
    c.codigo === encontrado.codigo ||
    c.codigo === encontrado.id ||
    normNomDirectiva(c.nombre) === normNomDirectiva(encontrado.nombre)
  );
  return baseRelacionado ? {
    ...baseRelacionado,
    ...encontrado,
    directiva: Array.isArray(encontrado.directiva) && encontrado.directiva.length ? encontrado.directiva : baseRelacionado.directiva,
    constructora: encontrado.constructora || encontrado.constructoraSeleccionada || encontrado.constructoraseleccionada || baseRelacionado.constructora,
  } : encontrado;
};

function inferirCargo(personaNombre, comiteId, comites = []) {
  if (!personaNombre || !comiteId) return "Socio";
  const comite = buscarComitePersona(comites, { comiteId, comite: comiteId });
  if (!comite || !comite.directiva || comite.directiva.length === 0) return "Socio";
  const normPersona = normNomDirectiva(personaNombre);
  const palabrasPersona = normPersona.split(" ").filter(p => p.length > 2);
  for (const miembro of comite.directiva) {
    const normMiembro = normNomDirectiva(miembro.nombre);
    const palabrasMiembro = normMiembro.split(" ").filter(p => p.length > 2);
    const coincidencias = palabrasPersona.filter(p => palabrasMiembro.includes(p));
    if (coincidencias.length >= 2) return miembro.rol;
    if (normPersona === normMiembro) return miembro.rol;
  }
  return "Socio";
}

const constructoraDeComite = (persona = {}, comites = []) => {
  const comite = buscarComitePersona(comites, persona);
  return comite?.constructoraSeleccionada ||
    comite?.constructoraseleccionada ||
    comite?.constructora ||
    persona.constructoraSeleccionada ||
    persona.constructoraseleccionada ||
    "";
};

const DOCS_SOLICITUD = {
  habitabilidad: [
    { id: "dominio",  label: "Dominio de la propiedad", subopciones: ["D.V.","DRU","Goce","Usufructo","Otro"] },
    { id: "rut",      label: "Cédula de identidad colores" },
    { id: "avaluo",   label: "Avalúo fiscal detallado" },
  ],
  csp_urbano: [
    { id: "dominio",      label: "Dominio de la propiedad", subopciones: ["D.V.","DRU","Goce","Usufructo","Otro"] },
    { id: "avaluo",       label: "Avalúo fiscal detallado" },
    { id: "infoprevias",  label: "Informaciones previas" },
    { id: "cuenta",       label: "Cuenta de ahorro para la vivienda" },
    { id: "rut",          label: "Cédula de identidad colores" },
    { id: "agua",         label: "Boleta de agua o factibilidad" },
    { id: "luz",          label: "Boleta de luz o factibilidad" },
  ],
  csp_rural: [
    { id: "rut",          label: "Cédula de identidad colores" },
    { id: "agua",         label: "Boleta de agua (si corresponde)" },
    { id: "luz",          label: "Boleta de luz (si corresponde)" },
    { id: "dominio",      label: "Dominio de la propiedad", subopciones: ["D.V.","DRU","Goce","Usufructo","Otro"] },
    { id: "avaluo",       label: "Certificado de avalúo detallado" },
    { id: "ruralidad",    label: "Certificado de ruralidad" },
    { id: "cuenta",       label: "Cuenta de ahorro para la vivienda" },
  ],
};

const DB = {
  get: (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const carpetaNombre = (nombre, rut) => nombre.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "") + "_" + rut.replace(/[^0-9kK]/g, "");

// ─── GENERADORES DE DOCUMENTOS HTML (frontend puro) ───────────────────────────

function _fechaHoy() {
  const m = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = new Date();
  return `${d.getDate()} de ${m[d.getMonth()]} de ${d.getFullYear()}`;
}

function _fmtRut(rut) {
  if (!rut) return '';
  const s = rut.replace(/[^0-9kK]/g, '');
  if (s.length < 2) return rut;
  return s.slice(0,-1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + s.slice(-1).toUpperCase();
}

const _CSS = `
*{box-sizing:border-box;margin:0;padding:0}
@media print{@page{size:21.6cm 35.6cm;margin:1.5cm 2cm 2cm 2cm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
body{font-family:Arial,sans-serif;font-size:9pt;line-height:1.45;color:#000}
.pag{max-width:21.6cm;margin:0 auto;padding:1.5cm 2cm}
.enc{text-align:center;margin-bottom:18px;width:100%}
.muni{font-size:15pt;font-weight:bold;color:#1e3a5f;letter-spacing:.5px;display:block}
.depto{font-size:9pt;font-weight:bold;color:#1e3a5f;margin-top:2px;display:block}
.sep{border:none;border-top:2.5px solid #1e3a5f;margin:10px 0 18px;width:100%}
p{margin:3px 0}
.sp{display:block;margin-top:10px}
.spg{display:block;margin-top:28px}
.firma{margin-top:60px;text-align:center}
.ind{padding-left:72px}
.ref{display:flex;justify-content:space-between;margin-bottom:14px}
.pie{margin-top:32px;padding-top:7px;border-top:1px solid #ccc;text-align:center;font-size:9pt;color:#666;font-style:italic}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #999;padding:7px 10px;vertical-align:top}
th{background:#1e3a5f;color:#fff;font-weight:bold}
.lbl{background:#D0E4F7;font-weight:bold}
`;

function _wrap(titulo, cuerpo) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${titulo}</title><style>${_CSS}</style></head><body><div class="pag">${cuerpo}<div class="pie">Propietario del software: JACC</div></div></body></html>`;
}

function _encabezado() {
  return `<div class="enc"><table style="width:100%;border:none;margin-bottom:10px"><tr><td style="width:110px;border:none;padding:0;text-align:left;vertical-align:middle"><img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCACNAJsDASIAAhEBAxEB/8QAHAAAAgIDAQEAAAAAAAAAAAAABgcABQEECAID/8QARxAAAQMDAwIDBQQGBwQLAAAAAQIDBAUGEQASIQcxE0FRFCIyYXEVI0KBCBZScpGhFyQzU2KSwUOCsbIlNUVUY4OFk8LD0v/EABsBAAICAwEAAAAAAAAAAAAAAAQGBQcAAgMB/8QANREAAQMDAgQEBAUDBQAAAAAAAQACAwQFESExBhJBURMiYXEUMoGhByORscEW0eEkM0JS8P/aAAwDAQACEQMRAD8A7L1NTU1ixTU1NQ9tYsWBrJ7arK9WKVQ6W/U6tPZhw2ElTjzqsJA/1J8gOT5aUNava6bvUUUYybZoR/2qkD2+Un1APDCT5Zyv93UbcbpT26PxJ3Y/c+yIp6WSd2GBMa8L5tu13AxUp6TMUMtw2El2Q4Pk2nJA+ZwPnoKqHU26p4P6v2vHpzJGUyKzI9//ANlrJB+qvPQLXZtEsGlIqKaY4mPImNtS5STuWkrOPFcWo7lDPck+eh2Y5dtfv64bcZup+iJgMtSKciJHQfHbcBIUpSslWFDBAxpJk4ora3L6UCNmD5jknQgbDPcKaba4o8c+SUwZFXvx9pRqV8pjNk8iFT2mUpHoFLKj+etGeiox2Fy53UC6GW0kBS11JtpAyceSANKO8LmN2dN7XplcZluvVCqLjVFuntqcdc9n3eIptCeTyAePXWrXLgfqXQSoUStIdjVSky4sOSiQgocUz46C2pQ+aO/0Ogi27y8rpag5LuU46DOMj6/x3RIbSgkBg0H3TlpcuqvJVIo3Uytygg4Ufa2ZSQfps/11cQLm6jQFlf2zSK03gHw5cIx1Y/fbJBP1TjSron6tu9aoDlitRDDapb/2suAAGDk/dA7fdK84P01cdQ5VUqF1W7aVEqkulvylOzJkmP8AE2w2kpAwQQQVqHf01wNddIKpsUc5wQXHmGwGdwPZdPhqeRhcWbduqbtL6txWdjd20KfRCo8yk/1qKPq42NyfqpIA8yNMKkVGnVeA3UKXOjToroyh6O6HEK+hHB1y5QLxk0yLdiLpnMym7cdDZnstBBkJKNwSU5xvycYHcnW9aNUotWkuVaxay/QKwQFyI4T4eTns/FVgKGD8QwfRWmCk4oqYAfjWeUY8zc41Gf2KjZrYx2TEfouowBqeelzZXUhE6oM0C6Y7VJrLh2sLQsqizT/4Sz2V/gV73pnTFB0501VFVRiSF2QVCyxvjdyvGFnU1nWMaI3Wizqampr1YpqamprFi86qLprtMtmhyKzV5HgRGByQMqWo8JQkd1KUcAAcknVs6tCEla1BKQMkny1z/cFbF419dxytxt6klw0hoAq8cpBC5ZSO5OClAx2GR8Woq8XWO205kdqdgO5RVJTOqJA0fX0WjcdTlVxb96XshcWDTmlSYNJA3ohtpGS45j43yPyT2HmdUEqt07qNaMpiz6+pirNhMmO2VeG6hwEKQlaDzsPIPcHOqKlX7W65VqTJQikyKHXprlPTSUkqmMtDIU85zxgDKgewI1W2t07SqVU3Lsq06Axba1RaVKYIY2sZLgWXu7mAoJweAONV5JA6SQ1FwfiQEFoGoxnGOX0Oh1TLGREwRRDTr/dETV7Ue9raRbkikzpdVqLSotSgstE+wqCtqluKOAkJI3DnnjGqivU2j0SJRpV6Xy5S61Cp6oDwpr2HprAVlGU4K84HcD89VNw9QKhVnJFPsEGlUtbp9rrJaAemKwAVoGPPHxnk50MwaPChvKkJQp6U5y5IeVvcWfUk6ceH+Cauqbz4MMZOcbu199h/hLl24np6QlvzuRXE6i0OmswY1odPKhIapqVpiS5iwwG9/wAZBVlR3c5PnnXuZ1Mu55xaxaVv4X8YdfKyrHbJxzjVGDqrkXBRGJLkZ2pR0OtDKwtWMfLPmflp0b+Htmiwaglx7l3+UsHiy4S5EIAHtlGkDqncVNQEmwqapsnLggyQ0Sr5gjB15evGwrjuBFWqMu4LLuDwvZxK3EJKM52bgCgpzz2GhKLU0SJKYzkSZEdWgOsIksKa8do9nEhQGU/Ma+4XFllxjdHfCThbRwrn5jQ0n4e2mU+JSPLHajOc59D6IiLiy4xHlqGZHsjC8rRjt25SIdGZnVm1FSVTa1Jp8lL0uY6fgXkfGAeSBzwMDjRzYEGO/T2q0qpit7wpEOfIhhuUhnsW3FYBUQR3IHbSRo6ava037Qs6oOU9wK3OQlHdGf8AkUH4T8xjTPod7u3zbdQoVMlfq3dyIx+4eG4IPmtsnukjz7pznGq64q4bulvjbFJrGTq8dieun3HTTCbrRe6WscTHo7GxRH9s0K465U7T9mXOTDaBlvAfdNuZ/s94OQsd+ORj5aOunV5z6LVo1qXTLXKjyCGqTVXT7zi/KO+f73ttV+P97urenVSt61bKESpsi23ISy3OTPcwXXu6nErP9oFcEY9ca2qbetnXrPk2vGW/KDkcvhS2FoQpKT8SFHByDyFDz7aXbfVVdpqnGBjjCN+o03Pb10UtUU8dTHh5Af0XU+dTS36OXRMnIk2rcEgv1umISpElQwZ0U8Ie/eHwrHkrn8Q0yMatumqY6iJssZyClGWN0Tyx3RTU1NTRC0U1Dqah1ixLDrrWHlwIdnQXXESK2paZS2zgtQ0Y8U58irIQP3ifLSmuCppn1Ju27NuePTa1TB4qogYK2FISkYZdIGEjAHAORolqVVjTryuK650ltEFp/wCzoi3VYShlk4UoE9tzqlfwGl5b06rWY1UqU7aU+uwpkt5+LUqXtdEkOEna6QcpUAdueONVfeKk3Gtfya+Ho0HGCepOdDjtummiiENOD/23K+Ns0d6f1B+2m6U5atxR05q6EtB6FUI6jyttfYE479/XOhfqLdrt/VddJgOrRasF0pUQcfaDqTzk/wB2D5eerG7ahWrY6TUSxVPOsVuseIhz73cqJFKipQ3+qUqCM/XQ3CjMQ4bMSM2G2Wk7UgemnbgrhxtyqTcKkZZHkM6jTrnf2GThLHE14NJCKaI+Z262G0JShKEpCUpGAkcDWFlKElSlBKQMkk4AGtaM/KqtbZoFvxE1CpvqCCFLDbLKjk5dcPupGATjucca+dWXYtvVVtu7bgXecmM+2JdKpJU1Ty2ThxIeB3OOI+LHwq7atKqu8FL5Acu9ElUtpmqRzu0b6on6Y2HcHVWWU0lx2l2y25tl1nYdzpB5bjj8R9Vdh9ddWULpZ0+pFv0+hsWpTXokBwOsGQwl1Yc/vFKUMlR7knXvpNdFt3JaUJy2mosWI2yjbCZUn+qoI91KgnhKsclOcjz0ZY+elGqrZKl/M8pqpqWKnbysQb1N6b2n1FpjEG5IKlGMsLjSI6/CfZ9QlY5CSOCO38tC1a/R06Vz6S1Ch0FVGeYSQzMp8hbchJPmpRJ388+9nRJePVrpvaFVFKuS7qfBn7QVRyVOKRn9sIB2/wC9jRTQ6xS67TGqnRqhGqEJ4ZbfjuBaFD5EaGDyNiu7ow7cLk+8ehXUe2UuSKK/GvGnI5CMiPNCfofdWfoQTpY/ZFzXBU0Q7fte4hc0FXiNbIxYdiKHmtS8JAPoTzrua+bzodnU5M2ruunevY2zHT4jqiElRwnPYBJOTqko/Va2arGnO0qDWJ0iE34j0ZqHuc27dwIVnZ29VaMfcpHxGCQ8wIxgoQW6MSCRmh9Eg6aiB1AoE6l3tbKmrvo0VTEyI4nY+2VDclbR7DccEHkAn56pLLq79se1NyIE65+oFRbbEmO0kBEFof2bTi/gbAAyQO50yutImvw6b1hg0VylVGjstrqkVS0rclUt7zXt7Lb5VjnHPOh6Tb1zCtVGq2PWaXFgXD4cp9yQwVuNL2AeI1jhW5ODg9jqq7tSMt7nwPd+U/UAk4yDq3I1x1wN8Jzo5zUMD8eYaHCI3pFZhQ6VdfsSGK5SP6y/GYXvDrR4eYz5hSeRx3SDroakVCLVKZGqUF0OxZTSXWVj8SVDIOuW6ExAsu5YFEk1GoVWqXCVl6bLkhR8Rsbkp8PPuggnGBjjHppw9A5amKXWLVdP/U0z+rc5Hszw8RsD5JPiI/3NEcJVXgyOpCctI5m9NNjgb4z31Q94hJxL16pnampqaft1ArB1U3jU00W1arV15xChuv8A+VBP+mrfQJ17d8PpPW0A8vttxx/5jqEf/LXKofyROd2C2YMuASVnRJ8Pp5T4bFDp9dJZSZ8ea6lpKwoFayFEEBRWSefmdAHT40Oo3w3Trep9yWxNZdDkpmFOEqnkA5KFkEgbhxxzom62RbTnLgQbluyVQ1tJ8RlpoFTTwyOVIwQcEdj89bPSiZvRKFPvOlVylRWdqWI1OTFcZV5FQTjjg+WqlppzHQPmIPM7PRwGpx6g/b3Tc8fmNZ0GEBT4dz9S+vNVpFtRQ45DCIaZTnEeFHT/AGjq/mVEgJHJI00Wf0Y6+9tbqHUlSY6iA6mJTQhZT5hKio4PbnR1+iBBZb6OR6wlhKZNXnSpb7hSNzpLygkkjvgJwNNarvx4tKmSJcwQ47bC1uv7tvhpAJKs+WBzq3La+Sjo2U7HYaBsk6qhimnMjm5OVyP+lFLs7p/YDfSi3rOkRDNfZkrqLo2+J4SgS5vzudWe2TgDcdc/piKSgIUW97rZbQFD55H8tXHWqVBq3UyZOp8muyIcvYpqZWVEvyB/eJSQMNkfCMDjnVW+2hqkNl85XH2/ng4H8s641LskKUoWNLXEjZEFh3Tc1kOqft6uP0lbigp5tkhbLyk9ytKhyO3pnT4pX6VEiRSfAqdrqivqRsVPjSUrQk5wXA0ofnjPprnGisy6u6mPSG6hNyMKS3HLiW/3lYwBrfkWnc1PJpsime3lH/dELdSPQEhPB+RA0KZHAEc2EW+KF5GmndFs60umU9UWsRqjdVwTazPWy2l10NB6QDlQdUocHnk8/LTgse45nTKxKpcYtyFAplLlRW6nSITynHGWXM73txO0uAqT9Qk57jAdbDC7LptvWyaJ7ZUqqtdUmreSpSYoGAQAkEhQJQkY+edMiNMEnp5cNoVWgyHFV1qQBJQQAHF5CQ7vwQE+7hWDkDsPMSlYGSh8rycdSf4Q9RGeTDBkq9vaj2bdNnK6iW84zNC21PMrQ4VNSvE2hbak+SlEAeqSkemNAcY0a5LmnWJU+sFatiVGIQ1TYfhQxJStAVu8XaPEXzgjOePPOhnphZlyW3WUw5bcyPBTELzzEeSF096aAlCXUp4IXjcSCMZ51pP2Cm9plVrdouU+6KpFl+xVuhyX0oUWUIAbfaWr4V7gec4OflqQjma+Y47IJ4LIdRr2RZ1Zp139NLrp9Btu5PaaReEd1mWa40JSFyGkbdmeClKmyMJHGQdD/Th6RP6Qz7eqVRqcJ+35S4kp2mq+/wDCbVuCU+Yyk445xoOqbN5S4irRYqNRRKok1uYKBXlBciItGdqo755UggkeYIPlo36TPLb6lXq0YymfaYsKb4ajjYoIUFZ475x/DUFxS1rqQydYyCO+cgfyss9STWGIHQg6KnpKOjMlcVylXAIFVjTGnvbpqnPatyDkoUp3CTnkED108LEmiF1bpvhhAj1qmPMKI/Etoh1sj/dLuklR7Zp9bcnv3rdtHTCmz3JqqNDmthCXFEH33D7xHntHGc6bMFUVi7bHmQlIMdqpezsqQrcnY40tHB9McaWYZWw3WAte52pBzqNegOB/bsmKoYXUzwWhdCampqatFKimgHr22Xul9QwQA29GcUT6JkNk/wDDR9oV6s05VV6a3FAbBLjlPdLYHmtKSpP8wND1beaB7fQreM4eElLyeuRqWz9hWpCrTZQS45IlJbKFZ4AyDkYOdUFqUytv3bV7hrMCk0p16m+yNwYUgOqWAdxccxj1AGvl1SiwKzblIrU28JNv08tJU6G1KCZZWkKSn3SFE8Hgd9DHR+XTIF4tsQE0eLGloLRU4NtQkKwSPcClkDjJ3YOqmpKc/APczcZzoehyRknH6BOEsmZOX0X36SXh1Tj9MaZRLerVCo9Lgh5hpxUIvSFferUpSio7QQScYHpr6VcXtTKdNqkPqTXpE5whchM15C4rqu+ShQ2oSMeXl5HUsdCqfWrptpQIcp9VcWhOP9k776T/ADOvfURdVRQXfs6WxCaQhb8mU42F7EoGQlOeNyjxny1YsdW+XlIOhwVWNTUVDax0OcapCSpU6vXJPqVTqD9YlPlRemuElTiuwUM8gcYA9Ma+9ZSXaT4Y4c2b9nnx31p0GS+85JlSSpbq071qWrKlH5635QLPsr6xkZ8N0+QSod/46Lld58p3o4/9Kc9UybAuN2zrNan02GmFGlR23Zfix1vNOOp93xUlChglIwU5BBHbRPTeo8Cr1Bp+pU2uMQ1sFbMxNLU0l8gjIStBJ25I5Ucc+WgGgVddP6bT6W6lxcBFTZYkv44jRn1DcTjnHxAcafkKdJcksKhz6cqkeyeI2yplaVhvOEqB7bcADGNBTPGckIW3sqA50cmgB0QrWaS1cUr2SiSJ1DDLYkTKl7QpDpTtJDXJJ27uVEYxt7nS1Z6gdQ36suPb86ZPZhtBMY+zIcEvYdqlLJI93B4UO/unGji4HF1zqpJpJXNboTNHaK4ThLTUhRcOF7cA7ccEHAP01H6WzOqs5VPeTDmQvA8BxCOG1bMDKfNJThJHy+WtmPa3cZUbcrv8PL4UZ1CE7QuC6ruvqU3VLiqkUsQfv4kZr2UNqKsFoJye3feOT8tGDttGnzYNYtCoP29WqenZHlse8HG/Nt1J/tEn56xToMtiryp/6vxmqrKQEvSkStzKkp7HHxD6Y/PV7FbeQwEyHUOOgkEoRtGPLjWr5cP5mjCWqq5TyvDubZA3VK5r7ku0Sr3VSqdUZlHneImuU1otuGMoYcZfa/Z5yCDgY+eiTp26h7q3dL7B8RDdJioJT5lRKgPzGrbzxng9xoTsZ2fGtnqRe9LaKpUl9bcJKU7vcYBSCE+eMqOPlqNvshmoXsO7sAfUhTfDk8lRWB7h8ucrUrtMdmXAar/Q8+imtwnoyWkstb3H3DlDpSPIYxk8jOmZZFMkUmn9N6K+gIfj1CKlxPoUpWpQ/LS3qTNIo9nt3lbN/wBTkVw+EsB2o+KJjqlJ3NKZ7gkkjABxp124l2b1Ss9jIT4DUme+gdseF4Y/gpwagmSPkq6aJvyh3XIOWj1J77p0kIbDJnt+6fGpqamrOSqprw4hK0KQoApUCCPUa96h7azGVi5jRbFIn0qbZtfgonM0WouR0suZSnaklTKgAe3hrA/I6uKTb1BpGBS6NAhAdvBYSk/xxnV/1YpwoV8wrjbQUwq02inzVfhQ+jJYWf3gVIz67fXWkDnVF8UQVFBWPhDiGOOQM6a7p3tb2VEIcdxulR1Lj/qz1DpN1oSoU+qN/Z1RV2Dbg5Zc/PkfloN6+vVJNJYjsOOM0/cFyCnnxllWEIz6cFR+o09bsoUC5rbnUOopzHltlG4D3kK7pWn5g4I0hbkrcqm2/ItO6E5rtOWhLG9OUT0c+G78wOCof4dOHCFzbUwtid8zPuOh/hKfEFqeyrbURjIcdUpKOrDrjZWEhxBTzq7iOIl05SX2lDCdisjuQOcarIFNkNLYe3EqWk7lK7hX+Ieh1vKqK2pKI6YThdxylP4fmPlpymLXO8qk6NroWYk0H6ot6FLplTuKRR6s2481Uqe7A8LcUb1cLQPTd7pwT2IHrp2W+7WVRf8ApK4nE0ttIDqFU9TE9spSE+Cr8AJIxkcqzx665shsvI8J5pS4S2leI14KuWlJ5C93moHTlsnqBVbwREtKqO+HXktqIneIENvoSAd2ByXMHlIxnk58tLN5pqtzi6ldvgEdvUImMeGBzL73PFXDq8aUA5GeZkNSZLcdAUmCw4SnL7pyp1awANudqAcjsNb1wRW2ZkKqNRnFOsyEeMtoEr8LBCs4+Py45+Wr6jWy3T67W4n3sqNVqe0XFvq3FTqUqbJI8hgJ47DGqyhvKdo0RxZUT4ew7j7xKfdJP1wdF0kZiiDXHJSXxNT8r2y91ssrS62l1AOxQyNySD/A8jXvd8tTOvDzjTEdx+Q6hplpBW46s4SlI7knXVKg8youoNXcpNsvGGAupSyIkBvuVuudsDzxkn8tH9iUFFsWbTKG2cqjMgOqH43DypX5knQB03pz16XOi+akypuj0/c1QmFDHinsqSR88YGm0NIPGFzaS2kiOeU5Pv2+itThO1GkhMzxq5UrFpWsxWRWWrfpqJ6Vbg+GAFA+o8s/PRj0Zimo3ncdcVgx4iG6VHOOFKH3r5HyypCfqg+mh2u1L7KpTkxLXjPJIRHYHd55R2toH1URpr9NLcNr2VApTq0uykpLst1P+0fWdzivzUTqR4Hppqqc1cxJ5RgZ1Rl7kZGwRsGpOqKNTjU1NWoldTUOprBxr1Yqa8bfhXRbU6hTspZltFG9PxNK7pWk+SkqAUD6gaStFkzUOyqJWUFutUpYZmJxw6D8D6PVCxz8juHlp71KoQaez406WxFbH4nXAkfxOkl1ou6xZoZrNFuKK5cdPSUspYQpxuW0feVGcUkYAPdJJ91XPrpd4k4cdeaf8tuXt2R1Bc2UMmXnAK2dB3U+woF60xCSsRKpGSfYpgTktn9lXqg+Y/Ma1HOp1LSylaKdNWSkFQygBBx2znWhJ6pOhwqYorSUnspyTnP5ADVf23gniWGYTQwkEd8BTVTxFai0tfID7apGVqnVS36quk3DEEKYD92of2cgftIV2I1XvgCqsrUtIBbKBnzOc6cV1XSu56OuFWKFSX4quAtSFKKFHkFJJ4P00vEWlCKEJMmU8lC9zSSrGD6AY1blusNzli5qhga/rgjHuoCbiejYcNJcPZVmqipTp1JrUOr050tPxVJU04PMg5wfkex0ex7ZDrhbZizXHQncW0pUVAfTGdfORb0Z+OoONPFsK2KOOArvjPrxqQi4aqmnJIXKfimikbygOTr6f3q1e8Z1dMprsdbMRKX3XAEoZkqzloeagOFZHGDocsp/fQW4jzjCp0Jxcaahte7Y8lZ3DPoe4+R0EUVqZbc/2iBLlxXFEOKa3ENucDaooPB47HX3TInM3DJuFsliZKaS1KUhgJbcA7KWgDG7/EedcncJ1RyQRr6qCu14p66MBuchMCrVKnUmA5Oqc1mIw3yVOKxn5D1PyGqGi0Sq9R5KJFUiyaTZ7RCm46wUP1PB4Kh3S38vPQnES0LhFdqmKzKbOWEVD7xpk+qUdho9a6nVcJw5S4Sx6IK0j/iRqBvHD17ZGWUTASeuRp7L2zS2uJwkqHHI6YTOYZZjR248dtLTLSAhttAwlCRwAB6a+iRnS/j9To6gn2ijSEHzLboUP5ga9Sb4pNYkRKT7ZKosGSpQqFRW0Sthod0thOTvX8IVjCeT6aq13AV+8YNlhIydSrEbxLbTGXMkGnRMjprRk3Xd3284ndRKG6pMLsUS5nZTo9Ut+8kHzUSfwjTpA440GWVdNhKpUamWzWqUmLGbS0zFbfSktpA4G04IP10ZJI76tu22ttrp207RjH6pZnq/i5DJnK9ampnU1ILiqS7LlotqUk1WvTkQoYWG/EUFKys9kgAEknB0sa9+kJa8VJFHp1Qqa8ZSVJDCD/m94f5dNqsU+FVadIptRjNSokhBbeacTlK0nyOuResVit2Hc7cGJMRIhS0l6MlSwXmUg42rHpnsrz+o1KWqCnqJPDlznooq5T1ELOeLGOvotbqj1AqF/Toi6jTocNmKFlhDKitXOM7ieD+QGvjSbapkxu3ky6w5HkVh5HhITGKh4anS2oBfYLBAOCMe8NCsjhIPoR/oNX0S6ahAobVLQmIjwiox5Sk/fMhS0rUlCuw95CTnGRpsfSuiiDYNMFLLahsknNNqSji1bIt2apbrjUhxt9ppaW5Ekhxk+K604hJbAC3AttO3Ix72NfKkWqhdGs+bTKc2Z63EpqKXkpcUth1S/vFtk+6U+GpIOPpoFeuS4KvMWuNKlyXEpG5EJk4AC944QMZ34V6551uRbUvuquKfat24nio+86tpxIPn3Vj1J9OdBPEjMmSX6bozma7/AG4s/ZHDjkUUCXJXBg06KlUp5+OtpCVNSEyW1R8g+8CWzgAcYzrR6g1Ggu1a3p9NditpZrEhUtprAQ0A8g7hj8KhyPLvqki9KupUklxFmS0hXm7KjoP8SvOhS46PeFvzhDrFl1SAVHaHnlo8BfOMB0Eo/nrh4tJEed0q6llTIORsaalUrVOeFTiCuQJExyC4026aiptKgZxdbR46Ochs52g9sJOgulJhyLIqFMfqUKM+ao1JHjLKQ82lBSpSeOTzqpp1uXfU0boVHgOJBxkVVhX/ACqOrD+j7qIP+w6af/UB/wDnUb/Udkgy01AGdV2Ntr3uBMO3/u6JbvmWrXbvt99uqoVTI59lmF5IQUssr+7OPMKSAAfPRAxdFvrqNVqaKqy69VTHdSypSWgVJivZQ8k59zftSQPMp50uv6PuoHdykUloeq6lgf8ALrRl25XISvDffoBeKglLLdT3LUT5BOw61F/s05axs+cLYUFxYSTDucpiwodGeoFAgwXKfMm0+HJadbDYCnX3Iu8JJIwshZOCM4xjg6+Vw0KMxBmCl25EqS1LVDedR2j+Ew0gKSrOAouLKiOSogjQnQenXUesxlyo1kVBtkfAuS80wpweqUuKSrH1A1svdO+pEFAP6sVplO4EpYcSsAjsfu1EE/PUs10BILJUM4Tf8okTy+m9McrbVKa8eKr7MWlDvibvGmB7wkKP7KVKz7vlqicslt2ox6VElAB6TK3S3wMssMFKElQHB3LJGAM5A1XCPflCCCunV2KiK4l9HiR17AtK/EB7ftEq+p15pXUOt06WklyG6tBSHQ+0Aso3qdKOfh3KWSTjPCfTXUCoJ8kgcuTnwt+dhBQbdDaWqfLa8Peo5ZBB8yrbx6aetodf6jT4seFWaBHkMMNJaSuG6pCkpSkAZSvOT+Y0irgc8eXGaCSPaJniEfIe+RrbUdjK14UrbzgDk6Kmo4qpx8QZwhoquSmALDuutrc62WLWZTENcyTT5L6whtuXHUApROAApOU9+OSNMzSS/R+6a06m0uHd1RVHnVKS2HImxQW3GQoeWOCv1Pl2GnZnSZWMhZKWxZwE30j5Xxh0uMoP6pXvT7FtxdSlAvSnSURIyT7zznp8kjuT5DXIlRm1q7bjfqUhD9TqctWVCO0pY4PCUgZwkdgNddV7p5atfuP9YK7BcqUoNpbabkPrUyykfsN52jPn66I6ZAgU9gMQIMaI0OyGWwgfy0TQ17KVpLW5cevZDVlBJVvALsNC5Do/SW/6y3hNuOxml91zHUsgD1wTu/gNE9D/AEY6ssFdVrUCGpQ5THC3yPzXgfy11CDr0NbS3qpk7BaxWenjHUoB6R9OGOnsGZDjVmbOZlLS4WnUpS22sDBKABkZ4zz5aPhqY1MajHyOe4ucpKOMMbyhZ14UlKgUqAUk8EEa96mtVuhipWHZtRdL0q2aUt093Ex0oX/mSAdUn9DfTjnFvqHPlOkD/wCzTC1NcHU0TvmaD9FuJHDqgSJ0k6eRXCtu22F5GCHnnXQfyWojRNR6DRKOnbSaRT4PGCY8dLZP1IHOrXUxr1lPEz5WgLwvJ3Kxg+upz66zqa7LVYI0hby/R2ardZn1hF2Sly5j63lJlRkLSCryynBwOAPlp96musM8kLuZhwuM0DJm8rwuSap+jndtMcMinIplU2Z27JKkOc8cJcG0cf4tCdcsu76G2pdUtuox0J7ueFvR/mTka7i1DqUhvk8W4BUbNZYJNiQuSehXU5Vn1RNFqrylUGU5727O6G4fxgfsH8Q8u/rrrFh5D7KHmVJcbWApKknIIPnqhuOy7UuRtaazQYMsq7rU0Av/ADDB/nrNuW1DoFGYpFNkzhDjbkspdkKcUlJUSE5PkM4A8gAPLQVZUx1L/Ea3BO6MpIJIG8jnZHRf/9k=" style="height:90px;object-fit:contain"></td><td style="border:none;padding:0;text-align:center;vertical-align:middle"><div class="muni">MUNICIPALIDAD DE LAUTARO</div><div class="depto">UNIDAD DE VIVIENDA MUNICIPALIDAD DE LAUTARO</div><div class="depto">ENTIDAD PATROCINANTE</div></td><td style="width:110px;border:none;padding:0;text-align:right;vertical-align:middle"><img src="data:image/png;base64,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" style="height:110px;object-fit:contain"></td></tr></table><hr class="sep"></div>`;
}

function generarHtmlMemo({ numero, nombre, rut, direccion, coordenadas, problemas, remitente, destinatario }) {
  const de = {
    nombre: "MARCELO CIFUENTES VÁSQUEZ",
    cargo: "ENCARGADO ENTIDAD PATROCINANTE",
    institucion: "MUNICIPALIDAD DE LAUTARO",
    iniciales: "MCV/mcv",
    ...(remitente || {})
  };
  const a = {
    nombre: "SEÑOR EDUARDO BUSTOS VALDEBENITO",
    cargo: "DIRECTOR DE OBRAS",
    institucion: "MUNICIPALIDAD DE LAUTARO",
    trato: "PRESENTE.",
    ...(destinatario || {})
  };
  const lista = Array.isArray(problemas) && problemas.length > 0
    ? problemas
    : ['(Sin especificar)'];
  const probHtml = lista
    .map((p, i) => `<p style="padding-left:60px;margin:5px 0">${i+1}.- ${String(p||'')}</p>`)
    .join('');
  return _wrap(`Memorándum N° ${numero}`, `
${_encabezado()}
<div style="text-align:right"><div style="display:inline-block;text-align:left"><p><b>MEMO N°&nbsp;:</b>&nbsp;${numero}</p><p><b>MAT&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b>&nbsp;Solicitud evaluación de vivienda</p><p><b>LAUTARO,</b>&nbsp;${_fechaHoy()}</p></div></div>
<p><b>DE&nbsp;&nbsp;&nbsp;:</b>&nbsp;<b>${de.nombre}</b></p>
<p style="padding-left:60px">${de.cargo}</p>
<p style="padding-left:60px">${de.institucion}</p>
<span class="sp"></span>
<p><b>A&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b>&nbsp;<b>${a.nombre}</b></p>
<p style="padding-left:60px">${a.cargo}</p>
<p style="padding-left:60px">${a.institucion}</p>
<p style="padding-left:60px">${a.trato || "PRESENTE."}</p>
<span class="sp"></span>
<p style="padding-left:60px">Junto con saludar cordialmente, me permito informar a Ud., el ingreso de una solicitud para evaluar vivienda de:</p>
<span class="sp"></span>
<p><b>NOMBRE:</b> ${(nombre||'')}</p>
<span class="sp"></span>
<p><b>RUT:</b> ${rut||''}</p>
<span class="sp"></span>
<p><b>DIRECCIÓN:</b> ${(direccion||'')}</p>
<span class="sp"></span>
<p><b>Coordenadas:</b> ${coordenadas||''}</p>
<span class="sp"></span>
<p><b>PROBLEMAS DE LA VIVIENDA:</b></p>
<div style="margin:8px 0">${probHtml}</div>
<span class="sp"></span>
<p><b>ADJUNTO:</b></p>
<span class="sp"></span>
<p>- Rut del propietario.</p>
<p>- Informe de evaluación previa. vivienda revisada por JACC.</p>
<p>- Escritura u otro que acredite la propiedad de la vivienda.</p>
<div class="firma">
  <p>Sin otro particular, saluda atentamente a Usted.,</p>
  <span class="spg"></span>
  <p><b>${de.nombre}</b></p>
  <p><b>${de.cargo}</b></p>
  <p><b>${de.institucion}</b></p>
</div>
<span class="sp"></span>
<p>${de.iniciales || ""}</p>
<span class="sp"></span>
<p><b>DISTRIBUCIÓN:</b></p>
<p>- Destinatario</p>
<p>- Archivo Vivienda</p>`);
}

function generarHtmlCarta({ numero, nombre, rut, remitente, destinatario }) {
  const de = {
    nombre: "MARCELO CIFUENTES VÁSQUEZ",
    cargo: "ENCARGADO ENTIDAD PATROCINANTE",
    institucion: "MUNICIPALIDAD DE LAUTARO",
    iniciales: "MCV/mcv",
    ...(remitente || {})
  };
  const a = {
    nombre: "SEÑOR MARCO SEGUEL REYES",
    cargo: "DIRECTOR DE SERVIU (S)",
    institucion: "REGIÓN DE LA ARAUCANIA",
    trato: "PRESENTE.",
    ...(destinatario || {})
  };
  return _wrap(`Carta SERVIU N° ${numero}`, `
${_encabezado()}
<div style="text-align:right"><div style="display:inline-block;text-align:left"><p><b>CNº&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b>&nbsp;<b>${numero}</b></p><p><b>MAT&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b>&nbsp;Lo que indica</p><p><b>LAUTARO,</b>&nbsp;${_fechaHoy()}</p></div></div>
<span class="sp"></span>
<p><b>DE&nbsp;&nbsp;&nbsp;:</b>&nbsp;<b>${de.nombre}</b></p>
<p class="ind">${de.cargo}</p>
<p class="ind">${de.institucion}</p>
<span class="sp"></span>
<p><b>A&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b>&nbsp;<b>${a.nombre}</b></p>
<p class="ind">${a.cargo}</p>
<p class="ind">${a.institucion}</p>
<p class="ind">${a.trato || "PRESENTE."}</p>
<span class="spg"></span>
<p class="ind">Junto con saludar cordialmente, me permito informar a Ud., el ingreso de una solicitud para quitar la marca de subsidio de vivienda registrado en el sistema a nombre de <b>${(nombre||'')}</b>, RUT: ${rut||''}.</p>
<div class="firma">
  <p>Sin otro particular, saluda atentamente a Usted.,</p>
  <span class="spg"></span>
  <p><b>${de.nombre}</b></p>
  <p><b>${de.cargo}</b></p>
  <p><b>${de.institucion}</b></p>
</div>
<span class="sp"></span>
<p>${de.iniciales || ""}</p>
<span class="sp"></span>
<p><b>DISTRIBUCIÓN:</b></p>
<p>- Destinatario</p>
<p>- Archivo Vivienda</p>`);
}

const SOLICITUD_2026_PDF = "/plantillas/formulario_solicitud_habilitacion_inhabitabilidad_2026.pdf";

function anioSolo(v) {
  if (!v) return '';
  const m = String(v).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : String(v);
}

function textoSubsidioSolicitud(persona = {}) {
  const anio = anioSolo(persona.anio_subsidio || persona.anioSubsidio);
  const existente = persona.subsidio_adjudicado || persona.subsidioAdjudicado || persona.subsidio || persona.programa_subsidio || "";
  if (existente) return existente;
  const tipo = String(persona.tipo_comite || persona.tipoComite || persona.tipo || "").toUpperCase();
  if (tipo.includes("RURAL")) return `SUBSIDIOS RURALES TITULO I Llamado N°1${anio ? " Año " + anio : ""}`;
  if (tipo.includes("URBANO")) return `SUBSIDIO HABITACIONAL URBANO${anio ? " Año " + anio : ""}`;
  return anio ? `SUBSIDIO HABITACIONAL Año ${anio}` : "";
}

async function generarPdfSolicitudOficial({ nombre, rut, direccion, telefono, subsidio, anioSubsidio }) {
  const plantilla = await fetch(SOLICITUD_2026_PDF).then(res => {
    if (!res.ok) throw new Error("No se pudo cargar la plantilla oficial 2026.");
    return res.arrayBuffer();
  });
  const pdfDoc = await PDFDocument.load(plantilla);
  const page = pdfDoc.getPage(0);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  const upper = (v) => String(v || "")
    .replaceAll("N°", "NRO ")
    .replaceAll("n°", "NRO ")
    .replaceAll("°", "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const draw = (text, x, y, size = 9, max = 56) => {
    const value = upper(text);
    const lineas = [];
    let actual = "";
    value.split(/\s+/).forEach(palabra => {
      const intento = actual ? `${actual} ${palabra}` : palabra;
      if (intento.length > max && actual) {
        lineas.push(actual);
        actual = palabra;
      } else {
        actual = intento;
      }
    });
    if (actual) lineas.push(actual);
    lineas.slice(0, 2).forEach((linea, i) => {
      page.drawText(linea, { x, y: y - (i * (size + 2)), size, font, color: black });
    });
  };
  const hoy = new Date();
  const fecha = `${String(hoy.getDate()).padStart(2, "0")}/${String(hoy.getMonth() + 1).padStart(2, "0")}/${hoy.getFullYear()}`;
  const [dia, mes, anio] = fecha.split("/");

  draw(nombre, 205, 594, 8.5, 50);
  draw(rut, 205, 568, 8.5, 28);
  draw("LAUTARO", 205, 541, 8.5, 28);
  draw(direccion, 205, 515, 8.5, 54);
  draw(telefono, 205, 488, 8.5, 32);
  draw("Jcampos@munilautaro.cl", 205, 462, 8.5, 46);
  draw(subsidio, 205, 436, 8.2, 56);
  draw(anioSolo(anioSubsidio), 205, 394, 8.5, 20);
  draw(dia, 149, 125, 8.5, 2);
  draw(mes, 206, 125, 8.5, 2);
  draw(anio, 269, 125, 8.5, 4);

  const bytes = await pdfDoc.save();
  return bytesToDataUrl(bytes, "application/pdf");
}

function generarHtmlInformeJACC({ nombre, rut, telefono, direccion, coordenadas, subsidioTexto, fechaVisita, estadoVivienda, filas }) {
  const rutFmt = _fmtRut(rut);
  const filasHtml = (filas||[]).map(fila => {
    const img = fila.imagenBase64
      ? `<img src="data:${fila.mimeType||'image/jpeg'};base64,${fila.imagenBase64}" style="width:7cm;height:auto;display:block;margin:0 auto;max-width:100%">`
      : '<span style="color:#aaa;font-size:9pt">Sin imagen</span>';
    return `<tr>
      <td style="text-align:center;font-weight:bold;width:50px">${fila.numero}</td>
      <td>${fila.descripcion||''}</td>
      <td style="text-align:center;width:8.5cm;padding:6px">${img}</td>
    </tr>`;
  }).join('');
  const encJACC = _encabezado();
  const parrafoVerificacion = `<p style="margin:18px 0;line-height:1.7;text-align:justify">Según el registro de verificación con fecha <b>${fechaVisita||'_____________'}</b>, con las visitas de inspección realizadas en la propiedad indicada. Se informa que la vivienda se encuentra en estado: <b>${estadoVivienda||'_____________'}</b></p>`;
  return _wrap(`Informe JACC - ${nombre||''}`, `
${encJACC}
<p style="text-align:center;font-size:13pt;font-weight:bold;margin-bottom:18px">INFORME TÉCNICO DE VISITA JACC</p>
<p style="font-weight:bold;margin-bottom:8px">I. ANTECEDENTES DEL BENEFICIARIO</p>
<table style="margin-bottom:18px"><tbody>
  <tr><td class="lbl" style="width:35%">NOMBRE BENEFICIARIO</td><td>${(nombre||'')}</td></tr>
  <tr><td class="lbl">RUT</td><td>${rutFmt}</td></tr>
  <tr><td class="lbl">TELÉFONO</td><td>${telefono||''}</td></tr>
  <tr><td class="lbl">DIRECCIÓN</td><td>${(direccion||'')}</td></tr>
  <tr><td class="lbl">COORDENADAS</td><td>${coordenadas||''}</td></tr>
  <tr><td class="lbl">AÑO Y TIPO DE SUBSIDIO</td><td>${subsidioTexto||''}</td></tr>
</tbody></table>
${parrafoVerificacion}
<p style="font-weight:bold;margin-bottom:8px">II. REGISTRO FOTOGRÁFICO</p>
<table>
  <thead><tr>
    <th style="width:50px">N° Foto</th>
    <th>Estado de la Vivienda</th>
    <th style="width:8.5cm;text-align:center">Fotografía</th>
  </tr></thead>
  <tbody>${filasHtml}</tbody>
</table>
<div style="margin-top:60px;text-align:center">
  <p style="margin-bottom:2px">_________________________________</p>
  <p style="font-weight:bold;margin-bottom:1px">JORGE ANTONIO CAMPOS CAMPOS</p>
  <p style="margin-bottom:1px">CONSTRUCTOR CIVIL/ENCARGADO C.S.P.</p>
  <p>UNIDAD DE VIVIENDA/E.P.</p>
</div>`);
}

// Convierte campos camelCase de la ficha a nombres de columnas de Supabase
function toDbFields(form) {
  const MAP = {
    fechaNacimiento:        "fecha_nacimiento",
    integrantesFamiliares:  "integrantes_familiares",
    puntajeRSH:             "puntaje_rsh",
    comiteId:               "comite_id",
    nFJS:                   "nfjs",
    sistemaAgua:            "sistemaagua",
    nServicioAgua:          "nservicioagua",
    proveedorElectrico:     "proveedorelectrico",
    nClienteElectricidad:   "nclienteelectricidad",
    certRuralidad:          "certruralidad",
    avaluoFiscal:           "avaluofiscal",
    informacionesPrevias:   "informacionesprevias",
    infPrevias:             "infprevias",
    antecedentesVivienda:   "antecedentesvivienda",
    movilidadReducida:      "movilidadreducida",
    credencialDiscapacidad: "credencialdiscapacidad",
    cuentaAhorro:           "cuentaahorro",
    rutColores:             "rutcolores",
    subsidioAnterior:       "subsidio_anterior",
    estadoCivil:            "estadocivil",
    ahorroPostular:         "ahorropostular",
    adultoMayor:            "adultomayor",
    permisoEdificacion:     "permisoedificacion",
    recepcionDefinitiva:    "recepciondefinitiva",
    constructoraSeleccionada:"constructoraseleccionada",
    metrosOriginal:         "metrosoriginal",
    metrosAmpl:             "metrosampl",
    metrosNoRegul:          "metrosnoregul",
    totalMetros:            "totalmetros",
    modalidadPostulacion:   "modalidadpostulacion",
    // Ya en snake_case — pasan directo:
    // dominiopropiedad, discapacidad, banco, rol, cargo_comite, numero_lista, etc.
  };
  const EXCLUDE = ["comiteId", "fechaIngreso"]; // campos que no van en update directo
  const result = {};
  for (const [k, v] of Object.entries(form)) {
    if (EXCLUDE.includes(k)) continue;
    result[MAP[k] || k] = v;
  }
  return result;
}

const isBlankFichaValue = (v) => v === null || v === undefined || String(v).trim() === "";

function protegerDatosFicha(form, persona, extra = {}) {
  const protegido = { ...persona, ...form, ...extra };
  for (const key of Object.keys(persona || {})) {
    if (isBlankFichaValue(protegido[key]) && !isBlankFichaValue(persona[key])) {
      protegido[key] = persona[key];
    }
  }
  return protegido;
}

// Carpeta estructurada: programa/comite/rut
// Usa persona.tipo_comite primero (disponible desde Supabase sin necesitar solicitudes)
const carpetaPrograma = (persona, solicitudes) => {
  if (!persona) return "";
  const cid = persona.comiteId || "";
  let prog;
  // 1) Detección por comiteId conocido
  if (cid === "comite_desmarque") prog = "Desmarque";
  else if (/^gr\d+R$/i.test(cid)) prog = "CSP_Rural";
  else if (/^gr\d+U$/i.test(cid)) prog = "CSP_Urbano";
  // 2) Detección por tipo_comite en persona (no requiere solicitudes cargadas)
  else {
    const tipo = (persona.tipo_comite || "").toUpperCase();
    if (tipo === "RURAL") prog = "CSP_Rural";
    else if (tipo === "URBANO") prog = "CSP_Urbano";
    else {
      // 3) Último recurso: solicitudes (si ya están cargadas)
      const sol = (solicitudes || []).find(s => s.personaId === persona.id || s.persona_id === persona.id);
      const pid = sol?.programaId || sol?.programa_id || "";
      const map = { habitabilidad: "Desmarque", csp_rural: "CSP_Rural", csp_urbano: "CSP_Urbano" };
      prog = map[pid] || "SinPrograma";
    }
  }
  const comite = (cid || "SinComite").replace(/[^a-zA-Z0-9]/g, "_");
  const rut = (persona.rut || "").trim();
  if (!rut) return carpetaNombre(persona.nombre, persona.rut);
  return `${prog}/${comite}/${rut}`;
};

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 18, padding: "28px 32px", width: "520px", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 20, color: "#1e3a5f", marginBottom: 22 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function LineaAvanceDesmarque({ sol }) {
  const [abiertos, setAbiertos] = useState({});
  const st = estadoLineaDesmarque(sol);
  const estadoActual = estadoActualLineaDesmarque(sol);
  const paso = (numero, label, estado, detalle = "") => ({ numero, label, estado, detalle });
  const pasos = [
    paso(1, "Ingresa solicitante", "done", "Datos iniciales del solicitante"),
    paso(2, "Documentos obligatorios", st.docsCompletos ? "done" : "pending", "VB cédula de identidad y título de dominio"),
  ];

  if (st.calificacion.estado === "NO_CALIFICA") {
    pasos.push(paso(3, "NO CALIFICA", "stop-red", st.calificacion.detalle));
  } else {
    pasos.push(paso(3, "Califica para visita", st.calificacion.estado === "CALIFICA" ? "done" : "pending", "Acción manual del usuario"));
    pasos.push(paso(5, "Fecha de visita", st.visitado ? "done" : "pending"));
    pasos.push(paso(6, "Memo recibido DOM", st.solicitudDom ? "done" : "pending", "Subir memo recibido"));
    if (st.informeRechazado) pasos.push(paso(7, "RECHAZADO DOM", "stop-red", st.informeDetalle));
    else if (st.informeRechazadoApelable) pasos.push(paso(7, "Informe DOM rechazado apelable", "warn", st.informeDetalle));
    else pasos.push(paso(7, "Informe DOM", st.informeIngresado ? "done" : "pending", st.informeDetalle));
    pasos.push(paso(8, "Ingresado a SERVIU", st.ingresadoServiu ? "done" : "pending"));
    if (st.desmarcado) pasos.push(paso(9, "DESMARCADO", "final-green", st.respuestaDetalle));
    else if (st.serviuRechazadoApelable) pasos.push(paso(9, "RECHAZADO APELABLE", "warn", st.respuestaDetalle));
    else if (st.serviuRechazado) pasos.push(paso(9, "DESMARQUE RECHAZADO", "stop-red", st.respuestaDetalle));
    else pasos.push(paso(9, "Respuesta SERVIU", st.respuestaIngresada ? "done" : "pending", st.respuestaDetalle));
  }

  const pasoActualIdx = pasos.reduce((ultimo, p, idx) => p.estado !== "pending" ? idx : ultimo, -1);

  const styles = {
    done: { bg: "#ECFDF5", border: "#10B981", color: "#047857" },
    pending: { bg: "#F9FAFB", border: "#D1D5DB", color: "#6B7280" },
    warn: { bg: "#FFFBEB", border: "#F59E0B", color: "#B45309" },
    "stop-red": { bg: "#FEF2F2", border: "#DC2626", color: "#B91C1C" },
    "final-green": { bg: "#E0F7FA", border: "#0891B2", color: "#0E7490" },
  };

  return <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, border: "1px solid #dbeafe", background: "#f8fbff" }}>
    <div style={{ fontSize: 12, fontWeight: 900, color: "#1e3a5f", textTransform: "uppercase", marginBottom: 10 }}>Línea de avance Desmarque de Vivienda</div>
    <div style={{ display: "inline-block", marginBottom: 10, background: estadoActual.bg, color: estadoActual.color, borderRadius: 9, padding: "4px 11px", fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>
      Estado actual: {estadoActual.label}
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {pasos.map((p, idx) => {
        const s = styles[p.estado] || styles.pending;
        const tieneDetalle = !!(p.detalle || "").trim();
        const abierto = !!abiertos[idx];
        const esActual = idx === pasoActualIdx;
        return <div key={idx} title={tieneDetalle ? "Pincha para ver/ocultar detalle" : p.label}
          onClick={() => tieneDetalle && setAbiertos(prev => ({ ...prev, [idx]: !prev[idx] }))}
          style={{ minWidth: 135, flex: "1 1 135px", border: (esActual ? "3px" : "1.5px") + " solid " + s.border, background: s.bg, color: s.color, borderRadius: 8, padding: esActual ? "7px 9px" : "8px 10px", cursor: tieneDetalle ? "pointer" : "default", boxShadow: esActual ? "0 0 0 3px rgba(30,58,95,0.10)" : "none" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: s.color, opacity: .8 }}>PASO {p.numero}</div>
          <div style={{ fontSize: 12, fontWeight: 900, lineHeight: 1.2 }}>{p.label}</div>
          {tieneDetalle && <div style={{ fontSize: 10, marginTop: 4, color: s.color, opacity: .85 }}>{abierto ? "Ocultar detalle" : "Ver detalle"}</div>}
          {tieneDetalle && abierto && <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: "rgba(255,255,255,0.72)", border: "1px solid " + s.border, fontSize: 11, lineHeight: 1.35, color: "#111827", whiteSpace: "pre-wrap" }}>{p.detalle}</div>}
        </div>;
      })}
    </div>
  </div>;
}

function PromptModal({ mensaje, onConfirm, onCancel }) {
  const [valor, setValor] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onCancel}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: "420px", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, color: "#333", marginBottom: 16, lineHeight: 1.6 }}>{mensaje}</div>
        <input type="password" autoComplete="new-password" value={valor} onChange={e => setValor(e.target.value)} onKeyDown={e => e.key === "Enter" && onConfirm(valor)}
          autoFocus placeholder="Ingrese la clave..."
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #1e3a5f", fontSize: 14, boxSizing: "border-box", marginBottom: 20 }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "9px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => onConfirm(valor)} style={{ padding: "9px 20px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function ModalClaveAcceso({ onConfirmar, onCancelar }) {
  const [clave, setClave] = useState("");
  const [error, setError] = useState(false);
  const verificar = () => {
    if (clave === ADMIN_KEY) { onConfirmar(); }
    else { setError(true); setClave(""); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }} onClick={onCancelar}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1e3a5f", marginBottom: 6 }}>Campo protegido</div>
        <div style={{ fontSize: 13, color: "#555", marginBottom: 16 }}>Ingresa la clave de administrador para editar este campo.</div>
        <input type="password" autoComplete="new-password" autoFocus value={clave}
          onChange={e => { setClave(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && verificar()}
          placeholder="Clave..."
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid " + (error ? "#DC2626" : "#ddd"), fontSize: 14, boxSizing: "border-box", marginBottom: error ? 6 : 20 }} />
        {error && <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 14 }}>Clave incorrecta. Intenta nuevamente.</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancelar} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
          <button onClick={verificar} style={{ padding: "9px 20px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ mensaje, onConfirm, onCancel, danger = false }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onCancel}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: "420px", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, color: "#333", marginBottom: 24, lineHeight: 1.6 }}>{mensaje}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "9px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
          <button onClick={onConfirm} style={{ padding: "9px 20px", borderRadius: 8, background: danger ? "#DC2626" : "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Aceptar</button>
        </div>
      </div>
    </div>
  );
}

function AlertModal({ mensaje, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: "380px", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, color: "#333", marginBottom: 24, lineHeight: 1.6 }}>{mensaje}</div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 24px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Aceptar</button>
        </div>
      </div>
    </div>
  );
}

function ProgramaFigura({ programa, tipo = "", size = 56 }) {
  const id = programa?.id || tipo || "";
  const nombreNorm = (programa?.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const color = programa?.color || "#1e3a5f";
  const light = programa?.colorLight || programa?.colorlight || "#EFF6FF";
  const common = { width: size, height: size, viewBox: "0 0 80 80", role: "img", style: { display: "block", margin: "0 auto" } };
  if (id === "habitabilidad" || tipo === "desmarque") return (
    <svg {...common} aria-label="Vivienda social no habitable">
      <rect x="8" y="46" width="64" height="18" rx="4" fill="#e5e7eb" />
      <path d="M18 45 L40 25 L62 45 V64 H18 Z" fill="#dbeafe" stroke="#1d4ed8" strokeWidth="3" />
      <path d="M15 44 L40 20 L65 44" fill="none" stroke="#dc2626" strokeWidth="5" strokeLinecap="round" />
      <rect x="27" y="48" width="11" height="16" fill="#94a3b8" />
      <rect x="45" y="47" width="12" height="10" fill="#bfdbfe" stroke="#1d4ed8" />
      <path d="M22 62 L31 53 M49 63 L58 54 M36 31 L43 38" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (id === "csp_urbano") return (
    <svg {...common} aria-label="Vivienda DS49 urbana en construcción">
      <rect x="7" y="58" width="66" height="8" rx="3" fill="#d1d5db" />
      <path d="M18 54 L18 36 L39 22 L62 36 V54" fill="#ecfdf5" stroke="#059669" strokeWidth="3" />
      <rect x="25" y="43" width="10" height="13" fill="#a7f3d0" stroke="#047857" />
      <rect x="45" y="39" width="10" height="9" fill="#d1fae5" stroke="#047857" />
      <path d="M12 26 H30 M21 26 V62 M55 17 V60 M48 17 H65 M48 26 H65" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
      <path d="M57 17 L66 26" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
  if (id === "csp_rural") return (
    <svg {...common} aria-label="Vivienda rural construida en el campo">
      <rect x="6" y="57" width="68" height="10" rx="5" fill="#bbf7d0" />
      <path d="M17 53 L17 34 L39 18 L62 34 V53 Z" fill="#fff7ed" stroke="#d97706" strokeWidth="3" />
      <path d="M13 34 L39 14 L66 34" fill="none" stroke="#92400e" strokeWidth="5" strokeLinecap="round" />
      <rect x="27" y="41" width="10" height="13" fill="#fed7aa" stroke="#92400e" />
      <rect x="47" y="39" width="10" height="9" fill="#ffedd5" stroke="#92400e" />
      <path d="M8 57 C18 49 27 49 38 57 C49 49 59 49 72 57" fill="none" stroke="#16a34a" strokeWidth="3" />
      <path d="M66 51 C66 42 72 42 72 51" fill="none" stroke="#15803d" strokeWidth="3" />
    </svg>
  );
  if (id === "mave_rural" || id === "ampliacion_vivienda") return (
    <svg {...common} aria-label="Mejoramiento y ampliación de vivienda rural">
      <rect x="8" y="58" width="64" height="8" rx="4" fill="#ddd6fe" />
      <path d="M16 54 L16 35 L36 20 L56 35 V54 Z" fill={id === "ampliacion_vivienda" ? "#ccfbf1" : "#f5f3ff"} stroke={id === "ampliacion_vivienda" ? "#0f766e" : "#7c3aed"} strokeWidth="3" />
      <path d="M50 54 V39 H67 V54 Z" fill={id === "ampliacion_vivienda" ? "#99f6e4" : "#ede9fe"} stroke={id === "ampliacion_vivienda" ? "#0f766e" : "#7c3aed"} strokeWidth="3" />
      <path d="M12 35 L36 16 L60 35" fill="none" stroke={id === "ampliacion_vivienda" ? "#115e59" : "#6d28d9"} strokeWidth="5" strokeLinecap="round" />
      <path d="M55 39 L67 30 L73 39" fill="none" stroke={id === "ampliacion_vivienda" ? "#115e59" : "#6d28d9"} strokeWidth="4" strokeLinecap="round" />
      <path d="M25 46 L35 36 M35 36 L41 42" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
      <rect x="24" y="43" width="10" height="11" fill={id === "ampliacion_vivienda" ? "#5eead4" : "#c4b5fd"} />
    </svg>
  );
  if (id.includes("arriendo") || nombreNorm.includes("arriendo")) return (
    <svg {...common} aria-label="Subsidio de arriendo">
      <circle cx="40" cy="40" r="30" fill="#fff7ed" stroke="#f97316" strokeWidth="3" />
      <path d="M22 43 L40 27 L58 43 V58 H22 Z" fill="#fed7aa" stroke="#ea580c" strokeWidth="3" />
      <text x="40" y="50" textAnchor="middle" fontSize="22" fontWeight="800" fill="#9a3412">$</text>
    </svg>
  );
  if (tipo === "sincomite") return (
    <svg {...common} aria-label="Sin comité">
      <rect x="21" y="13" width="38" height="54" rx="6" fill="#f8fafc" stroke="#64748b" strokeWidth="3" />
      <rect x="30" y="9" width="20" height="10" rx="3" fill="#e2e8f0" stroke="#64748b" strokeWidth="3" />
      <path d="M29 32 H52 M29 43 H52 M29 54 H44" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg {...common} aria-label="Programa habitacional">
      <circle cx="40" cy="40" r="31" fill={light} stroke={color} strokeWidth="3" />
      <path d="M20 43 L40 25 L60 43 V59 H20 Z" fill="#fff" stroke={color} strokeWidth="3" />
      <rect x="34" y="47" width="12" height="12" fill={light} stroke={color} />
      <text x="40" y="22" textAnchor="middle" fontSize="18" fontWeight="900" fill={color}>{programa?.icon || "P"}</text>
    </svg>
  );
}

function Dashboard({ personas, solicitudes, comites, programasCustom = [], onNav }) {
  const sinDatosBase = personas.length === 0 && comites.length === 0 && solicitudes.length === 0;
  const completas = solicitudes.filter(s => pct(s.documentos, s.programaId) === 100).length;
  const todosProgramas = combinarProgramas(programasCustom);
  if (sinDatosBase) {
    return (
      <div>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Panel principal</div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Resumen del sistema de subsidios habitacionales</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #BFDBFE", borderRadius: 14, padding: 28, color: "#1e3a5f" }}>
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>Cargando datos reales del sistema</div>
          <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6 }}>
            No se muestran contadores en cero mientras la base de datos no responda. Presione “Actualizar datos” si tarda demasiado.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Panel principal</div>
        <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Resumen del sistema de subsidios habitacionales</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 28 }}>
        {[
          ["Solicitantes", personas.length, "#1e3a5f", "personas"],
          ["Comités", comites.length, "#7C3AED", "comites"],
          ["Solicitudes", solicitudes.length, "#0891B2", "solicitudes"],
          ["Completas", completas, "#059669", "solicitudes"],
          ["Pendientes", solicitudes.length - completas, "#DC2626", "solicitudes"]
        ].map(([l, v, c, nav]) => (
          <div key={l} onClick={() => onNav(nav)} style={{ background: "#fff", borderRadius: 14, padding: "20px 22px", border: "1px solid #e8e3de", cursor: "pointer" }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 3, textTransform: "uppercase" }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {todosProgramas.map(p => {
          const comitesPrograma = comites.filter(c => c.programaId === p.id);
          const personasPrograma = personas.filter(per => comitesPrograma.some(c => c.id === per.comiteId));
          const sols = solicitudes.filter(s => s.programaId === p.id);
          const comp = sols.filter(s => pct(s.documentos, s.programaId) === 100).length;
          return (
            <div key={p.id} onClick={() => onNav("comites_prog_" + p.id)} style={{ background: "#fff", borderRadius: 14, padding: "20px 22px", border: "1px solid #e8e3de", cursor: "pointer" }}>
              <div style={{ marginBottom: 10 }}><ProgramaFigura programa={p} size={48} /></div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a5f", marginBottom: 4 }}>{p.nombre}</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{p.descripcion}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#666" }}>{comitesPrograma.length} comités · {personasPrograma.length} personas</span>
                <span style={{ color: "#059669", fontWeight: 600 }}>{comp} completas</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FORMULARIO DE PERSONA (reutilizable) ───────────────────────────────────
function FormPersona({ form, setForm, onGuardar, onCancelar, comites, comiteIdFijo, programasCustom }) {
  const [tipoSolicitud, setTipoSolicitud] = useState(
    form.comiteId === "comite_desmarque" ? "desmarque" : (form.comiteId ? "comite" : "")
  );
  const [archivoRut, setArchivoRut] = useState("");
  const [archivoRol, setArchivoRol] = useState("");
  const [archivoDoc, setArchivoDoc] = useState("");
  const [motivoSinComite, setMotivoSinComite] = useState("");

  const CAMPOS = [
    ["nombre", "Nombre completo *", "text", "12"],
    ["rut", "Cédula de identidad *", "text", "6"],
    ["telefono", "Telefono", "tel", "6"],
    ["direccion", "Direccion", "text", "12"],
    ["puntajeRSH", "Puntaje RSH", "text", "6"],
    ["comuna", "Comuna", "text", "6"],
  ];

  // Lista dinámica: COMITES_FIJOS (con códigos) + nuevos comités de Supabase
  const normN = s => (s||"").toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");
  // Si el tipo es comite_PROGID, filtrar comités de ese programa
  const progIdSeleccionado = tipoSolicitud && tipoSolicitud.startsWith("comite_") ? tipoSolicitud.replace("comite_","") : null;
  const todosProgramas = combinarProgramas(programasCustom);

  const comitesMergedBase = [
    ...COMITES_FIJOS.map(c => ({ id: c.codigo, nombre: c.nombre, tipo: c.tipo, programaId: c.tipo === "Urbano" ? "csp_urbano" : "csp_rural" })),
    ...(comites||[])
      .filter(sc => sc.nombre && !COMITES_FIJOS.some(f => normN(f.nombre) === normN(sc.nombre)))
      .map(sc => ({
        id: sc.id,
        nombre: sc.nombre,
        tipo: sc.programaId === "csp_urbano" ? "URBANO" : "RURAL",
        programaId: sc.programaId
      }))
  ];
  const comitesMerged = progIdSeleccionado
    ? comitesMergedBase.filter(c => c.programaId === progIdSeleccionado)
    : comitesMergedBase;

  const seleccionarTipo = (tipo) => {
    setTipoSolicitud(tipo);
    if (tipo === "desmarque") {
      setForm({ ...form, comiteId: "comite_desmarque", comuna: "Lautaro", observaciones: "" });
    } else if (tipo === "sincomite") {
      setForm({ ...form, comiteId: "", comite: "", tipo_comite: "", observaciones: "" });
      setMotivoSinComite("");
    } else if (tipo.startsWith("comite_")) {
      setForm({ ...form, comiteId: "", comite: "", tipo_comite: "", observaciones: "" });
    } else {
      setForm({ ...form, comiteId: "", comite: "", tipo_comite: "", observaciones: "" });
    }
  };

  const handleGuardar = () => {
    if (tipoSolicitud === "sincomite" && !motivoSinComite.trim()) {
      alert("El motivo es obligatorio cuando no se asigna comité."); return;
    }
    onGuardar();
  };

  return (
    <>
      {/* Selección tipo solicitud - todos los programas del sistema */}
      {!comiteIdFijo && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#444", marginBottom: 10 }}>¿Programa de solicitud? *</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
            {/* Programa Habitabilidad (desmarque) */}
            <div onClick={() => seleccionarTipo("desmarque")}
              style={{ padding: "14px 16px", borderRadius: 10, border: "2px solid " + (tipoSolicitud === "desmarque" ? "#0891B2" : "#ddd"),
                background: tipoSolicitud === "desmarque" ? "#E0F7FA" : "#fafafa", cursor: "pointer", textAlign: "center" }}>
              <ProgramaFigura programa={todosProgramas.find(p => p.id === "habitabilidad")} tipo="desmarque" size={58} />
              <div style={{ fontSize: 12, fontWeight: 700, color: tipoSolicitud === "desmarque" ? "#0891B2" : "#555", marginTop: 4 }}>Habitabilidad de Vivienda</div>
              <div style={{ fontSize: 10, color: "#888" }}>Desmarque</div>
            </div>
            {/* Programas CSP y personalizados (con comité) */}
            {todosProgramas.filter(p => p.id !== "habitabilidad").map(p => (
              <div key={p.id} onClick={() => seleccionarTipo("comite_" + p.id)}
                style={{ padding: "14px 16px", borderRadius: 10, border: "2px solid " + (tipoSolicitud === "comite_" + p.id ? (p.color || "#7C3AED") : "#ddd"),
                  background: tipoSolicitud === "comite_" + p.id ? (p.colorLight || p.colorlight || "#F5F3FF") : "#fafafa", cursor: "pointer", textAlign: "center" }}>
                <ProgramaFigura programa={p} size={58} />
                <div style={{ fontSize: 12, fontWeight: 700, color: tipoSolicitud === "comite_" + p.id ? (p.color || "#7C3AED") : "#555", marginTop: 4 }}>{p.nombre}</div>
                <div style={{ fontSize: 10, color: "#888" }}>{p.descripcion || "Con comité"}</div>
              </div>
            ))}
            {/* Sin comité */}
            <div onClick={() => seleccionarTipo("sincomite")}
              style={{ padding: "14px 16px", borderRadius: 10, border: "2px solid " + (tipoSolicitud === "sincomite" ? "#D97706" : "#ddd"),
                background: tipoSolicitud === "sincomite" ? "#FFFBEB" : "#fafafa", cursor: "pointer", textAlign: "center" }}>
              <ProgramaFigura tipo="sincomite" size={58} />
              <div style={{ fontSize: 12, fontWeight: 700, color: tipoSolicitud === "sincomite" ? "#D97706" : "#555", marginTop: 4 }}>Sin comité</div>
              <div style={{ fontSize: 10, color: "#888" }}>Pendiente de asignación</div>
            </div>
          </div>
        </div>
      )}

      {/* Formulario solo aparece después de seleccionar tipo */}
      {(tipoSolicitud || comiteIdFijo) && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {CAMPOS.map(([k, l, t, cols]) => {
              // Cédula de identidad - campo normal con nota para subir cédula después
              if (k === "rut" && tipoSolicitud === "desmarque") {
                return (
                  <div key={k} style={{ gridColumn: "span 6" }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Cédula de identidad *</label>
                    <input value={formatRut(form.rut || "")}
                      onChange={e => setForm({...form, rut: limpiarRut(e.target.value)})}
                      placeholder="Solo números y guión: 10398338-K"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
                    <div style={{ fontSize: 10, color: "#2563EB", marginTop: 3 }}>⚠ Solo números y guión. Ej: 10398338-K → se mostrará 10.398.338-K</div>
                  </div>
                );
              }
              return (
                <div key={k} style={{ gridColumn: "span " + (cols || "6") }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>{l}</label>
                  {k === "rut" ? (
                    <><input value={formatRut(form.rut || "")}
                      onChange={e => setForm({ ...form, rut: limpiarRut(e.target.value) })}
                      placeholder="Solo números y guión: 10398338-K"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
                    <div style={{ fontSize: 10, color: "#2563EB", marginTop: 3 }}>⚠ Solo números y guión. Ej: 10398338-K → 10.398.338-K</div></>
                  ) : (
                    <input type={t} value={form[k] || ""} onChange={e => setForm({ ...form, [k]: e.target.value })}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
                  )}
                </div>
              );
            })}

            {/* Selector de comité Rural/Urbano — carga desde Supabase + estáticos */}
            {!comiteIdFijo && tipoSolicitud && tipoSolicitud.startsWith("comite_") && (
              <div style={{ gridColumn: "span 12" }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>
                  Comité * <span style={{ fontWeight: 400, color: "#9ca3af" }}>({comitesMerged.length} disponibles)</span>
                </label>
                <select value={form.comiteId || ""} onChange={e => {
                  const sel = comitesMerged.find(c => c.id === e.target.value);
                  setForm(sel
                    ? { ...form, comiteId: sel.id, comite: sel.nombre, tipo_comite: sel.tipo }
                    : { ...form, comiteId: "", comite: "", tipo_comite: "" }
                  );
                }} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (form.comiteId ? "#7C3AED" : "#ddd"), fontSize: 14, boxSizing: "border-box", background: "#fff" }}>
                  <option value="">-- Seleccionar comité --</option>
                  {comitesMerged.map(c => (
                    <option key={c.id} value={c.id}>{c.tipo === "RURAL" ? "🌾" : "🏙️"} {c.nombre}</option>
                  ))}
                </select>
                {form.comiteId && (
                  <div style={{ fontSize: 12, color: "#7C3AED", marginTop: 5, fontWeight: 600 }}>
                    ✓ {form.tipo_comite === "RURAL" ? "🌾 Rural" : "🏙️ Urbano"} — {form.comite}
                  </div>
                )}
              </div>
            )}

            {/* Campo motivo cuando no se asigna comité */}
            {!comiteIdFijo && tipoSolicitud === "sincomite" && (
              <div style={{ gridColumn: "span 12" }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#D97706", display: "block", marginBottom: 5, textTransform: "uppercase" }}>
                  ¿Motivo por el que no se asigna comité? *
                </label>
                <textarea value={motivoSinComite}
                  onChange={e => {
                    setMotivoSinComite(e.target.value);
                    setForm(f => ({ ...f, observaciones: e.target.value.trim() ? "Pendiente por: " + e.target.value.trim() : "" }));
                  }}
                  placeholder="Ej: En espera de apertura de lista, pendiente de asignación por SERVIU..."
                  rows={3}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (motivoSinComite.trim() ? "#D97706" : "#FCA5A5"), fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
                {motivoSinComite.trim() && (
                  <div style={{ fontSize: 11, color: "#D97706", marginTop: 4 }}>
                    Se guardará como: <strong>"Pendiente por: {motivoSinComite.trim()}"</strong>
                  </div>
                )}
              </div>
            )}

            {/* Campos extra para Desmarque */}
            {tipoSolicitud === "desmarque" && (
              <>
                <div style={{ gridColumn: "span 6" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Tipo (RURAL/URBANO) *</label>
                  <select value={form.tipo_comite || ""} onChange={e => setForm({ ...form, tipo_comite: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (!form.tipo_comite ? "#FCA5A5" : "#ddd"), fontSize: 14, boxSizing: "border-box", background: "#fff" }}>
                    <option value="">-- Seleccionar --</option>
                    <option value="RURAL">RURAL</option>
                    <option value="URBANO">URBANO</option>
                  </select>
                </div>
                <div style={{ gridColumn: "span 6" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Año Subsidio *</label>
                  <input value={form.anio_subsidio || ""} onChange={e => setForm({ ...form, anio_subsidio: e.target.value })}
                    placeholder="Ej: 1989" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (!form.anio_subsidio ? "#FCA5A5" : "#ddd"), fontSize: 14, boxSizing: "border-box" }} />
                </div>
                {/* Rol de Propiedad */}
                <div style={{ gridColumn: "span 6" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Rol de la Propiedad *</label>
                  <input value={form.rol_propiedad || ""} onChange={e => setForm({...form, rol_propiedad: e.target.value})}
                    placeholder="Ej: 300-39"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (!form.rol_propiedad ? "#FCA5A5" : "#ddd"), fontSize: 14, boxSizing: "border-box" }} />
                </div>

                {/* Documento de Propiedad */}
                <div style={{ gridColumn: "span 6" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Documento de Propiedad *</label>
                  <select value={form.dominio_terreno || ""} onChange={e => setForm({...form, dominio_terreno: e.target.value})}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (!form.dominio_terreno ? "#FCA5A5" : "#ddd"), fontSize: 14, boxSizing: "border-box", background: "#fff" }}>
                    <option value="">-- Seleccionar --</option>
                    <option value="DV">DV - Dominio Vigente</option>
                    <option value="DRU">DRU - Derecho Real de Uso</option>
                    <option value="USUFRUCTO">Usufructo</option>
                    <option value="GOCE">Goce de Tierra</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </div>
                <div style={{ gridColumn: "span 6" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Sector *</label>
                  <input value={form.sector || ""} onChange={e => setForm({ ...form, sector: e.target.value })}
                    placeholder="Ej: BLANCO LEPIN" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (!form.sector ? "#FCA5A5" : "#ddd"), fontSize: 14, boxSizing: "border-box" }} />
                </div>
                <div style={{ gridColumn: "span 6" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Coordenadas (opcional)</label>
                  <input value={form.coordenadas || ""} onChange={e => setForm({ ...form, coordenadas: e.target.value })}
                    placeholder="Ej: C=-38.516023,-72.374214" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
                </div>
                <div style={{ gridColumn: "span 12" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Observaciones (opcional)</label>
                  <textarea value={form.observaciones || ""} onChange={e => setForm({ ...form, observaciones: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", minHeight: 60, resize: "vertical" }} />
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <button onClick={onCancelar} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={handleGuardar} disabled={!tipoSolicitud && !comiteIdFijo}
              style={{ padding: "9px 20px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
          </div>
        </>
      )}
    </>
  );
}

// ─── VISTA SOLICITANTES ──────────────────────────────────────────────────────
function PersonasView({ personas, solicitudes, comites, onSave, onDetail, programasCustom }) {
  const [search, setSearch] = useState("");
  const [modoBusqueda, setModoBusqueda] = useState("cedula");
  const [showModal, setShowModal] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [claveInput, setClaveInput] = useState("");
  const [claveError, setClaveError] = useState(false);
  const EMPTY = { nombre: "", rut: "", fechaNacimiento: "", telefono: "", email: "", direccion: "", comuna: "", integrantesFamiliares: "", puntajeRSH: "", comiteId: "" };
  const [form, setForm] = useState(EMPTY);

  const normalizarBusqueda = (s = "") => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const searchTexto = search.trim();
  const searchRut = limpiarRut(searchTexto);
  const searchActivo = searchTexto.length > 0;
  const searchRutValido = modoBusqueda !== "cedula" || !searchActivo || rutNumeroGuionValido(searchRut);
  const filtered = !searchActivo
    ? personas
    : modoBusqueda === "cedula"
      ? (searchRutValido ? personas.filter(p => limpiarRut(p.rut || "") === searchRut) : [])
      : personas.filter(p => normalizarBusqueda(p.nombre || "").includes(normalizarBusqueda(searchTexto)));

  const getSols = (id) => solicitudes.filter(s => s.personaId === id);
  const getDocPct = (id) => {
    const sols = getSols(id);
    if (!sols.length) return null;
    const all = sols.flatMap(s => s.documentos);
    return all.length ? Math.round(all.filter(d => d.entregado).length / all.length * 100) : 0;
  };

  const eliminar = (e, id) => {
    e.stopPropagation();
    setPendingDeleteId(id);
    setClaveInput("");
    setClaveError(false);
  };

  const confirmarEliminar = () => {
    if (claveInput === ADMIN_KEY) {
      onSave(personas.filter(x => x.id !== pendingDeleteId));
      setPendingDeleteId(null);
    } else {
      setClaveError(true);
    }
  };

  const guardar = async () => {
    if (!form.nombre.trim() || !form.rut.trim()) { alert("Nombre y cédula de identidad son obligatorios."); return; }
    if (!rutFormatoChilenoValido(form.rut)) {
      alert("La cédula de identidad no es válida. Debe ingresar una cédula chilena con puntos, guion y dígito verificador correcto. Ejemplo: 10.398.338-K");
      return;
    }
    const rutFormateado = formatRut(form.rut);
    const rutLimpio = form.rut.replace(/[^0-9kK]/g, "").toLowerCase();
    const duplicado = personas.find(p => p.rut && p.rut.replace(/[^0-9kK]/g,"").toLowerCase() === rutLimpio);
    if (duplicado) { alert("\u26A0 La cédula " + formatRut(form.rut) + " ya está registrada para: " + duplicado.nombre + ".\n\nNo se puede registrar el mismo solicitante dos veces."); return; }
    if (form.comiteId === "comite_desmarque") {
      if (!form.telefono.trim()) { alert("El teléfono es obligatorio para Desmarque."); return; }
      if (!form.direccion.trim()) { alert("La dirección es obligatoria para Desmarque."); return; }
      if (!form.tipo_comite) { alert("Debe seleccionar RURAL o URBANO."); return; }
      if (!form.anio_subsidio) { alert("El año de subsidio es obligatorio."); return; }
      if (!form.rol_propiedad) { alert("El rol de la propiedad es obligatorio."); return; }
      if (!form.dominio_terreno) { alert("El documento de propiedad es obligatorio."); return; }
      if (!form.sector) { alert("El sector es obligatorio."); return; }
    }
    // Generar N° Recepción automático basado en total de personas desmarque
    const totalDesmarque = personas.filter(p => p.comiteId === "comite_desmarque").length + 1;
    const numeroRecepcion = form.comiteId === "comite_desmarque" ? String(totalDesmarque) : "";
    const fechaRecepcion = form.comiteId === "comite_desmarque" ? today() : "";
    const fechaSistema = today();
    const nueva = { ...form, rut: rutFormateado, id: uid(), fechaIngreso: fechaSistema, fecha_ingreso: fechaSistema, 
      numero_recepcion: numeroRecepcion, fecha_recepcion: fechaRecepcion,
      tipo_comite: form.tipo_comite || "",
      rol_propiedad: form.rol_propiedad || "",
      dominio_terreno: form.dominio_terreno || "",
      anio_subsidio: form.anio_subsidio || "",
      sector: form.sector || "",
      coordenadas: form.coordenadas || "",
      observaciones: form.observaciones || "",
    };
    const carpeta = carpetaNombre(form.nombre, rutFormateado);
    try { 
      await fetch(apiPath("/carpeta/", carpeta), { method: "POST" });
      // Mover archivos de carpeta temporal si existe
      const carpetaTmp = form.nombre.replace(/\s+/g,"_").replace(/[^a-zA-Z0-9_]/g,"") + "_" + rutFormateado.replace(/[^0-9kK]/g,"");
      if (carpetaTmp !== carpeta) {
        await fetch(API + "/renombrar-carpeta", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ origen: carpetaTmp, destino: carpeta }) });
      }
    } catch (e) { }
    onSave([...personas, nueva]);
    setForm(EMPTY);
    setShowModal(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Solicitantes</div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>{personas.length} registrados</div>
        </div>
        <button onClick={() => setShowModal(true)} style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Nuevo solicitante</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: searchActivo && !searchRutValido ? 6 : 18, display: "flex", alignItems: "center", gap: 10, border: "1.5px solid " + (searchActivo && !searchRutValido ? "#DC2626" : "#e8e3de") }}>
        {["cedula", "nombre"].map(modo => (
          <button key={modo} onClick={() => { setModoBusqueda(modo); setSearch(""); }}
            style={{ border: "1.5px solid " + (modoBusqueda === modo ? "#1e3a5f" : "#e5e7eb"), background: modoBusqueda === modo ? "#1e3a5f" : "#fff", color: modoBusqueda === modo ? "#fff" : "#374151", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>
            {modo === "cedula" ? "Cédula" : "Nombre"}
          </button>
        ))}
        <input
          placeholder={modoBusqueda === "cedula" ? "Buscar por cédula: 10398338-K" : "Buscar por nombre del solicitante"}
          value={search}
          onChange={e => setSearch(modoBusqueda === "cedula" ? limpiarRut(e.target.value) : e.target.value)}
          style={{ border: "none", outline: "none", fontSize: 14, flex: 1 }}
        />
      </div>
      {modoBusqueda === "cedula" && searchActivo && !searchRutValido && (
        <div style={{ marginBottom: 18, fontSize: 12, color: "#DC2626", fontWeight: 700 }}>
          La cédula debe ingresarse sin puntos, con guion y dígito verificador chileno correcto. Ejemplo: 10398338-K
        </div>
      )}
      {modoBusqueda === "cedula" && searchActivo && searchRutValido && (
        <div style={{ marginBottom: 18, fontSize: 12, color: "#059669", fontWeight: 700 }}>
          Cédula válida: {searchRut}
        </div>
      )}

      {filtered.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>{searchActivo ? (modoBusqueda === "cedula" ? "No hay solicitantes para esa cédula válida." : "No hay solicitantes con ese nombre.") : "No hay solicitantes registrados aun."}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map(p => {
          const dp = getDocPct(p.id);
          const solsAll = getSols(p.id);
          const sols = solsAll.length;
          const comite = comites.find(c => c.id === p.comiteId);
          const esPrioritario = solicitantePrioritario(p.id, solicitudes);

          // Detectar "Desmarque en trámite": tiene habitabilidad + otro programa,
          // y Respuesta SERVIU no está aprobada
          const tieneHabitabilidad = solsAll.some(s => s.programaId === "habitabilidad");
          const tieneOtroPrograma = solsAll.some(s => s.programaId !== "habitabilidad");
          const respuestaAprobada = solsAll.some(s =>
            s.programaId === "habitabilidad" &&
            (s.documentos || []).some(d =>
              d.nombre && d.nombre.includes("Respuesta SERVIU") &&
              d.valor && d.valor.toLowerCase().includes("aprobado")
            )
          );
          const desmarqueEnTramite = tieneHabitabilidad && tieneOtroPrograma && !respuestaAprobada;

          return (
            <div key={p.id} onClick={() => onDetail(p.id)} style={{
              background: esPrioritario ? "#FFFBEB" : desmarqueEnTramite ? "#FFF7ED" : "#fff",
              borderRadius: 12, padding: "16px 20px",
              border: esPrioritario ? "2px solid #F59E0B" : desmarqueEnTramite ? "2px solid #F97316" : "1px solid #e8e3de",
              display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: esPrioritario ? "#F59E0B" : desmarqueEnTramite ? "#F97316" : "#1e3a5f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{p.nombre[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}</div>
                  <div style={{ fontSize: 13, color: "#888" }}>Cédula: {formatRut(p.rut)}{p.comuna ? " - " + p.comuna : ""}</div>
                  {comite && <div style={{ fontSize: 11, color: "#7C3AED", marginTop: 2 }}>● {comite.nombre}</div>}
                  {desmarqueEnTramite && (
                    <div style={{ display: "inline-block", marginTop: 4, background: "#F97316", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>
                      ⚠ Desmarque en trámite
                    </div>
                  )}
                  {esPrioritario && (
                    <div style={{ display: "inline-block", marginTop: 4, marginLeft: desmarqueEnTramite ? 6 : 0, background: "#F59E0B", color: "#111827", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 900, letterSpacing: 0.3 }}>
                      Prioridad
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {dp !== null && <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#aaa" }}>DOCS</div><div style={{ fontSize: 15, fontWeight: 800, color: statusColor(dp) }}>{dp}%</div></div>}
                <div style={{ background: sols > 0 ? "#EFF6FF" : "#f5f5f5", color: sols > 0 ? "#1e3a5f" : "#999", borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>{sols} solicitudes</div>
                <button onClick={(e) => eliminar(e, p.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>X</button>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <Modal title="Registrar solicitante" onClose={() => setShowModal(false)}>
          <FormPersona form={form} setForm={setForm} onGuardar={guardar} onCancelar={() => setShowModal(false)} comites={comites} programasCustom={programasCustom} />
        </Modal>
      )}

      {pendingDeleteId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000 }}
          onClick={() => setPendingDeleteId(null)}>
          <div style={{ background:"#fff", borderRadius:14, padding:"28px 32px", width:400, boxShadow:"0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:"#DC2626", marginBottom:8 }}>🗑 Eliminar solicitante</div>
            <div style={{ fontSize:13, color:"#555", marginBottom:18, lineHeight:1.6 }}>
              Esta acción es irreversible. Ingresa la clave de administrador para confirmar la eliminación.
            </div>
            <input type="password" autoComplete="new-password" autoFocus value={claveInput}
              onChange={e => { setClaveInput(e.target.value); setClaveError(false); }}
              onKeyDown={e => e.key === "Enter" && confirmarEliminar()}
              placeholder="Clave de administrador"
              style={{ width:"100%", padding:"10px 14px", borderRadius:8, border:"1.5px solid " + (claveError ? "#DC2626" : "#ddd"), fontSize:14, boxSizing:"border-box", marginBottom:claveError ? 6 : 20 }} />
            {claveError && <div style={{ fontSize:12, color:"#DC2626", marginBottom:14 }}>⚠ Clave incorrecta. Intenta nuevamente.</div>}
            <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={() => setPendingDeleteId(null)}
                style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #ddd", background:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Cancelar</button>
              <button onClick={confirmarEliminar}
                style={{ padding:"9px 20px", borderRadius:8, background:"#DC2626", color:"#fff", border:"none", fontSize:14, fontWeight:600, cursor:"pointer" }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DETALLE PERSONA ─────────────────────────────────────────────────────────

// ─── FICHA RURAL ─────────────────────────────────────────────────────────────
// Formatea YYYY-MM-DD → DD/MM/YYYY para mostrar en pantalla e impresos
function fmtFecha(f) {
  if (!f) return "";
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
    const [y, m, d] = f.split("-");
    return d + "/" + m + "/" + y;
  }
  return f; // ya está formateada o formato desconocido
}

function calcularEdad(fechaNac) {
  if (!fechaNac) return null;
  // Parsear manualmente para evitar problemas de zona horaria UTC
  let anio, mes, dia;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaNac)) {
    [anio, mes, dia] = fechaNac.split("-").map(Number);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaNac)) {
    [dia, mes, anio] = fechaNac.split("/").map(Number);
  } else {
    return null;
  }
  if (!anio || anio < 1900 || anio > new Date().getFullYear()) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - anio;
  if (hoy.getMonth() + 1 < mes || (hoy.getMonth() + 1 === mes && hoy.getDate() < dia)) edad--;
  return edad;
}

function calcularAhorro(rsh) {
  const val = parseFloat(String(rsh).replace(",", ".").replace("%", ""));
  if (isNaN(val)) return "";
  if (val <= 40) return "10";
  if (val < 90) return "15";
  return "";
}

const valorDesdeDocsCsp = (solicitudes = [], matcher) => {
  for (const sol of solicitudes || []) {
    if (sol.programaId !== "csp_rural" && sol.programaId !== "csp_urbano") continue;
    for (const doc of sol.documentos || []) {
      const n = docNombreNorm(doc);
      if (!matcher(n, doc)) continue;
      const valor = String(doc.valor || "").trim();
      if (valor) return valor;
    }
  }
  return "";
};

const fechaNacimientoDesdeSolicitudes = (solicitudes = []) => {
  const desdeCedula = valorDesdeDocsCsp(solicitudes, n => n.includes("cedula") && n.includes("identidad"));
  const fechaCedula = normalizarFechaInput((desdeCedula.split("|")[1] || "").trim());
  if (fechaCedula) return fechaCedula;
  const directa = valorDesdeDocsCsp(solicitudes, n => n.includes("fecha") && n.includes("nacimiento"));
  return normalizarFechaInput(directa);
};

const rshDesdeSolicitudes = (solicitudes = []) => {
  const valor = valorDesdeDocsCsp(solicitudes, n =>
    n.includes("registro social") || n.includes("rsh") || n.includes("rdh")
  );
  return (valor.split("|")[0] || "").trim();
};

function FichaRural({ persona, misSols, comites, onSave, esCsp }) {
  const [modo, setModo] = useState("ver");
  const [form, setForm] = useState({ ...persona });
  const [confirmModal, setConfirmModal] = useState(null);
  const [camposDesbloqueados, setCamposDesbloqueados] = useState(false);
  const [showClaveCampos, setShowClaveCampos] = useState(false);

  useEffect(() => {
    if (modo === "ver") setForm({ ...persona });
  }, [persona, modo]);

  const guardar = () => {
    setConfirmModal({ msg: "¿Guardar los cambios de la Ficha Rural?", fn: async () => {
      const formFinal = protegerDatosFicha(form, persona, {
        adultoMayor: textoAdultoMayor(form.fechaNacimiento) || form.adultoMayor,
        cargo_comite: inferirCargo(form.nombre, persona.comiteId, comites),
        constructoraSeleccionada: constructoraDeComite({ ...persona, ...form }, comites)
      });
      await supabase.from("personas").update(toDbFields(formFinal)).eq("id", persona.id);
      onSave(formFinal);
      setCamposDesbloqueados(false);
      setModo("ver");
      setConfirmModal(null);
    }});
  };

  const handleFechaNac = (val) => {
    const adulto = textoAdultoMayor(val) || form.adultoMayor || "";
    setForm(f => ({ ...f, fechaNacimiento: val, adultoMayor: adulto }));
  };

  const handleRSH = (val) => {
    const ahorro = calcularAhorro(val);
    setForm(f => ({ ...f, puntajeRSH: val, ahorroPostular: ahorro || f.ahorroPostular }));
  };

  const sectionTitleStyle = {
    gridColumn: "span 3",
    fontSize: 15,
    fontWeight: 900,
    color: "#1E3A8A",
    textTransform: "uppercase",
    padding: "8px 0 7px",
    borderBottom: "3px solid #93C5FD",
    letterSpacing: "0.2px"
  };

  const campo = (label, valor) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: valor ? "#1e3a5f" : "#DC2626", fontWeight: valor ? 500 : 600, padding: "5px 0", borderBottom: "1px solid #f0ede8" }}>{valor || "⚠ Falta"}</div>
    </div>
  );

  const inp = (label, key, type = "text") => {
    const onChange = key === "fechaNacimiento" ? e => handleFechaNac(e.target.value)
                   : key === "puntajeRSH"     ? e => handleRSH(e.target.value)
                   : key === "avaluoFiscal"   ? e => setForm({ ...form, [key]: formatPesosChilenos(e.target.value) })
                   : e => setForm({ ...form, [key]: e.target.value });
    return (
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>{label}</label>
        <input type={type} value={form[key] || ""} onChange={onChange}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, boxSizing: "border-box", background: "#fff" }} />
      </div>
    );
  };

  const seccion = (titulo) => (
    <div style={{ ...sectionTitleStyle, marginTop: 10 }}>{titulo}</div>
  );

  const fechaNacFicha = persona.fechaNacimiento || persona.fecha_nacimiento || fechaNacimientoDesdeSolicitudes(misSols);
  const rshFicha = persona.puntajeRSH || persona.puntaje_rsh || rshDesdeSolicitudes(misSols);

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e3de", marginBottom: 20, overflow: "hidden" }}>
      <div style={{ background: "#FFFBEB", borderBottom: "3px solid #D97706", padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#D97706" }}>🌾 Ficha Rural — {persona.comite}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["ver","Ver"],["editar","Editar"]].map(([k,l]) => (
            <button key={k} onClick={() => { setForm({...persona}); if (k==="ver") setCamposDesbloqueados(false); setModo(k); }}
              style={{ padding: "6px 14px", borderRadius: 7, border: "1.5px solid " + (modo===k ? "#D97706" : "#ddd"), background: modo===k ? "#D97706" : "#fff", color: modo===k ? "#fff" : "#555", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {modo === "ver" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={sectionTitleStyle}>Información General</div>
            {campo("Nombre del Comité", persona.comite)}
            {campo("Cargo en el Comité", inferirCargo(persona.nombre, persona.comiteId, comites) || persona.cargo_comite)}
            {campo("Nombre Postulante", persona.nombre)}
            {campo("Cédula de identidad", persona.rut)}
            {campo("RUT colores", persona.rutColores || persona.rutcolores || rutColoresDesdeSolicitudes(misSols))}
            {campo("Fecha de Nacimiento", fmtFecha(fechaNacFicha))}
            {campo("Dirección", persona.direccion)}
            {campo("Coordenadas", persona.coordenadas)}
            {campo("Rol", persona.rol)}
            {campo("Teléfono", persona.telefono)}
            {campo("Correo electrónico", persona.email)}
            {campo("RSH %", rshFicha ? String(rshFicha).replace("%", "") + "%" : "")}
            {campo("Comuna RSH", persona.comuna)}
            {campo("N° Integrantes", persona.integrantesFamiliares)}
            {campo("Estado Civil", persona.estadoCivil)}
            {(() => {
              const val = textoAdultoMayor(fechaNacFicha) || persona.adultoMayor || "";
              return campo("Adulto Mayor", val);
            })()}

            <div style={{ ...sectionTitleStyle, marginTop: 10 }}>Área Técnica</div>
            {campo("Dominio Propiedad", persona.dominiopropiedad)}
            {campo("N° FJS / Año", persona.nFJS)}
            {campo("Sistema de Agua Potable", persona.sistemaAgua)}
            {campo("N° Servicio Agua", persona.nServicioAgua)}
            {campo("Proveedor Eléctrico", persona.proveedorElectrico)}
            {campo("N° Cliente Electricidad", persona.nClienteElectricidad)}
            {campo("Inf. Previas", persona.infPrevias || "N/A")}
            {campo("Antecedentes de la Vivienda", persona.antecedentesVivienda || "N/A")}
            {campo("Cert. Ruralidad", persona.certRuralidad)}
            {campo("Avalúo Fiscal", formatPesosChilenos(persona.avaluoFiscal))}
            {campo("Permiso Edificación", persona.permisoEdificacion)}
            {campo("Recepción Definitiva", persona.recepcionDefinitiva)}
            {campo("Constructora Seleccionada", constructoraDeComite(persona, comites))}
            {campo("Metros Viv. Original", persona.metrosOriginal)}
            {campo("Metros Ampliación", persona.metrosAmpl)}
            {campo("Metros No Regularizados", persona.metrosNoRegul)}
            {campo("Total Metros", persona.totalMetros)}
            {campo("Modalidad Postulación DS49", persona.modalidadPostulacion)}

            <div style={{ ...sectionTitleStyle, marginTop: 10 }}>Área Social</div>
            {campo("Discapacidad", persona.discapacidad)}
            {campo("Movilidad Reducida", persona.movilidadReducida)}
            {campo("Credencial/Cert. Discapacidad", persona.credencialDiscapacidad)}
            {campo("N° Cuenta de Ahorro", persona.cuentaAhorro)}
            {campo("Banco", persona.banco)}
            {campo("Subsidio Anterior", mostrarSiNo(persona.subsidioAnterior))}
            {campo("Ahorro para Postular (UF)", persona.ahorroPostular || calcularAhorro(rshFicha))}
            {campo("Observaciones", persona.observaciones)}
          </div>
        )}

        {modo === "editar" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            {seccion("Información General")}
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Cargo en el Comité</label>
              <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#f9fafb", color: "#374151", fontWeight: 600 }}>
                {inferirCargo(form.nombre, persona.comiteId, comites)}
                <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>(automático)</span>
              </div>
            </div>
            {inp("Nombre Postulante", "nombre")}
            {!esCsp && inp("Cédula de identidad", "rut")}
            {!esCsp && inp("Fecha de Nacimiento", "fechaNacimiento", "date")}
            {inp("Dirección", "direccion")}
            {inp("Coordenadas", "coordenadas")}
            {!esCsp && inp("Rol", "rol")}
            {inp("Teléfono", "telefono")}
            {inp("Correo electrónico", "email")}
            {!esCsp && inp("RSH %", "puntajeRSH")}
            {!esCsp && inp("Comuna RSH", "comuna")}
            {!esCsp && inp("N° Integrantes", "integrantesFamiliares")}
            {!esCsp && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Estado Civil</label>
              <select value={form.estadoCivil || ""} onChange={e => setForm({...form, estadoCivil: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                {["SOLTERO/A","CASADO/A","DIVORCIADO/A","VIUDO/A","CONVIVIENTE"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            )}
            {!esCsp && <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Adulto Mayor</label>
              {(() => {
                const e = calcularEdad(form.fechaNacimiento);
                const val = textoAdultoMayor(form.fechaNacimiento);
                return val ? (
                  <div style={{ padding: "7px 10px", borderRadius: 7, background: e >= 60 ? "#FFFBEB" : "#f9fafb", border: "1.5px solid " + (e >= 60 ? "#D97706" : "#e5e7eb"), fontSize: 13, fontWeight: 700, color: e >= 60 ? "#D97706" : "#6b7280" }}>
                    {val} <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>(calculado automáticamente)</span>
                  </div>
                ) : (
                  <div style={{ padding: "7px 10px", borderRadius: 7, background: "#f9fafb", border: "1.5px solid #e5e7eb", fontSize: 13, color: "#9ca3af" }}>
                    Ingresa la fecha de nacimiento para calcular
                  </div>
                );
              })()}
            </div>}

            {seccion("Área Técnica")}
            {!esCsp && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Dominio Propiedad</label>
              <select value={form.dominiopropiedad || ""} onChange={e => setForm({...form, dominiopropiedad: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                {["DV - Dominio Vigente","DRU - Derecho Real de Uso","USUFRUCTO","GOCE","ADJUDICACION","OTRO"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            )}
            {(() => {
              const val = form.nFJS || "";
              const sp = val.indexOf(" ");
              const prefijo = sp > 0 ? val.slice(0, sp) : "";
              const resto = sp > 0 ? val.slice(sp + 1) : val;
              const sl = resto.indexOf("/");
              const numero = sl >= 0 ? resto.slice(0, sl) : resto;
              const anio = sl >= 0 ? resto.slice(sl + 1) : "";
              const upd = (p, n, a) => {
                const numAnio = n.trim() && a.trim() ? n.trim() + "/" + a.trim() : n.trim() || a.trim();
                setForm({...form, nFJS: [p.trim(), numAnio].filter(Boolean).join(" ")});
              };
              const estilo = { width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, boxSizing: "border-box" };
              const lbl = (t) => <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>{t}</label>;
              return (<>
                <div>{lbl("FJS")} <input type="text" value={prefijo} placeholder="FJS" onChange={e => upd(e.target.value, numero, anio)} style={estilo} /></div>
                <div>{lbl("N°")} <input type="text" value={numero} placeholder="25" onChange={e => upd(prefijo, e.target.value, anio)} style={estilo} /></div>
                <div>{lbl("Año")} <input type="text" value={anio} placeholder="2026" onChange={e => upd(prefijo, numero, e.target.value)} style={estilo} /></div>
              </>);
            })()}
            {!esCsp && inp("Sistema de Agua Potable", "sistemaAgua")}
            {!esCsp && inp("N° Servicio Agua", "nServicioAgua")}
            {!esCsp && inp("Proveedor Eléctrico", "proveedorElectrico")}
            {esCsp ? (
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>N° Cliente Electricidad</label>
                <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#f9fafb", color: "#555" }}>{form.nClienteElectricidad || <span style={{ color: "#9ca3af" }}>— (se sincroniza desde la solicitud)</span>}</div>
              </div>
            ) : inp("N° Cliente Electricidad", "nClienteElectricidad")}
            {!esCsp && inp("Inf. Previas", "infPrevias")}
            {!esCsp && inp("Antecedentes de la Vivienda", "antecedentesVivienda")}
            {!esCsp && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Cert. Ruralidad</label>
              <select value={form.certRuralidad || ""} onChange={e => setForm({...form, certRuralidad: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                <option value="SI">SI - Tiene</option>
                <option value="NO">NO - No tiene</option>
                <option value="FALTA">FALTA - Pendiente</option>
              </select>
            </div>
            )}
            {!esCsp && inp("Avalúo Fiscal", "avaluoFiscal")}
            {inp("Permiso Edificación", "permisoEdificacion")}
            {inp("Recepción Definitiva", "recepcionDefinitiva")}
            {inp("Constructora Seleccionada", "constructoraSeleccionada")}
            {inp("Metros Viv. Original", "metrosOriginal")}
            {inp("Metros Ampliación", "metrosAmpl")}
            {inp("Metros No Regularizados", "metrosNoRegul")}
            {inp("Total Metros", "totalMetros")}
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Modalidad Postulación</label>
              <select value={form.modalidadPostulacion || ""} onChange={e => setForm({...form, modalidadPostulacion: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                <option value="CSP DS49">CSP DS49</option>
                <option value="CSP">CSP</option>
                <option value="D.S. 49">D.S. 49</option>
                <option value="C.S.P.">C.S.P.</option>
              </select>
            </div>

            {seccion("Área Social")}
            {!esCsp && (() => {
              const discNoAplica = form.discapacidad === "N/A" || (form.discapacidad || "").toLowerCase().includes("sin");
              const lockStyle = { padding: "7px 10px", borderRadius: 7, background: "#f9fafb", border: "1.5px solid #e5e7eb", fontSize: 13, color: "#6b7280" };
              const lockLabel = (label) => <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>{label}</label>;
              return (<>
            <div>
              {lockLabel("Discapacidad")}
              <select value={form.discapacidad || ""} onChange={e => {
                const val = e.target.value;
                const noAplica = val === "N/A" || val.toLowerCase().includes("sin");
                setForm({ ...form, discapacidad: val, ...(noAplica ? { movilidadReducida: "N/A", credencialDiscapacidad: "N/A" } : {}) });
              }} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                <option value="S">S - Sí</option>
                <option value="N">N - No</option>
                <option value="N/A">N/A</option>
              </select>
            </div>
            {discNoAplica ? (
              <div>{lockLabel("Movilidad Reducida")}<div style={lockStyle}>N/A — sin discapacidad</div></div>
            ) : (
              <div>
                {lockLabel("Movilidad Reducida")}
                <select value={form.movilidadReducida || ""} onChange={e => setForm({...form, movilidadReducida: e.target.value})}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, background: "#fff" }}>
                  <option value="">-- Seleccionar --</option>
                  <option value="SI">SI</option>
                  <option value="N/A">N/A</option>
                </select>
              </div>
            )}
            {inp("N° Cuenta de Ahorro", "cuentaAhorro")}
            {inp("Banco", "banco")}
            {discNoAplica ? (
              <div>{lockLabel("Credencial/Cert. Discapacidad")}<div style={lockStyle}>N/A — sin discapacidad</div></div>
            ) : inp("Credencial/Cert. Discapacidad", "credencialDiscapacidad")}
              </>);
            })()}
            {!esCsp && inp("Subsidio Anterior", "subsidioAnterior")}
            {!esCsp && inp("Ahorro para Postular (UF)", "ahorroPostular")}
            <div style={{ gridColumn: "span 3" }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Observaciones</label>
              <textarea value={form.observaciones || ""} onChange={e => setForm({...form, observaciones: e.target.value})}
                rows={3} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #D97706", fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>

            <div style={{ gridColumn: "span 3", display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 16, borderTop: "1px solid #f0ede8" }}>
              <button onClick={() => { setForm({...persona}); setCamposDesbloqueados(false); setModo("ver"); }} style={{ padding: "9px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={guardar} style={{ padding: "9px 22px", borderRadius: 8, background: "#D97706", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
            </div>
          </div>
        )}
      </div>
      {confirmModal && <ConfirmModal mensaje={confirmModal.msg} danger={false} onConfirm={confirmModal.fn} onCancel={() => setConfirmModal(null)} />}
      {/* clave de campos eliminada */}
    </div>
  );
}

// ─── FICHA URBANA ─────────────────────────────────────────────────────────────
function FichaUrbana({ persona, misSols, comites, onSave, esCsp }) {
  const [modo, setModo] = useState("ver");
  const [form, setForm] = useState({ ...persona });
  const [confirmModal, setConfirmModal] = useState(null);
  const [camposDesbloqueados, setCamposDesbloqueados] = useState(false);
  const [showClaveCampos, setShowClaveCampos] = useState(false);

  useEffect(() => {
    if (modo === "ver") setForm({ ...persona });
  }, [persona, modo]);

  const guardar = () => {
    setConfirmModal({ msg: "¿Guardar los cambios de la Ficha Urbana?", fn: async () => {
      const formFinal = protegerDatosFicha(form, persona, {
        adultoMayor: textoAdultoMayor(form.fechaNacimiento) || form.adultoMayor,
        cargo_comite: inferirCargo(form.nombre, persona.comiteId, comites),
        constructoraSeleccionada: constructoraDeComite({ ...persona, ...form }, comites)
      });
      await supabase.from("personas").update(toDbFields(formFinal)).eq("id", persona.id);
      onSave(formFinal);
      setCamposDesbloqueados(false);
      setModo("ver");
      setConfirmModal(null);
    }});
  };

  const handleFechaNac = (val) => {
    const adulto = textoAdultoMayor(val) || form.adultoMayor || "";
    setForm(f => ({ ...f, fechaNacimiento: val, adultoMayor: adulto }));
  };

  const handleRSH = (val) => {
    const ahorro = calcularAhorro(val);
    setForm(f => ({ ...f, puntajeRSH: val, ahorroPostular: ahorro || f.ahorroPostular }));
  };

  const sectionTitleStyle = {
    gridColumn: "span 3",
    fontSize: 15,
    fontWeight: 900,
    color: "#1E3A8A",
    textTransform: "uppercase",
    padding: "8px 0 7px",
    borderBottom: "3px solid #93C5FD",
    letterSpacing: "0.2px"
  };

  const campo = (label, valor) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: valor ? "#1e3a5f" : "#DC2626", fontWeight: valor ? 500 : 600, padding: "5px 0", borderBottom: "1px solid #f0ede8" }}>{valor || "⚠ Falta"}</div>
    </div>
  );

  const inp = (label, key, type = "text") => {
    const onChange = key === "fechaNacimiento" ? e => handleFechaNac(e.target.value)
                   : key === "puntajeRSH"     ? e => handleRSH(e.target.value)
                   : key === "avaluoFiscal"   ? e => setForm({ ...form, [key]: formatPesosChilenos(e.target.value) })
                   : e => setForm({ ...form, [key]: e.target.value });
    return (
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>{label}</label>
        <input type={type} value={form[key] || ""} onChange={onChange}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, boxSizing: "border-box", background: "#fff" }} />
      </div>
    );
  };

  const seccion = (titulo) => (
    <div style={{ ...sectionTitleStyle, marginTop: 10 }}>{titulo}</div>
  );

  const fechaNacFicha = persona.fechaNacimiento || persona.fecha_nacimiento || fechaNacimientoDesdeSolicitudes(misSols);
  const rshFicha = persona.puntajeRSH || persona.puntaje_rsh || rshDesdeSolicitudes(misSols);

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e3de", marginBottom: 20, overflow: "hidden" }}>
      <div style={{ background: "#ECFDF5", borderBottom: "3px solid #059669", padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#059669" }}>🏙️ Ficha Urbana — {persona.comite}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["ver","Ver"],["editar","Editar"]].map(([k,l]) => (
            <button key={k} onClick={() => { setForm({...persona}); if (k==="ver") setCamposDesbloqueados(false); setModo(k); }}
              style={{ padding: "6px 14px", borderRadius: 7, border: "1.5px solid " + (modo===k ? "#059669" : "#ddd"), background: modo===k ? "#059669" : "#fff", color: modo===k ? "#fff" : "#555", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {modo === "ver" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={sectionTitleStyle}>Información General</div>
            {campo("Nombre del Comité", persona.comite)}
            {campo("Cargo en el Comité", inferirCargo(persona.nombre, persona.comiteId, comites) || persona.cargo_comite)}
            {campo("Nombre Postulante", persona.nombre)}
            {campo("Cédula de identidad", persona.rut)}
            {campo("RUT colores", persona.rutColores || persona.rutcolores || rutColoresDesdeSolicitudes(misSols))}
            {campo("Fecha de Nacimiento", fmtFecha(fechaNacFicha))}
            {campo("Dirección", persona.direccion)}
            {campo("Coordenadas", persona.coordenadas)}
            {campo("Rol", persona.rol)}
            {campo("Teléfono", persona.telefono)}
            {campo("Correo electrónico", persona.email)}
            {campo("RSH %", rshFicha ? String(rshFicha).replace("%", "") + "%" : "")}
            {campo("Comuna RSH", persona.comuna)}
            {campo("N° Integrantes", persona.integrantesFamiliares)}
            {campo("Estado Civil", persona.estadoCivil)}
            {(() => {
              const val = textoAdultoMayor(fechaNacFicha) || persona.adultoMayor || "";
              return campo("Adulto Mayor", val);
            })()}

            <div style={{ ...sectionTitleStyle, marginTop: 10 }}>Área Técnica</div>
            {campo("Dominio Propiedad", persona.dominiopropiedad)}
            {campo("N° FJS / Año", persona.nFJS)}
            {campo("Informaciones Previas", persona.informacionesPrevias || "N/A")}
            {campo("Antecedentes de la Vivienda", persona.antecedentesVivienda || "N/A")}
            {campo("Sistema de Agua Potable", persona.sistemaAgua)}
            {campo("N° Servicio Agua", persona.nServicioAgua)}
            {campo("Proveedor Eléctrico", persona.proveedorElectrico)}
            {campo("N° Cliente Electricidad", persona.nClienteElectricidad)}
            {campo("Avalúo Fiscal", formatPesosChilenos(persona.avaluoFiscal))}
            {campo("Permiso Edificación", persona.permisoEdificacion)}
            {campo("Recepción Definitiva", persona.recepcionDefinitiva)}
            {campo("Constructora Seleccionada", constructoraDeComite(persona, comites))}
            {campo("Metros Viv. Original", persona.metrosOriginal)}
            {campo("Metros Ampliación", persona.metrosAmpl)}
            {campo("Metros No Regularizados", persona.metrosNoRegul)}
            {campo("Total Metros", persona.totalMetros)}
            {campo("Modalidad Postulación", persona.modalidadPostulacion)}

            <div style={{ ...sectionTitleStyle, marginTop: 10 }}>Área Social</div>
            {campo("Discapacidad", persona.discapacidad)}
            {campo("Movilidad Reducida", persona.movilidadReducida)}
            {campo("Credencial/Cert. Discapacidad", persona.credencialDiscapacidad)}
            {campo("N° Cuenta de Ahorro", persona.cuentaAhorro)}
            {campo("Banco", persona.banco)}
            {campo("Subsidio Anterior", mostrarSiNo(persona.subsidioAnterior))}
            {campo("Ahorro para Postular (UF)", persona.ahorroPostular || calcularAhorro(rshFicha))}
            {campo("Observaciones", persona.observaciones)}
          </div>
        )}

        {modo === "editar" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            {seccion("Información General")}
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Cargo en el Comité</label>
              <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#f9fafb", color: "#374151", fontWeight: 600 }}>
                {inferirCargo(form.nombre, persona.comiteId, comites)}
                <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>(automático)</span>
              </div>
            </div>
            {inp("Nombre Postulante", "nombre")}
            {!esCsp && inp("Cédula de identidad", "rut")}
            {!esCsp && inp("Fecha de Nacimiento", "fechaNacimiento", "date")}
            {inp("Dirección", "direccion")}
            {inp("Coordenadas", "coordenadas")}
            {!esCsp && inp("Rol", "rol")}
            {inp("Teléfono", "telefono")}
            {inp("Correo electrónico", "email")}
            {!esCsp && inp("RSH %", "puntajeRSH")}
            {!esCsp && inp("Comuna RSH", "comuna")}
            {!esCsp && inp("N° Integrantes", "integrantesFamiliares")}
            {!esCsp && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Estado Civil</label>
              <select value={form.estadoCivil || ""} onChange={e => setForm({...form, estadoCivil: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                {["SOLTERO/A","CASADO/A","DIVORCIADO/A","VIUDO/A","CONVIVIENTE"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            )}
            {!esCsp && <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Adulto Mayor</label>
              {(() => {
                const e = calcularEdad(form.fechaNacimiento);
                const val = textoAdultoMayor(form.fechaNacimiento);
                return val ? (
                  <div style={{ padding: "7px 10px", borderRadius: 7, background: e >= 60 ? "#ECFDF5" : "#f9fafb", border: "1.5px solid " + (e >= 60 ? "#059669" : "#e5e7eb"), fontSize: 13, fontWeight: 700, color: e >= 60 ? "#059669" : "#6b7280" }}>
                    {val} <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>(calculado automáticamente)</span>
                  </div>
                ) : (
                  <div style={{ padding: "7px 10px", borderRadius: 7, background: "#f9fafb", border: "1.5px solid #e5e7eb", fontSize: 13, color: "#9ca3af" }}>
                    Ingresa la fecha de nacimiento para calcular
                  </div>
                );
              })()}
            </div>}

            {seccion("Área Técnica")}
            {!esCsp && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Dominio Propiedad</label>
              <select value={form.dominiopropiedad || ""} onChange={e => setForm({...form, dominiopropiedad: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                {["DV - Dominio Vigente","DRU - Derecho Real de Uso","USUFRUCTO","GOCE","ADJUDICACION","OTRO"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            )}
            {!esCsp && inp("Informaciones Previas", "informacionesPrevias")}
            {(() => {
              const val = form.nFJS || "";
              const sp = val.indexOf(" ");
              const prefijo = sp > 0 ? val.slice(0, sp) : "";
              const resto = sp > 0 ? val.slice(sp + 1) : val;
              const sl = resto.indexOf("/");
              const numero = sl >= 0 ? resto.slice(0, sl) : resto;
              const anio = sl >= 0 ? resto.slice(sl + 1) : "";
              const upd = (p, n, a) => {
                const numAnio = n.trim() && a.trim() ? n.trim() + "/" + a.trim() : n.trim() || a.trim();
                setForm({...form, nFJS: [p.trim(), numAnio].filter(Boolean).join(" ")});
              };
              const estilo = { width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, boxSizing: "border-box" };
              const lbl = (t) => <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>{t}</label>;
              return (<>
                <div>{lbl("FJS")} <input type="text" value={prefijo} placeholder="FJS" onChange={e => upd(e.target.value, numero, anio)} style={estilo} /></div>
                <div>{lbl("N°")} <input type="text" value={numero} placeholder="25" onChange={e => upd(prefijo, e.target.value, anio)} style={estilo} /></div>
                <div>{lbl("Año")} <input type="text" value={anio} placeholder="2026" onChange={e => upd(prefijo, numero, e.target.value)} style={estilo} /></div>
              </>);
            })()}
            {!esCsp && inp("Antecedentes de la Vivienda", "antecedentesVivienda")}
            {!esCsp && inp("Sistema de Agua Potable", "sistemaAgua")}
            {!esCsp && inp("N° Servicio Agua", "nServicioAgua")}
            {!esCsp && inp("Proveedor Eléctrico", "proveedorElectrico")}
            {esCsp ? (
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>N° Cliente Electricidad</label>
                <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#f9fafb", color: "#555" }}>{form.nClienteElectricidad || <span style={{ color: "#9ca3af" }}>— (se sincroniza desde la solicitud)</span>}</div>
              </div>
            ) : inp("N° Cliente Electricidad", "nClienteElectricidad")}
            {!esCsp && inp("Avalúo Fiscal", "avaluoFiscal")}
            {inp("Permiso Edificación", "permisoEdificacion")}
            {inp("Recepción Definitiva", "recepcionDefinitiva")}
            {inp("Constructora Seleccionada", "constructoraSeleccionada")}
            {inp("Metros Viv. Original", "metrosOriginal")}
            {inp("Metros Ampliación", "metrosAmpl")}
            {inp("Metros No Regularizados", "metrosNoRegul")}
            {inp("Total Metros", "totalMetros")}
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Modalidad Postulación</label>
              <select value={form.modalidadPostulacion || ""} onChange={e => setForm({...form, modalidadPostulacion: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                <option value="CSP DS49">CSP DS49</option>
                <option value="CSP">CSP</option>
              </select>
            </div>

            {seccion("Área Social")}
            {!esCsp && (() => {
              const discNoAplica = form.discapacidad === "N/A" || (form.discapacidad || "").toLowerCase().includes("sin");
              const lockStyle = { padding: "7px 10px", borderRadius: 7, background: "#f9fafb", border: "1.5px solid #e5e7eb", fontSize: 13, color: "#6b7280" };
              const lockLabel = (label) => <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>{label}</label>;
              return (<>
            <div>
              {lockLabel("Discapacidad")}
              <select value={form.discapacidad || ""} onChange={e => {
                const val = e.target.value;
                const noAplica = val === "N/A" || val.toLowerCase().includes("sin");
                setForm({ ...form, discapacidad: val, ...(noAplica ? { movilidadReducida: "N/A", credencialDiscapacidad: "N/A" } : {}) });
              }} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                <option value="S">S - Sí</option>
                <option value="N">N - No</option>
                <option value="N/A">N/A</option>
              </select>
            </div>
            {discNoAplica ? (
              <div>{lockLabel("Movilidad Reducida")}<div style={lockStyle}>N/A — sin discapacidad</div></div>
            ) : (
              <div>
                {lockLabel("Movilidad Reducida")}
                <select value={form.movilidadReducida || ""} onChange={e => setForm({...form, movilidadReducida: e.target.value})}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, background: "#fff" }}>
                  <option value="">-- Seleccionar --</option>
                  <option value="SI">SI</option>
                  <option value="N/A">N/A</option>
                </select>
              </div>
            )}
            {inp("N° Cuenta de Ahorro", "cuentaAhorro")}
            {inp("Banco", "banco")}
            {discNoAplica ? (
              <div>{lockLabel("Credencial/Cert. Discapacidad")}<div style={lockStyle}>N/A — sin discapacidad</div></div>
            ) : inp("Credencial/Cert. Discapacidad", "credencialDiscapacidad")}
              </>);
            })()}
            {!esCsp && inp("Subsidio Anterior", "subsidioAnterior")}
            {!esCsp && inp("Ahorro para Postular (UF)", "ahorroPostular")}
            <div style={{ gridColumn: "span 3" }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Observaciones</label>
              <textarea value={form.observaciones || ""} onChange={e => setForm({...form, observaciones: e.target.value})}
                rows={3} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #059669", fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>

            <div style={{ gridColumn: "span 3", display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 16, borderTop: "1px solid #f0ede8" }}>
              <button onClick={() => { setForm({...persona}); setCamposDesbloqueados(false); setModo("ver"); }} style={{ padding: "9px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={guardar} style={{ padding: "9px 22px", borderRadius: 8, background: "#059669", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
            </div>
          </div>
        )}
      </div>
      {confirmModal && <ConfirmModal mensaje={confirmModal.msg} danger={false} onConfirm={confirmModal.fn} onCancel={() => setConfirmModal(null)} />}
      {/* clave de campos eliminada */}
    </div>
  );
}

function FichaProgramaCustom({ persona, programa, solicitud }) {
  const docs = solicitud && Array.isArray(solicitud.documentos) ? solicitud.documentos : [];
  const color = programa.color || "#7C3AED";
  const colorLight = programa.colorLight || programa.colorlight || "#F5F3FF";

  const valorDoc = (doc) => {
    const raw = doc.valor || "";
    if (!raw) return "";
    try {
      const obj = JSON.parse(raw);
      return Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim())
        .map(([k, v]) => {
          const label = k
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, c => c.toUpperCase());
          return `${label}: ${v}`;
        })
        .join(" | ");
    } catch {
      return raw;
    }
  };

  const dato = (label, value) => {
    const val = value === 0 ? "0" : (value || "").toString().trim();
    if (!val) return null;
    return (
      <div key={label} style={{ borderBottom: "1px solid #eef2f7", padding: "8px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 700 }}>{val}</div>
      </div>
    );
  };

  const datos = [
    dato("Nombre", persona.nombre),
    dato("Cédula de identidad", persona.rut),
    dato("RUT colores", persona.rutColores || persona.rutcolores || rutColoresDesdeSolicitudes(solicitud ? [solicitud] : [])),
    dato("Fecha de ingreso", persona.fechaIngreso || persona.fecha_ingreso),
    dato("Fecha de nacimiento", persona.fechaNacimiento || persona.fecha_nacimiento),
    dato("Teléfono", persona.telefono),
    dato("Dirección", persona.direccion),
    dato("Correo", persona.email || persona.correo),
    dato("Comuna", persona.comuna),
    dato("Comité", persona.comite),
    dato("RSH", persona.puntajeRSH || persona.puntaje_rsh),
    dato("Estado civil", persona.estadoCivil || persona.estadocivil || persona.estado_civil),
    dato("N° integrantes", persona.integrantesFamiliares || persona.integrantes_familiares),
    dato("N° cuenta ahorro", persona.numero_cuenta_ahorro || persona.cuentaAhorro || persona.cuentaahorro),
    dato("Banco", persona.banco),
    dato("Ingreso familiar UF", persona.ingreso_familiar_uf),
    dato("Subsidio anterior", mostrarSiNo(persona.subsidioAnterior || persona.subsidio_anterior)),
    dato("Rol propiedad", persona.rol_propiedad || persona.rol),
    dato("Avalúo fiscal", persona.avaluoFiscal || persona.avaluofiscal),
    dato("Coordenadas", persona.coordenadas),
    dato("Observaciones", persona.observaciones),
  ].filter(Boolean);

  const docsConDatos = docs.filter(d => docCompletoEquivalente(d, docs) || valorDoc(d));

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", marginBottom: 20, border: "1px solid #e8e3de" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: colorLight, color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 }}>
          {programa.icon || "P"}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color }}>Ficha {programa.nombre || "Programa personalizado"}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Datos disponibles del solicitante para este programa</div>
        </div>
      </div>

      {datos.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0 18px", marginBottom: 18 }}>
          {datos}
        </div>
      ) : (
        <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, color: "#94a3b8", fontSize: 13 }}>
          Aún no hay datos cargados para mostrar en esta ficha.
        </div>
      )}

      {docsConDatos.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#334155", textTransform: "uppercase", marginBottom: 8 }}>Documentos / antecedentes registrados</div>
          <div style={{ display: "grid", gap: 8 }}>
            {docsConDatos.map((d, i) => {
              const completo = docCompletoEquivalente(d, docs);
              const val = valorDoc(d);
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: "9px 12px", borderRadius: 9, border: "1px solid " + (completo ? "#bbf7d0" : "#e5e7eb"), background: completo ? "#f0fdf4" : "#f8fafc" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#1f2937" }}>{d.nombre}</div>
                    {val && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{val}</div>}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: completo ? "#047857" : "#64748b", textTransform: "uppercase" }}>
                    {completo ? "VB" : "Dato"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DetallePersona({ personaId, personas, solicitudes, comites, programasCustom, onBack, onSaveSolicitudes, onSavePersonas, currentUser, registrarAuditoria }) {
  const todosProgramas = combinarProgramas(programasCustom);
  const [showModal, setShowModal] = useState(false);
  const [progSel, setProgSel] = useState("");
  const [archivos, setArchivos] = useState([]);
  const [archivosRutas, setArchivosRutas] = useState({});
  const [archivosDatos, setArchivosDatos] = useState({});
  const [subiendo, setSubiendo] = useState(false);
  const [showModalComprobante, setShowModalComprobante] = useState(false);
  const [showDesbloquearRespuesta, setShowDesbloquearRespuesta] = useState(false);
  const [solsEditando, setSolsEditando] = useState({}); // {solId: true} para habilitar edición
  const [showModalEmigrar, setShowModalEmigrar] = useState(false);
  const [programaEmigrar, setProgramaEmigrar] = useState("");
  const [showDesbloquearPrograma, setShowDesbloquearPrograma] = useState(false);
  const [notaRechazo, setNotaRechazo] = useState("");
  const [resultadoComp, setResultadoComp] = useState("");
  const [showModalInformeDom, setShowModalInformeDom] = useState(false);
  const [resultadoInformeDom, setResultadoInformeDom] = useState("");
  const [showModalRespuestaServiu, setShowModalRespuestaServiu] = useState(false);
  const [resultadoRespuestaServiu, setResultadoRespuestaServiu] = useState("");
  const [notaResultado, setNotaResultado] = useState("");
  const [showFichaEdit, setShowFichaEdit] = useState(false);
  const [fichaForm, setFichaForm] = useState({});
  const [tipoComiteDesbloqueado, setTipoComiteDesbloqueado] = useState(false);
  const [showDesbloquearTipoComite, setShowDesbloquearTipoComite] = useState(false);
  const [camposDesmarqueDesbloqueados, setCamposDesmarqueDesbloqueados] = useState(false);
  const [showClaveCamposDesmarque, setShowClaveCamposDesmarque] = useState(false);
  const [rutDesbloqueado, setRutDesbloqueado] = useState(false);
  const [showClaveRut, setShowClaveRut] = useState(false);
  const [showClaveVbDesmarque, setShowClaveVbDesmarque] = useState(false);
  const [pendingVbDesmarque, setPendingVbDesmarque] = useState(null);
  const [showModalMemo, setShowModalMemo] = useState(false);
  const [showModalCarta, setShowModalCarta] = useState(false);
  const [showModalSolicitud, setShowModalSolicitud] = useState(false);
  const [showModalInformeJACC, setShowModalInformeJACC] = useState(false);
  const memoInicial = {
    numero: "",
    problemas: [],
    nuevoProblema: "",
    deTipo: "marcelo",
    deNombre: "MARCELO CIFUENTES VÁSQUEZ",
    deCargo: "ENCARGADO ENTIDAD PATROCINANTE",
    deInstitucion: "MUNICIPALIDAD DE LAUTARO",
    deIniciales: "MCV/mcv",
    aTipo: "eduardo",
    aNombre: "SEÑOR EDUARDO BUSTOS VALDEBENITO",
    aCargo: "DIRECTOR DE OBRAS",
    aInstitucion: "MUNICIPALIDAD DE LAUTARO",
    aTrato: "PRESENTE."
  };
  const [formMemo, setFormMemo] = useState(memoInicial);
  const cartaInicial = {
    numero: "",
    deTipo: "marcelo",
    deNombre: "MARCELO CIFUENTES VÁSQUEZ",
    deCargo: "ENCARGADO ENTIDAD PATROCINANTE",
    deInstitucion: "MUNICIPALIDAD DE LAUTARO",
    deIniciales: "MCV/mcv",
    aTipo: "marco",
    aNombre: "SEÑOR MARCO SEGUEL REYES",
    aCargo: "DIRECTOR DE SERVIU (S)",
    aInstitucion: "REGIÓN DE LA ARAUCANIA",
    aTrato: "PRESENTE."
  };
  const [formCarta, setFormCarta] = useState(cartaInicial);
  const [formSolicitud, setFormSolicitud] = useState({ subsidio: "", anioSubsidio: "" });
  const [filasInforme, setFilasInforme] = useState([{ id: uid(), descripcion: "", imagenBase64: null, imagenNombre: "", mimeType: "", imgWidth: 265, imgHeight: 200 }]);
  const [informeSubsidioTexto, setInformeSubsidioTexto] = useState("");
  const [informeEstadoVivienda, setInformeEstadoVivienda] = useState("");
  const [generando, setGenerando] = useState(false);
  const [generandoInforme, setGenerandoInforme] = useState(false);
  const [docMenu, setDocMenu] = useState(null); // { arch, x, y }
  const [htmlPreview, setHtmlPreview] = useState(null);
  const [showModalZip, setShowModalZip] = useState(false);
  const [zipSearch, setZipSearch] = useState("");
  const [zipSeleccionados, setZipSeleccionados] = useState([]);
  const [generandoZip, setGenerandoZip] = useState(false);
  const fileRef = useRef();
  const iframePreviewRef = useRef();

  const [showAsignarComite, setShowAsignarComite] = useState(false);
  const [comiteParaAsignar, setComiteParaAsignar] = useState("");
  const [visitas, setVisitas] = useState([]);
  const [showFormVisita, setShowFormVisita] = useState(false);
  const [formVisita, setFormVisita] = useState({ fecha: "", profesional: "", compromiso: "", checksDocs: {}, otrosSolicitud: "", checksDocsRecibidos: {}, profesionalRecibio: "" });
  const [guardandoVisita, setGuardandoVisita] = useState(false);
  const [showFichaSolicitante, setShowFichaSolicitante] = useState(false);

  const persona = personas.find(p => p.id === personaId);
  const carpetaVieja = persona ? carpetaNombre(persona.nombre, persona.rut) : "";
  const carpeta = persona ? carpetaPrograma(persona, solicitudes) : "";
  const misSols = solicitudes.filter(s => s.personaId === personaId);
  const esPrioritario = solicitantePrioritario(personaId, solicitudes);
  const VISITAS_DOC_KEY = "__registro_visitas_oficina__";

  const visitasDesdeSolicitudes = () => {
    const visitasRecuperadas = [];
    (misSols || []).forEach(s => {
      (s.documentos || []).forEach(d => {
        if (!(d.interno && d.tipo === VISITAS_DOC_KEY)) return;
        try {
          const arr = JSON.parse(d.valor || "[]");
          if (Array.isArray(arr)) visitasRecuperadas.push(...arr);
        } catch {}
      });
    });
    return visitasRecuperadas;
  };

  const abrirModalSolicitud = () => {
    setFormSolicitud({
      subsidio: textoSubsidioSolicitud(persona),
      anioSubsidio: anioSolo(persona?.anio_subsidio || persona?.anioSubsidio)
    });
    setShowModalSolicitud(true);
  };

  const guardarFechaVisitaDesmarque = async (sol, fecha) => {
    const fechaAnterior = fechaVisitaSolicitud(sol);
    if (!fecha && fechaAnterior && !window.confirm("¿Quitar la fecha de visita registrada?")) {
      onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...sol, fecha_visita: fechaAnterior }));
      return false;
    }
    const documentos = documentosConFechaVisita(sol.documentos || [], fecha);
    const solActualizada = { ...sol, fecha_visita: fecha, documentos };
    const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : solActualizada);
    onSaveSolicitudes(nuevasSols);

    const { error: docsError } = await supabase
      .from("solicitudes")
      .update({ documentos })
      .eq("id", sol.id);

    if (docsError) {
      console.warn("[fecha visita documentos] error:", docsError.message);
      const docsAnteriores = documentosConFechaVisita(sol.documentos || [], fechaAnterior);
      onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...sol, fecha_visita: fechaAnterior, documentos: docsAnteriores }));
      alert("No se pudo guardar la fecha de visita. No se modificó el registro.");
      return false;
    }

    supabase
      .from("solicitudes")
      .update({ fecha_visita: fecha || null })
      .eq("id", sol.id)
      .then(({ error }) => { if (error) console.warn("[fecha visita columna] respaldo interno usado:", error.message); });

    return true;
  };

  const fusionarVisitas = (a = [], b = []) => {
    const porId = new Map();
    [...a, ...b].forEach(v => {
      if (!v || !v.id) return;
      porId.set(v.id, { ...porId.get(v.id), ...v });
    });
    return [...porId.values()].sort((x, y) => String(y.fecha || "").localeCompare(String(x.fecha || "")));
  };

  const respaldarVisitasEnSolicitud = async (lista) => {
    const solDestino = misSols[0];
    if (!solDestino) return false;
    const limpias = fusionarVisitas(lista, []);
    const documentos = [...(solDestino.documentos || [])];
    const idx = documentos.findIndex(d => d.interno && d.tipo === VISITAS_DOC_KEY);
    const registro = {
      nombre: "Registro de visitas a oficina",
      obligatorio: false,
      entregado: limpias.length > 0,
      interno: true,
      tipo: VISITAS_DOC_KEY,
      valor: JSON.stringify(limpias)
    };
    if (idx >= 0) documentos[idx] = { ...documentos[idx], ...registro };
    else documentos.push(registro);
    const actualizadas = solicitudes.map(s => s.id === solDestino.id ? { ...s, documentos } : s);
    onSaveSolicitudes(actualizadas);
    const { error } = await supabase.from("solicitudes").update({ documentos }).eq("id", solDestino.id);
    if (error) {
      console.warn("[visitas respaldo] error:", error.message);
      return false;
    }
    return true;
  };

  const cargarVisitas = async () => {
    const respaldo = visitasDesdeSolicitudes();
    try {
      const { data, error } = await supabase.from("visitas").select("*").eq("persona_id", personaId).order("fecha", { ascending: false });
      if (error) {
        if (error.code === "PGRST205") console.warn("[visitas] Tabla 'visitas' no existe aún. Ejecuta supabase_migration.sql en el Dashboard.");
        else console.warn("[visitas] error:", error.message);
        setVisitas(prev => fusionarVisitas(prev, respaldo));
        return;
      }
      const combinadas = fusionarVisitas(data || [], respaldo);
      setVisitas(combinadas);
      if (respaldo.length < combinadas.length) respaldarVisitasEnSolicitud(combinadas).catch(() => {});
    } catch (err) {
      console.warn("[cargarVisitas] excepción:", err.message);
      setVisitas(prev => fusionarVisitas(prev, respaldo));
    }
  };

  const agregarVisita = async (progDocs) => {
    const profesionalActual = formVisita.profesional || currentUser?.nombre || "";
    if (!formVisita.fecha || !profesionalActual) return;
    setGuardandoVisita(true);
    const buildLineas = (checks) => progDocs
      .filter(d => checks[d.id])
      .map(d => d.subopciones && typeof checks[d.id] === "string"
        ? `• ${d.label} (${checks[d.id]})`
        : `• ${d.label}`);
    const lineas = buildLineas(formVisita.checksDocs);
    if (formVisita.otrosSolicitud.trim()) lineas.push(`Otros: ${formVisita.otrosSolicitud.trim()}`);
    const recibidosLineas = buildLineas(formVisita.checksDocsRecibidos);
    const nueva = {
      id: uid(), persona_id: personaId, fecha: formVisita.fecha,
      profesional: profesionalActual,
      solicitud: lineas.join("\n"),
      compromiso: formVisita.compromiso.trim(),
      docs_recibidos: recibidosLineas.join("\n"),
      profesional_recibio: formVisita.profesionalRecibio || (recibidosLineas.length ? profesionalActual : ""),
    };
    let persistidaTabla = true;
    const { error: insErr } = await supabase.from("visitas").insert([nueva]);
    if (insErr) {
      console.warn("[visitas insert] error:", insErr.message);
      const base = {
        id: nueva.id,
        persona_id: nueva.persona_id,
        fecha: nueva.fecha,
        profesional: nueva.profesional,
        solicitud: nueva.solicitud,
        compromiso: nueva.compromiso
      };
      const retry = await supabase.from("visitas").insert([base]);
      if (retry.error) {
        persistidaTabla = false;
        console.warn("[visitas insert retry] error:", retry.error.message);
      }
    }
    const listaFinal = fusionarVisitas([nueva], visitas);
    const persistidaRespaldo = await respaldarVisitasEnSolicitud(listaFinal);
    if (!persistidaTabla && !persistidaRespaldo) {
      alert("No se pudo guardar la visita en Supabase. No se cerrará el formulario para evitar pérdida de datos.");
      setGuardandoVisita(false);
      return;
    }
    await registrarAuditoria?.("registrar_visita", "visitas", nueva.id, { personaId, persona: persona?.nombre || "", fecha: nueva.fecha, profesional: nueva.profesional });
    setVisitas(listaFinal);
    setFormVisita({ fecha: "", profesional: "", compromiso: "", checksDocs: {}, otrosSolicitud: "", checksDocsRecibidos: {}, profesionalRecibio: "" });
    setShowFormVisita(false);
    setGuardandoVisita(false);
  };

  const asignarComite = async () => {
    const normN = s => (s||"").toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");
    const todosComites = [
      ...COMITES_FIJOS.map(c => ({ id: c.codigo, nombre: c.nombre, tipo: c.tipo })),
      ...(comites||[]).filter(sc => sc.nombre && !COMITES_FIJOS.some(f => normN(f.nombre) === normN(sc.nombre)))
        .map(sc => ({ id: sc.id, nombre: sc.nombre, tipo: sc.programaId === "csp_urbano" ? "URBANO" : "RURAL" }))
    ];
    const sel = todosComites.find(c => c.id === comiteParaAsignar);
    if (!sel) return;
    await supabase.from("personas").update({ comite_id: sel.id, comite: sel.nombre, tipo_comite: sel.tipo }).eq("id", persona.id);
    onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, comiteId: sel.id, comite: sel.nombre, tipo_comite: sel.tipo } : p));
    setShowAsignarComite(false);
    setComiteParaAsignar("");
  };

  const eliminarVisita = async (id) => {
    if (!window.confirm("¿Eliminar esta visita?")) return;
    const { error } = await supabase.from("visitas").delete().eq("id", id);
    if (error) console.warn("[visitas delete] error:", error.message);
    const restantes = visitas.filter(v => v.id !== id);
    await respaldarVisitasEnSolicitud(restantes);
    setVisitas(restantes);
  };

  const imprimirVisita = (v) => {
    const win = window.open("", "_blank", "width=820,height=700");
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Visita — ${persona.nombre}</title>
<style>
  @page { margin: 2.2cm 2cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; line-height: 1.55; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 14px; border-bottom: 3px solid #1e3a5f; margin-bottom: 22px; }
  .org-name { font-size: 17px; font-weight: 700; color: #1e3a5f; }
  .org-sub  { font-size: 12px; color: #555; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 15px; font-weight: 700; color: #1e3a5f; }
  .doc-title p  { font-size: 11px; color: #888; margin-top: 3px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; margin-bottom: 18px; }
  .field { margin-bottom: 14px; }
  .field-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-bottom: 3px; }
  .field-value { font-size: 13px; font-weight: 600; color: #111; padding: 6px 10px; background: #f9fafb; border-radius: 5px; border-left: 3px solid #1e3a5f; }
  .docs-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; white-space: pre-line; font-size: 13px; min-height: 60px; }
  .comprob-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; font-size: 13px; min-height: 60px; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 52px; }
  .firma-line { border-top: 1px solid #333; padding-top: 8px; text-align: center; font-size: 11px; color: #555; }
  .footer-note { margin-top: 36px; font-size: 10px; color: #aaa; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
  <div>
    <div class="org-name">UNIDAD DE VIVIENDA</div>
    <div class="org-sub">Entidad Patrocinante: Ilustre Municipalidad de Lautaro</div>
  </div>
  <div class="doc-title">
    <h1>Registro de Visita a Oficina</h1>
    <p>Documento generado el ${new Date().toLocaleDateString("es-CL")}</p>
  </div>
</div>

<div class="grid2">
  <div class="field">
    <div class="field-label">Nombre del solicitante</div>
    <div class="field-value">${persona.nombre}</div>
  </div>
  <div class="field">
    <div class="field-label">RUT</div>
    <div class="field-value">${persona.rut || "—"}</div>
  </div>
  <div class="field">
    <div class="field-label">Fecha de visita</div>
    <div class="field-value">${fmtFecha(v.fecha)}</div>
  </div>
  <div class="field">
    <div class="field-label">Profesional que atendió</div>
    <div class="field-value">${v.profesional}</div>
  </div>
</div>

<hr class="divider">

<div class="field" style="margin-bottom:16px">
  <div class="field-label" style="margin-bottom:6px">Documentos / solicitudes al postulante</div>
  <div class="docs-box">${v.solicitud ? v.solicitud.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : "—"}</div>
</div>

<div class="field">
  <div class="field-label" style="margin-bottom:6px">Compromiso del solicitante</div>
  <div class="comprob-box">${v.compromiso ? v.compromiso.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : "—"}</div>
</div>

${v.docs_recibidos || v.profesional_recibio ? `
<hr class="divider">
<div class="field" style="margin-bottom:${v.profesional_recibio ? "10px" : "16px"}">
  <div class="field-label" style="margin-bottom:6px;color:#059669">Documentos recibidos en esta visita</div>
  <div class="docs-box" style="border-left:3px solid #059669">${v.docs_recibidos ? v.docs_recibidos.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : "—"}</div>
</div>
${v.profesional_recibio ? `<div class="field"><div class="field-label">Profesional que recibió los documentos</div><div class="field-value" style="border-left-color:#059669">${v.profesional_recibio}</div></div>` : ""}
` : ""}

<div class="firmas">
  <div class="firma-line">Firma del profesional<br><span style="font-weight:600">${v.profesional}</span></div>
  <div class="firma-line">Firma del solicitante<br><span style="font-weight:600">${persona.nombre}</span></div>
</div>

<div class="footer-note">Unidad de Vivienda · Ilustre Municipalidad de Lautaro · Propietario del software: JACC</div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  // Sincroniza campos de persona a Supabase y estado local
  const syncPersona = async (fields) => {
    if (!persona) return;
    // Mapeo completo camelCase → snake_case para columnas de Supabase
    const snakeMap = {
      fechaNacimiento:       "fecha_nacimiento",
      integrantesFamiliares: "integrantes_familiares",
      puntajeRSH:            "puntaje_rsh",
      comiteId:              "comite_id",
      // Campos técnicos ficha (DB los guarda en minúsculas)
      nFJS:                  "nfjs",
      sistemaAgua:           "sistemaagua",
      nServicioAgua:         "nservicioagua",
      proveedorElectrico:    "proveedorelectrico",
      nClienteElectricidad:  "nclienteelectricidad",
      certRuralidad:         "certruralidad",
      avaluoFiscal:          "avaluofiscal",
      rol_propiedad:         "rol_propiedad",
      puntaje_rsh:           "puntaje_rsh",
      anio_subsidio:         "anio_subsidio",
      informacionesPrevias:  "informacionesprevias",
      infPrevias:            "infprevias",
      antecedentesVivienda:  "antecedentesvivienda",
      movilidadReducida:     "movilidadreducida",
      credencialDiscapacidad:"credencialdiscapacidad",
      cuentaAhorro:          "cuentaahorro",
      rutColores:            "rutcolores",
      subsidioAnterior:      "subsidio_anterior",
      estadoCivil:           "estadocivil",
      ahorroPostular:        "ahorropostular",
      adultoMayor:           "adultomayor",
      permisoEdificacion:    "permisoedificacion",
      recepcionDefinitiva:   "recepciondefinitiva",
      constructoraSeleccionada: "constructoraseleccionada",
      metrosOriginal:        "metrosoriginal",
      metrosAmpl:            "metrosampl",
      metrosNoRegul:         "metrosnoregul",
      totalMetros:           "totalmetros",
      modalidadPostulacion:  "modalidadpostulacion",
    };
    const dbFields = {};
    for (const [k, v] of Object.entries(fields)) dbFields[snakeMap[k] || k] = v;
    try {
      const { error } = await supabase.from("personas").update(dbFields).eq("id", persona.id);
      if (error) console.warn("[syncPersona] error al actualizar campo(s):", Object.keys(dbFields), error.message);
    } catch (err) { console.warn("[syncPersona] excepción:", err.message); }
    onSavePersonas(personas.map(p => {
      if (p.id !== persona.id) return p;
      const actualizado = { ...p, ...fields };
      if (!Object.prototype.hasOwnProperty.call(fields, "observaciones") && p.observaciones) {
        actualizado.observaciones = p.observaciones;
      }
      return actualizado;
    }));
  };

  useEffect(() => {
    if (persona) { cargarVisitas(); }
    setShowFichaSolicitante(false);
  }, [personaId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setShowFichaSolicitante(false);
  }, [currentUser?.usuario, currentUser?.nombre]);

  // Re-cargar archivos cuando carpeta cambia (puede cambiar al cargar solicitudes)
  useEffect(() => {
    if (persona && carpeta) { cargarArchivos(); }
  }, [carpeta]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poblar N/A en Ficha Rural para CSP rural (debe ir antes del return null)
  useEffect(() => {
    if (!persona) return;
    const tieneRuralCsp = solicitudes.some(s => s.personaId === personaId && s.programaId === "csp_rural");
    if (!tieneRuralCsp) return;
    const updates = {};
    if (!persona.infPrevias) updates.infPrevias = "N/A";
    if (!persona.antecedentesVivienda) updates.antecedentesVivienda = "N/A";
    if (Object.keys(updates).length > 0) syncPersona(updates);
  }, [personaId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!personaId || misSols.length === 0) return;
    let cambio = false;
    const actualizadas = solicitudes.map(s => {
      if (s.personaId !== personaId) return s;
      if (!Array.isArray(s.documentos) || s.documentos.length < 2) return s;
      const docs = asegurarCorreoSolicitante(s.documentos);
      if (docs === s.documentos) return s;
      cambio = true;
      return { ...s, documentos: docs };
    });
    if (!cambio) return;
    onSaveSolicitudes(actualizadas);
    actualizadas
      .filter(s => s.personaId === personaId)
      .forEach(s => {
        supabase.from("solicitudes").update({ documentos: s.documentos }).eq("id", s.id)
          .then(({ error }) => { if (error) console.warn("[correo solicitante]", error.message); });
      });
  }, [personaId, solicitudes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!persona || !misSols.length) return;
    const solsCsp = misSols.filter(sol => sol.programaId === "csp_rural" || sol.programaId === "csp_urbano");
    if (!solsCsp.length) return;
    const limpiar = (v) => String(v ?? "").trim();
    const agregar = (updates, key, value) => {
      const val = limpiar(value);
      if (!val) return;
      const actual = limpiar(persona[key]);
      if (actual !== val) updates[key] = val;
    };
    const resumenDominio = (tipo, desc, fjs, numero, anio) => {
      const partes = [
        tipo,
        desc ? "Detalle: " + desc : "",
        fjs ? "Fjs: " + fjs : "",
        numero ? "N°: " + numero : "",
        anio ? "Año: " + anio : "",
      ].filter(Boolean);
      return partes.join(" - ");
    };
    const updates = {};
    solsCsp.forEach(sol => {
      (sol.documentos || []).forEach(doc => {
        const n = docNombreNorm(doc);
        const valor = limpiar(doc.valor);
        if (!valor) return;
        if (n.includes("cedula") && n.includes("identidad")) {
          const p = valor.split("|");
          const fecha = normalizarFechaInput(p[1]);
          agregar(updates, "rut", p[0]);
          agregar(updates, "fechaNacimiento", fecha);
          agregar(updates, "rutColores", p[2]);
          agregar(updates, "adultoMayor", textoAdultoMayor(fecha));
        }
        if (n.includes("fecha") && n.includes("nacimiento")) {
          const fecha = normalizarFechaInput(valor);
          agregar(updates, "fechaNacimiento", fecha);
          agregar(updates, "adultoMayor", textoAdultoMayor(fecha));
        }
        if (n.includes("registro social") || n.includes("rsh") || n.includes("rdh")) {
          const p = valor.split("|");
          const ahorro = calcularAhorro(p[0]);
          agregar(updates, "puntajeRSH", p[0]);
          agregar(updates, "puntaje_rsh", p[0]);
          agregar(updates, "ahorroPostular", ahorro);
          agregar(updates, "comuna", p[1] && p[1].startsWith("OTRA: ") ? p[1].replace(/^OTRA:\s*/, "") : p[1]);
          agregar(updates, "estadoCivil", p[2]);
          agregar(updates, "integrantesFamiliares", p[3]);
          agregar(updates, "subsidioAnterior", p[4]);
          agregar(updates, "discapacidad", p[5] === "N/A" ? "N/A" : (p[5] ? "S" : ""));
          agregar(updates, "credencialDiscapacidad", p[5] === "N/A" ? "N/A" : p[5]);
          agregar(updates, "movilidadReducida", p[6]);
        }
        if (n.includes("avaluo") || n.includes("avalúo")) {
          const p = valor.split("|");
          const rol = limpiar(p[0]);
          const avaluo = formatPesosChilenos(p[1] || "");
          agregar(updates, "rol", rol);
          agregar(updates, "rol_propiedad", rol);
          agregar(updates, "avaluoFiscal", avaluo);
          agregar(updates, "coordenadas", p[2]);
        }
        if (n.includes("telefono")) agregar(updates, "telefono", valor);
        if (n.includes("correo")) agregar(updates, "email", valor);
        if (n.includes("certificado") && n.includes("ruralidad")) agregar(updates, "certRuralidad", valor.replace("|", " - "));
        if (n.includes("dominio") || n.includes("derecho real") || n.includes("usufructo") || n.includes("goce")) {
          const p = valor.split("|");
          const dominio = resumenDominio(p[0], p[1], p[2], p[3], p[4]);
          agregar(updates, "dominiopropiedad", dominio);
          agregar(updates, "dominio_terreno", p[0]);
        }
        if (n.includes("cuenta") && n.includes("ahorro")) {
          const p = valor.split("|");
          agregar(updates, "cuentaAhorro", p[0]);
          agregar(updates, "banco", p[1]);
        }
        if (n.includes("boleta") && n.includes("luz")) {
          const p = valor.split("|");
          agregar(updates, "proveedorElectrico", p[0]);
          agregar(updates, "nClienteElectricidad", p[1]);
        }
        if (n.includes("agua") || n.includes("apr") || n.includes("arranque")) {
          const p = valor.split("|");
          agregar(updates, "sistemaAgua", p[0]);
          agregar(updates, "nServicioAgua", p[1]);
        }
      });
    });
    const fechaParaEdad = updates.fechaNacimiento || persona.fechaNacimiento || persona.fecha_nacimiento || fechaNacimientoDesdeSolicitudes(solsCsp);
    agregar(updates, "adultoMayor", textoAdultoMayor(fechaParaEdad));
    const ahorroActual = calcularAhorro(updates.puntajeRSH || persona.puntajeRSH || persona.puntaje_rsh || rshDesdeSolicitudes(solsCsp));
    agregar(updates, "ahorroPostular", ahorroActual);
    if (Object.keys(updates).length > 0) syncPersona(updates);
  }, [personaId, solicitudes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!persona) return null;

  const comite = comites.find(c => c.id === persona.comiteId);

  // Registra un archivo en Supabase asociado al solicitante
  const _registrarArchivoSupa = async (nombre, carp, extra = {}) => {
    const base = {
      id: `${persona.id}_${nombre}`,
      persona_id: persona.id,
      nombre,
      carpeta: carp || carpeta
    };
    const { error } = await supabase.from("archivos_solicitante").upsert({ ...base, ...extra });
    if (error && (extra.storage_path || extra.storage_bucket || extra.mime_type || extra.tamano_bytes)) {
      const retry = await supabase.from("archivos_solicitante").upsert(base);
      if (retry.error) console.error("[archivos_solicitante] Error al registrar:", retry.error.message, "| archivo:", nombre);
      return !retry.error;
    }
    if (error) console.error("[archivos_solicitante] Error al registrar:", error.message, "| archivo:", nombre);
    return !error;
  };

  const guardarArchivoPersistente = async (nombre, dataUrl, mimeType = "", carp = carpeta, storagePath = "") => {
    if (!nombre || (!dataUrl && !storagePath)) return;
    const archivoUrl = storagePath ? storagePublicUrl(storagePath) : dataUrl;
    setArchivosDatos(prev => ({ ...prev, [nombre]: { dataUrl: archivoUrl, mimeType, carpeta: carp } }));
    setArchivos(prev => prev.includes(nombre) ? prev : [nombre, ...prev]);
    setArchivosRutas(prev => ({ ...prev, [nombre]: carp }));
    const solDestino = misSols[0];
    if (!solDestino) return;
    const documentos = [...(solDestino.documentos || [])];
    const idx = documentos.findIndex(d => d.interno && d.archivo === nombre);
    const registro = {
      nombre,
      obligatorio: false,
      entregado: true,
      interno: true,
      archivo: nombre,
      archivoData: storagePath ? "" : dataUrl,
      archivoTipo: mimeType,
      carpeta: carp,
      storagePath
    };
    if (idx >= 0) documentos[idx] = { ...documentos[idx], ...registro };
    else documentos.push(registro);
    const actualizadas = solicitudes.map(s => s.id === solDestino.id ? { ...s, documentos } : s);
    onSaveSolicitudes(actualizadas);
    await supabase.from("solicitudes").update({ documentos }).eq("id", solDestino.id);
  };

  const subirArchivoServidor = async (file, carp = carpeta) => {
    if (!file) throw new Error("No se selecciono archivo.");
    if (!carp) throw new Error("No se pudo determinar la carpeta del solicitante.");
    const nombreSubido = file.name;
    const objectPath = storageObjectPath(carp, nombreSubido);
    const { error: storageErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, file, { upsert: true, contentType: file.type || "application/octet-stream" });
    if (storageErr) {
      console.warn("[storage] No se pudo subir a Supabase Storage:", storageErr.message);
    }
    const fd = new FormData();
    fd.append("archivo", file);
    let data = {};
    try {
      const res = await fetch(apiPath("/subir/", carp), { method: "POST", body: fd });
      data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        data = { nombre: file.name };
      }
    } catch {
      data = { nombre: file.name };
    }
    const storagePathFinal = storageErr ? "" : objectPath;
    const dataUrl = storagePathFinal ? "" : await fileToDataUrl(file);
    await _registrarArchivoSupa(nombreSubido, carp, {
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePathFinal,
      mime_type: file.type || "application/octet-stream",
      tamano_bytes: file.size || 0
    });
    const archivoUrl = storagePathFinal ? storagePublicUrl(storagePathFinal) : dataUrl;
    setArchivosDatos(prev => ({ ...prev, [nombreSubido]: { dataUrl: archivoUrl, mimeType: file.type, carpeta: carp } }));
    setArchivos(prev => prev.includes(nombreSubido) ? prev : [nombreSubido, ...prev]);
    setArchivosRutas(prev => ({ ...prev, [nombreSubido]: carp }));
    await guardarArchivoPersistente(nombreSubido, dataUrl, file.type, carp, storagePathFinal);
    await registrarAuditoria?.("subir_documento", "archivos_solicitante", persona.id, {
      solicitante: persona.nombre,
      archivo: nombreSubido,
      carpeta: carp,
    });
    return { nombre: nombreSubido, dataUrl: archivoUrl, mimeType: file.type, storagePath: storagePathFinal };
  };
  const cargarArchivos = async () => {
    const fetchLista = async (p) => {
      if (!p) return [];
      try {
        const r = await fetch(apiPath("/archivos/", p));
        if (!r.ok) return [];
        return await r.json();
      } catch { return []; }
    };

    // 1. Filesystem (servidor local) — falla silenciosamente si el servidor no está
    const [nuevos, viejos] = await Promise.all([
      fetchLista(carpeta),
      carpeta !== carpetaVieja ? fetchLista(carpetaVieja) : Promise.resolve([])
    ]);

    const rutasMap = {};
    const datosMap = {};
    nuevos.forEach(f => { rutasMap[f] = carpeta; });
    viejos.forEach(f => { if (!rutasMap[f]) rutasMap[f] = carpetaVieja; });

    // 2. Supabase — completamente independiente, no afecta al resultado del filesystem
    let supaNames = [];
    let { data: supaFiles, error: supaError } = await supabase
      .from("archivos_solicitante")
      .select("nombre, carpeta, storage_bucket, storage_path, mime_type")
      .eq("persona_id", persona.id)
      .order("creado", { ascending: false });
    if (supaError) {
      const retry = await supabase
        .from("archivos_solicitante")
        .select("nombre, carpeta")
        .eq("persona_id", persona.id)
        .order("creado", { ascending: false });
      supaFiles = retry.data;
      supaError = retry.error;
    }

    if (supaError) {
      console.warn("[archivos_solicitante] No se pudo consultar Supabase:", supaError.message);
    } else {
      (supaFiles || []).forEach(sf => {
        if (!rutasMap[sf.nombre]) rutasMap[sf.nombre] = sf.carpeta || carpeta;
        if (sf.storage_path) datosMap[sf.nombre] = { dataUrl: storagePublicUrl(sf.storage_path, sf.storage_bucket), mimeType: sf.mime_type || "", carpeta: sf.carpeta || carpeta };
      });
      supaNames = (supaFiles || []).map(sf => sf.nombre);
    }

    // 3. Copias guardadas en solicitudes (respaldo para la web publicada sin /files)
    const docsConArchivo = (solicitudes || [])
      .filter(s => s.personaId === personaId)
      .flatMap(s => s.documentos || [])
      .filter(d => d.archivo && (d.archivoData || d.storagePath));
    docsConArchivo.forEach(d => {
      datosMap[d.archivo] = { dataUrl: d.storagePath ? storagePublicUrl(d.storagePath) : d.archivoData, mimeType: d.archivoTipo || "", carpeta: d.carpeta || carpeta };
      if (!rutasMap[d.archivo]) rutasMap[d.archivo] = d.carpeta || carpeta;
    });

    // 4. Unión deduplicada: solicitudes/Supabase primero (más reciente), luego filesystem
    const fsFiles = [...nuevos, ...viejos.filter(f => !nuevos.includes(f))];
    const datosNames = docsConArchivo.map(d => d.archivo);
    const todos = [...new Set([...datosNames, ...supaNames, ...fsFiles])];
    setArchivos(todos);
    setArchivosRutas(rutasMap);
    setArchivosDatos(datosMap);

    const hayArchivoAvaluo = todos.some(a => {
      const al = a.toLowerCase();
      return al.includes("avaluo") || al.includes("avalúo");
    });
    const actualizadas = solicitudes.map(s => {
      if (s.personaId !== personaId || !Array.isArray(s.documentos)) return s;
      let cambio = false;
      const documentos = s.documentos.map(d => {
        const dn = (d.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!dn.includes("avaluo") || d.entregado === hayArchivoAvaluo) return d;
        cambio = true;
        return { ...d, entregado: hayArchivoAvaluo };
      });
      return cambio ? { ...s, documentos } : s;
    });
    if (actualizadas.some((s, idx) => s !== solicitudes[idx])) onSaveSolicitudes(actualizadas);
  };

  const subirArchivo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSubiendo(true);
    try {
      await subirArchivoServidor(file, carpeta);
      // Si es comité desmarque, detectar tipo de archivo
      if (persona.comiteId === "comite_desmarque") {
        const nombreLower = file.name.toLowerCase();
        if (nombreLower.includes("informe") || nombreLower.includes("dom") || nombreLower.includes("inspeccion")) {
          setShowModalInformeDom(true);
        } else if (nombreLower.includes("comprobante") || nombreLower.includes("serviu") || nombreLower.includes("respuesta") || nombreLower.includes("desmarque")) {
          setShowModalRespuestaServiu(true);
        }
      }
    } catch (err) { alert("Error al subir el archivo: " + (err.message || "")); }
    setSubiendo(false);
    e.target.value = "";
  };

  const abrirArchivo = (nombre) => {
    const archivoGuardado = archivosDatos[nombre];
    const fileUrl = archivoGuardado?.dataUrl || apiPath("/files/", archivosRutas[nombre] || carpeta, nombre);
    if (archivoGuardado?.dataUrl && String(archivoGuardado.dataUrl).startsWith("data:text/html")) {
      const partes = String(archivoGuardado.dataUrl).split(",");
      const html = partes.length > 1 ? decodeURIComponent(partes.slice(1).join(",")) : "";
      setHtmlPreview(html);
      return;
    }
    window.open(fileUrl, "_blank", "noopener,noreferrer");
  };

  const eliminarArchivo = async (nombre) => {
    const ok = window["confirm"]("Eliminar " + nombre + "?");
    if (!ok) return;
    const errores = [];
    const avisos = [];
    const registrosSupa = [];
    try {
      const res = await fetch(apiPath("/archivos/", carpeta, nombre), { method: "DELETE" });
      if (!res.ok && res.status !== 404) avisos.push("servidor local");
      if (carpeta !== carpetaVieja) {
        const resViejo = await fetch(apiPath("/archivos/", carpetaVieja, nombre), { method: "DELETE" });
        if (!resViejo.ok && resViejo.status !== 404) avisos.push("carpeta anterior");
      }
    } catch {
      avisos.push("servidor local");
    }
    try {
      const { data } = await supabase
        .from("archivos_solicitante")
        .select("storage_bucket, storage_path")
        .eq("persona_id", persona.id)
        .eq("nombre", nombre);
      (data || []).forEach(r => registrosSupa.push(r));
    } catch {
      errores.push("consulta Supabase");
    }
    try {
      const porBucket = registrosSupa.reduce((acc, r) => {
        if (!r.storage_path) return acc;
        const bucket = r.storage_bucket || STORAGE_BUCKET;
        acc[bucket] = acc[bucket] || [];
        acc[bucket].push(r.storage_path);
        return acc;
      }, {});
      for (const [bucket, paths] of Object.entries(porBucket)) {
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) errores.push("Storage: " + error.message);
      }
    } catch (err) {
      errores.push("Storage: " + (err.message || "no se pudo borrar"));
    }
    try {
      const { error } = await supabase.from("archivos_solicitante").delete().eq("persona_id", persona.id).eq("nombre", nombre);
      if (error) errores.push("registro Supabase: " + error.message);
    } catch {
      errores.push("registro Supabase");
    }
    try {
      const actualizadas = solicitudes.map(s => {
        if (s.personaId !== persona.id || !Array.isArray(s.documentos)) return s;
        let cambio = false;
        const documentos = s.documentos
          .filter(d => {
            const quitarRegistroInterno = d.interno && d.archivo === nombre;
            if (quitarRegistroInterno) cambio = true;
            return !quitarRegistroInterno;
          })
          .map(d => {
            if (d.archivo !== nombre && d.archivoData !== nombre && d.storagePath !== nombre) return d;
            cambio = true;
            return { ...d, archivo: "", archivoData: "", archivoTipo: "", storagePath: "" };
          });
        return cambio ? { ...s, documentos } : s;
      });
      const afectadas = actualizadas.filter((s, idx) => s !== solicitudes[idx]);
      if (afectadas.length) {
        onSaveSolicitudes(actualizadas);
        for (const s of afectadas) {
          const { error } = await supabase.from("solicitudes").update({ documentos: s.documentos }).eq("id", s.id);
          if (error) errores.push("solicitud: " + error.message);
        }
      }
    } catch (err) {
      errores.push("solicitud: " + (err.message || "no se pudo actualizar"));
    }
    setArchivos(prev => prev.filter(a => a !== nombre));
    setArchivosDatos(prev => {
      const next = { ...prev };
      delete next[nombre];
      return next;
    });
    setArchivosRutas(prev => {
      const next = { ...prev };
      delete next[nombre];
      return next;
    });
    setDocMenu(null);
    try { await cargarArchivos(); } catch {}
    if (errores.length) {
      console.warn("[eliminarArchivo]", errores.join(" | "));
      alert("Se intentó eliminar el documento, pero hubo una respuesta incompleta: " + errores.join(", ") + ". Si sigue apareciendo, actualice la página e intente nuevamente.");
    } else if (avisos.length) {
      console.warn("[eliminarArchivo avisos]", avisos.join(" | "));
    }
  };

  const descargarZip = async () => {
    if (zipSeleccionados.length === 0) return;
    setGenerandoZip(true);
    try {
      const zip = new JSZip();
      for (const p of zipSeleccionados) {
        const rutLimpia = (p.rut || "").replace(/[^0-9kK]/g, "");
        const nombreCarpeta = `${(p.nombre || "SIN_NOMBRE").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "")}_${rutLimpia}`;
        const folder = zip.folder(nombreCarpeta);

        // Calcular carpeta del solicitante en el servidor
        const carpetaSol = carpetaPrograma(p, solicitudes);
        const carpetaViejaSol = carpetaNombre(p.nombre, p.rut);

        // Obtener lista de archivos: Supabase + servidor local
        const archivosSet = new Set();
        const rutasPorArchivo = {};
        const datosPorArchivo = {};

        (solicitudes || [])
          .filter(s => s.personaId === p.id)
          .flatMap(s => s.documentos || [])
          .filter(d => d.archivo && (d.archivoData || d.storagePath))
          .forEach(d => {
            archivosSet.add(d.archivo);
            rutasPorArchivo[d.archivo] = d.carpeta || carpetaSol;
            datosPorArchivo[d.archivo] = d.storagePath ? storagePublicUrl(d.storagePath) : d.archivoData;
          });

        // Desde Supabase
        let { data: supaArch, error: supaArchError } = await supabase
          .from("archivos_solicitante")
          .select("nombre, carpeta, storage_bucket, storage_path")
          .eq("persona_id", p.id);
        if (supaArchError) {
          const retry = await supabase
            .from("archivos_solicitante")
            .select("nombre, carpeta")
            .eq("persona_id", p.id);
          supaArch = retry.data;
        }
        (supaArch || []).forEach(a => {
          archivosSet.add(a.nombre);
          rutasPorArchivo[a.nombre] = a.carpeta || carpetaSol;
          if (a.storage_path) datosPorArchivo[a.nombre] = storagePublicUrl(a.storage_path, a.storage_bucket);
        });

        // Desde servidor local (nueva carpeta y vieja)
        for (const carp of [carpetaSol, carpetaViejaSol]) {
          if (!carp) continue;
          try {
            const r = await fetch(apiPath("/archivos/", carp));
            if (r.ok) {
              const lista = await r.json();
              lista.forEach(nombre => {
                archivosSet.add(nombre);
                if (!rutasPorArchivo[nombre]) rutasPorArchivo[nombre] = carp;
              });
            }
          } catch {}
        }

        // Descargar y agregar cada archivo al ZIP
        for (const nombre of archivosSet) {
          const rutaArch = rutasPorArchivo[nombre] || carpetaSol;
          const url = datosPorArchivo[nombre] || apiPath("/files/", rutaArch, nombre);
          try {
            const resp = await fetch(url);
            if (resp.ok) {
              const blob = await resp.blob();
              folder.file(nombre, blob);
            }
          } catch {}
        }
      }

      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fecha = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `Documentos_${zipSeleccionados.length}solicitantes_${fecha}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setShowModalZip(false);
      setZipSeleccionados([]);
      setZipSearch("");
    } catch (e) {
      alert("Error generando ZIP: " + e.message);
    }
    setGenerandoZip(false);
  };

  const guardarResultadoInformeDom = async () => {
    if (!resultadoInformeDom) return;
    // Cerrar modal primero para evitar error removeChild
    const res = resultadoInformeDom;
    const nota = notaResultado;
    setShowModalInformeDom(false);
    setResultadoInformeDom("");
    setNotaResultado("");
    await new Promise(r => setTimeout(r, 50));
    let nuevoEstado = persona.estado_desmarque;
    if (res === "APROBADO") nuevoEstado = "Informe DOM aprobado";
    else if (res === "RECHAZADO_APELABLE") nuevoEstado = "RECHAZADO APELABLE";
    else if (res === "RECHAZADO_SIN_APELACION") nuevoEstado = "RECHAZADO DOM";
    try {
      const { data: solsDb } = await supabase.from("solicitudes").select("*").eq("persona_id", persona.id).eq("programa_id", "habitabilidad");
      const solDb = solsDb && solsDb[0];
      if (solDb) {
        const etiqueta = res === "APROBADO" ? "INFORME DOM APROBADO" : res === "RECHAZADO_APELABLE" ? "INFORME DOM RECHAZADO APELABLE" : "INFORME DOM RECHAZADO";
        const docsActualizados = (solDb.documentos || []).map(d =>
          d.nombre && d.nombre.includes("Informe DOM")
            ? { ...d, valor: etiqueta + (nota ? " - " + nota : ""), entregado: true }
            : d
        );
        await supabase.from("solicitudes").update({ documentos: docsActualizados }).eq("id", solDb.id);
        onSaveSolicitudes(solicitudes.map(s => s.id === solDb.id ? { ...s, documentos: docsActualizados, fecha_visita: fechaVisitaSolicitud({ ...solDb, documentos: docsActualizados }) || s.fecha_visita || "" } : s));
      }
      await supabase.from("personas").update({ estado_desmarque: nuevoEstado }).eq("id", persona.id);
      onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, estado_desmarque: nuevoEstado } : p));
    } catch(e) { console.warn("[guardarInformeDom]", e.message); }
  };

  const guardarResultadoRespuestaServiu = async () => {
    if (!resultadoRespuestaServiu) return;
    const res = resultadoRespuestaServiu;
    const nota = notaResultado;
    setShowModalRespuestaServiu(false);
    setResultadoRespuestaServiu("");
    setNotaResultado("");
    await new Promise(r => setTimeout(r, 50));
    let nuevoEstado = persona.estado_desmarque;
    if (res === "APROBADO") nuevoEstado = "DESMARCADO";
    else if (res === "RECHAZADO_APELABLE") nuevoEstado = "RECHAZADO APELABLE";
    else if (res === "RECHAZADO_SIN_APELACION") nuevoEstado = "DESMARQUE RECHAZADO";
    try {
      const { data: solsDb } = await supabase.from("solicitudes").select("*").eq("persona_id", persona.id).eq("programa_id", "habitabilidad");
      const solDb = solsDb && solsDb[0];
      if (solDb) {
        const etiqueta = res === "APROBADO" ? "DESMARCADO"
          : res === "RECHAZADO_APELABLE" ? "RECHAZADO APELABLE"
          : "DESMARQUE RECHAZADO";
        const docsActualizados = (solDb.documentos || []).map(d =>
          d.nombre && d.nombre.includes("Respuesta SERVIU")
            ? { ...d, valor: etiqueta + (nota ? " - " + nota : ""), entregado: true }
            : d
        );
        await supabase.from("solicitudes").update({ documentos: docsActualizados }).eq("id", solDb.id);
        onSaveSolicitudes(solicitudes.map(s => s.id === solDb.id ? { ...s, documentos: docsActualizados, fecha_visita: fechaVisitaSolicitud({ ...solDb, documentos: docsActualizados }) || s.fecha_visita || "" } : s));
      }
      await supabase.from("personas").update({ estado_desmarque: nuevoEstado, observaciones: nota || persona.observaciones }).eq("id", persona.id);
      onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, estado_desmarque: nuevoEstado } : p));
    } catch(e) { console.warn("[guardarRespuestaServiu]", e.message); }
  };

  const guardarFichaDesmarque = async () => {
    const campos = {
      rut: fichaForm.rut || persona.rut || "",
      direccion: fichaForm.direccion || persona.direccion || "",
      telefono: fichaForm.telefono || persona.telefono || "",
      tipo_comite: fichaForm.tipo_comite || persona.tipo_comite || "",
      sector: fichaForm.sector || persona.sector || "",
      rol_propiedad: fichaForm.rol_propiedad || persona.rol_propiedad || "",
      coordenadas: fichaForm.coordenadas || persona.coordenadas || "",
      puntaje_rsh: fichaForm.puntaje_rsh || persona.puntajeRSH || "",
      dominio_terreno: fichaForm.dominio_terreno || persona.dominio_terreno || "",
      anio_subsidio: fichaForm.anio_subsidio || persona.anio_subsidio || "",
      observaciones: fichaForm.observaciones || persona.observaciones || "",
    };
    await supabase.from("personas").update(campos).eq("id", persona.id);
    const p2 = { ...persona, ...campos, puntajeRSH: campos.puntaje_rsh };
    onSavePersonas(personas.map(p => p.id === persona.id ? p2 : p));

    // Actualizar documentos de la solicitud si se ingresaron valores
    const sol = misSols[0];
    if (sol) {
      const docsActualizados = sol.documentos.map(d => {
        if (d.nombre && d.nombre.includes("Memo DOM") && fichaForm.numero_memo_dom)
          return { ...d, valor: fichaForm.numero_memo_dom, entregado: true };
        if (d.nombre && d.nombre.includes("Carta SERVIU") && fichaForm.numero_carta_serviu)
          return { ...d, valor: fichaForm.numero_carta_serviu, entregado: true };
        if (d.nombre && d.nombre.includes("Informe DOM") && fichaForm.numero_informe_dom)
          return { ...d, valor: fichaForm.numero_informe_dom, entregado: true };
        return d;
      });
      const solActualizada = { ...sol, documentos: docsActualizados, fecha_visita: sol.fecha_visita };
      onSaveSolicitudes(solicitudes.map(s => s.id === sol.id ? solActualizada : s));
      await supabase.from("solicitudes").update({ documentos: docsActualizados }).eq("id", sol.id);
      // Auto-cambiar estado según datos ingresados
      if (!["NO CALIFICA","APELAR SERVIU","RECHAZADO APELABLE","RECHAZADO DOM","DESMARQUE RECHAZADO","DESMARCADO","Informe DOM aprobado","INFORME DOM APROBADO"].includes(persona.estado_desmarque)) {
        const nuevoEstado = calcularEstadoDesmarque(solActualizada, persona.estado_desmarque);
        if (nuevoEstado !== persona.estado_desmarque) {
          await supabase.from("personas").update({ estado_desmarque: nuevoEstado }).eq("id", persona.id);
          onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, estado_desmarque: nuevoEstado } : p));
        }
      }
    }
    setShowFichaEdit(false);
  };

  // Helper: actualiza valor (N°|fecha) en un doc de solicitud sin tocar entregado
  const _actualizarValorDoc = async (nombreDoc, valor) => {
    const { data: solsDb } = await supabase.from("solicitudes").select("*").eq("persona_id", persona.id).eq("programa_id", "habitabilidad");
    const solDb = (solsDb && solsDb[0]) || misSols[0];
    if (!solDb) return;
    const docs = (solDb.documentos || []).map(d => d.nombre && d.nombre.includes(nombreDoc) ? { ...d, valor } : d);
    await supabase.from("solicitudes").update({ documentos: docs }).eq("id", solDb.id);
    onSaveSolicitudes(solicitudes.map(s => s.id === solDb.id ? { ...s, documentos: docs, fecha_visita: fechaVisitaSolicitud({ ...solDb, documentos: docs }) || s.fecha_visita || "" } : s));
  };

  // Helper: activa el VB (entregado:true) para un doc de solicitud
  const _activarVb = async (nombreDoc) => {
    const { data: solsDb } = await supabase.from("solicitudes").select("*").eq("persona_id", persona.id).eq("programa_id", "habitabilidad");
    const solDb = (solsDb && solsDb[0]) || misSols[0];
    if (!solDb) return;
    const docs = (solDb.documentos || []).map(d => d.nombre && d.nombre.includes(nombreDoc) ? { ...d, entregado: true } : d);
    await supabase.from("solicitudes").update({ documentos: docs }).eq("id", solDb.id);
    onSaveSolicitudes(solicitudes.map(s => s.id === solDb.id ? { ...s, documentos: docs, fecha_visita: fechaVisitaSolicitud({ ...solDb, documentos: docs }) || s.fecha_visita || "" } : s));
  };

  const guardarCalificacionDesmarque = async (sol, estado) => {
    if (!sol) return;
    let detalle = "";
    if (estado === "NO_CALIFICA") {
      detalle = window.prompt("Detalle por el que no califica:") || "";
      if (!detalle.trim()) {
        alert("Debe ingresar el detalle por el que no califica.");
        return;
      }
    }
    const valor = estado === "CALIFICA" ? "CALIFICA" : `NO_CALIFICA|${detalle.trim()}`;
    const existe = (sol.documentos || []).some(d => docNombreNorm(d).includes("calificacion para visita"));
    const documentos = existe
      ? sol.documentos.map(d => docNombreNorm(d).includes("calificacion para visita") ? { ...d, valor, entregado: true } : d)
      : [...(sol.documentos || []), { nombre: DOC_CALIFICACION_DESMARQUE, obligatorio: false, valor, entregado: true, interno: true }];
    const nuevoEstado = estado === "NO_CALIFICA" ? "NO CALIFICA" : (persona.estado_desmarque || "NO VISITADO");
    await supabase.from("solicitudes").update({ documentos }).eq("id", sol.id);
    await supabase.from("personas").update({ estado_desmarque: nuevoEstado }).eq("id", persona.id);
    onSaveSolicitudes(solicitudes.map(s => s.id === sol.id ? { ...s, documentos } : s));
    onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, estado_desmarque: nuevoEstado } : p));
    await registrarAuditoria?.("calificar_desmarque", "solicitudes", sol.id, { solicitante: persona.nombre, resultado: estado, detalle });
  };

  const generarMemo = async () => {
    // Capturar valores del form antes de cualquier operación async (evita closure stale)
    const numero = formMemo.numero;
    const problemas = [
      ...(formMemo.problemas || []),
      ...(formMemo.nuevoProblema && formMemo.nuevoProblema.trim() ? [formMemo.nuevoProblema.trim()] : [])
    ];
    const remitente = {
      nombre: formMemo.deNombre || "MARCELO CIFUENTES VÁSQUEZ",
      cargo: formMemo.deCargo || "ENCARGADO ENTIDAD PATROCINANTE",
      institucion: formMemo.deInstitucion || "MUNICIPALIDAD DE LAUTARO",
      iniciales: formMemo.deIniciales || ""
    };
    const destinatario = {
      nombre: formMemo.aNombre || "SEÑOR EDUARDO BUSTOS VALDEBENITO",
      cargo: formMemo.aCargo || "DIRECTOR DE OBRAS",
      institucion: formMemo.aInstitucion || "MUNICIPALIDAD DE LAUTARO",
      trato: formMemo.aTrato || "PRESENTE."
    };
    setGenerando(true);
    try {
      const html = generarHtmlMemo({
        numero,
        nombre: persona.nombre,
        rut: persona.rut,
        direccion: persona.direccion,
        coordenadas: persona.coordenadas || "",
        problemas,
        remitente,
        destinatario
      });
      setHtmlPreview(html);
      const nombreArch = `MEMO_${numero.replace(/[^a-zA-Z0-9]/g, '_')}_${persona.nombre.split(' ')[0]}.html`;
      fetch(apiPath("/guardar-html/", carpeta), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreArch, html })
      }).catch(() => {});
      await _registrarArchivoSupa(nombreArch, carpeta);
      await guardarArchivoPersistente(nombreArch, htmlToDataUrl(html), "text/html", carpeta);
      // Copiar N° y fecha al campo — VB NO se activa aún (solo al subir el escaneado)
      const fechaIso = new Date().toISOString().slice(0, 10);
      await _actualizarValorDoc("Memo DOM", numero + "|" + fechaIso);
      setShowModalMemo(false);
      setFormMemo(memoInicial);
    } catch(e) { alert("Error generando memo: " + e.message); }
    finally { setGenerando(false); }
  };

  const generarCarta = async () => {
    const numero = formCarta.numero;
    const remitente = {
      nombre: formCarta.deNombre || "MARCELO CIFUENTES VÁSQUEZ",
      cargo: formCarta.deCargo || "ENCARGADO ENTIDAD PATROCINANTE",
      institucion: formCarta.deInstitucion || "MUNICIPALIDAD DE LAUTARO",
      iniciales: formCarta.deIniciales || ""
    };
    const destinatario = {
      nombre: formCarta.aNombre || "SEÑOR MARCO SEGUEL REYES",
      cargo: formCarta.aCargo || "DIRECTOR DE SERVIU (S)",
      institucion: formCarta.aInstitucion || "REGIÓN DE LA ARAUCANIA",
      trato: formCarta.aTrato || "PRESENTE."
    };
    setGenerando(true);
    try {
      const html = generarHtmlCarta({ numero, nombre: persona.nombre, rut: persona.rut, remitente, destinatario });
      setHtmlPreview(html);
      const nombreArch = `CARTA_${numero.replace(/[^a-zA-Z0-9]/g, '_')}_${persona.nombre.split(' ')[0]}.html`;
      fetch(apiPath("/guardar-html/", carpeta), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreArch, html })
      }).catch(() => {});
      await _registrarArchivoSupa(nombreArch, carpeta);
      await guardarArchivoPersistente(nombreArch, htmlToDataUrl(html), "text/html", carpeta);
      // Copiar N° y fecha al campo — VB NO se activa aún (solo al subir el comprobante)
      const fechaIso = new Date().toISOString().slice(0, 10);
      await _actualizarValorDoc("Carta SERVIU", numero + "|" + fechaIso);
      setShowModalCarta(false);
      setFormCarta(cartaInicial);
    } catch(e) { alert("Error generando carta: " + e.message); }
    finally { setGenerando(false); }
  };

  const generarSolicitud = async () => {
    setGenerando(true);
    try {
      const datosSolicitud = {
        nombre: persona.nombre, rut: persona.rut, direccion: persona.direccion,
        telefono: persona.telefono, subsidio: formSolicitud.subsidio, anioSubsidio: formSolicitud.anioSubsidio
      };
      const pdfDataUrl = await generarPdfSolicitudOficial(datosSolicitud);
      setHtmlPreview(`<iframe title="Solicitud oficial completada" src="${pdfDataUrl}" style="width:100%;height:100%;border:0;background:#e8e8e8"></iframe>`);
      const nombreArch = `SOLICITUD_${persona.nombre.split(' ')[0]}_${new Date().toISOString().slice(0,10)}.pdf`;
      await _registrarArchivoSupa(nombreArch, carpeta);
      await guardarArchivoPersistente(nombreArch, pdfDataUrl, "application/pdf", carpeta);
      setShowModalSolicitud(false);
      setFormSolicitud({ subsidio: "", anioSubsidio: "" });
    } catch(e) { alert("Error generando solicitud: " + e.message); }
    finally { setGenerando(false); }
  };

  const handleImagenFilaJACC = (filaId, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type;
      const img = new window.Image();
      img.onload = () => {
        const targetW = 265;
        const targetH = Math.round(targetW * (img.naturalHeight / img.naturalWidth));
        setFilasInforme(prev => prev.map(f => f.id === filaId ? { ...f, imagenBase64: base64, imagenNombre: file.name, mimeType, imgWidth: targetW, imgHeight: targetH } : f));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const generarInformeJACC = async () => {
    const estadoVivienda = informeEstadoVivienda;
    const subsidioTexto  = informeSubsidioTexto;
    const sol = misSols[0];
    const fechaVisita = sol ? fmtFecha(fechaVisitaSolicitud(sol)) : "";
    setGenerandoInforme(true);
    try {
      const html = generarHtmlInformeJACC({
        nombre: persona.nombre, rut: persona.rut, telefono: persona.telefono || "",
        direccion: persona.direccion || "", coordenadas: persona.coordenadas || "",
        subsidioTexto,
        fechaVisita,
        estadoVivienda,
        filas: filasInforme.map((f, i) => ({ numero: i + 1, descripcion: f.descripcion, imagenBase64: f.imagenBase64 || null, mimeType: f.mimeType || "image/jpeg" }))
      });
      setHtmlPreview(html);
      const nombreArchivo = `INFORME_JACC_${persona.nombre.split(" ")[0]}_${new Date().toISOString().slice(0,10)}.html`;
      fetch(apiPath("/guardar-html/", carpeta), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreArchivo, html })
      }).catch(() => {});
      await _registrarArchivoSupa(nombreArchivo, carpeta);
      await guardarArchivoPersistente(nombreArchivo, htmlToDataUrl(html), "text/html", carpeta);
      setShowModalInformeJACC(false);
      setFilasInforme([{ id: uid(), descripcion: "", imagenBase64: null, imagenNombre: "", mimeType: "", imgWidth: 265, imgHeight: 200 }]);
      setInformeSubsidioTexto("");
      setInformeEstadoVivienda("");
    } catch(e) { alert("Error generando informe: " + e.message); }
    finally { setGenerandoInforme(false); }
  };

  const guardarResultadoComprobante = async () => {
    if (!resultadoComp) return;
    const res = resultadoComp;
    const nota = notaRechazo;
    setShowModalComprobante(false);
    setNotaRechazo("");
    setResultadoComp("");
    await new Promise(r => setTimeout(r, 50));
    try {
      const updPersona = { ...persona, estado_desmarque: res };
      if (nota) updPersona.observaciones = nota;
      await supabase.from("personas").update({ estado_desmarque: res, observaciones: nota || persona.observaciones }).eq("id", persona.id);
      onSavePersonas(personas.map(p => p.id === persona.id ? updPersona : p));
    } catch(e) { console.warn("[guardarComprobante]", e.message); }
  };

  const yaInscritos = misSols.map(s => s.programaId);
  const disponibles = todosProgramas.filter(p => !yaInscritos.includes(p.id));

  const agregar = () => {
    if (!progSel) return;
    const prog = todosProgramas.find(p => p.id === progSel);
    const nueva = {
      id: uid(), personaId, personaNombre: persona.nombre,
      programaId: prog.id, fecha: today(),
      documentos: asegurarCorreoSolicitante(prog.documentos).map(d => ({
        nombre: d.nombre, obligatorio: d.obligatorio, entregado: false,
        tipo: d.tipo || null, opciones: d.opciones || null, opcionSeleccionada: null, etiqueta: null,
        requiereArchivo: !!d.requiereArchivo, requiereTexto: !!d.requiereTexto, etiquetaTexto: d.etiquetaTexto || ""
      }))
    };
    onSaveSolicitudes([...solicitudes, nueva]);
    setProgSel("");
    setShowModal(false);
  };

  const toggleDoc = async (solId, idx) => {
    const sol = solicitudes.find(s => s.id === solId);
    if (!sol) return;
    const doc = sol.documentos[idx];
    // Documentos que requieren archivo o proceso especial: no se pueden marcar manualmente
    const requiereArchivo = doc.nombre && (
      doc.nombre.toLowerCase().includes('cedula') ||
      doc.nombre.toLowerCase().includes('título') ||
      doc.nombre.toLowerCase().includes('titulo') ||
      doc.nombre.toLowerCase().includes('certificado de avaluo') ||
      doc.nombre.toLowerCase().includes('avaluo') ||
      doc.nombre.toLowerCase().includes('informe dom')
    );
    if (requiereArchivo) return; // Solo se marca al subir archivo
    const nuevasSols = solicitudes.map(s => s.id !== solId ? s : {
      ...s, documentos: s.documentos.map((d, i) => i === idx ? { ...d, entregado: !d.entregado } : d)
    });
    onSaveSolicitudes(nuevasSols);
    const solActualizada = nuevasSols.find(s => s.id === solId);
    if (solActualizada) await supabase.from("solicitudes").update({ documentos: solActualizada.documentos }).eq("id", solId);
  };

  const marcarDocEntregado = async (solId, idx, entregado = true) => {
    const nuevasSols = solicitudes.map(s => s.id !== solId ? s : {
      ...s,
      documentos: s.documentos.map((d, i) => i === idx ? { ...d, entregado } : d)
    });
    onSaveSolicitudes(nuevasSols);
    const solActualizada = nuevasSols.find(s => s.id === solId);
    if (solActualizada) await supabase.from("solicitudes").update({ documentos: solActualizada.documentos }).eq("id", solId);
  };

  const setDocValor = async (solId, idx, valor) => {
    const nuevasSols = solicitudes.map(s => s.id !== solId ? s : {
      ...s, documentos: s.documentos.map((d, i) => {
        if (i !== idx) return d;
        // Memo, Carta e Informe DOM: requiere N° Y fecha (separados por |)
        const necesitaNumYFecha = d.nombre && (d.nombre.includes('Memo DOM') || d.nombre.includes('Carta SERVIU') || d.nombre.includes('Informe DOM'));
        const partes = valor.split("|").map(p => p.trim()).filter(Boolean);
        const completo = necesitaNumYFecha ? partes.length >= 2 && partes[0] && partes[1] : valor.trim() !== '';
        return { ...d, valor, entregado: completo };
      })
    });
    onSaveSolicitudes(nuevasSols);
    // Actualizar estado automático si es desmarque
    if (persona.comiteId === "comite_desmarque" && !["NO CALIFICA","APELAR SERVIU","RECHAZADO APELABLE","RECHAZADO DOM","DESMARQUE RECHAZADO","DESMARCADO","Informe DOM aprobado","INFORME DOM APROBADO"].includes(persona.estado_desmarque)) {
      const sol = nuevasSols.find(s => s.id === solId);
      const nuevoEstado = calcularEstadoDesmarque(sol, persona.estado_desmarque);
      if (nuevoEstado !== persona.estado_desmarque) {
        await supabase.from("personas").update({ estado_desmarque: nuevoEstado }).eq("id", persona.id);
        onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, estado_desmarque: nuevoEstado } : p));
      }
    }
  };

  const guardarPrioridadSolicitud = async (solId, valor) => {
    const solActual = solicitudes.find(s => s.id === solId);
    if (solActual && prioridadSolicitud(solActual) === valor) return;
    const clave = window.prompt("Ingrese clave del administrador para cambiar prioridad:");
    if (clave !== "196560") {
      if (clave !== null) alert("Clave de administrador incorrecta.");
      return;
    }
    const nuevasSols = solicitudes.map(s => s.id !== solId ? s : {
      ...s,
      documentos: documentosConPrioridad(s.documentos, valor)
    });
    onSaveSolicitudes(nuevasSols);
    const solActualizada = nuevasSols.find(s => s.id === solId);
    if (solActualizada) await supabase.from("solicitudes").update({ documentos: solActualizada.documentos }).eq("id", solId);
    await registrarAuditoria?.("actualizar_prioridad", "solicitudes", solId, { persona: persona?.nombre || "", prioridad: valor });
  };

  // Setea la opción especial de un documento (luz/agua/discapacidad)
  const setDocOpcion = async (solId, idx, opcion, tipoReal) => {
    const nuevasSols = solicitudes.map(s => s.id !== solId ? s : {
      ...s, documentos: s.documentos.map((d, i) => {
        if (i !== idx) return d;
        const autoMarcar = (
          (tipoReal === "luz" && opcion === "Sin empalme") ||
          (tipoReal === "agua" && opcion === "Pozo") ||
          (tipoReal === "discapacidad" && opcion === "Sin discapacidad")
        );
        const etiqueta = autoMarcar
          ? (tipoReal === "agua" && opcion === "Pozo" ? "POZO" : "N/A")
          : null;
        const partes = (d.valor || "").split("|");
        let valor = d.valor || "";
        if (tipoReal === "luz" && opcion !== "Sin empalme") valor = opcion + "|" + (partes[1] || "");
        if (tipoReal === "agua" && opcion === "Pozo") valor = "Pozo";
        if (tipoReal === "agua" && opcion !== "Pozo") valor = opcion + "|" + (partes[1] || "");
        return { ...d, valor, opcionSeleccionada: opcion, entregado: autoMarcar, etiqueta, tipo: tipoReal };
      })
    });
    onSaveSolicitudes(nuevasSols);
    const solActualizada = nuevasSols.find(s => s.id === solId);
    if (solActualizada) await supabase.from("solicitudes").update({ documentos: solActualizada.documentos }).eq("id", solId);
  };

  const conteoDocsDetalle = misSols.reduce((acc, s) => {
    const c = conteoDocumentosSolicitud(s.documentos || [], s.programaId);
    return { completos: acc.completos + c.completos, total: acc.total + c.total };
  }, { completos: 0, total: 0 });

  return (
    <div>
      <button onClick={onBack} style={{ background: "transparent", border: "1px solid #ddd", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 22, cursor: "pointer" }}>← Volver</button>

      <div style={{ background: esPrioritario ? "#FFFBEB" : "#fff", borderRadius: 14, padding: "24px 28px", marginBottom: 20, border: esPrioritario ? "2px solid #F59E0B" : "1px solid #e8e3de" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 58, height: 58, borderRadius: 29, background: "#1e3a5f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24 }}>{persona.nombre[0].toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a5f" }}>{persona.nombre}</div>
            <div style={{ fontSize: 13, color: "#888" }}>Cédula de identidad: {formatRut(persona.rut)}{persona.telefono ? " - " + persona.telefono : ""}{persona.email ? " - " + persona.email : ""}</div>
            {(persona.direccion || persona.comuna) && <div style={{ fontSize: 13, color: "#888" }}>{[persona.direccion, persona.comuna].filter(Boolean).join(", ")}</div>}
            {(persona.puntajeRSH || persona.integrantesFamiliares) && <div style={{ fontSize: 13, color: "#888" }}>{persona.puntajeRSH ? "RSH: " + persona.puntajeRSH : ""}{persona.integrantesFamiliares ? " - Grupo familiar: " + persona.integrantesFamiliares + " personas" : ""}</div>}
            {(comite || persona.comite) && (
              <div style={{ fontSize: 12, color: "#7C3AED", marginTop: 4, fontWeight: 600 }}>
                {persona.tipo_comite === "RURAL" ? "🌾" : persona.tipo_comite === "URBANO" ? "🏙️" : "👥"} Comité: {comite ? comite.nombre : persona.comite}
                {persona.comiteId && COMITES_FIJOS.find(c => c.codigo === persona.comiteId) && (
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, background: "#f5f3ff", color: "#7C3AED", borderRadius: 8, padding: "1px 7px" }}>{persona.comiteId}</span>
                )}
              </div>
            )}
            {!persona.comiteId && persona.comiteId !== "comite_desmarque" && (
              <>
                {(persona.observaciones || "").startsWith("Pendiente por:") && (
                  <div style={{ marginTop: 5, fontSize: 12, background: "#FFFBEB", color: "#D97706", borderRadius: 8, padding: "4px 10px", display: "inline-block", fontWeight: 600, border: "1px solid #FDE68A" }}>
                    ⏳ {persona.observaciones}
                  </div>
                )}
                <button onClick={() => setShowAsignarComite(true)}
                  style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "#7C3AED", background: "#f5f3ff", border: "1px solid #ddd8fe", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
                  + Asignar comité
                </button>
              </>
            )}
            {persona.comiteId === "comite_desmarque" && (() => {
              const solDesmarque = misSols.find(s => s.programaId === "habitabilidad");
              const est = estadoActualLineaDesmarque(solDesmarque, persona.estado_desmarque);
              return <span style={{ display:"inline-block", marginTop:6, background:est.bg, color:est.color, borderRadius:10, padding:"4px 14px", fontSize:13, fontWeight:800 }}>{est.label}</span>;
            })()}
            {esPrioritario && (
              <span style={{ display: "inline-block", marginTop: 6, marginLeft: 8, background: "#FDE68A", color: "#92400E", borderRadius: 10, padding: "4px 14px", fontSize: 13, fontWeight: 900, border: "1px solid #F59E0B" }}>
                Prioridad
              </span>
            )}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 28, textAlign: "center" }}>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: "#1e3a5f" }}>{misSols.length}</div><div style={{ fontSize: 11, color: "#aaa" }}>PROGRAMAS</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: conteoDocsDetalle.completos === conteoDocsDetalle.total && conteoDocsDetalle.total > 0 ? "#059669" : "#DC2626" }}>{conteoDocsDetalle.completos}/{conteoDocsDetalle.total}</div><div style={{ fontSize: 11, color: "#aaa" }}>DOCUMENTOS</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: "#7C3AED" }}>{archivos.length}</div><div style={{ fontSize: 11, color: "#aaa" }}>ARCHIVOS</div></div>
          </div>
        </div>
      </div>

      {/* Modal asignar comité */}
      {showAsignarComite && (
        <Modal title="Asignar comité al solicitante" onClose={() => { setShowAsignarComite(false); setComiteParaAsignar(""); }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 12 }}>
              Selecciona el comité para <strong>{persona.nombre}</strong>:
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {(() => {
                const normN = s => (s||"").toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");
                const lista = [
                  ...COMITES_FIJOS.map(c => ({ id: c.codigo, nombre: c.nombre, tipo: c.tipo, codigo: c.codigo })),
                  ...(comites||[]).filter(sc => sc.nombre && !COMITES_FIJOS.some(f => normN(f.nombre) === normN(sc.nombre)))
                    .map(sc => ({ id: sc.id, nombre: sc.nombre, tipo: sc.programaId === "csp_urbano" ? "URBANO" : "RURAL", codigo: null }))
                ];
                return lista.map(c => (
                  <div key={c.id} onClick={() => setComiteParaAsignar(c.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 9, border: "2px solid " + (comiteParaAsignar === c.id ? "#7C3AED" : "#e5e7eb"), background: comiteParaAsignar === c.id ? "#f5f3ff" : "#fff", cursor: "pointer" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: comiteParaAsignar === c.id ? "#7C3AED" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: c.codigo ? 11 : 14, fontWeight: 800, color: comiteParaAsignar === c.id ? "#fff" : "#6b7280", fontFamily: "monospace", flexShrink: 0 }}>
                      {c.codigo || (c.tipo === "URBANO" ? "🏙️" : "🌾")}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: comiteParaAsignar === c.id ? "#4C1D95" : "#111827" }}>{c.nombre}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{c.tipo === "RURAL" ? "🌾 Rural" : "🏙️ Urbano"}</div>
                    </div>
                    {comiteParaAsignar === c.id && <span style={{ color: "#7C3AED", fontWeight: 700, fontSize: 16 }}>✓</span>}
                  </div>
                ));
              })()}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 16, borderTop: "1px solid #f0ede8" }}>
            <button onClick={() => { setShowAsignarComite(false); setComiteParaAsignar(""); }}
              style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={asignarComite} disabled={!comiteParaAsignar}
              style={{ padding: "9px 22px", borderRadius: 8, background: comiteParaAsignar ? "#7C3AED" : "#d1d5db", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: comiteParaAsignar ? "pointer" : "not-allowed" }}>
              Confirmar asignación
            </button>
          </div>
        </Modal>
      )}

      {/* ── REGISTRO DE VISITAS A OFICINA ─────────────────────────────────── */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e3de", marginBottom: 20, overflow: "hidden" }}>
        <div style={{ background: "#f8f7ff", borderBottom: "2px solid #7C3AED", padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#4C1D95" }}>📋 Registro de Visitas a Oficina</div>
          <button onClick={() => { setShowFormVisita(v => !v); setFormVisita({ fecha: todayISO(), profesional: currentUser?.nombre || "", compromiso: "", checksDocs: {}, otrosSolicitud: "", checksDocsRecibidos: {}, profesionalRecibio: currentUser?.nombre || "" }); }}
            style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {showFormVisita ? "✕ Cancelar" : "+ Agregar visita"}
          </button>
        </div>

        {showFormVisita && (() => {
          const progId = misSols.find(s => s.programaId === "csp_urbano") ? "csp_urbano"
            : misSols.find(s => s.programaId === "csp_rural") ? "csp_rural"
            : misSols.find(s => s.programaId === "habitabilidad") ? "habitabilidad"
            : persona.comiteId === "comite_desmarque" ? "habitabilidad"
            : null;
          console.log("[Visitas] programaId detectado:", progId, "| misSols programas:", misSols.map(s => s.programaId));
          const progDocs = progId ? (DOCS_SOLICITUD[progId] || []) : [];
          const progLabel = progId === "csp_urbano" ? "Construcción Sitio Propio Urbano"
            : progId === "csp_rural" ? "Construcción Sitio Propio Rural"
            : progId === "habitabilidad" ? "Desmarque de Vivienda"
            : null;
          const profesionalesBase = ["Priscilla Curín Castro","Jacqueline Ortega","Marcelo Cifuentes Vásquez","Onoria Retamal","Jorge Campos Campos","Jonathan Rodríguez"];
          const profesionales = currentUser?.nombre && !profesionalesBase.includes(currentUser.nombre)
            ? [currentUser.nombre, ...profesionalesBase]
            : profesionalesBase;
          const canSave = formVisita.fecha && (formVisita.profesional || currentUser?.nombre);
          return (
          <div style={{ padding: "18px 22px", background: "#faf9ff", borderBottom: "1px solid #e8e3de" }}>
            {/* Fila 1: fecha + profesional */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Fecha de visita *</label>
                <input type="date" value={formVisita.fecha} onChange={e => setFormVisita(f => ({ ...f, fecha: e.target.value }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid " + (formVisita.fecha ? "#7C3AED" : "#ddd"), fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Profesional que atendió *</label>
                <select value={formVisita.profesional} onChange={e => setFormVisita(f => ({ ...f, profesional: e.target.value }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid " + (formVisita.profesional ? "#7C3AED" : "#ddd"), fontSize: 13, background: "#fff", boxSizing: "border-box" }}>
                  <option value="">Seleccionar profesional…</option>
                  {profesionales.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Checklist de documentos */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 6, textTransform: "uppercase" }}>
                Documentos solicitados
                {progLabel && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: "#7C3AED", background: "#f5f3ff", borderRadius: 10, padding: "2px 8px" }}>{progLabel}</span>}
              </label>
              {progDocs.length === 0 ? (
                <div style={{ fontSize: 12, color: "#aaa" }}>Sin programa CSP detectado — use el campo "Otros"</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {progDocs.map(doc => {
                    const checked = !!formVisita.checksDocs[doc.id];
                    const subVal = typeof formVisita.checksDocs[doc.id] === "string" ? formVisita.checksDocs[doc.id] : "";
                    return (
                      <div key={doc.id} style={{ background: checked ? "#f5f3ff" : "#f9fafb", borderRadius: 8, padding: "6px 10px", border: "1.5px solid " + (checked ? "#7C3AED" : "#e5e7eb") }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                          onClick={() => setFormVisita(f => ({ ...f, checksDocs: { ...f.checksDocs, [doc.id]: f.checksDocs[doc.id] ? false : (doc.subopciones ? true : true) } }))}>
                          <div style={{ width: 16, height: 16, borderRadius: 4, border: "2px solid " + (checked ? "#7C3AED" : "#d1d5db"), background: checked ? "#7C3AED" : "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {checked && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 12, color: checked ? "#4C1D95" : "#374151", fontWeight: checked ? 600 : 400 }}>{doc.label}</span>
                        </div>
                        {doc.subopciones && checked && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5, marginLeft: 24 }}>
                            {doc.subopciones.map(sub => (
                              <button key={sub} onClick={() => setFormVisita(f => ({ ...f, checksDocs: { ...f.checksDocs, [doc.id]: f.checksDocs[doc.id] === sub ? true : sub } }))}
                                style={{ fontSize: 11, padding: "2px 10px", borderRadius: 10, border: "1.5px solid " + (subVal === sub ? "#7C3AED" : "#ddd"), background: subVal === sub ? "#7C3AED" : "#fff", color: subVal === sub ? "#fff" : "#555", cursor: "pointer", fontWeight: subVal === sub ? 700 : 400 }}>
                                {sub}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Otros + Compromiso */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Otros (solicitudes adicionales)</label>
                <textarea value={formVisita.otrosSolicitud} onChange={e => setFormVisita(f => ({ ...f, otrosSolicitud: e.target.value }))}
                  placeholder="Solicitudes adicionales no listadas…"
                  rows={3} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #ddd", fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Compromiso del solicitante</label>
                <textarea value={formVisita.compromiso} onChange={e => setFormVisita(f => ({ ...f, compromiso: e.target.value }))}
                  placeholder="¿Qué comprometió el postulante?"
                  rows={3} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #ddd", fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>

            {/* Documentos recibidos */}
            <div style={{ marginTop: 4, marginBottom: 14, borderTop: "1.5px dashed #e5e7eb", paddingTop: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#059669", display: "block", marginBottom: 6, textTransform: "uppercase" }}>
                Documentos recibidos en esta visita
                {progLabel && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: "#059669", background: "#ecfdf5", borderRadius: 10, padding: "2px 8px" }}>{progLabel}</span>}
              </label>
              {progDocs.length === 0 ? (
                <div style={{ fontSize: 12, color: "#aaa" }}>Sin programa detectado</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10 }}>
                  {progDocs.map(doc => {
                    const checked = !!formVisita.checksDocsRecibidos[doc.id];
                    const subVal = typeof formVisita.checksDocsRecibidos[doc.id] === "string" ? formVisita.checksDocsRecibidos[doc.id] : "";
                    return (
                      <div key={doc.id} style={{ background: checked ? "#ecfdf5" : "#f9fafb", borderRadius: 8, padding: "6px 10px", border: "1.5px solid " + (checked ? "#059669" : "#e5e7eb") }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                          onClick={() => setFormVisita(f => ({ ...f, checksDocsRecibidos: { ...f.checksDocsRecibidos, [doc.id]: f.checksDocsRecibidos[doc.id] ? false : true } }))}>
                          <div style={{ width: 16, height: 16, borderRadius: 4, border: "2px solid " + (checked ? "#059669" : "#d1d5db"), background: checked ? "#059669" : "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {checked && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 12, color: checked ? "#065f46" : "#374151", fontWeight: checked ? 600 : 400 }}>{doc.label}</span>
                        </div>
                        {doc.subopciones && checked && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5, marginLeft: 24 }}>
                            {doc.subopciones.map(sub => (
                              <button key={sub} onClick={() => setFormVisita(f => ({ ...f, checksDocsRecibidos: { ...f.checksDocsRecibidos, [doc.id]: f.checksDocsRecibidos[doc.id] === sub ? true : sub } }))}
                                style={{ fontSize: 11, padding: "2px 10px", borderRadius: 10, border: "1.5px solid " + (subVal === sub ? "#059669" : "#ddd"), background: subVal === sub ? "#059669" : "#fff", color: subVal === sub ? "#fff" : "#555", cursor: "pointer", fontWeight: subVal === sub ? 700 : 400 }}>
                                {sub}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Profesional que recibió los documentos</label>
                <select value={formVisita.profesionalRecibio} onChange={e => setFormVisita(f => ({ ...f, profesionalRecibio: e.target.value }))}
                  style={{ width: "100%", maxWidth: 340, padding: "7px 10px", borderRadius: 7, border: "1.5px solid " + (formVisita.profesionalRecibio ? "#059669" : "#ddd"), fontSize: 13, background: "#fff" }}>
                  <option value="">Seleccionar profesional…</option>
                  {profesionales.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              {!canSave && <span style={{ fontSize: 11, color: "#B45309", alignSelf: "center" }}>⚠ Fecha y profesional son obligatorios</span>}
              <button onClick={() => agregarVisita(progDocs)} disabled={!canSave || guardandoVisita}
                style={{ background: canSave ? "#7C3AED" : "#d1d5db", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed" }}>
                {guardandoVisita ? "Guardando…" : "Guardar visita"}
              </button>
            </div>
          </div>
          );
        })()}

        <div style={{ padding: "0 22px 16px" }}>
          {visitas.length === 0 ? (
            <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, padding: "24px 0" }}>Sin visitas registradas</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 16 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f0ede8" }}>
                  {["Fecha", "Profesional", "Solicitud al postulante", "Compromiso del postulante", "Docs recibidos", ""].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visitas.map(v => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "10px 8px", whiteSpace: "nowrap", color: "#1e3a5f", fontWeight: 600 }}>{fmtFecha(v.fecha)}</td>
                    <td style={{ padding: "10px 8px", color: "#374151" }}>{v.profesional}</td>
                    <td style={{ padding: "10px 8px", color: "#6b7280", maxWidth: 220 }}>{v.solicitud || <span style={{ color: "#d1d5db" }}>—</span>}</td>
                    <td style={{ padding: "10px 8px", color: "#6b7280", maxWidth: 220 }}>{v.compromiso || <span style={{ color: "#d1d5db" }}>—</span>}</td>
                    <td style={{ padding: "10px 8px", maxWidth: 180 }}>
                      {v.docs_recibidos ? (
                        <div>
                          <div style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>
                            {v.docs_recibidos.split("\n").filter(Boolean).length} doc(s)
                          </div>
                          {v.profesional_recibio && <div style={{ fontSize: 11, color: "#6b7280" }}>{v.profesional_recibio}</div>}
                        </div>
                      ) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>
                      <button onClick={() => imprimirVisita(v)}
                        style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        🖨 Imprimir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, padding: "14px 20px", marginBottom: 20, border: "1px solid #e8e3de", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e3a5f" }}>Ficha del solicitante</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>La ficha permanece oculta hasta que se solicite mostrarla.</div>
        </div>
        <button onClick={() => setShowFichaSolicitante(v => !v)}
          style={{ background: showFichaSolicitante ? "#6B7280" : "#1e3a5f", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
          {showFichaSolicitante ? "Ocultar ficha" : "Mostrar ficha"}
        </button>
      </div>

      {showFichaSolicitante && (
        <>
          {/* FICHA COMPLETA RURAL */}
          {(() => {
            const tieneRural = misSols.some(s => s.programaId === "csp_rural");
            const tieneUrbano = misSols.some(s => s.programaId === "csp_urbano");
            const tienePrograma = misSols.length > 0;
            const comiteRural = persona.comiteId && persona.comiteId !== "comite_desmarque" &&
              (persona.tipoComite === "Rural" || persona.tipo_comite === "RURAL" ||
               (comite && comite.nombre && comite.nombre.toUpperCase().includes("RURAL")));
            // Solo usar como fallback cuando NO hay programa asignado todavía
            const sinComite = !tienePrograma && (!persona.comiteId || persona.comiteId === "");
            // Si hay programa pero es solo urbano, no mostrar Rural
            if (tienePrograma && !tieneRural) return null;
            return (tieneRural || comiteRural || sinComite) ? (
              <FichaRural persona={persona} misSols={misSols} comites={comites} esCsp={tieneRural} onSave={(datos) => onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, ...datos } : p))} />
            ) : null;
          })()}

          {/* FICHA COMPLETA URBANA */}
          {(() => {
            const tieneUrbano = misSols.some(s => s.programaId === "csp_urbano");
            const tieneRural = misSols.some(s => s.programaId === "csp_rural");
            const tienePrograma = misSols.length > 0;
            const comiteUrbano = persona.comiteId && persona.comiteId !== "comite_desmarque" &&
              (persona.tipoComite === "Urbano" || persona.tipo_comite === "URBANO" ||
               (comite && comite.nombre && comite.nombre.toUpperCase().includes("URBANO")));
            // Si hay programa pero es solo rural, no mostrar Urbana
            if (tienePrograma && !tieneUrbano) return null;
            return (tieneUrbano || comiteUrbano) ? (
              <FichaUrbana persona={persona} misSols={misSols} comites={comites} esCsp={tieneUrbano} onSave={(datos) => onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, ...datos } : p))} />
            ) : null;
          })()}

          {/* FICHAS PARA PROGRAMAS PERSONALIZADOS Y MAVE */}
          {(() => {
            const fichaGeneralIds = new Set(["mave_rural", "ampliacion_vivienda", ...(programasCustom || []).map(p => p.id)]);
            const fichas = misSols
              .filter(s => fichaGeneralIds.has(s.programaId))
              .map(s => ({ solicitud: s, programa: todosProgramas.find(p => p.id === s.programaId) }))
              .filter(x => x.programa);

            if (comite && fichaGeneralIds.has(comite.programaId) && !fichas.some(x => x.programa.id === comite.programaId)) {
              const programa = todosProgramas.find(p => p.id === comite.programaId);
              if (programa) fichas.push({ solicitud: null, programa });
            }

            return fichas.map(({ programa, solicitud }) => (
              <FichaProgramaCustom key={programa.id + "-" + (solicitud ? solicitud.id : "comite")} persona={persona} programa={programa} solicitud={solicitud} />
            ));
          })()}

          {/* FICHA COMPLETA DESMARQUE */}
          {persona.comiteId === "comite_desmarque" && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", marginBottom: 20, border: "1px solid #e8e3de" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f" }}>📋 Ficha Desmarque</div>
            <button onClick={() => {
              const sol = misSols[0];
              const docs = sol ? sol.documentos : [];
              const memo = docs.find(d => d.nombre && d.nombre.includes("Memo DOM"));
              const carta = docs.find(d => d.nombre && d.nombre.includes("Carta SERVIU"));
              const informe = docs.find(d => d.nombre && d.nombre.includes("Informe DOM"));
              setFichaForm({
                rut: persona.rut||"",
                direccion: persona.direccion||"",
                telefono: persona.telefono||"",
                tipo_comite: persona.tipo_comite||"",
                sector: persona.sector||"",
                rol_propiedad: persona.rol_propiedad||"",
                coordenadas: persona.coordenadas||"",
                puntaje_rsh: persona.puntajeRSH||"",
                dominio_terreno: persona.dominio_terreno||"",
                anio_subsidio: persona.anio_subsidio||"",
                observaciones: persona.observaciones||"",
                fecha_visita: sol ? fechaVisitaSolicitud(sol) : "",
                numero_informe_dom: informe ? informe.valor||"" : "",
                numero_memo_dom: memo ? memo.valor||"" : "",
                numero_carta_serviu: carta ? carta.valor||"" : "",
              });
              setCamposDesmarqueDesbloqueados(false);
              setShowFichaEdit(true);
            }}
              style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✏️ Editar datos</button>
          </div>
          {(() => {
            const campo = (label, valor) => (
              <div key={label} style={{ display: "flex", borderBottom: "1px solid #f0f0f0", padding: "7px 0" }}>
                <div style={{ width: 220, fontSize: 12, fontWeight: 700, color: "#555", flexShrink: 0 }}>{label}</div>
                <div style={{ fontSize: 12, color: valor ? "#1e3a5f" : "#DC2626", fontWeight: valor ? 400 : 600 }}>{valor || "⚠ Falta trámite o documento"}</div>
              </div>
            );
            const sol = misSols[0];
            const docs = sol ? sol.documentos : [];
            const memo = docs.find(d => d.nombre && d.nombre.includes("Memo DOM"));
            const carta = docs.find(d => d.nombre && d.nombre.includes("Carta SERVIU"));
            const informe = docs.find(d => d.nombre && d.nombre.includes("Informe DOM"));
            // Supabase usa snake_case, el objeto local puede usar camelCase
            const getVal = (campo1, campo2) => persona[campo1] || persona[campo2] || "";
            return (
              <div>
                {campo("Estado", getVal("estado_desmarque","estadoDesmarque"))}
                {campo("N° Recepción", getVal("numero_recepcion","numeroRecepcion"))}
                {campo("Fecha Recepción", getVal("fecha_recepcion","fechaRecepcion"))}
                {campo("Nombre", persona.nombre)}
                {campo("Cédula de identidad", persona.rut)}
                {campo("RUT colores", persona.rutColores || persona.rutcolores || rutColoresDesdeSolicitudes(misSols))}
                {campo("Teléfono", persona.telefono)}
                {campo("U/R", getVal("tipo_comite","tipoComite") || persona.tipo)}
                {campo("Comunidad/Dirección", persona.direccion)}
                {campo("Rol Propiedad", getVal("rol_propiedad","rolPropiedad"))}
                {campo("Coordenadas", persona.coordenadas)}
                {campo("Sector", persona.sector)}
                {campo("RSH", persona.puntajeRSH ? persona.puntajeRSH + "%" : (persona.puntaje_rsh ? persona.puntaje_rsh + "%" : ""))}
                {campo("Dominio del Terreno", getVal("dominio_terreno","dominioTerreno"))}
                {campo("Año de Subsidio", getVal("anio_subsidio","anioSubsidio"))}
                {campo("Fecha Visita", sol && fechaVisitaSolicitud(sol) ? fmtFecha(fechaVisitaSolicitud(sol)) : "")}
                {campo("N° Informe DOM", informe && informe.valor ? informe.valor : "")}
                {campo("N° Memorando DOM y Fecha", memo && memo.valor ? memo.valor : "")}
                {campo("N° Carta SERVIU y Fecha", carta && carta.valor ? carta.valor : "")}
                {campo("Observaciones", persona.observaciones)}
              </div>
            );
          })()}
        </div>
          )}
        </>
      )}

      <div style={{ background: "#fff", borderRadius: 14, padding: "22px 26px", marginBottom: 20, border: "1px solid #e8e3de" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f" }}>Carpeta de documentos</div>
            <div style={{ fontSize: 12, color: "#888" }}>Carpeta: {carpeta}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {persona && persona.comiteId === "comite_desmarque" && (
              <>
                <button onClick={() => { setInformeSubsidioTexto(persona.anio_subsidio || ""); setShowModalInformeJACC(true); }} style={{ background: "#166534", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📋 Generar Informe JACC</button>
                <button onClick={() => setShowModalMemo(true)} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📄 Generar Memo DOM</button>
                <button onClick={() => setShowModalCarta(true)} style={{ background: "#0891B2", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📄 Generar Carta SERVIU</button>
                <button onClick={abrirModalSolicitud} style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📄 Generar Solicitud</button>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#DC2626", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  📎 Subir Informe DOM
                  <input type="file" style={{ display: "none" }} accept=".pdf,.jpg,.jpeg,.png"
                    onChange={async e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setSubiendo(true);
                      try {
                        await subirArchivoServidor(file, carpeta);
                        setShowModalInformeDom(true);
                      } catch (err) { alert("Error al subir Informe DOM: " + (err.message || "")); }
                      finally { setSubiendo(false); e.target.value = ""; }
                    }} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#B45309", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  📎 Subir Respuesta SERVIU
                  <input type="file" style={{ display: "none" }} accept=".pdf,.jpg,.jpeg,.png"
                    onChange={async e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setSubiendo(true);
                      try {
                        await subirArchivoServidor(file, carpeta);
                        setShowModalRespuestaServiu(true);
                      } catch (err) { alert("Error al subir Respuesta SERVIU: " + (err.message || "")); }
                      finally { setSubiendo(false); e.target.value = ""; }
                    }} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#7C3AED", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }} title="Sube el memorando firmado/recibido — activa el VB automáticamente">
                  📎 Subir Memo recibido
                  <input type="file" style={{ display: "none" }} accept=".pdf,.jpg,.jpeg,.png"
                    onChange={async e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setSubiendo(true);
                      try {
                        await subirArchivoServidor(file, carpeta);
                        await _activarVb("Memo DOM");
                      } catch (err) { alert("Error al subir Memo recibido: " + (err.message || "")); }
                      finally { setSubiendo(false); e.target.value = ""; }
                    }} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0891B2", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }} title="Sube el comprobante de ingreso SERVIU — activa el VB automáticamente">
                  📎 Subir comprobante Carta
                  <input type="file" style={{ display: "none" }} accept=".pdf,.jpg,.jpeg,.png"
                    onChange={async e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setSubiendo(true);
                      try {
                        await subirArchivoServidor(file, carpeta);
                        await _activarVb("Carta SERVIU");
                      } catch (err) { alert("Error al subir comprobante Carta: " + (err.message || "")); }
                      finally { setSubiendo(false); e.target.value = ""; }
                    }} />
                </label>
              </>
            )}
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={subirArchivo} accept=".pdf,.jpg,.jpeg,.png" />
            <button onClick={() => fileRef.current.click()} disabled={subiendo} style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {subiendo ? "Subiendo..." : "⬆ Subir documento"}
            </button>
            <button onClick={() => { setZipSeleccionados([persona]); setShowModalZip(true); }} style={{ background: "#374151", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              🗜 Descargar ZIP
            </button>
          </div>
        </div>
        {archivos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 0", color: "#bbb" }}>No hay archivos subidos aun. Haz clic en Subir documento.</div>
        ) : (
          <div style={{ position: "relative" }} onClick={e => { if (!e.target.closest("[data-docmenu]")) setDocMenu(null); }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {archivos.map(arch => {
                const archivoGuardado = archivosDatos[arch];
                const fileUrl = archivoGuardado?.dataUrl || apiPath("/files/", archivosRutas[arch] || carpeta, arch);
                const esGenerado = arch.startsWith("MEMO_") || arch.startsWith("CARTA_") || arch.startsWith("SOLICITUD_") || arch.startsWith("INFORME_JACC_");
                const esMemoDom      = arch.startsWith("MEMO_");
                const esCartaServ    = arch.startsWith("CARTA_");
                const esSolicitud    = arch.startsWith("SOLICITUD_");
                const esInformeJACC  = arch.startsWith("INFORME_JACC_");
                const isMenuOpen   = docMenu && docMenu.arch === arch;
                return (
                  <div key={arch} style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 9, border: "1px solid " + (isMenuOpen ? "#7C3AED" : "#e5e7eb"), background: isMenuOpen ? "#F5F3FF" : "#fafafa" }}>
                    <button
                      onClick={e => { e.stopPropagation(); setDocMenu(isMenuOpen ? null : { arch, x: e.clientX, y: e.clientY }); }}
                      title="Opciones"
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500, color: "#1e3a5f", flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: 0 }}>
                      {arch.endsWith(".html") ? "🌐 " : arch.endsWith(".pdf") ? "📋 " : "📎 "}{arch}
                    </button>
                    <button onClick={() => eliminarArchivo(arch)} style={{ background: "transparent", border: "none", color: "#DC2626", cursor: "pointer", marginLeft: 6, fontSize: 13 }}>✕</button>
                    {isMenuOpen && (
                      <div data-docmenu="1" style={{ position: "fixed", top: docMenu.y + 6, left: Math.min(docMenu.x, window.innerWidth - 200), zIndex: 9999, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.13)", minWidth: 180, overflow: "hidden" }}>
                        <div style={{ padding: "6px 0" }}>
                          <button onClick={() => { abrirArchivo(arch); setDocMenu(null); }}
                            style={{ display: "block", width: "100%", padding: "9px 18px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#1e3a5f", fontWeight: 500 }}>
                            👁 Ver documento
                          </button>
                          {esGenerado && (
                            <button onClick={() => {
                              if (esMemoDom)     setShowModalMemo(true);
                              if (esCartaServ)   setShowModalCarta(true);
                              if (esSolicitud)   abrirModalSolicitud();
                              if (esInformeJACC) setShowModalInformeJACC(true);
                              setDocMenu(null);
                            }}
                              style={{ display: "block", width: "100%", padding: "9px 18px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#059669", fontWeight: 500 }}>
                              ✏️ Editar / Regenerar
                            </button>
                          )}
                          <button onClick={() => {
                            const isPdf = arch.toLowerCase().endsWith(".pdf");
                            if (isPdf) {
                              const iframe = document.createElement("iframe");
                              iframe.style.display = "none";
                              iframe.src = fileUrl;
                              document.body.appendChild(iframe);
                              iframe.onload = () => { try { iframe.contentWindow.print(); } catch { window.open(fileUrl, "_blank"); } setTimeout(() => document.body.removeChild(iframe), 8000); };
                            } else {
                              abrirArchivo(arch);
                            }
                            setDocMenu(null);
                          }}
                            style={{ display: "block", width: "100%", padding: "9px 18px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#B45309", fontWeight: 500 }}>
                            🖨 Imprimir
                          </button>
                          <div style={{ height: 1, background: "#f0f0f0", margin: "4px 0" }} />
                          <button onClick={() => { eliminarArchivo(arch); setDocMenu(null); }}
                            style={{ display: "block", width: "100%", padding: "9px 18px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#DC2626", fontWeight: 500 }}>
                            🗑 Eliminar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {(() => {
        const tieneCsp = misSols.some(s => s.programaId === "csp_rural" || s.programaId === "csp_urbano");
        return (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#1e3a5f" }}>Solicitudes activas</div>
            {disponibles.length > 0 && (
              <button onClick={() => setShowModal(true)}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                + Agregar programa
              </button>
            )}
          </div>
        );
      })()}

      {misSols.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>No tiene programas asignados aun.</div>}

      {misSols.map(sol => {
        const prog = todosProgramas.find(p => p.id === sol.programaId);
        const p = pct(sol.documentos, sol.programaId);
        const conteoSol = conteoDocumentosSolicitud(sol.documentos, sol.programaId);
        const ok = conteoSol.completos;
        const progNombreNorm = (prog?.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const esMave = sol.programaId === "mave_rural" || progNombreNorm.includes("mejoramiento de vivienda") || progNombreNorm.includes("mave");
        const esAmpliacion = sol.programaId === "ampliacion_vivienda" || progNombreNorm.includes("ampliacion de la vivienda");
        const esProgramaEspecialVivienda = esMave || esAmpliacion;
        const esCsp = sol.programaId === "csp_rural" || sol.programaId === "csp_urbano" || esProgramaEspecialVivienda;
        const esCustom = !!(prog && prog.esCustom && !esProgramaEspecialVivienda);
        const prioridadActual = prioridadSolicitud(sol);
        return (
          <div key={sol.id} style={{ background: "#fff", borderRadius: 14, padding: "22px 26px", marginBottom: 16, border: "1px solid #e8e3de" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 18, background: prog ? prog.colorLight : "#eee", color: prog ? prog.color : "#666", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16 }}>{prog ? prog.icon : "?"}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "#1e3a5f" }}>{prog ? prog.nombre : sol.programaId}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>Ingresada: {sol.fecha}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ background: statusBg(p), color: statusColor(p), borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: 700 }}>{statusLabel(p)}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: statusColor(p) }}>{ok}/{conteoSol.total}</div>
                <button onClick={() => setSolsEditando(prev => ({ ...prev, [sol.id]: !prev[sol.id] }))}
                  style={{ padding: "5px 14px", borderRadius: 8, border: "1.5px solid " + (solsEditando[sol.id] ? "#059669" : "#1e3a5f"), background: solsEditando[sol.id] ? "#059669" : "#1e3a5f", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {solsEditando[sol.id] ? "✓ Editando" : "✏ Editar"}
                </button>
                {solsEditando[sol.id] && (
                  <button onClick={async () => {
                    const docs = sol.documentos || [];
                    const db = {}; // campos para Supabase (snake_case)
                    const lc = {}; // campos para estado local (camelCase)
                    for (const d of docs) {
                      const n = (d.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                      const t = d.tipo || "";
                      const v = d.valor || "";
                      const p = v.split("|");
                      // Cédula → rut + fecha_nacimiento
                      if (n.includes("cedula")) {
                        if (p[0]) { db.rut = p[0].trim(); lc.rut = p[0].trim(); }
                        if (p[1] && p[1].length === 10) {
                          db.fecha_nacimiento = p[1];
                          lc.fechaNacimiento = p[1];
                          const adulto = textoAdultoMayor(p[1]);
                          if (adulto) db.adultomayor = lc.adultoMayor = adulto;
                        }
                        if (p[2]) { db.rutcolores = p[2].trim(); lc.rutColores = p[2].trim(); }
                      }
                      if (n.includes("correo") && n.includes("solicitante") && v.trim()) {
                        db.email = v.trim();
                        lc.email = v.trim();
                      }
                      // Fecha de nacimiento sola
                      if (n.includes("fecha de nacimiento") && v.length === 10) {
                        db.fecha_nacimiento = v; lc.fechaNacimiento = v;
                        const adulto = textoAdultoMayor(v);
                        if (adulto) db.adultomayor = lc.adultoMayor = adulto;
                      }
                      // RSH → puntaje, comuna, estado civil, integrantes, subsidio
                      if (n.includes("registro social") || n.includes("rsh")) {
                        if (p[0]) { db.puntaje_rsh = p[0].trim(); lc.puntajeRSH = p[0].trim(); }
                        if (p[1]) { db.comuna = p[1].trim(); lc.comuna = p[1].trim(); }
                        if (p[2]) { db.estadocivil = p[2]; lc.estadoCivil = p[2]; }
                        if (p[3]) { db.integrantes_familiares = p[3].trim(); lc.integrantesFamiliares = p[3].trim(); }
                        if (p[4]) { db.subsidio_anterior = p[4]; lc.subsidioAnterior = p[4]; }
                        if (p[5]) { db.credencialdiscapacidad = p[5].trim(); lc.credencialDiscapacidad = p[5].trim(); }
                        if (p[6]) { db.movilidadreducida = p[6].trim(); lc.movilidadReducida = p[6].trim(); }
                        if (p[5] === "N/A") { db.discapacidad = "N/A"; lc.discapacidad = "N/A"; }
                        if (p[5] && p[5] !== "N/A") { db.discapacidad = "S"; lc.discapacidad = "S"; }
                      }
                      // Luz / empalme → proveedor + n° cliente
                      if (t === "luz") {
                        if (p[0]) { db.proveedorelectrico = p[0].trim(); lc.proveedorElectrico = p[0].trim(); }
                        if (p[1]) { db.nclienteelectricidad = p[1].trim(); lc.nClienteElectricidad = p[1].trim(); }
                      }
                      // Agua con arranque → empresa + n° servicio
                      if (t === "agua" && v.includes("|")) {
                        if (p[0]) { db.sistemaagua = p[0].trim(); lc.sistemaAgua = p[0].trim(); }
                        if (p[1]) { db.nservicioagua = p[1].trim(); lc.nServicioAgua = p[1].trim(); }
                      }
                      // Agua sin arranque (Pozo u otro)
                      if (t === "agua" && v && !v.includes("|")) {
                        db.sistemaagua = v; lc.sistemaAgua = v;
                        if (v.trim().toLowerCase() === "pozo") {
                          db.nservicioagua = "N/A"; lc.nServicioAgua = "N/A";
                        }
                      }
                      // Discapacidad → usa opcionSeleccionada (no d.opcion)
                      if (t === "discapacidad") {
                        const opSel = d.opcionSeleccionada || "";
                        if (opSel === "Con discapacidad") {
                          db.discapacidad = "S"; lc.discapacidad = "S";
                          if (p[0]) { db.credencialdiscapacidad = p[0].trim(); lc.credencialDiscapacidad = p[0].trim(); }
                          if (p[1]) { db.movilidadreducida = p[1].toLowerCase().startsWith("s") ? "SI" : "NO"; lc.movilidadReducida = db.movilidadreducida; }
                        }
                        if (opSel === "Sin discapacidad") {
                          db.discapacidad = "N/A"; lc.discapacidad = "N/A";
                          db.movilidadreducida = "N/A"; lc.movilidadReducida = "N/A";
                          db.credencialdiscapacidad = "N/A"; lc.credencialDiscapacidad = "N/A";
                        }
                      }
                      // Movilidad reducida (doc separado)
                      if (n.includes("movilidad")) {
                        const opSel = d.opcionSeleccionada || v;
                        if (opSel) { db.movilidadreducida = opSel === "Sí" ? "SI" : opSel; lc.movilidadReducida = db.movilidadreducida; }
                      }
                      // Dominio de la propiedad / Título de dominio
                      if (n.includes("dominio") || n.includes("titulo") || n.includes("escritura")) {
                        const base = p[0] === "Otro" && p[1] ? "Otro: " + p[1] : p[0];
                        const detalle = [
                          p[2] ? "Fjs: " + p[2].trim() : "",
                          p[3] ? "N°: " + p[3].trim() : "",
                          p[4] ? "Año: " + p[4].trim() : "",
                        ].filter(Boolean).join(", ");
                        const val = [base, detalle].filter(Boolean).join(" - ");
                        if (val) { db.dominiopropiedad = val; lc.dominiopropiedad = val; }
                      }
                      // Avalúo fiscal
                      if (n.includes("avaluo")) {
                        if (p[0]) { db.rol_propiedad = p[0].trim(); lc.rol_propiedad = p[0].trim(); }
                        if (p[1]) {
                          const valorAvaluo = formatPesosChilenos(p[1]);
                          db.avaluofiscal = valorAvaluo;
                          lc.avaluoFiscal = valorAvaluo;
                        }
                        if (p[2]) { db.coordenadas = p[2].trim(); lc.coordenadas = p[2].trim(); }
                      }
                      // Certificado ruralidad
                      if (n.includes("ruralidad") && p[0]) { db.certruralidad = p[0].trim() + (p[1] ? " — " + p[1] : ""); lc.certRuralidad = db.certruralidad; }
                      // Cuenta de ahorro → número en p[0], banco en p[1]
                      if (n.includes("cuenta de ahorro")) {
                        if (p[0]) { db.cuentaahorro = p[0].trim(); lc.cuentaAhorro = p[0].trim(); }
                        if (p[1]) { db.banco = p[1].trim(); lc.banco = p[1].trim(); }
                      }
                      // Rol
                      if (n.includes("rol") && v) { db.rol = v; lc.rol = v; }
                      if (n.includes("telefono") && v) { db.telefono = v.trim(); lc.telefono = v.trim(); }
                    }
                    const cargoAuto = inferirCargo(persona.nombre, persona.comiteId, comites);
                    if (cargoAuto) { db.cargo_comite = cargoAuto; lc.cargo_comite = cargoAuto; }
                    const constructoraAuto = constructoraDeComite({ ...persona, ...lc }, comites);
                    if (constructoraAuto) {
                      db.constructoraseleccionada = constructoraAuto;
                      lc.constructoraSeleccionada = constructoraAuto;
                    }
                    if (Object.keys(db).length > 0) {
                      await supabase.from("personas").update(db).eq("id", persona.id);
                      onSavePersonas(personas.map(p2 => p2.id === persona.id ? { ...p2, ...lc } : p2));
                    }
                    setSolsEditando(prev => ({ ...prev, [sol.id]: false }));
                    alert("✓ Datos guardados en la ficha del solicitante");
                  }}
                    style={{ padding: "5px 14px", borderRadius: 8, border: "1.5px solid #059669", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    💾 Guardar
                  </button>
                )}
              </div>
            </div>
            <div style={{ marginBottom: 14, padding: "10px 14px", background: prioridadActual === "prioridad" ? "#FFFBEB" : "#F9FAFB", borderRadius: 8, border: "1px solid " + (prioridadActual === "prioridad" ? "#F59E0B" : "#E5E7EB"), display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#374151", textTransform: "uppercase" }}>Prioridad del solicitante</div>
              <button onClick={() => guardarPrioridadSolicitud(sol.id, "prioridad")}
                style={{ padding: "6px 12px", border: "1.5px solid #F59E0B", borderRadius: 7, background: prioridadActual === "prioridad" ? "#F59E0B" : "#fff", color: prioridadActual === "prioridad" ? "#111827" : "#92400E", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
                Prioridad
              </button>
              <button onClick={() => guardarPrioridadSolicitud(sol.id, "normal")}
                style={{ padding: "6px 12px", border: "1.5px solid #D1D5DB", borderRadius: 7, background: prioridadActual === "normal" ? "#1F2937" : "#fff", color: prioridadActual === "normal" ? "#fff" : "#374151", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                Solicitante normal
              </button>
            </div>
            <div style={{ height: 8, background: "#f0ede8", borderRadius: 4, marginBottom: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", width: p + "%", background: statusColor(p), borderRadius: 4 }} />
            </div>
            {sol.programaId === "habitabilidad" && (
              <>
                <LineaAvanceDesmarque sol={sol} />
                {(() => {
                  const st = estadoLineaDesmarque(sol);
                  return <div style={{ marginBottom: 14, padding: "10px 14px", background: st.calificacion.estado === "NO_CALIFICA" ? "#FEF2F2" : st.calificacion.estado === "CALIFICA" ? "#ECFDF5" : "#F9FAFB", borderRadius: 8, border: "1px solid " + (st.calificacion.estado === "NO_CALIFICA" ? "#FCA5A5" : st.calificacion.estado === "CALIFICA" ? "#86EFAC" : "#E5E7EB"), display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "#374151", textTransform: "uppercase" }}>Calificación manual para visita</div>
                    <button onClick={() => guardarCalificacionDesmarque(sol, "CALIFICA")} style={{ padding: "6px 12px", border: 0, borderRadius: 7, background: "#059669", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Califica</button>
                    <button onClick={() => guardarCalificacionDesmarque(sol, "NO_CALIFICA")} style={{ padding: "6px 12px", border: 0, borderRadius: 7, background: "#DC2626", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>No califica</button>
                    {st.calificacion.estado === "CALIFICA" && <span style={{ fontSize: 12, color: "#047857", fontWeight: 800 }}>✓ Solicitante califica para visita</span>}
                    {st.calificacion.estado === "NO_CALIFICA" && <span style={{ fontSize: 12, color: "#B91C1C", fontWeight: 800 }}>NO CALIFICA: {st.calificacion.detalle}</span>}
                    {!st.calificacion.estado && <span style={{ fontSize: 12, color: "#6B7280" }}>Pendiente de revisión manual</span>}
                  </div>;
                })()}
              </>
            )}
            {/* Campo Fecha de Visita inline para Desmarque */}
            {sol.programaId === "habitabilidad" && (
              <div style={{ marginBottom: 14, padding: "10px 14px", background: fechaVisitaSolicitud(sol) ? "#f0fdf4" : "#fffbeb", borderRadius: 8, border: "1px solid " + (fechaVisitaSolicitud(sol) ? "#bbf7d0" : "#fde68a"), display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>📅 Fecha de Visita</div>
                <input type="date" value={fechaVisitaSolicitud(sol)}
                  onClick={e => e.stopPropagation()}
                  onChange={async e => {
                    const val = e.target.value;
                    const guardada = await guardarFechaVisitaDesmarque(sol, val);
                    if (!guardada) return;
                    if (val && !["NO CALIFICA","APELAR SERVIU","RECHAZADO APELABLE","RECHAZADO DOM","DESMARQUE RECHAZADO","DESMARCADO","INFORME EN DOM","INFORME EN SERVIU"].includes(persona.estado_desmarque)) {
                      const nuevoEstado = "VISITA HECHA FALTA INFORME";
                      if (nuevoEstado !== persona.estado_desmarque) {
                        await supabase.from("personas").update({ estado_desmarque: nuevoEstado }).eq("id", persona.id);
                        onSavePersonas(personas.map(p2 => p2.id === persona.id ? { ...p2, estado_desmarque: nuevoEstado } : p2));
                      }
                    }
                  }}
                  style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid " + (fechaVisitaSolicitud(sol) ? "#059669" : "#ddd"), fontSize: 12, background: "#fff" }} />
                {fechaVisitaSolicitud(sol)
                  ? <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>✓ Visita registrada</span>
                  : <span style={{ fontSize: 11, color: "#B45309" }}>⚠ Sin fecha de visita — estado: No Visitado</span>}
              </div>
            )}
            {solsEditando[sol.id] && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {(() => {
                const visibles = indicesDocumentosVisibles(sol.documentos || []);
                return (sol.documentos || []).map((doc, i) => {
                if (!visibles.has(i)) return null;
                if (doc.interno) return null;
                if ((doc.nombre || "").toLowerCase().includes("credencial de discapacidad")) return null;
                // ── PROGRAMA PERSONALIZADO: renderizado genérico ──────────────
                if (esCustom) {
                  const reqArch = !!doc.requiereArchivo;
                  const reqTxt  = !!doc.requiereTexto;
                  const nomDoc  = (doc.nombre || "").toLowerCase();

                  // Detectar tipo especial por nombre
                  const esCedula    = nomDoc.includes("cedula") || nomDoc.includes("cédula") || nomDoc.includes("identidad");
                  const esAhorro    = nomDoc.includes("ahorro");
                  const esRsh       = nomDoc.includes("rsh") || nomDoc.includes("registro social");
                  const esIngreso   = nomDoc.includes("ingreso familiar") || nomDoc.includes("ingreso");
                  const esCorreo    = nomDoc.includes("correo") && nomDoc.includes("solicitante");

                  // Valor extra guardado en doc.valor como JSON cuando hay múltiples campos
                  const valObj = (() => { try { return doc.valor ? JSON.parse(doc.valor) : {}; } catch { return { raw: doc.valor }; } })();

                  const archivoOk = reqArch || esCedula || esAhorro ? !!doc.archivo || archivos.some(a => {
                    const key = nomDoc.replace(/\s/g,'').slice(0,6);
                    return a.toLowerCase().includes(key.slice(0,5));
                  }) : true;
                  const textoOk = reqTxt ? !!(doc.valor && doc.valor.trim()) : true;

                  // Validaciones específicas. Los archivos se suben solo en Carpeta de documentos;
                  // en Solicitudes activas se completan datos y se marca VB.
                  const cedulaOk    = true;
                  const ahorroOk    = esAhorro  ? !!(valObj.numeroCuenta || "").trim() : true;
                  const rshOk       = esRsh     ? !!(valObj.porcentaje || doc.valor || "").toString().trim() : true;
                  const ingresoOk   = esIngreso ? !!(valObj.monto || doc.valor || "").toString().trim() : true;
                  const correoOk    = esCorreo  ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((doc.valor || persona.email || "").trim()) : true;
                  const archivoReqOk = true;
                  const requisitosOk = archivoReqOk && textoOk && cedulaOk && ahorroOk && rshOk && ingresoOk && correoOk;

                  const bgColor    = doc.entregado ? "#ECFDF5" : requisitosOk ? "#FFFBEB" : "#FAFAFA";
                  const bordeColor = doc.entregado ? "#6EE7B7" : requisitosOk ? "#FCD34D" : "#e5e7eb";

                  const guardarValorYFicha = async (nuevoValor, campoFicha, valorFicha) => {
                    const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d, j) => j === i ? { ...d, valor: nuevoValor } : d) });
                    onSaveSolicitudes(nuevasSols);
                    await supabase.from("solicitudes").update({ documentos: nuevasSols.find(s=>s.id===sol.id).documentos }).eq("id", sol.id);
                    if (campoFicha && valorFicha !== undefined) {
                      const update = { [campoFicha]: valorFicha };
                      await supabase.from("personas").update(update).eq("id", persona.id);
                      onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, ...update } : p));
                    }
                  };

                  const marcarVB = async () => {
                    const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d, j) => j === i ? { ...d, entregado: true } : d) });
                    onSaveSolicitudes(nuevasSols);
                    await supabase.from("solicitudes").update({ documentos: nuevasSols.find(s=>s.id===sol.id).documentos }).eq("id", sol.id);
                  };

                  return (
                    <div key={i} style={{ borderRadius: 9, border: "1.5px solid " + bordeColor, background: bgColor, padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid " + (doc.entregado ? "#059669" : requisitosOk ? "#D97706" : "#D1D5DB"), background: doc.entregado ? "#059669" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, flexShrink: 0 }}>
                          {doc.entregado ? "✓" : ""}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: doc.entregado ? "#065f46" : "#374151" }}>{doc.nombre}</div>
                          {!doc.obligatorio && <div style={{ fontSize: 10, color: "#aaa" }}>Opcional</div>}
                          {requisitosOk && !doc.entregado && <div style={{ fontSize: 10, color: "#D97706", fontWeight: 700 }}>✓ Listo para marcar VB</div>}
                          {(reqArch || esCedula || esAhorro) && !doc.entregado && (
                            <div style={{ fontSize: 10, color: archivoOk ? "#059669" : "#B45309", marginTop: 2 }}>
                              {archivoOk ? "Archivo encontrado en carpeta de documentos" : "Sube el archivo en Carpeta de documentos y marca VB aquí"}
                            </div>
                          )}
                        </div>
                        {!doc.entregado && requisitosOk && (
                          <button onClick={marcarVB} style={{ padding: "4px 12px", borderRadius: 6, background: "#059669", color: "#fff", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓ VB</button>
                        )}
                      </div>

                      {!doc.entregado && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

                          {/* CÉDULA: el archivo se sube en Carpeta de documentos */}
                          {esCedula && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: archivoOk ? "#ECFDF5" : "#FFFBEB", borderRadius: 6, padding: "6px 12px", fontSize: 11, color: archivoOk ? "#059669" : "#B45309", fontWeight: 600 }}>
                              {archivoOk ? "✓ Archivo encontrado en carpeta" : "📁 Subir archivo en Carpeta de documentos"}
                            </div>
                          )}

                          {/* AHORRO: número de cuenta; archivo solo en Carpeta de documentos */}
                          {esAhorro && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: archivoOk ? "#ECFDF5" : "#FFFBEB", borderRadius: 6, padding: "6px 12px", fontSize: 11, color: archivoOk ? "#059669" : "#B45309", fontWeight: 600 }}>
                                {archivoOk ? "✓ Comprobante encontrado en carpeta" : "📁 Subir comprobante en Carpeta de documentos"}
                              </div>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input value={valObj.numeroCuenta || ""} placeholder="N° de cuenta de ahorro"
                                  onChange={async e => {
                                    const numeroCuenta = e.target.value;
                                    const nuevo = JSON.stringify({ ...valObj, numeroCuenta });
                                    await guardarValorYFicha(nuevo, "numero_cuenta_ahorro", numeroCuenta);
                                    if (numeroCuenta.trim()) await marcarVB();
                                  }}
                                  style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
                                {!(valObj.numeroCuenta||"").trim() && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa N° de cuenta</div>}
                              </div>
                            </div>
                          )}

                          {/* RSH: ingresar porcentaje */}
                          {esRsh && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input value={valObj.porcentaje || doc.valor || ""} placeholder="% RSH (ej: 45)"
                                onChange={async e => {
                                  const v = e.target.value.replace(/[^0-9.]/g, "");
                                  await guardarValorYFicha(v, "puntajeRSH", v);
                                }}
                                style={{ width: 100, padding: "5px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
                              <span style={{ fontSize: 11, color: "#555" }}>%</span>
                              {!(valObj.porcentaje || doc.valor || "").toString().trim() && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa el porcentaje RSH</div>}
                            </div>
                          )}

                          {/* INGRESO FAMILIAR: ingresar monto en UF */}
                          {esIngreso && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input value={valObj.monto || doc.valor || ""} placeholder="Monto ingreso familiar (UF)"
                                onChange={async e => {
                                  const v = e.target.value.replace(/[^0-9.]/g, "");
                                  await guardarValorYFicha(v, "ingreso_familiar_uf", v);
                                }}
                                style={{ width: 160, padding: "5px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
                              <span style={{ fontSize: 11, color: "#555" }}>UF</span>
                              {!(valObj.monto || doc.valor || "").toString().trim() && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa el ingreso familiar en UF</div>}
                            </div>
                          )}

                          {/* CORREO: obligatorio y sincronizado a ficha */}
                          {esCorreo && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input value={doc.valor || persona.email || ""} placeholder="correo@ejemplo.cl"
                                onChange={async e => {
                                  const v = e.target.value.trim();
                                  await guardarValorYFicha(v, "email", v);
                                  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) await marcarVB();
                                }}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
                              {!correoOk && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa correo válido</div>}
                            </div>
                          )}

                          {/* Documento genérico con archivo: se sube en Carpeta de documentos */}
                          {reqArch && !esCedula && !esAhorro && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: archivoOk ? "#ECFDF5" : "#FFFBEB", borderRadius: 6, padding: "6px 12px", fontSize: 11, color: archivoOk ? "#059669" : "#B45309" }}>
                              {archivoOk ? "✓ Archivo encontrado en carpeta" : "📁 Subir archivo en Carpeta de documentos"}
                            </div>
                          )}

                          {/* Texto adicional genérico */}
                          {reqTxt && !esRsh && !esIngreso && !esAhorro && !esCorreo && (
                            <div style={{ display: "flex", gap: 5 }}>
                              <input value={doc.valor || ""} placeholder={doc.etiquetaTexto || "Ingresar valor..."}
                                onChange={e => guardarValorYFicha(e.target.value, null, null)}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
                            </div>
                          )}

                          {/* Solo checkbox */}
                          {!reqArch && !reqTxt && !esCedula && !esAhorro && !esRsh && !esIngreso && !esCorreo && (
                            <button onClick={marcarVB} style={{ marginTop: 2, padding: "4px 12px", borderRadius: 6, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 11, cursor: "pointer" }}>Marcar VB</button>
                          )}

                        </div>
                      )}
                    </div>
                  );
                }
                // ── FIN PROGRAMA PERSONALIZADO ────────────────────────────────

                // Ocultar documentos obsoletos o duplicados (preservando índice original para updates)
                if (sol.programaId === "csp_urbano") {
                  const n = (doc.nombre || "").toLowerCase();
                  if (n.includes("fecha de nacimiento")) return null;
                }
                if (sol.programaId === "csp_rural") {
                  const n = (doc.nombre||"").toLowerCase();
                  if (n.includes("fecha de nacimiento")) return null;
                  if (n.includes("titulo de dominio") || n.includes("título de dominio")) return null;
                }
                // Detectar tipo especial por nombre (independiente del campo tipo)
                const nom = doc.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const tipoReal = doc.tipo ||
                  (nom.includes("boleta de luz") || nom.includes("suministro electrico") || nom.includes("suministro electrico") || nom.includes("electrico") ? "luz" :
                   nom.includes("boleta de agua") || nom.includes("agua potable") || nom.includes("agua (apr") ? "agua" :
                   nom.includes("credencial de discapacidad") ? "discapacidad" : null);

                const opcionesReal = doc.opciones ||
                  (tipoReal === "luz" ? ["FRONTEL", "CODINER", "CGE"] :
                   tipoReal === "agua" ? ["Aguas Araucania", "Aguas San Isidro", "APR", "Pozo"] :
                   tipoReal === "discapacidad" ? ["Con discapacidad", "Sin discapacidad"] : null);

                const esEspecial = !!tipoReal;
                const opSel = doc.opcionSeleccionada || null;
                const sinOpcion = esEspecial && !opSel;
                const docTieneArchivo = !!(doc.archivo || doc.storagePath || doc.archivoData);

                const necesitaArchivo = esEspecial && (
                  (tipoReal === "luz" && opSel && opSel !== "Sin empalme") ||
                  (tipoReal === "agua" && opSel && opSel !== "Pozo") ||
                  (tipoReal === "discapacidad" && opSel === "Con discapacidad")
                );

                // Documentos con respaldo en archivo. La carga se realiza en Carpeta de documentos;
                // desde Solicitudes activas solo se revisan datos y se marca VB.
                const esDocArchivo = !esEspecial && doc.nombre && (
                  doc.nombre.toLowerCase().includes("cedula") ||
                  doc.nombre.toLowerCase().includes("título") ||
                  doc.nombre.toLowerCase().includes("titulo") ||
                  doc.nombre.toLowerCase().includes("avaluo") ||
                  doc.nombre.toLowerCase().includes("dominio") ||
                  doc.nombre.toLowerCase().includes("derecho real") ||
                  doc.nombre.toLowerCase().includes("escritura") ||
                  (esCsp && doc.nombre.toLowerCase().includes("ruralidad")) ||
                  (esCsp && doc.nombre.toLowerCase().includes("informaciones previas")) ||
                  (esCsp && doc.nombre.toLowerCase().includes("vivienda") && !doc.nombre.toLowerCase().includes("ahorro"))
                );
                // Verificar si ya tiene archivo en la carpeta
                const tieneArchivo = docTieneArchivo || archivos.some(a => {
                  const al = a.toLowerCase();
                  const dn = doc.nombre.toLowerCase();
                  if (dn.includes("cedula")) return al.includes("cedula") || al.includes("rut") || al.includes("ci");
                  if (dn.includes("avaluo")) return al.includes("avaluo") || al.includes("avalúo");
                  if (dn.includes("dominio") || dn.includes("derecho real") || dn.includes("escritura"))
                    return al.includes("escritura") || al.includes("dru") || al.includes("titulo") || al.includes("dominio") || al.includes("goce") || al.includes("usufructo");
                  if (dn.includes("ruralidad")) return al.includes("ruralidad") || al.includes("rural");
                  if (dn.includes("informaciones previas")) return al.includes("informaciones") || al.includes("previas");
                  if (dn.includes("vivienda")) return al.includes("vivienda");
                  if (dn.includes("cuenta de ahorro")) return al.includes("ahorro") || al.includes("cuenta") || al.includes("cartola");
                  return false;
                });

                // Para documentos especiales, detectar archivo si ya existe en carpeta.
                const tieneArchivoEspecial = esEspecial && (docTieneArchivo || archivos.some(a => {
                  const al = a.toLowerCase();
                  if (tipoReal === "luz") return al.includes("luz") || al.includes("boleta") || al.includes("empalme") || al.includes("frontel") || al.includes("codiner") || al.includes("cge");
                  if (tipoReal === "agua") return al.includes("agua") || al.includes("arranque") || al.includes("apr") || al.includes("san isidro") || al.includes("araucania") || al.includes("pozo");
                  if (tipoReal === "discapacidad") return al.includes("discapacidad") || al.includes("credencial");
                  return false;
                }));

                // Documentos CSP con lógica propia
                const esRsh = esCsp && nom.includes("registro social de hogares");
                const esFechaNac = esCsp && nom.includes("fecha de nacimiento");
                const esSinDiscapacidad = tipoReal === "discapacidad" && opSel === "Sin discapacidad";
                const esConDiscapacidad = tipoReal === "discapacidad" && opSel === "Con discapacidad";
                const esConArranque = esCsp && tipoReal === "agua" && opSel && opSel !== "Pozo";
                const esCertRuralidad = esCsp && nom.includes("certificado de ruralidad");
                const esCuentaAhorro = esCsp && nom.includes("cuenta de ahorro");
                const esTituloDominio = !esEspecial && (
                  nom.includes("titulo de dominio") ||
                  nom.includes("título de dominio") ||
                  nom.includes("derecho real") ||
                  nom.includes("goce de tierra")
                );
                // "Dominio de la propiedad" (nuevo en CSP Rural, reemplaza Título de dominio)
                const esDominioProp = !esTituloDominio && (nom.includes("dominio de la propiedad") || nom.includes("escritura completa"));
                const esLuz = esCsp && tipoReal === "luz";
                const luzPartes = esLuz ? (doc.valor || "").split("|") : [];
                const proveedorLuz = luzPartes[0] || "";
                const nClienteLuz = luzPartes[1] || "";
                const esCedula = esCsp && nom.includes("cedula");
                const esAvaluo = esCsp && nom.includes("avaluo");
                const esInfoPrevias = esCsp && nom.includes("informaciones previas");
                const esAntecedentesVivienda = esCsp && (nom.includes("antecedentes de la vivienda") || nom.includes("certificado de la vivienda"));
                const esCorreoSolicitante = nom.includes("correo") && nom.includes("solicitante");
                const esTelefonoContacto = esCsp && nom.includes("telefono");

                // Tipo de dominio: "DV" | "DRU" | "Usufructo" | "Goce con resolución" | "Goce sin resolución" | "Otro|descripción"
                const tituloPartes = esTituloDominio ? (doc.valor || "").split("|") : [];
                const tituloTipo = tituloPartes[0] || "";
                const tituloDesc = tituloPartes[1] || "";
                const tituloFjs = tituloPartes[2] || "";
                const tituloNumero = tituloPartes[3] || "";
                const tituloAnio = tituloPartes[4] || "";

                // Dominio de la propiedad: "tipo|descripcion|fjs|numero|anio"
                const dominioPartes = esDominioProp ? (doc.valor || "").split("|") : [];
                const dominioTipo = dominioPartes[0] || "";
                const dominioDesc = dominioPartes[1] || "";
                const dominioFjs = dominioPartes[2] || "";
                const dominioNumero = dominioPartes[3] || "";
                const dominioAnio = dominioPartes[4] || "";
                const resumenDominioPropiedad = (tipo, desc, fjs, numero, anio) => {
                  const base = tipo === "Otro" && desc ? "Otro: " + desc.trim() : tipo;
                  const detalle = [
                    fjs ? "Fjs: " + fjs.trim() : "",
                    numero ? "N°: " + numero.trim() : "",
                    anio ? "Año: " + anio.trim() : "",
                  ].filter(Boolean).join(", ");
                  return [base, detalle].filter(Boolean).join(" - ");
                };

                // Cédula CSP: "rut|fechaNacimiento" — auto-rellena RUT del solicitante
                const cedPartes = esCedula ? (doc.valor || "").split("|") : [];
                const cedRut = cedPartes[0] || persona.rut || "";
                // Normalizar fecha a YYYY-MM-DD para el input type="date"
                const _rawFecha = cedPartes[1] || persona.fechaNacimiento || "";
                const cedFecha = (() => {
                  if (!_rawFecha) return "";
                  // Si viene como DD/MM/YYYY → convertir a YYYY-MM-DD
                  if (/^\d{2}\/\d{2}\/\d{4}$/.test(_rawFecha)) {
                    const [d, m, y] = _rawFecha.split("/");
                    return y + "-" + m + "-" + d;
                  }
                  return _rawFecha; // ya es YYYY-MM-DD
                })();
                const cedRutValido = rutFormatoChilenoValido(cedRut);
                const cedCompleto = !!(cedRutValido && cedFecha.trim());
                // Compatibilidad backward (código que usa cedulaRut)
                const cedulaRut = cedRut;

                const correoSolicitante = esCorreoSolicitante ? (doc.valor || persona.email || "").trim() : "";
                const correoCompleto = esCorreoSolicitante ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoSolicitante) : true;

                // Certificado de ruralidad: "numero|YYYY-MM-DD"
                const certRuralPartes = esCertRuralidad ? (doc.valor || "").split("|") : [];
                const certRuralNum = certRuralPartes[0] || "";
                const certRuralFecha = certRuralPartes[1] || "";
                const certRuralCompleto = !!(certRuralNum.trim() && certRuralFecha.trim());

                // Avalúo: doc.valor = "rol|valor$|coordenadas"
                const avaluoPartes = esAvaluo ? (doc.valor || "").split("|") : [];
                const avaluoRol = avaluoPartes[0] || "";
                const avaluoValor = formatPesosChilenos(avaluoPartes[1] || "");
                const avaluoCoordenadas = avaluoPartes[2] || "";
                const avaluoRolPartes = avaluoRol.split("-");
                const avaluoRolPrimero = avaluoRolPartes[0] || "";
                const avaluoRolSegundo = avaluoRolPartes.slice(1).join("-") || "";
                const armarRolAvaluo = (primero, segundo) => [primero, segundo].map(x => x.trim()).filter(Boolean).join("-");
                const avaluoCompleto = !!(avaluoRol.trim() && avaluoValor.trim());

                // Informaciones previas: doc.valor = "numero|año"
                const infoPartes = esInfoPrevias ? (doc.valor || "").split("|") : [];
                const infoNumero = infoPartes[0] || "";
                const infoAnio = infoPartes[1] || "";
                const infoCompleto = !!(infoNumero.trim() && infoAnio.trim());

                // Antecedentes de la vivienda: CSP urbano usa N/A o N°/fecha; Ampliación guarda permiso, recepción y m2.
                const antecPartes = esAntecedentesVivienda ? (doc.valor || "").split("|") : [];
                const antecNumero = antecPartes[0] || "";
                const antecAnio = antecPartes[1] || "";
                const antecRecepcionNumero = antecPartes[2] || "";
                const antecRecepcionFecha = antecPartes[3] || "";
                const antecM2 = antecPartes[4] || "";
                const antecEsNA = esAntecedentesVivienda && antecNumero.trim() === "N/A";
                const antecSeleccionSi = esAntecedentesVivienda && antecNumero.trim() === "__SI__";
                const antecNumeroVisible = antecSeleccionSi ? "" : antecNumero;
                const antecOpcion = antecEsNA ? "NA" : (antecSeleccionSi || antecNumero.trim() || antecAnio.trim() ? "SI" : "");
                const antecCompleto = esAmpliacion
                  ? !!(antecNumero.trim() && antecAnio.trim() && antecRecepcionNumero.trim() && antecRecepcionFecha.trim() && antecM2.trim())
                  : antecEsNA || !!(antecNumeroVisible.trim() && antecAnio.trim());

                // Documentos de trámite Desmarque: "numero|YYYY-MM-DD"
                const esInformeDOM = !esCsp && doc.nombre && doc.nombre.includes("Informe DOM");
                const esMemoDOM    = !esCsp && doc.nombre && doc.nombre.includes("Memo DOM");
                const esCartaServiu= !esCsp && doc.nombre && doc.nombre.includes("Carta SERVIU");
                const esTramite    = esInformeDOM || esMemoDOM || esCartaServiu;
                const tramitePartes= esTramite ? (doc.valor || "").split("|") : [];
                const tramiteNum   = tramitePartes[0] || "";
                const tramiteFecha = tramitePartes[1] || "";
                const tramiteCompleto = !!(tramiteNum.trim() && tramiteFecha.trim());

                // Valores APR: "nombreAPR|nServicio" en doc.valor
                const aprPartes = esConArranque ? (doc.valor || "").split("|") : [];
                const aprNombre = aprPartes[0] || "";
                const aprServicio = aprPartes[1] || "";
                const aprCompleto = !!(aprNombre.trim() && aprServicio.trim());

                // Valores discapacidad con folio: "folio|movilidad" en doc.valor
                const discPartes = esConDiscapacidad ? (doc.valor || "").split("|") : [];
                const discFolio = discPartes[0] || "";
                const discMovilidad = discPartes[1] || "";
                const discCompleto = !!(discFolio.trim() && discMovilidad);

                // Valores cuenta ahorro: "cuenta|banco|ok" en doc.valor (se conserva compatibilidad con registros antiguos)
                const cuentaPartes = esCuentaAhorro ? (doc.valor || "").split("|") : [];
                const cuentaNum = cuentaPartes[0] || "";
                const cuentaBanco = cuentaPartes[1] || "";
                const tieneArchivoCuenta = esCuentaAhorro && (cuentaPartes[2] === "ok" || docTieneArchivo || archivos.some(a => { const al = a.toLowerCase(); return al.includes("ahorro") || al.includes("cuenta") || al.includes("cartola"); }));

                // Valores RSH: "pct|comuna|estadoCivil|integrantes|subsidio|credencialDiscapacidad|movilidadReducida|dormitorios|integrantesNucleo"
                const rshPartes = esRsh ? (doc.valor || "").split("|") : [];
                const rshPct = rshPartes[0] || "";
                const rshComuna = rshPartes[1] || "";
                const rshEstCivil = rshPartes[2] || "";
                const rshIntegrantes = rshPartes[3] || "";
                const rshSubsidio = rshPartes[4] || "";
                const rshDiscapacidad = rshPartes[5] || "";
                const rshMovilidad = rshPartes[6] || "";
                const rshDormitorios = rshPartes[7] || "";
                const rshIntegrantesNucleo = rshPartes[8] || "";
                const rshComunaEsLautaro = rshComuna.trim().toUpperCase() === "LAUTARO";
                const rshComunaEsOtra = rshComuna.startsWith("OTRA: ");
                const rshOtraComuna = rshComunaEsOtra ? rshComuna.replace(/^OTRA:\s*/, "") : "";
                const rshComunaLista = rshComunaEsLautaro || (rshComunaEsOtra && rshOtraComuna.trim());
                const rshDiscapacidadCompleta = rshDiscapacidad === "N/A" || !!(rshDiscapacidad.trim() && rshMovilidad.trim());
                const rshCompleto = esAmpliacion
                  ? !!(rshPct.trim() && rshEstCivil.trim() && rshIntegrantes.trim() && rshDiscapacidadCompleta && rshDormitorios.trim() && rshIntegrantesNucleo.trim())
                  : esMave
                  ? !!(rshPct.trim() && rshEstCivil.trim() && rshIntegrantes.trim() && rshDiscapacidadCompleta)
                  : !!(rshPct.trim() && rshComunaLista && rshEstCivil.trim() && rshIntegrantes.trim() && rshSubsidio.trim() && rshDiscapacidadCompleta);
                const setRsh = (idx, val) => {
                  const p = [rshPct, rshComuna, rshEstCivil, rshIntegrantes, rshSubsidio, rshDiscapacidad, rshMovilidad, rshDormitorios, rshIntegrantesNucleo];
                  p[idx] = val;
                  const newValor = p.join("|");
                  const discCompleta = p[5] === "N/A" || !!(p[5].trim() && p[6].trim());
                  const completo = esAmpliacion
                    ? p[0].trim() && p[2].trim() && p[3].trim() && discCompleta && p[7].trim() && p[8].trim()
                    : esMave
                    ? p[0].trim() && p[2].trim() && p[3].trim() && discCompleta
                    : p[0].trim() && p[1].trim() && p[2].trim() && p[3].trim() && p[4].trim() && discCompleta;
                  const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : {
                    ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor, entregado: !!completo })
                  });
                  onSaveSolicitudes(nuevasSols);
                  const solActualizada = nuevasSols.find(s => s.id === sol.id);
                  if (solActualizada) supabase.from("solicitudes").update({ documentos: solActualizada.documentos }).eq("id", sol.id);
                };
                const setRshMultiple = (updates) => {
                  const p = [rshPct, rshComuna, rshEstCivil, rshIntegrantes, rshSubsidio, rshDiscapacidad, rshMovilidad, rshDormitorios, rshIntegrantesNucleo];
                  Object.entries(updates).forEach(([idx, val]) => { p[Number(idx)] = val; });
                  const newValor = p.join("|");
                  const discCompleta = p[5] === "N/A" || !!(p[5].trim() && p[6].trim());
                  const completo = esAmpliacion
                    ? p[0].trim() && p[2].trim() && p[3].trim() && discCompleta && p[7].trim() && p[8].trim()
                    : esMave
                    ? p[0].trim() && p[2].trim() && p[3].trim() && discCompleta
                    : p[0].trim() && p[1].trim() && p[2].trim() && p[3].trim() && p[4].trim() && discCompleta;
                  const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : {
                    ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor, entregado: !!completo })
                  });
                  onSaveSolicitudes(nuevasSols);
                  const solActualizada = nuevasSols.find(s => s.id === sol.id);
                  if (solActualizada) supabase.from("solicitudes").update({ documentos: solActualizada.documentos }).eq("id", sol.id);
                };

                // Tooltip según el motivo del bloqueo
                const tooltipBloqueado = esRsh ? "Ingresa el RSH primero"
                  : esFechaNac ? "Ingresa la fecha primero"
                  : esTituloDominio && !tituloTipo ? "Selecciona el tipo de dominio primero"
                  : esDominioProp && !dominioTipo ? "Selecciona el tipo de dominio primero"
                  : esCedula && !cedCompleto ? "Ingresa cédula chilena válida con puntos, guion, dígito verificador y fecha de nacimiento"
                  : esCertRuralidad && !certRuralCompleto ? "Ingresa N° y fecha del certificado primero"
                  : esAvaluo && !avaluoCompleto ? "Ingresa rol y valor de avalúo primero"
                  : esInfoPrevias && !infoCompleto ? "Ingresa N° y fecha del documento primero"
                  : esAntecedentesVivienda && !antecCompleto ? (esAmpliacion ? "Ingresa permiso, recepción y m2 primero" : "Ingresa N° y fecha del certificado primero")
                  : esCorreoSolicitante && !correoCompleto ? "Ingresa correo electrónico válido"
                  : esTelefonoContacto && !(doc.valor || "").trim() ? "Ingresa teléfono de contacto"
                  : esLuz && !nClienteLuz.trim() ? "Ingresa el N° de cliente de electricidad primero"
                  : "Completa los datos requeridos primero";

                // Checkbox bloqueado solo si faltan datos requeridos. Los archivos se suben en Carpeta de documentos.
                const bloqueadoPorArchivo =
                  (esCedula && !cedCompleto && !doc.entregado) ||
                  (esCertRuralidad && !certRuralCompleto && !doc.entregado) ||
                  (esDominioProp && !dominioTipo && !doc.entregado) ||
                  (esAvaluo && !avaluoCompleto && !doc.entregado) ||
                  (esInfoPrevias && !infoCompleto && !doc.entregado) ||
                  (esAntecedentesVivienda && !antecCompleto && !doc.entregado) ||
                  (esCorreoSolicitante && !correoCompleto && !doc.entregado) ||
                  (esTelefonoContacto && !(doc.valor || "").trim() && !doc.entregado) ||
                  (esTituloDominio && !tituloTipo && !doc.entregado) ||
                  (esLuz && !nClienteLuz.trim() && !doc.entregado) ||
                  (esRsh && !rshCompleto && !doc.entregado) ||
                  (esFechaNac && !(doc.valor || "").trim() && !doc.entregado) ||
                  (esConArranque && !aprCompleto && !doc.entregado) ||
                  (esConDiscapacidad && !discCompleto && !doc.entregado) ||
                  (esCuentaAhorro && (!cuentaNum.trim() || !cuentaBanco.trim()) && !doc.entregado);

                const bordeColor = doc.entregado ? "#BBF7D0" : sinOpcion ? "#FDE68A" : doc.obligatorio ? "#FED7D7" : "#E5E7EB";
                const bgColor = doc.entregado ? "#F0FDF4" : sinOpcion ? "#FFFBEB" : doc.obligatorio ? "#FFF5F5" : "#FAFAFA";
                const nombreVisibleDoc = esAntecedentesVivienda ? "Certificados de antecedentes de la vivienda" : doc.nombre;

                return (
                  <div key={i} style={{ borderRadius: 9, border: "1.5px solid " + bordeColor, background: bgColor, padding: "10px 14px" }}>
                    {/* Fila superior: checkbox + nombre */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: (esEspecial || esRsh || esFechaNac || esTelefonoContacto) ? 8 : 0,
                      cursor: bloqueadoPorArchivo ? "not-allowed" : (!esEspecial && !esRsh && !esFechaNac && !esTelefonoContacto ? "pointer" : "default") }}
                      onClick={() => {
                        if (bloqueadoPorArchivo) return;
                        if (!esEspecial && !esDocArchivo && !esRsh && !esFechaNac && !esTelefonoContacto) {
                          toggleDoc(sol.id, i);
                        }
                        if (esDocArchivo && !doc.entregado) {
                          if (sol.programaId === "csp_urbano") return; // CSP Urbano: VB solo via botón "Marcar VB ✓"
                          marcarDocEntregado(sol.id, i, true);
                        }
                        if (esCsp && esEspecial && !doc.entregado && (!esLuz || !!nClienteLuz.trim())) marcarDocEntregado(sol.id, i, true);
                      }}>
                      {esSinDiscapacidad ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", flexShrink: 0 }}>N/A</span>
                      ) : (
                        <div title={bloqueadoPorArchivo ? tooltipBloqueado : ""} style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid " + (doc.entregado ? "#059669" : bloqueadoPorArchivo ? "#9ca3af" : "#D1D5DB"), background: doc.entregado ? "#059669" : bloqueadoPorArchivo ? "#f3f4f6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0, fontSize: 13, opacity: bloqueadoPorArchivo ? 0.5 : 1 }}>
                          {doc.entregado ? "✓" : ""}
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: doc.entregado ? "#065f46" : "#374151", fontWeight: 600 }}>{nombreVisibleDoc}</div>
                        {bloqueadoPorArchivo && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{tooltipBloqueado}</div>}
                        {doc.etiqueta && !esSinDiscapacidad && <div style={{ fontSize: 12, fontWeight: 800, color: "#059669", marginTop: 2 }}>{doc.etiqueta}</div>}
                        {esSinDiscapacidad && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>Sin discapacidad — no requiere documento</div>}
                        {!doc.obligatorio && !opSel && !bloqueadoPorArchivo && <div style={{ fontSize: 10, color: "#aaa" }}>Opcional</div>}
                      </div>
                    </div>

                    {/* Botones de opción para docs especiales — siempre visibles */}
                    {esEspecial && opcionesReal && (
                      <div style={{ display: "flex", gap: 6, marginBottom: esLuz ? 6 : 4 }}>
                        {opcionesReal.map((op, oi) => (
                          <button key={oi} onClick={async () => {
                            await setDocOpcion(sol.id, i, op, tipoReal);
                            if (esCsp && tipoReal === "agua" && op === "Pozo") await syncPersona({ sistemaAgua: "Pozo", nServicioAgua: "N/A" });
                            if (esCsp && tipoReal === "agua" && op !== "Pozo") await syncPersona({ sistemaAgua: op });
                            if (esCsp && tipoReal === "luz" && op !== "Sin empalme") await syncPersona({ proveedorElectrico: op });
                            if (tipoReal === "discapacidad" && op === "Sin discapacidad") await syncPersona({ discapacidad: "N/A", movilidadReducida: "N/A", credencialDiscapacidad: "N/A" });
                            if (tipoReal === "discapacidad" && op === "Con discapacidad") await syncPersona({ discapacidad: "S", movilidadReducida: "", credencialDiscapacidad: "" });
                          }}
                            style={{
                              flex: 1, padding: "6px 4px", borderRadius: 6,
                              border: "2px solid " + (opSel === op ? "#1e3a5f" : "#ddd"),
                              background: opSel === op ? "#1e3a5f" : "#fff",
                              color: opSel === op ? "#fff" : "#555",
                              fontSize: 11, fontWeight: 700, cursor: "pointer", textAlign: "center"
                            }}>
                            {oi + 1}. {op}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Selector proveedor eléctrico + N° cliente (Boleta de luz CSP) */}
                    {esLuz && (
                      <div style={{ display: "grid", gap: 5, marginBottom: 4 }}>
                        <input type="text" placeholder="N° de cliente electricidad (obligatorio)" value={nClienteLuz}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const val = e.target.value;
                            const newValor = proveedorLuz + "|" + val;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (val.trim()) await syncPersona({ nClienteElectricidad: val.trim() });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (nClienteLuz.trim() ? "#059669" : "#DC2626"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {!nClienteLuz.trim() && <div style={{ fontSize: 10, color: "#B45309", marginTop: 1 }}>⚠ Ingresa el N° de cliente para habilitar el VB</div>}
                        <select value={proveedorLuz} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const val = e.target.value;
                            const newValor = val + "|" + nClienteLuz;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (val) await syncPersona({ proveedorElectrico: val });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (proveedorLuz ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }}>
                          <option value="">Seleccionar proveedor eléctrico…</option>
                          {["CODINER","FRONTEL","CGE"].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        {proveedorLuz && <div style={{ fontSize: 10, color: "#059669", marginTop: 2 }}>✓ Proveedor: {proveedorLuz}</div>}
                      </div>
                    )}

                    {/* Campos RSH: porcentaje, comuna, estado civil, integrantes, subsidio anterior */}
                    {esRsh && (
                      <div style={{ display: "grid", gap: 5, marginBottom: 4 }}>
                        <input type="text" placeholder="Porcentaje RSH (ej: 65%)" value={rshPct}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const val = e.target.value;
                            setRsh(0, val);
                            if (val.trim()) {
                              const ahorro = calcularAhorro(val);
                              await syncPersona({ puntajeRSH: val.trim(), ...(ahorro ? { ahorroPostular: ahorro } : {}) });
                            }
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (rshPct.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={async e => {
                            e.stopPropagation();
                            setRsh(1, "LAUTARO");
                            await syncPersona({ comuna: "LAUTARO" });
                          }}
                            style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: "2px solid " + (rshComunaEsLautaro ? "#1e3a5f" : "#ddd"), background: rshComunaEsLautaro ? "#1e3a5f" : "#fff", color: rshComunaEsLautaro ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            LAUTARO
                          </button>
                          <button onClick={e => {
                            e.stopPropagation();
                            setRsh(1, rshComunaEsOtra ? rshComuna : "OTRA: ");
                          }}
                            style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: "2px solid " + (rshComunaEsOtra ? "#1e3a5f" : "#ddd"), background: rshComunaEsOtra ? "#1e3a5f" : "#fff", color: rshComunaEsOtra ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            Otra comuna
                          </button>
                        </div>
                        {rshComunaEsOtra && (
                          <input type="text" placeholder="Completa nombre de la comuna" value={rshOtraComuna}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const val = e.target.value;
                              setRsh(1, "OTRA: " + val);
                              if (val.trim()) await syncPersona({ comuna: val.trim() });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (rshOtraComuna.trim() ? "#059669" : "#DC2626"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        )}
                        {rshComunaEsOtra && !rshOtraComuna.trim() && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Completa el nombre de la comuna para habilitar el VB</div>}
                        <select value={rshEstCivil} onClick={e => e.stopPropagation()}
                          onChange={async e => { setRsh(2, e.target.value); if (e.target.value) await syncPersona({ estadoCivil: e.target.value }); }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (rshEstCivil ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }}>
                          <option value="">Estado civil…</option>
                          {["SOLTERO/A","CASADO/A","CONVIVIENTE CIVIL","DIVORCIADO/A","VIUDO/A"].map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input type="number" min="1" placeholder="N° integrantes grupo familiar" value={rshIntegrantes}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => { setRsh(3, e.target.value); if (e.target.value.trim()) await syncPersona({ integrantesFamiliares: e.target.value.trim() }); }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (rshIntegrantes.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <div style={{ fontSize: 10, color: "#6b7280" }}>Subsidio anterior:</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {["S","N"].map(op => (
                            <button key={op} onClick={async e => { e.stopPropagation(); setRsh(4, op); await syncPersona({ subsidioAnterior: op }); }}
                              style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: "2px solid " + (rshSubsidio === op ? "#1e3a5f" : "#ddd"), background: rshSubsidio === op ? "#1e3a5f" : "#fff", color: rshSubsidio === op ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                              {op === "S" ? "S — Sí" : "N — No"}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize: 10, color: "#6b7280" }}>Discapacidad:</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={async e => { e.stopPropagation(); setRshMultiple({ 5: "N/A", 6: "N/A" }); await syncPersona({ discapacidad: "N/A", credencialDiscapacidad: "N/A", movilidadReducida: "N/A" }); }}
                            style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: "2px solid " + (rshDiscapacidad === "N/A" ? "#1e3a5f" : "#ddd"), background: rshDiscapacidad === "N/A" ? "#1e3a5f" : "#fff", color: rshDiscapacidad === "N/A" ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            No — N/A
                          </button>
                          <button onClick={async e => { e.stopPropagation(); setRshMultiple({ 5: rshDiscapacidad === "N/A" ? "" : rshDiscapacidad, 6: rshDiscapacidad === "N/A" ? "" : rshMovilidad }); await syncPersona({ discapacidad: "S" }); }}
                            style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: "2px solid " + (rshDiscapacidad && rshDiscapacidad !== "N/A" ? "#1e3a5f" : "#ddd"), background: rshDiscapacidad && rshDiscapacidad !== "N/A" ? "#1e3a5f" : "#fff", color: rshDiscapacidad && rshDiscapacidad !== "N/A" ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            Sí
                          </button>
                        </div>
                        {rshDiscapacidad !== "N/A" && (
                          <>
                            <input type="text" placeholder="N° credencial discapacidad" value={rshDiscapacidad}
                              onClick={e => e.stopPropagation()}
                              onChange={async e => { setRsh(5, e.target.value); if (e.target.value.trim()) await syncPersona({ discapacidad: "S", credencialDiscapacidad: e.target.value.trim() }); }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (rshDiscapacidad.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            <div style={{ fontSize: 10, color: "#6b7280" }}>Movilidad reducida:</div>
                            <div style={{ display: "flex", gap: 6 }}>
                              {["SI","NO"].map(op => (
                                <button key={op} onClick={async e => { e.stopPropagation(); setRsh(6, op); await syncPersona({ movilidadReducida: op }); }}
                                  style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: "2px solid " + (rshMovilidad === op ? "#1e3a5f" : "#ddd"), background: rshMovilidad === op ? "#1e3a5f" : "#fff", color: rshMovilidad === op ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                  {op}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {esAmpliacion && (
                          <>
                            <div style={{ fontSize: 10, color: "#6b7280" }}>Hacinamiento:</div>
                            <input type="number" min="0" placeholder="N° dormitorios" value={rshDormitorios}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setRsh(7, e.target.value)}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (rshDormitorios.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            <input type="number" min="1" placeholder="Integrantes del núcleo familiar" value={rshIntegrantesNucleo}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setRsh(8, e.target.value)}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (rshIntegrantesNucleo.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                          </>
                        )}
                        {!rshCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Completa todos los campos para habilitar el VB</div>}
                      </div>
                    )}

                    {/* Campo fecha de nacimiento */}
                    {esFechaNac && (() => {
                      const fechaValor = /^\d{4}-\d{2}-\d{2}$/.test(doc.valor || "") ? doc.valor : "";
                      const guardarFecha = async (fechaCompleta) => {
                        setDocValor(sol.id, i, fechaCompleta);
                        if (fechaCompleta) {
                          const am = textoAdultoMayor(fechaCompleta);
                          await supabase.from("personas").update({ fecha_nacimiento: fechaCompleta, adultomayor: am }).eq("id", persona.id);
                          onSavePersonas(personas.map(p => p.id===persona.id ? {...p, fechaNacimiento: fechaCompleta, adultoMayor: am} : p));
                        }
                      };
                      return (
                      <div style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 3, textTransform: "uppercase" }}>Fecha de nacimiento</div>
                        <input type="date" value={fechaValor}
                          onClick={e => e.stopPropagation()}
                          onChange={e => guardarFecha(e.target.value)}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (fechaValor ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {!doc.valor && <div style={{ fontSize: 10, color: "#B45309", marginTop: 3 }}>⚠ Ingresa la fecha para habilitar el VB</div>}
                        {fechaValor && <div style={{ fontSize: 10, color: "#059669", marginTop: 3 }}>✓ {fmtFecha(fechaValor)}</div>}
                      </div>
                      );
                    })()}

                    {/* Inputs APR (Con arranque) */}
                    {esConArranque && (
                      <div style={{ display: "grid", gap: 5, marginBottom: 4 }}>
                        <input type="text" placeholder="Nombre Empresa Sanitaria" value={aprNombre} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = e.target.value + "|" + aprServicio;
                            const completo = e.target.value.trim() && aprServicio.trim();
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (e.target.value.trim()) await syncPersona({ sistemaAgua: e.target.value.trim() });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (aprNombre.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <input type="text" placeholder="N° de servicio agua" value={aprServicio} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = aprNombre + "|" + e.target.value;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (e.target.value.trim()) await syncPersona({ nServicioAgua: e.target.value.trim() });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (aprServicio.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {!aprCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Completa nombre empresa sanitaria y N° servicio</div>}
                      </div>
                    )}

                    {/* Inputs discapacidad Con discapacidad */}
                    {esConDiscapacidad && (
                      <div style={{ display: "grid", gap: 5, marginBottom: 4 }}>
                        <input type="text" placeholder="N° de folio credencial" value={discFolio} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = e.target.value + "|" + discMovilidad;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (e.target.value.trim()) await syncPersona({ credencialDiscapacidad: e.target.value.trim() });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (discFolio.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>Movilidad reducida:</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {["Sí", "No"].map(op => (
                            <button key={op} onClick={async e => { e.stopPropagation();
                              const newValor = discFolio + "|" + op;
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              await syncPersona({ movilidadReducida: op.toLowerCase().startsWith("s") ? "SI" : "NO" });
                            }}
                              style={{ flex: 1, padding: "5px 4px", borderRadius: 6, border: "2px solid " + (discMovilidad === op ? "#7C3AED" : "#ddd"), background: discMovilidad === op ? "#7C3AED" : "#fff", color: discMovilidad === op ? "#fff" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                              {op}
                            </button>
                          ))}
                        </div>
                        {!discCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa el folio y la movilidad reducida</div>}
                      </div>
                    )}

                    {/* Certificado de Ruralidad: N° + Fecha */}
                    {esCertRuralidad && (
                      <div style={{ marginBottom: 4, display: "grid", gap: 4 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.3px" }}>N° Certificado</div>
                        <input type="text" placeholder="N° certificado (ej: 25/2026)" value={certRuralNum}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = e.target.value + "|" + certRuralFecha;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (e.target.value.trim()) await syncPersona({ certRuralidad: e.target.value.trim() + (certRuralFecha ? " — " + certRuralFecha : "") });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (certRuralNum.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.3px", marginTop: 2 }}>Fecha del Certificado</div>
                        <input type="date" value={certRuralFecha}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = certRuralNum + "|" + e.target.value;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (certRuralFecha ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {certRuralCompleto
                          ? <div style={{ fontSize: 10, color: "#059669" }}>✓ N° {certRuralNum} — {certRuralFecha}</div>
                          : <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa N° y fecha para marcar VB</div>}
                      </div>
                    )}

                    {/* Cuenta de ahorro — archivo + número + banco */}
                    {esCuentaAhorro && !doc.entregado && (
                      <div style={{ display: "grid", gap: 5, marginBottom: 4 }}>
                        <input type="text" placeholder="N° cuenta de ahorro" value={cuentaNum} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = e.target.value + "|" + cuentaBanco;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (e.target.value.trim()) await syncPersona({ cuentaAhorro: e.target.value.trim() });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (cuentaNum.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <select value={cuentaBanco} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = cuentaNum + "|" + e.target.value;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (e.target.value) await syncPersona({ banco: e.target.value });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (cuentaBanco.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }}>
                          <option value="">Seleccionar banco…</option>
                          {["Banco Estado","Banco de Chile","Banco Santander","BCI","Scotiabank","Itaú","BICE","Banco Falabella","Banco Ripley","Banco Security","Coopeuch","Tenpo"].map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                        <div style={{ fontSize: 10, color: tieneArchivoCuenta ? "#059669" : "#B45309", fontWeight: 600 }}>
                          {tieneArchivoCuenta ? "✓ Archivo encontrado en Carpeta de documentos" : "📁 Subir cartola/certificado en Carpeta de documentos"}
                        </div>
                        {cuentaNum.trim() && cuentaBanco.trim() && (
                          <button onClick={() => marcarDocEntregado(sol.id, i, true)}
                            style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", marginTop: 2 }}>
                            Marcar VB ✓
                          </button>
                        )}
                        {(!cuentaNum.trim() || !cuentaBanco.trim()) && (
                          <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Completa N° cuenta y banco para marcar VB</div>
                        )}
                      </div>
                    )}
                    {esCuentaAhorro && doc.entregado && (
                      <div style={{ fontSize: 11, color: "#059669", marginTop: 4 }}>✓ Cuenta: {cuentaNum} — {cuentaBanco}</div>
                    )}

                    {/* Campos N°+Fecha para Informe DOM, Memo DOM, Carta SERVIU (Desmarque) */}
                    {esTramite && (
                      <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                          {esInformeDOM ? "N° Informe DOM" : esMemoDOM ? "N° Memorando DOM" : "N° Carta SERVIU"}
                        </div>
                        <input type="text"
                          placeholder={esInformeDOM ? "N° del informe (ej: 15/2026)" : esMemoDOM ? "N° del memorando (ej: 25/2026)" : "N° de la carta (ej: 45/2026)"}
                          value={tramiteNum}
                          onChange={e => { const v = e.target.value + "|" + tramiteFecha; setDocValor(sol.id, i, v); }}
                          onClick={e => e.stopPropagation()}
                          style={{ width:"100%", padding:"5px 8px", borderRadius:6, border:"1.5px solid " + (tramiteNum.trim()?"#059669":"#ddd"), fontSize:12, background:"#fff", boxSizing:"border-box" }} />
                        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3px", marginTop: 2 }}>Fecha</div>
                        <input type="date"
                          value={tramiteFecha}
                          onChange={e => { const v = tramiteNum + "|" + e.target.value; setDocValor(sol.id, i, v); }}
                          onClick={e => e.stopPropagation()}
                          style={{ width:"100%", padding:"5px 8px", borderRadius:6, border:"1.5px solid " + (tramiteFecha?"#059669":"#ddd"), fontSize:12, background:"#fff", boxSizing:"border-box" }} />
                        {tramiteCompleto
                          ? <div style={{ fontSize:10, color:"#059669" }}>✓ {tramiteNum} — {tramiteFecha}</div>
                          : <div style={{ fontSize:10, color:"#B45309" }}>⚠ Ingresa N° y fecha para activar el VB</div>}
                      </div>
                    )}

                    {/* Sección especial Respuesta SERVIU */}
                    {doc.nombre && doc.nombre.includes("Respuesta SERVIU") && (
                      <div style={{ marginTop: 8 }}>
                        {!doc.entregado && (
                          <div style={{ marginBottom: 6, display: "grid", gap: 4 }}>
                            <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase" }}>N° Ordinario (opcional)</div>
                            <input type="text" placeholder="Ej: 1234/2026" value={doc.num_ord || ""}
                              onClick={e => e.stopPropagation()}
                              onChange={e => onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                                ...s, documentos: s.documentos.map((d2,i2) => i2!==i ? d2 : {...d2, num_ord: e.target.value})
                              }))}
                              style={{ width:"100%", padding:"5px 8px", borderRadius:6, border:"1.5px solid #ddd", fontSize:12, boxSizing:"border-box" }} />
                            <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase" }}>Fecha Respuesta (opcional)</div>
                            <input type="date" value={doc.fecha_resp || ""}
                              onClick={e => e.stopPropagation()}
                              onChange={e => onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                                ...s, documentos: s.documentos.map((d2,i2) => i2!==i ? d2 : {...d2, fecha_resp: e.target.value})
                              }))}
                              style={{ width:"100%", padding:"5px 8px", borderRadius:6, border:"1.5px solid #ddd", fontSize:12, boxSizing:"border-box" }} />
                            <div style={{ fontSize: 11, color: "#B45309", fontWeight: 600, marginTop: 2 }}>
                              ⚠ Use el botón "Subir Respuesta SERVIU" para registrar el resultado
                            </div>
                          </div>
                        )}
                        {doc.entregado && (
                          <div style={{ background: doc.valor && doc.valor.includes("APROBADO") ? "#E0F7FA" : "#FEF2F2", borderRadius: 7, padding: "8px 12px" }}>
                            <div style={{ fontSize: 12, color: doc.valor && doc.valor.includes("APROBADO") ? "#0891B2" : "#DC2626", fontWeight: 700, marginBottom: 4 }}>
                              {doc.valor && doc.valor.includes("APROBADO") ? "✅" : "❌"} {doc.valor}
                            </div>
                            {(doc.num_ord || doc.fecha_resp) && (
                              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>
                                {doc.num_ord && <span>N° Ord: {doc.num_ord} </span>}
                                {doc.fecha_resp && <span>· Fecha: {doc.fecha_resp}</span>}
                              </div>
                            )}
                            <button onClick={async () => {
                                const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : {
                                  ...s, documentos: s.documentos.map((d2, i2) => i2 === i ? { ...d2, entregado: false, valor: "" } : d2)
                                });
                                onSaveSolicitudes(nuevasSols);
                                await supabase.from("solicitudes").update({ documentos: nuevasSols.find(s2=>s2.id===sol.id).documentos }).eq("id", sol.id);
                              }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: "#DC2626", color: "#fff", border: "none", cursor: "pointer", marginTop: 4 }}>
                                Modificar resultado
                              </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Selector tipo de dominio para Título de dominio CSP */}
                    {esTituloDominio && (
                      <div style={{ marginTop: 8, marginBottom: 4 }}>
                        <select value={tituloTipo} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const tipo = e.target.value;
                            const newValor = [tipo, tipo === "Otro" ? tituloDesc : "", tituloFjs, tituloNumero, tituloAnio].join("|");
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                              ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor })
                            }));
                            if (tipo) await syncPersona({ dominiopropiedad: resumenDominioPropiedad(tipo, tipo === "Otro" ? tituloDesc : "", tituloFjs, tituloNumero, tituloAnio) });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (tituloTipo ? "#059669" : "#DC2626"), fontSize: 12, background: "#fff", boxSizing: "border-box" }}>
                          <option value="">Selecciona tipo de dominio…</option>
                          {["D.V.", "DRU", "Usufructo", "Goce con resolución", "Goce sin resolución", "Otro"].map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        {tituloTipo === "Otro" && (
                          <input type="text" placeholder="Describe el tipo de dominio…" value={tituloDesc}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = ["Otro", e.target.value, tituloFjs, tituloNumero, tituloAnio].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                                ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor })
                              }));
                              if (e.target.value.trim()) await syncPersona({ dominiopropiedad: resumenDominioPropiedad("Otro", e.target.value, tituloFjs, tituloNumero, tituloAnio) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (tituloDesc.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box", marginTop: 4 }} />
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginTop: 5 }}>
                          <input type="text" placeholder="Fjs: 1250" value={tituloFjs}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = [tituloTipo, tituloDesc, e.target.value, tituloNumero, tituloAnio].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              await syncPersona({ dominiopropiedad: resumenDominioPropiedad(tituloTipo, tituloDesc, e.target.value, tituloNumero, tituloAnio) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (tituloFjs.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                          <input type="text" placeholder="N°: 120" value={tituloNumero}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = [tituloTipo, tituloDesc, tituloFjs, e.target.value, tituloAnio].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              await syncPersona({ dominiopropiedad: resumenDominioPropiedad(tituloTipo, tituloDesc, tituloFjs, e.target.value, tituloAnio) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (tituloNumero.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                          <input type="text" placeholder="Año: 2025" value={tituloAnio}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = [tituloTipo, tituloDesc, tituloFjs, tituloNumero, e.target.value].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              await syncPersona({ dominiopropiedad: resumenDominioPropiedad(tituloTipo, tituloDesc, tituloFjs, tituloNumero, e.target.value) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (tituloAnio.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        </div>
                        {!tituloTipo && <div style={{ fontSize: 10, color: "#B45309", marginTop: 3 }}>⚠ Selecciona el tipo para marcar VB</div>}
                        {tituloTipo && <div style={{ fontSize: 10, color: "#059669", marginTop: 3 }}>✓ {resumenDominioPropiedad(tituloTipo, tituloDesc, tituloFjs, tituloNumero, tituloAnio)}</div>}
                      </div>
                    )}

                    {/* Correo del solicitante */}
                    {esCorreoSolicitante && (
                      <div style={{ display: "grid", gap: 5, marginBottom: 4 }}>
                        <input type="email" placeholder="correo@ejemplo.cl" value={correoSolicitante}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const val = e.target.value.trim();
                            const completo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
                            const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : {
                              ...s,
                              documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: val, entregado: completo })
                            });
                            onSaveSolicitudes(nuevasSols);
                            await supabase.from("solicitudes").update({ documentos: nuevasSols.find(s => s.id === sol.id).documentos }).eq("id", sol.id);
                            if (val) await syncPersona({ email: val });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (correoCompleto ? "#059669" : "#DC2626"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {!correoCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa correo electrónico válido para habilitar el VB</div>}
                        {correoCompleto && <div style={{ fontSize: 10, color: "#059669", fontWeight: 700 }}>✓ Correo guardado en ficha</div>}
                      </div>
                    )}

                    {/* Teléfono de contacto */}
                    {esTelefonoContacto && (
                      <div style={{ display: "grid", gap: 5, marginBottom: 4 }}>
                        <input type="text" placeholder="Teléfono de contacto" value={doc.valor || persona.telefono || ""}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const val = e.target.value.replace(/[^\d+ ]/g, "");
                            const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : {
                              ...s,
                              documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: val, entregado: !!val.trim() })
                            });
                            onSaveSolicitudes(nuevasSols);
                            await supabase.from("solicitudes").update({ documentos: nuevasSols.find(s => s.id === sol.id).documentos }).eq("id", sol.id);
                            if (val.trim()) await syncPersona({ telefono: val.trim() });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + ((doc.valor || persona.telefono || "").trim() ? "#059669" : "#DC2626"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {!(doc.valor || persona.telefono || "").trim() && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa teléfono para habilitar el VB</div>}
                        {(doc.valor || persona.telefono || "").trim() && <div style={{ fontSize: 10, color: "#059669", fontWeight: 700 }}>✓ Teléfono guardado en ficha</div>}
                      </div>
                    )}

                    {/* Cédula: cédula de identidad + Fecha de Nacimiento */}
                    {esCedula && (() => {
                      const cedPartes2 = (doc.valor || "").split("|");
                      const rut2 = cedPartes2[0] || persona.rut || "";
                      const fecha2 = cedPartes2[1] || "";
                      const tipoRut2 = cedPartes2[2] || persona.rutColores || persona.rutcolores || "";
                      const fechaCedula = /^\d{4}-\d{2}-\d{2}$/.test(fecha2 || "") ? fecha2 : "";
                      const guardarCedula = async (rut, fechaCompleta) => {
                        const rutOk = rutFormatoChilenoValido(rut);
                        const rutFinal = rutOk ? formatRut(rut) : rut;
                        const newValor = rutFinal + "|" + fechaCompleta + "|" + tipoRut2;
                        onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2,i2) => i2!==i ? d2 : { ...d2, valor: newValor, entregado: !!(rutOk && fechaCompleta.length===10) }) }));
                        if (fechaCompleta.length===10) {
                          const am = textoAdultoMayor(fechaCompleta);
                          await supabase.from("personas").update({ fecha_nacimiento: fechaCompleta, adultomayor: am }).eq("id", persona.id);
                          onSavePersonas(personas.map(p => p.id===persona.id ? {...p, fechaNacimiento: fechaCompleta, adultoMayor: am} : p));
                        }
                        if (rutOk) await syncPersona({ rut: rutFinal });
                      };
                      const rut2Valido = rutFormatoChilenoValido(rut2);
                      return (
                      <div style={{ marginTop: 8, marginBottom: 4, display: "grid", gap: 5 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.3px" }}>Cédula de identidad del solicitante</div>
                        <input type="text" placeholder="ej: 10.398.338-K" value={formatRut(rut2)}
                          onClick={e => e.stopPropagation()}
                          onChange={e => guardarCedula(e.target.value, fechaCedula)}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid "+(rut2Valido?"#059669":"#DC2626"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.3px", marginTop: 2 }}>Fecha de Nacimiento</div>
                        <input type="date" value={fechaCedula}
                          onClick={e => e.stopPropagation()}
                          onChange={e => guardarCedula(rut2, e.target.value)}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (fechaCedula ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {!rut2Valido && <div style={{ fontSize: 10, color: "#DC2626", marginTop: 2 }}>⚠ La cédula debe ser chilena válida, con puntos, guion y dígito verificador correcto.</div>}
                        {!(rut2Valido && fechaCedula) && <div style={{ fontSize: 10, color: "#B45309", marginTop: 2 }}>⚠ Ingresa cédula de identidad válida y fecha completa para marcar VB</div>}
                        {rut2Valido && fechaCedula && <div style={{ fontSize: 10, color: "#059669" }}>✓ Cédula de identidad: {formatRut(rut2)} — Nacimiento: {fmtFecha(fechaCedula)}</div>}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 2 }}>
                          {[
                            ["RUT colores", "ok"],
                            ["RUT ByN", "falta rut colores"],
                          ].map(([label, valor]) => (
                            <button key={valor} type="button"
                              onClick={async e => {
                                e.stopPropagation();
                                const newValor = formatRut(rut2) + "|" + fechaCedula + "|" + valor;
                                const nuevasSols = solicitudes.map(s => s.id !== sol.id ? s : {
                                  ...s,
                                  documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor })
                                });
                                onSaveSolicitudes(nuevasSols);
                                await supabase.from("solicitudes").update({ documentos: nuevasSols.find(s => s.id === sol.id).documentos }).eq("id", sol.id);
                                await syncPersona({ rutColores: valor });
                              }}
                              style={{ padding: "6px 8px", borderRadius: 6, border: "2px solid " + (tipoRut2 === valor ? "#059669" : "#d1d5db"), background: tipoRut2 === valor ? "#ECFDF5" : "#fff", color: tipoRut2 === valor ? "#047857" : "#374151", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                              {label}
                            </button>
                          ))}
                        </div>
                        {tipoRut2 && <div style={{ fontSize: 10, color: tipoRut2 === "ok" ? "#059669" : "#B45309", fontWeight: 700 }}>Estado en ficha: {tipoRut2 === "ok" ? "rut colores=ok" : "rut ByN=falta rut colores"}</div>}
                      </div>
                      );
                    })()}

                    {/* Dominio de la propiedad (CSP Rural): dropdown + upload */}
                    {esDominioProp && (
                      <div style={{ marginTop: 8, marginBottom: 4 }}>
                        <select value={dominioTipo} onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const tipo = e.target.value;
                            const newValor = [tipo, tipo === "Otro" ? dominioDesc : "", dominioFjs, dominioNumero, dominioAnio].join("|");
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                              ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor })
                            }));
                            if (tipo) await syncPersona({ dominiopropiedad: resumenDominioPropiedad(tipo, tipo === "Otro" ? dominioDesc : "", dominioFjs, dominioNumero, dominioAnio) });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (dominioTipo ? "#059669" : "#DC2626"), fontSize: 12, background: "#fff", boxSizing: "border-box" }}>
                          <option value="">Selecciona tipo de dominio…</option>
                          {["D.V.","DRU","Goce con resolución","Goce sin resolución","Usufructo","Otro"].map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        {dominioTipo === "Otro" && (
                          <input type="text" placeholder="Describe el tipo de dominio…" value={dominioDesc}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = ["Otro", e.target.value, dominioFjs, dominioNumero, dominioAnio].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                                ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor })
                              }));
                              if (e.target.value.trim()) await syncPersona({ dominiopropiedad: resumenDominioPropiedad("Otro", e.target.value, dominioFjs, dominioNumero, dominioAnio) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (dominioDesc.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box", marginTop: 4 }} />
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginTop: 5 }}>
                          <input type="text" placeholder="Fjs: 1250" value={dominioFjs}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = [dominioTipo, dominioDesc, e.target.value, dominioNumero, dominioAnio].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              await syncPersona({ dominiopropiedad: resumenDominioPropiedad(dominioTipo, dominioDesc, e.target.value, dominioNumero, dominioAnio) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (dominioFjs.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                          <input type="text" placeholder="N°: 120" value={dominioNumero}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = [dominioTipo, dominioDesc, dominioFjs, e.target.value, dominioAnio].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              await syncPersona({ dominiopropiedad: resumenDominioPropiedad(dominioTipo, dominioDesc, dominioFjs, e.target.value, dominioAnio) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (dominioNumero.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                          <input type="text" placeholder="Año: 2025" value={dominioAnio}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const newValor = [dominioTipo, dominioDesc, dominioFjs, dominioNumero, e.target.value].join("|");
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              await syncPersona({ dominiopropiedad: resumenDominioPropiedad(dominioTipo, dominioDesc, dominioFjs, dominioNumero, e.target.value) });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (dominioAnio.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        </div>
                        {!dominioTipo && <div style={{ fontSize: 10, color: "#B45309", marginTop: 3 }}>⚠ Selecciona el tipo para marcar VB</div>}
                        {dominioTipo && <div style={{ fontSize: 10, color: "#059669", marginTop: 3 }}>✓ {resumenDominioPropiedad(dominioTipo, dominioDesc, dominioFjs, dominioNumero, dominioAnio)}</div>}
                      </div>
                    )}

                    {/* Campos rol + valor de avalúo antes del upload */}
                    {esAvaluo && (
                      <div style={{ display: "grid", gap: 5, marginTop: 8, marginBottom: 4 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
                          <input type="text" value="Lautaro" readOnly
                            onClick={e => e.stopPropagation()}
                            title="Comuna fija para consulta en SII Mapas"
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 12, background: "#f9fafb", color: "#555", boxSizing: "border-box" }} />
                          <input type="text" placeholder="Primer rol" value={avaluoRolPrimero}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const rol = armarRolAvaluo(e.target.value, avaluoRolSegundo);
                              const newValor = rol + "|" + avaluoValor + "|" + avaluoCoordenadas;
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              if (rol) await syncPersona({ rol, rol_propiedad: rol });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (avaluoRolPrimero.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                          <input type="text" placeholder="Segundo rol" value={avaluoRolSegundo}
                            onClick={e => e.stopPropagation()}
                            onChange={async e => {
                              const rol = armarRolAvaluo(avaluoRolPrimero, e.target.value);
                              const newValor = rol + "|" + avaluoValor + "|" + avaluoCoordenadas;
                              onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              if (rol) await syncPersona({ rol, rol_propiedad: rol });
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (avaluoRolSegundo.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
                          {[
                            ["1. Copiar comuna", "LAUTARO", "#1e3a5f"],
                            ["2. Copiar primer rol", avaluoRolPrimero, "#2563EB"],
                            ["3. Copiar segundo rol", avaluoRolSegundo, "#059669"],
                          ].map(([label, value, color]) => (
                            <button key={label} type="button"
                              onClick={async e => {
                                e.stopPropagation();
                                try { await navigator.clipboard.writeText(value || ""); } catch {}
                              }}
                              disabled={!value}
                              title={value ? `Copiar: ${value}` : "Completa este dato primero"}
                              style={{ padding: "6px 8px", borderRadius: 6, border: "1.5px solid " + (value ? color : "#d1d5db"), background: value ? color : "#f3f4f6", color: value ? "#fff" : "#9ca3af", fontSize: 10, fontWeight: 700, cursor: value ? "pointer" : "not-allowed" }}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <button type="button"
                          onClick={e => {
                            e.stopPropagation();
                            window.open(SII_MAPAS_URL, "_blank", "noopener,noreferrer");
                          }}
                          title="Abre SII Mapas para pegar comuna, manzana y predio en ese orden."
                          style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #D97706", background: "#D97706", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Abrir SII Mapas
                        </button>
                        <div style={{ fontSize: 10, color: "#6b7280" }}>
                          En SII Mapas pega en este orden: LAUTARO, {avaluoRolPrimero || "___"}, {avaluoRolSegundo || "___"}.
                        </div>
                        <input type="text" placeholder="Valor $ del avalúo (ej: $45.000.000)" value={avaluoValor}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const valorFormateado = formatPesosChilenos(e.target.value);
                            const newValor = avaluoRol + "|" + valorFormateado + "|" + avaluoCoordenadas;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (valorFormateado) await syncPersona({ avaluoFiscal: valorFormateado });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (avaluoValor.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <input type="text" placeholder="Coordenadas (ej: -38.516023, -72.374214)" value={avaluoCoordenadas}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = avaluoRol + "|" + avaluoValor + "|" + e.target.value;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (e.target.value.trim()) await syncPersona({ coordenadas: e.target.value.trim() });
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (avaluoCoordenadas.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {!avaluoCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Completa rol y valor de avalúo para marcar VB</div>}
                      </div>
                    )}

                    {/* Antecedentes de la vivienda */}
                    {esAntecedentesVivienda && (
                      <div style={{ marginTop: 8, marginBottom: 4 }}>
                        {esAmpliacion ? (
                          <div style={{ display: "grid", gap: 5 }}>
                            <input type="text" placeholder="N° permiso de edificación" value={antecNumero}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const newValor = e.target.value + "|" + antecAnio + "|" + antecRecepcionNumero + "|" + antecRecepcionFecha + "|" + antecM2;
                                onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (antecNumero.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            <input type="text" placeholder="Fecha permiso (ej: 01/02/2026)" value={antecAnio}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const newValor = antecNumero + "|" + e.target.value + "|" + antecRecepcionNumero + "|" + antecRecepcionFecha + "|" + antecM2;
                                onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (antecAnio.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            <input type="text" placeholder="N° recepción" value={antecRecepcionNumero}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const newValor = antecNumero + "|" + antecAnio + "|" + e.target.value + "|" + antecRecepcionFecha + "|" + antecM2;
                                onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (antecRecepcionNumero.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            <input type="text" placeholder="Fecha recepción (ej: 01/02/2026)" value={antecRecepcionFecha}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const newValor = antecNumero + "|" + antecAnio + "|" + antecRecepcionNumero + "|" + e.target.value + "|" + antecM2;
                                onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (antecRecepcionFecha.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            <input type="text" placeholder="M2 de la vivienda" value={antecM2}
                              onClick={e => e.stopPropagation()}
                              onChange={async e => {
                                const newValor = antecNumero + "|" + antecAnio + "|" + antecRecepcionNumero + "|" + antecRecepcionFecha + "|" + e.target.value;
                                onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                                if (antecNumero.trim() && antecAnio.trim() && antecRecepcionNumero.trim() && antecRecepcionFecha.trim() && e.target.value.trim()) {
                                  await syncPersona({ antecedentesVivienda: `Permiso ${antecNumero.trim()} ${antecAnio.trim()} / Recepción ${antecRecepcionNumero.trim()} ${antecRecepcionFecha.trim()} / ${e.target.value.trim()} m2` });
                                }
                              }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (antecM2.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            {antecCompleto && <div style={{ fontSize: 10, color: "#6b7280" }}>Antecedentes completos. Marca VB y sube el respaldo en Carpeta de documentos.</div>}
                            {!antecCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa permiso, recepción y m2 para marcar VB</div>}
                          </div>
                        ) : (
                          <>
                            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                              {[["NA","N/A — No aplica"],["SI","SÍ — Tiene documento"]].map(([op, lbl]) => (
                                <button key={op} onClick={e => {
                                  e.stopPropagation();
                                  if (op === "NA") {
                                    onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                                      ...s, documentos: s.documentos.map((d2,i2) => i2!==i ? d2 : {...d2, valor:"N/A", entregado:true})
                                    }));
                                    syncPersona({ antecedentesVivienda: "N/A" });
                                  } else {
                                    onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : {
                                      ...s, documentos: s.documentos.map((d2,i2) => i2!==i ? d2 : {...d2, valor:"__SI__|", entregado:false})
                                    }));
                                  }
                                }}
                                  style={{ flex:1, padding:"4px 8px", borderRadius:6, border:"2px solid "+(antecOpcion===op?"#059669":"#ddd"),
                                    background:antecOpcion===op?"#059669":"#fff", color:antecOpcion===op?"#fff":"#555",
                                    fontSize:11, fontWeight:700, cursor:"pointer" }}>
                                  {lbl}
                                </button>
                              ))}
                            </div>
                            {antecEsNA && <div style={{ fontSize:10, color:"#059669", fontWeight:600 }}>✓ Marcado como N/A — VB activado sin archivo</div>}
                            {antecOpcion === "SI" && (
                          <div style={{ display: "grid", gap: 5 }}>
                            <input type="text" placeholder="N° del certificado (ej: 25)" value={antecNumeroVisible}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const newValor = e.target.value + "|" + antecAnio;
                                onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                              }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (antecNumero.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            <input type="date" value={normalizarFechaInput(antecAnio)}
                              onClick={e => e.stopPropagation()}
                              onChange={async e => {
                                const newValor = antecNumeroVisible + "|" + e.target.value;
                                onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                                if (antecNumeroVisible.trim() && e.target.value.trim()) {
                                  await syncPersona({ antecedentesVivienda: "Certificado N° " + antecNumeroVisible.trim() + " Fecha " + fmtFecha(e.target.value.trim()) });
                                }
                              }}
                              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (antecAnio.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                            {antecCompleto && <div style={{ fontSize: 10, color: "#6b7280" }}>Se guardará como: Certificado N° {antecNumeroVisible} Fecha {fmtFecha(antecAnio)}</div>}
                            {!antecCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa N° y fecha para marcar VB</div>}
                          </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Campos N° + año de informaciones previas antes del upload */}
                    {esInfoPrevias && (
                      <div style={{ display: "grid", gap: 5, marginTop: 8, marginBottom: 4 }}>
                        <input type="text" placeholder="N° del documento (ej: 25)" value={infoNumero}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            const newValor = e.target.value + "|" + infoAnio;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (infoNumero.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        <input type="text" placeholder="Fecha (ej: 01/02/2026)" value={infoAnio}
                          onClick={e => e.stopPropagation()}
                          onChange={async e => {
                            const newValor = infoNumero + "|" + e.target.value;
                            onSaveSolicitudes(solicitudes.map(s => s.id !== sol.id ? s : { ...s, documentos: s.documentos.map((d2, i2) => i2 !== i ? d2 : { ...d2, valor: newValor }) }));
                            if (infoNumero.trim() && e.target.value.trim()) {
                              const formatted = infoNumero.trim() + "/" + e.target.value.trim();
                              await syncPersona({ informacionesPrevias: formatted });
                            }
                          }}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid " + (infoAnio.trim() ? "#059669" : "#ddd"), fontSize: 12, background: "#fff", boxSizing: "border-box" }} />
                        {infoCompleto && <div style={{ fontSize: 10, color: "#6b7280" }}>Se guardará como: {infoNumero}/{infoAnio}</div>}
                        {!infoCompleto && <div style={{ fontSize: 10, color: "#B45309" }}>⚠ Ingresa N° y fecha para marcar VB</div>}
                      </div>
                    )}

                    {/* Marcar VB; los archivos se suben en Carpeta de documentos */}
                    {esDocArchivo && !doc.entregado &&
                      (!esTituloDominio || !!tituloTipo) &&
                      (!esDominioProp || !!dominioTipo) &&
                      (!esCedula || cedCompleto) &&
                      (!esCertRuralidad || certRuralCompleto) &&
                      (!esAvaluo || avaluoCompleto) &&
                      (!esInfoPrevias || infoCompleto) &&
                      (!esAntecedentesVivienda || antecCompleto) && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: tieneArchivo ? "#059669" : "#B45309", marginBottom: 4, fontWeight: 600 }}>
                          {tieneArchivo ? "✓ Archivo encontrado en Carpeta de documentos" : "📁 Subir respaldo en Carpeta de documentos"}
                        </div>
                        <button onClick={() => { marcarDocEntregado(sol.id, i, true); }}
                          style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          Marcar VB ✓
                        </button>
                      </div>
                    )}

                    {/* Mensaje según opción seleccionada */}
                    {necesitaArchivo && !doc.entregado && !esSinDiscapacidad && (
                      <>{esCsp ? (
                        /* CSP: archivo en carpeta, VB desde solicitudes */
                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, background: tieneArchivoEspecial ? "#ECFDF5" : "#FFFBEB", borderRadius: 6, padding: "5px 10px" }}>
                          <span style={{ fontSize: 11, color: tieneArchivoEspecial ? "#059669" : "#B45309", fontWeight: 700 }}>
                            {tieneArchivoEspecial ? "✓ Archivo encontrado en carpeta" : "📁 Subir archivo en Carpeta de documentos"}
                          </span>
                          <button onClick={() => marcarDocEntregado(sol.id, i, true)}
                            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, background: "#059669", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, marginLeft: "auto" }}>
                            Marcar VB ✓
                          </button>
                        </div>
                      ) : (
                        /* Otros programas: archivo en carpeta, VB desde solicitudes */
                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, background: "#FFFBEB", borderRadius: 6, padding: "5px 8px" }}>
                          <span style={{ fontSize: 11, color: "#D97706", fontWeight: 700 }}>📁 Subir archivo en Carpeta de documentos</span>
                          <button onClick={() => marcarDocEntregado(sol.id, i, true)}
                            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, background: "#059669", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, marginLeft: "auto" }}>
                            Marcar VB ✓
                          </button>
                        </div>
                      )}
                    </> )}
                    {necesitaArchivo && doc.entregado && !esSinDiscapacidad && (
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, background: "#F0FDF4", borderRadius: 6, padding: "5px 8px" }}>
                        <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>✓ VB marcado</span>
                      </div>
                    )}
                  </div>
                );
              }).filter(Boolean);
              })()}
            </div>}
          </div>
        );
      })}

      {showFichaEdit && (
        <Modal title="Editar Ficha Desmarque" onClose={() => setShowFichaEdit(false)}>
          <div style={{ display: "grid", gap: 10, maxHeight: "70vh", overflowY: "auto", paddingRight: 8 }}>
            {[
              ["rut","Cédula de identidad","Ej: 10398338-K"],
              ["direccion","Comunidad/Dirección",""],
              ["telefono","Teléfono",""],
              ["sector","Sector *",""],
              ["coordenadas","Coordenadas (opcional)","Ej: C=-38.516023,-72.374214"],
              ["puntaje_rsh","RSH (%)","Ej: 40"],
              ["anio_subsidio","Año de Subsidio *","Ej: 1989"],
              ["rol_propiedad","Rol de la Propiedad","Ej: 300-39"],
              ["numero_informe_dom","N° Informe DOM","Ej: N°15 del 10-03-2025"],
            ].map(([key, label, ph]) => {
              return (
                <div key={key}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 }}>{label}</div>
                  <input value={fichaForm[key] || ""} onChange={e => setFichaForm({...fichaForm, [key]: e.target.value})}
                    placeholder={ph}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #ddd", fontSize: 13, background: "#fff" }} />
                </div>
              );
            })}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 }}>Fecha Visita</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e5e7eb", background: "#f9fafb", fontSize: 13, color: fichaForm.fecha_visita ? "#1e3a5f" : "#9ca3af" }}>
                <span style={{ flex: 1 }}>{fmtFecha(fichaForm.fecha_visita) || "No registrada"}</span>
                <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>🔒 Solo desde Solicitudes activas</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 }}>U/R (URBANO o RURAL)</div>
              <select value={fichaForm.tipo_comite || ""} onChange={e => setFichaForm({...fichaForm, tipo_comite: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #DC2626", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                <option value="RURAL">RURAL</option>
                <option value="URBANO">URBANO</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 }}>Documento de Propiedad</div>
              <select value={fichaForm.dominio_terreno || ""} onChange={e => setFichaForm({...fichaForm, dominio_terreno: e.target.value})}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #ddd", fontSize: 13, background: "#fff" }}>
                <option value="">-- Seleccionar --</option>
                <option value="DV">DV - Dominio Vigente</option>
                <option value="DRU">DRU - Derecho Real de Uso</option>
                <option value="USUFRUCTO">Usufructo</option>
                <option value="GOCE">Goce de Tierra</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 }}>Observaciones (opcional)</div>
              <textarea value={fichaForm.observaciones || ""} onChange={e => setFichaForm({...fichaForm, observaciones: e.target.value})}
                style={{ width: "100%", minHeight: 70, padding: "7px 10px", borderRadius: 7, border: "1.5px solid #ddd", fontSize: 13, resize: "vertical" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button onClick={() => setShowFichaEdit(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={() => { if (window["confirm"]("¿Está seguro de guardar los cambios?")) guardarFichaDesmarque(); }}
              style={{ padding: "9px 20px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
          </div>
          {/* clave desmarque eliminada */}
        </Modal>
      )}

      {showModalMemo && (
        <Modal title="Generar Memorando DOM" onClose={() => setShowModalMemo(false)}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4 }}>N° del Memorando *</div>
              <input value={formMemo.numero} onChange={e => setFormMemo({...formMemo, numero: e.target.value})}
                placeholder="Ej: 15/2026"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, background: "#FAFAFA" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#444", marginBottom: 8 }}>De</div>
                <select
                  value={formMemo.deTipo}
                  onChange={e => {
                    const esMarcelo = e.target.value === "marcelo";
                    setFormMemo({
                      ...formMemo,
                      deTipo: e.target.value,
                      deNombre: esMarcelo ? "MARCELO CIFUENTES VÁSQUEZ" : "",
                      deCargo: esMarcelo ? "ENCARGADO ENTIDAD PATROCINANTE" : "",
                      deInstitucion: esMarcelo ? "MUNICIPALIDAD DE LAUTARO" : "",
                      deIniciales: esMarcelo ? "MCV/mcv" : ""
                    });
                  }}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13, marginBottom: 8 }}>
                  <option value="marcelo">Marcelo Cifuentes Vásquez</option>
                  <option value="otro">Otro</option>
                </select>
                {formMemo.deTipo === "otro" && (
                  <div style={{ display: "grid", gap: 7 }}>
                    <input value={formMemo.deNombre} onChange={e => setFormMemo({...formMemo, deNombre: e.target.value})} placeholder="Nombre completo" style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                    <input value={formMemo.deCargo} onChange={e => setFormMemo({...formMemo, deCargo: e.target.value})} placeholder="Cargo" style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                    <input value={formMemo.deInstitucion} onChange={e => setFormMemo({...formMemo, deInstitucion: e.target.value})} placeholder="Institución" style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                    <input value={formMemo.deIniciales} onChange={e => setFormMemo({...formMemo, deIniciales: e.target.value})} placeholder="Iniciales, ej: MCV/mcv" style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                  </div>
                )}
              </div>
              <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, background: "#FAFAFA" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#444", marginBottom: 8 }}>A</div>
                <select
                  value={formMemo.aTipo}
                  onChange={e => {
                    const esEduardo = e.target.value === "eduardo";
                    setFormMemo({
                      ...formMemo,
                      aTipo: e.target.value,
                      aNombre: esEduardo ? "SEÑOR EDUARDO BUSTOS VALDEBENITO" : "",
                      aCargo: esEduardo ? "DIRECTOR DE OBRAS" : "",
                      aInstitucion: esEduardo ? "MUNICIPALIDAD DE LAUTARO" : "",
                      aTrato: esEduardo ? "PRESENTE." : "PRESENTE."
                    });
                  }}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13, marginBottom: 8 }}>
                  <option value="eduardo">Señor Eduardo Bustos Valdebenito</option>
                  <option value="otro">Otro</option>
                </select>
                {formMemo.aTipo === "otro" && (
                  <div style={{ display: "grid", gap: 7 }}>
                    <input value={formMemo.aNombre} onChange={e => setFormMemo({...formMemo, aNombre: e.target.value})} placeholder="Nombre completo" style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                    <input value={formMemo.aCargo} onChange={e => setFormMemo({...formMemo, aCargo: e.target.value})} placeholder="Cargo" style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                    <input value={formMemo.aInstitucion} onChange={e => setFormMemo({...formMemo, aInstitucion: e.target.value})} placeholder="Institución" style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                    <input value={formMemo.aTrato} onChange={e => setFormMemo({...formMemo, aTrato: e.target.value})} placeholder="Trato final, ej: PRESENTE." style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }} />
                  </div>
                )}
              </div>
            </div>
            <div style={{ background: "#EDE9FE", borderRadius: 7, padding: "7px 12px", fontSize: 12, color: "#7C3AED" }}>
              <b>Coordenadas:</b> {persona.coordenadas || <span style={{ color: "#aaa" }}>No registradas en la ficha</span>}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 6 }}>Problemas de la vivienda</div>
              {formMemo.problemas.length > 0 && (
                <div style={{ marginBottom: 8, display: "grid", gap: 5 }}>
                  {formMemo.problemas.map((p, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#F5F3FF", borderRadius: 7, padding: "7px 10px", fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: "#7C3AED", whiteSpace: "nowrap", minWidth: 28 }}>{i + 1}.-</span>
                      <span style={{ flex: 1, color: "#333" }}>{p}</span>
                      <button onClick={() => setFormMemo({...formMemo, problemas: formMemo.problemas.filter((_, j) => j !== i)})}
                        style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={formMemo.nuevoProblema}
                  onChange={e => setFormMemo({...formMemo, nuevoProblema: e.target.value})}
                  onKeyDown={e => {
                    if (e.key === "Enter" && formMemo.nuevoProblema.trim()) {
                      setFormMemo({...formMemo, problemas: [...formMemo.problemas, formMemo.nuevoProblema.trim()], nuevoProblema: ""});
                    }
                  }}
                  placeholder="Describe el problema de la vivienda..."
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 }}
                />
                <button
                  onClick={() => {
                    if (formMemo.nuevoProblema.trim())
                      setFormMemo({...formMemo, problemas: [...formMemo.problemas, formMemo.nuevoProblema.trim()], nuevoProblema: ""});
                  }}
                  disabled={!formMemo.nuevoProblema.trim()}
                  style={{ padding: "8px 14px", borderRadius: 8, background: formMemo.nuevoProblema.trim() ? "#7C3AED" : "#ccc", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: formMemo.nuevoProblema.trim() ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
                  + Agregar
                </button>
              </div>
            </div>
            <div style={{ background: "#F5F3FF", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#7C3AED" }}>
              <div><strong>Nombre:</strong> {persona.nombre}</div>
              <div><strong>Cédula de identidad:</strong> {persona.rut}</div>
              <div><strong>Dirección:</strong> {persona.direccion || "-"}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setShowModalMemo(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={generarMemo} disabled={!formMemo.numero || generando}
                style={{ padding: "9px 20px", borderRadius: 8, background: formMemo.numero ? "#7C3AED" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: formMemo.numero ? "pointer" : "not-allowed" }}>
                {generando ? "Generando..." : "Generar y Descargar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showModalCarta && (
        <Modal title="Generar Carta SERVIU" onClose={() => setShowModalCarta(false)}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4 }}>N° de la Carta *</div>
              <input value={formCarta.numero} onChange={e => setFormCarta({...formCarta, numero: e.target.value})}
                placeholder="Ej: 45/2026"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#F0F9FF", borderRadius: 8, padding: 12, border: "1px solid #BAE6FD" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#075985", marginBottom: 8 }}>DE</div>
                <select
                  value={formCarta.deTipo}
                  onChange={e => {
                    const esMarcelo = e.target.value === "marcelo";
                    setFormCarta({
                      ...formCarta,
                      deTipo: e.target.value,
                      deNombre: esMarcelo ? "MARCELO CIFUENTES VÁSQUEZ" : "",
                      deCargo: esMarcelo ? "ENCARGADO ENTIDAD PATROCINANTE" : "",
                      deInstitucion: esMarcelo ? "MUNICIPALIDAD DE LAUTARO" : "",
                      deIniciales: esMarcelo ? "MCV/mcv" : ""
                    });
                  }}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #7DD3FC", fontSize: 13, marginBottom: 8 }}
                >
                  <option value="marcelo">Marcelo Cifuentes Vásquez</option>
                  <option value="otro">Otro</option>
                </select>
                {formCarta.deTipo === "otro" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input value={formCarta.deNombre} onChange={e => setFormCarta({...formCarta, deNombre: e.target.value})} placeholder="Nombre remitente" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                    <input value={formCarta.deCargo} onChange={e => setFormCarta({...formCarta, deCargo: e.target.value})} placeholder="Cargo remitente" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                    <input value={formCarta.deInstitucion} onChange={e => setFormCarta({...formCarta, deInstitucion: e.target.value})} placeholder="Institución remitente" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                    <input value={formCarta.deIniciales} onChange={e => setFormCarta({...formCarta, deIniciales: e.target.value})} placeholder="Iniciales, ej: MCV/mcv" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                  </div>
                )}
              </div>
              <div style={{ background: "#ECFEFF", borderRadius: 8, padding: 12, border: "1px solid #A5F3FC" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0E7490", marginBottom: 8 }}>A</div>
                <select
                  value={formCarta.aTipo}
                  onChange={e => {
                    const esMarco = e.target.value === "marco";
                    setFormCarta({
                      ...formCarta,
                      aTipo: e.target.value,
                      aNombre: esMarco ? "SEÑOR MARCO SEGUEL REYES" : "",
                      aCargo: esMarco ? "DIRECTOR DE SERVIU (S)" : "",
                      aInstitucion: esMarco ? "REGIÓN DE LA ARAUCANIA" : "",
                      aTrato: esMarco ? "PRESENTE." : ""
                    });
                  }}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #67E8F9", fontSize: 13, marginBottom: 8 }}
                >
                  <option value="marco">Señor Marco Seguel Reyes</option>
                  <option value="otro">Otro</option>
                </select>
                {formCarta.aTipo === "otro" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input value={formCarta.aNombre} onChange={e => setFormCarta({...formCarta, aNombre: e.target.value})} placeholder="Nombre destinatario" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                    <input value={formCarta.aCargo} onChange={e => setFormCarta({...formCarta, aCargo: e.target.value})} placeholder="Cargo destinatario" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                    <input value={formCarta.aInstitucion} onChange={e => setFormCarta({...formCarta, aInstitucion: e.target.value})} placeholder="Institución / región" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                    <input value={formCarta.aTrato} onChange={e => setFormCarta({...formCarta, aTrato: e.target.value})} placeholder="PRESENTE." style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }} />
                  </div>
                )}
              </div>
            </div>
            <div style={{ background: "#E0F7FA", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#0891B2" }}>
              <div><strong>Nombre:</strong> {persona.nombre}</div>
              <div><strong>Cédula de identidad:</strong> {persona.rut}</div>
              <div><strong>Fecha:</strong> {new Date().toLocaleDateString("es-CL")}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setShowModalCarta(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={generarCarta} disabled={!formCarta.numero || generando}
                style={{ padding: "9px 20px", borderRadius: 8, background: formCarta.numero ? "#0891B2" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: formCarta.numero ? "pointer" : "not-allowed" }}>
                {generando ? "Generando..." : "Generar y Descargar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showModalSolicitud && (
        <Modal title="Generar Solicitud 2026" onClose={() => setShowModalSolicitud(false)}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4 }}>Subsidio Adjudicado *</div>
              <input value={formSolicitud.subsidio} onChange={e => setFormSolicitud({...formSolicitud, subsidio: e.target.value})}
                placeholder="Ej: SUBSIDIO RURAL - SUB. RURALES TITULO I"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14 }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4 }}>Año del Subsidio *</div>
              <input value={formSolicitud.anioSubsidio} onChange={e => setFormSolicitud({...formSolicitud, anioSubsidio: e.target.value})}
                placeholder="Ej: 1989"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14 }} />
            </div>
            <div style={{ background: "#ECFDF5", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#059669" }}>
              <div><strong>Plantilla oficial:</strong> Formulario Solicitud Habilitación Inhabitabilidad 2026</div>
              <div>Se generará un PDF oficial completado automáticamente.</div>
              <div><a href={SOLICITUD_2026_PDF} target="_blank" rel="noopener noreferrer" style={{ color: "#047857", fontWeight: 700 }}>Ver archivo oficial usado</a></div>
              <hr style={{ border: 0, borderTop: "1px solid #BBF7D0", margin: "8px 0" }} />
              <div><strong>Nombre:</strong> {persona.nombre}</div>
              <div><strong>Cédula de identidad:</strong> {persona.rut}</div>
              <div><strong>Dirección:</strong> {persona.direccion || "-"}</div>
              <div><strong>Teléfono:</strong> {persona.telefono || "-"}</div>
              <div><strong>Correo:</strong> Jcampos@munilautaro.cl</div>
              <div><strong>Comuna:</strong> LAUTARO</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setShowModalSolicitud(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={generarSolicitud} disabled={!formSolicitud.subsidio || !formSolicitud.anioSubsidio || generando}
                style={{ padding: "9px 20px", borderRadius: 8, background: (formSolicitud.subsidio && formSolicitud.anioSubsidio) ? "#059669" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: (formSolicitud.subsidio && formSolicitud.anioSubsidio) ? "pointer" : "not-allowed" }}>
                {generando ? "Generando..." : "Generar PDF oficial"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showModalInformeJACC && (
        <Modal title="Generar Informe JACC" onClose={() => setShowModalInformeJACC(false)}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ background: "#F0FDF4", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#166534", lineHeight: 1.7 }}>
              <div><strong>Beneficiario:</strong> {persona.nombre || ""}</div>
              <div><strong>Cédula de identidad:</strong> {persona.rut || "-"}</div>
              <div><strong>Teléfono:</strong> {persona.telefono || "-"}</div>
              <div><strong>Dirección:</strong> {persona.direccion || "-"}</div>
              <div><strong>Coordenadas:</strong> {persona.coordenadas || "-"}</div>
              <div><strong>Fecha de visita:</strong> {(() => { const s = misSols[0]; const f = s ? fechaVisitaSolicitud(s) : ""; return f ? f : <span style={{ color: "#dc2626" }}>No registrada en la ficha</span>; })()}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4 }}>Año y Tipo de Subsidio</div>
              <input
                value={informeSubsidioTexto}
                onChange={e => setInformeSubsidioTexto(e.target.value)}
                placeholder="Ej: SUBSIDIOS RURALES TITULO I Llamado N°1 Año 1992"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13, boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4 }}>Estado de la vivienda *</div>
              <input
                value={informeEstadoVivienda}
                onChange={e => setInformeEstadoVivienda(e.target.value)}
                placeholder="Ej: DETERIORADA / HABITABLE / INHABITABLE"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid " + (informeEstadoVivienda ? "#166534" : "#ddd"), fontSize: 13, boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#444", marginBottom: 8 }}>Fotografías de la vivienda</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#1e3a5f", color: "#fff" }}>
                      <th style={{ padding: "7px 10px", textAlign: "center", width: 36 }}>N°</th>
                      <th style={{ padding: "7px 10px", textAlign: "left" }}>Estado de la vivienda</th>
                      <th style={{ padding: "7px 10px", textAlign: "left", width: 155 }}>Fotografía</th>
                      <th style={{ padding: "7px 10px", width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasInforme.map((fila, i) => (
                      <tr key={fila.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: "#1e3a5f" }}>{i + 1}</td>
                        <td style={{ padding: "8px 10px" }}>
                          <input
                            value={fila.descripcion}
                            onChange={e => setFilasInforme(prev => prev.map(f => f.id === fila.id ? { ...f, descripcion: e.target.value } : f))}
                            placeholder="Describa el estado..."
                            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12, boxSizing: "border-box" }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {fila.imagenNombre ? (
                            <div style={{ fontSize: 11, color: "#059669", display: "flex", alignItems: "center", gap: 4 }}>
                              <span>✓</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{fila.imagenNombre}</span>
                              <button onClick={() => setFilasInforme(prev => prev.map(f => f.id === fila.id ? { ...f, imagenBase64: null, imagenNombre: "", mimeType: "" } : f))}
                                style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✕</button>
                            </div>
                          ) : (
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0f0f0", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: "#555" }}>
                              📷 Buscar
                              <input type="file" accept="image/*" style={{ display: "none" }}
                                onChange={e => handleImagenFilaJACC(fila.id, e.target.files[0])} />
                            </label>
                          )}
                        </td>
                        <td style={{ padding: "8px 6px", textAlign: "center" }}>
                          {filasInforme.length > 1 && (
                            <button onClick={() => setFilasInforme(prev => prev.filter(f => f.id !== fila.id))}
                              style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 16 }}>✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => setFilasInforme(prev => [...prev, { id: uid(), descripcion: "", imagenBase64: null, imagenNombre: "", mimeType: "", imgWidth: 265, imgHeight: 200 }])}
                style={{ marginTop: 8, padding: "7px 14px", borderRadius: 7, border: "1.5px dashed #1e3a5f", background: "transparent", color: "#1e3a5f", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                + Agregar fila
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setShowModalInformeJACC(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={generarInformeJACC} disabled={generandoInforme}
                style={{ padding: "9px 20px", borderRadius: 8, background: "#166534", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: generandoInforme ? "not-allowed" : "pointer" }}>
                {generandoInforme ? "Generando..." : "Generar Word"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showModalInformeDom && (
        <Modal title="Resultado Informe DOM" onClose={() => { setShowModalInformeDom(false); setResultadoInformeDom(""); setNotaResultado(""); }}>
          <div style={{ fontSize: 14, color: "#444", marginBottom: 16 }}>¿Cuál es el resultado del <strong>Informe DOM</strong>?</div>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            {[
              { k: "APROBADO", label: "✅ Aprobado", color: "#059669", bg: "#ECFDF5" },
              { k: "RECHAZADO_APELABLE", label: "🟡 Rechazado - Apelable", color: "#B45309", bg: "#FFFBEB" },
              { k: "RECHAZADO_SIN_APELACION", label: "🔴 Rechazado Sin Apelación", color: "#DC2626", bg: "#FEF2F2" },
            ].map(op => (
              <div key={op.k} onClick={() => setResultadoInformeDom(op.k)}
                style={{ padding: "12px 16px", borderRadius: 10, border: "2px solid " + (resultadoInformeDom === op.k ? op.color : "#e5e7eb"),
                  background: resultadoInformeDom === op.k ? op.bg : "#fff", cursor: "pointer", fontWeight: 700, color: op.color, fontSize: 14 }}>
                {op.label}
              </div>
            ))}
          </div>
          {(resultadoInformeDom === "RECHAZADO_APELABLE" || resultadoInformeDom === "RECHAZADO_SIN_APELACION") && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 5 }}>Razón del rechazo (opcional)</div>
              <textarea value={notaResultado} onChange={e => setNotaResultado(e.target.value)}
                placeholder="Ingrese la razón del rechazo..."
                style={{ width: "100%", minHeight: 70, borderRadius: 8, border: "1.5px solid #ddd", padding: "8px 10px", fontSize: 13, resize: "vertical" }} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => { setShowModalInformeDom(false); setResultadoInformeDom(""); setNotaResultado(""); }}
              style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardarResultadoInformeDom} disabled={!resultadoInformeDom}
              style={{ padding: "9px 20px", borderRadius: 8, background: resultadoInformeDom ? "#1e3a5f" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: resultadoInformeDom ? "pointer" : "not-allowed" }}>Guardar</button>
          </div>
        </Modal>
      )}

      {showModalRespuestaServiu && (
        <Modal title="Resultado Respuesta SERVIU" onClose={() => { setShowModalRespuestaServiu(false); setResultadoRespuestaServiu(""); setNotaResultado(""); }}>
          <div style={{ fontSize: 14, color: "#444", marginBottom: 16 }}>¿Cuál es el resultado de la <strong>Respuesta SERVIU</strong>?</div>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            {[
              { k: "APROBADO", label: "✅ Aprobado — Desmarcado", color: "#0891B2", bg: "#E0F7FA" },
              { k: "RECHAZADO_APELABLE", label: "🟡 Rechazado — Para Apelar", color: "#B45309", bg: "#FFFBEB" },
              { k: "RECHAZADO_SIN_APELACION", label: "🔴 Rechazado Sin Apelación", color: "#DC2626", bg: "#FEF2F2" },
            ].map(op => (
              <div key={op.k} onClick={() => setResultadoRespuestaServiu(op.k)}
                style={{ padding: "12px 16px", borderRadius: 10, border: "2px solid " + (resultadoRespuestaServiu === op.k ? op.color : "#e5e7eb"),
                  background: resultadoRespuestaServiu === op.k ? op.bg : "#fff", cursor: "pointer", fontWeight: 700, color: op.color, fontSize: 14 }}>
                {op.label}
              </div>
            ))}
          </div>
          {(resultadoRespuestaServiu === "RECHAZADO_APELABLE" || resultadoRespuestaServiu === "RECHAZADO_SIN_APELACION") && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 5 }}>Motivo (opcional)</div>
              <textarea value={notaResultado} onChange={e => setNotaResultado(e.target.value)}
                placeholder="Ingrese el motivo..."
                style={{ width: "100%", minHeight: 70, borderRadius: 8, border: "1.5px solid #ddd", padding: "8px 10px", fontSize: 13, resize: "vertical" }} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => { setShowModalRespuestaServiu(false); setResultadoRespuestaServiu(""); setNotaResultado(""); }}
              style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardarResultadoRespuestaServiu} disabled={!resultadoRespuestaServiu}
              style={{ padding: "9px 20px", borderRadius: 8, background: resultadoRespuestaServiu ? "#1e3a5f" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: resultadoRespuestaServiu ? "pointer" : "not-allowed" }}>Guardar</button>
          </div>
        </Modal>
      )}

      {showModalComprobante && (
        <Modal title="Resultado Comprobante SERVIU" onClose={() => { setShowModalComprobante(false); setNotaRechazo(""); setResultadoComp(""); }}>
          <div style={{ fontSize: 14, color: "#444", marginBottom: 20 }}>¿Cuál es el resultado del Comprobante SERVIU para <strong>{persona.nombre}</strong>?</div>
          <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
            {[
              { k: "DESMARCADO", label: "✅ Desmarcado", color: "#0891B2", bg: "#E0F7FA" },
              { k: "APELAR SERVIU", label: "🟡 Apelar SERVIU", color: "#B45309", bg: "#FFFBEB" },
              { k: "NO CALIFICA", label: "🔴 No Califica", color: "#DC2626", bg: "#FEF2F2" },
            ].map(op => (
              <div key={op.k} onClick={() => setResultadoComp(op.k)}
                style={{ padding: "14px 18px", borderRadius: 10, border: "2px solid " + (resultadoComp === op.k ? op.color : "#e5e7eb"),
                  background: resultadoComp === op.k ? op.bg : "#fff", cursor: "pointer", fontWeight: 700, color: op.color, fontSize: 15 }}>
                {op.label}
              </div>
            ))}
          </div>
          {(resultadoComp === "APELAR SERVIU" || resultadoComp === "NO CALIFICA") && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 6 }}>
                {resultadoComp === "APELAR SERVIU" ? "Medidas para apelar:" : "Razón de rechazo:"}
              </div>
              <textarea value={notaRechazo} onChange={e => setNotaRechazo(e.target.value)}
                placeholder={resultadoComp === "APELAR SERVIU" ? "Ingrese las medidas para apelar..." : "Ingrese la razón de rechazo..."}
                style={{ width: "100%", minHeight: 80, borderRadius: 8, border: "1.5px solid #ddd", padding: "10px 12px", fontSize: 13, resize: "vertical" }} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => { setShowModalComprobante(false); setNotaRechazo(""); setResultadoComp(""); }}
              style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardarResultadoComprobante} disabled={!resultadoComp}
              style={{ padding: "9px 20px", borderRadius: 8, background: resultadoComp ? "#1e3a5f" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: resultadoComp ? "pointer" : "not-allowed" }}>Guardar</button>
          </div>
        </Modal>
      )}

      {showModal && (
        <Modal title="Asignar programa" onClose={() => setShowModal(false)}>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>Selecciona el programa:</div>
          <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
            {disponibles.map(p => (
              <div key={p.id} onClick={() => setProgSel(p.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 11, border: "2px solid " + (progSel === p.id ? p.color : "#e5e7eb"), background: progSel === p.id ? p.colorLight : "#fff", cursor: "pointer" }}>
                <div style={{ width: 36, height: 36, borderRadius: 18, background: p.colorLight, color: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{p.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1e3a5f" }}>{p.nombre}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{p.documentos.length} documentos</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => setShowModal(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={agregar} disabled={!progSel} style={{ padding: "9px 20px", borderRadius: 8, background: progSel ? "#1e3a5f" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: progSel ? "pointer" : "not-allowed" }}>Asignar</button>
          </div>
        </Modal>
      )}

      {/* claves VB eliminadas */}

      {/* modales clave programa y tipo comité eliminados */}

      {/* MODAL DESBLOQUEAR RESPUESTA SERVIU */}
      {/* modal clave Respuesta SERVIU eliminado */}

      {/* MODAL EMIGRAR A PROGRAMA */}
      {showModalEmigrar && (
        <Modal title="Solicitante Aprobado — Emigrar a Programa" onClose={() => { setShowModalEmigrar(false); setProgramaEmigrar(""); }}>
          <div style={{ background: "#E0F7FA", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#0891B2", fontWeight: 600 }}>
            ✅ {persona.nombre} fue Aprobado/Desmarcado.<br />
            <span style={{ fontWeight: 400, color: "#555" }}>Seleccione el programa al que emigrará este solicitante:</span>
          </div>
          <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
            {todosProgramas.filter(p => p.id !== "habitabilidad").map(p => (
              <div key={p.id} onClick={() => setProgramaEmigrar(p.id)}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 11, border: "2px solid " + (programaEmigrar === p.id ? p.color : "#e5e7eb"), background: programaEmigrar === p.id ? p.colorLight : "#fff", cursor: "pointer" }}>
                <div style={{ width: 40, height: 40, borderRadius: 20, background: programaEmigrar === p.id ? p.color : p.colorLight, color: programaEmigrar === p.id ? "#fff" : p.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{p.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1e3a5f" }}>{p.nombre}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{p.descripcion}</div>
                </div>
              </div>
            ))}
            <div onClick={() => setProgramaEmigrar("sin_programa")}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 11, border: "2px solid " + (programaEmigrar === "sin_programa" ? "#555" : "#e5e7eb"), background: programaEmigrar === "sin_programa" ? "#f5f5f5" : "#fff", cursor: "pointer" }}>
              <div style={{ width: 40, height: 40, borderRadius: 20, background: "#f0ede8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>—</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#555" }}>Solo desbloquear / Sin emigrar</div>
                <div style={{ fontSize: 12, color: "#888" }}>Desbloquear la ficha sin asignar nuevo programa</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => { setShowModalEmigrar(false); setProgramaEmigrar(""); }}
              style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button disabled={!programaEmigrar} onClick={async () => {
              // Desbloquear: quitar VB de Respuesta SERVIU
              const sol = misSols.find(s => s.programaId === "habitabilidad");
              if (sol) {
                const docsActualizados = sol.documentos.map(d =>
                  d.nombre && d.nombre.includes("Respuesta SERVIU")
                    ? { ...d, entregado: false, valor: "" }
                    : d
                );
                await supabase.from("solicitudes").update({ documentos: docsActualizados }).eq("id", sol.id);
                onSaveSolicitudes(solicitudes.map(s => s.id === sol.id ? { ...s, documentos: docsActualizados } : s));
              }
              // Agregar nuevo programa si corresponde
              if (programaEmigrar && programaEmigrar !== "sin_programa") {
                const prog = todosProgramas.find(p => p.id === programaEmigrar);
                if (prog && !misSols.find(s => s.programaId === programaEmigrar)) {
                  const nueva = {
                    id: uid(), personaId, personaNombre: persona.nombre,
                    programaId: prog.id, fecha: today(),
                    documentos: prog.documentos.map(d => ({
                      nombre: d.nombre, obligatorio: d.obligatorio, entregado: false,
                      tipo: d.tipo || null, opciones: d.opciones || null, opcionSeleccionada: null, etiqueta: null,
                      requiereArchivo: !!d.requiereArchivo, requiereTexto: !!d.requiereTexto, etiquetaTexto: d.etiquetaTexto || "", valor: d.valor || ""
                    }))
                  };
                  const { data: inserted } = await supabase.from("solicitudes").insert([{
                    id: nueva.id, persona_id: personaId, persona_nombre: persona.nombre,
                    programa_id: prog.id, fecha: today(), documentos: nueva.documentos
                  }]).select();
                  onSaveSolicitudes([...solicitudes, nueva]);
                }
              }
              // Actualizar estado persona a POSTULANDO
              if (programaEmigrar !== "sin_programa") {
                await supabase.from("personas").update({ estado_desmarque: "POSTULANDO" }).eq("id", persona.id);
                onSavePersonas(personas.map(p => p.id === persona.id ? { ...p, estado_desmarque: "POSTULANDO" } : p));
              }
              setShowModalEmigrar(false);
              setProgramaEmigrar("");
            }} style={{ padding: "9px 22px", borderRadius: 8, background: programaEmigrar ? "#059669" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: programaEmigrar ? "pointer" : "not-allowed" }}>
              {programaEmigrar === "sin_programa" ? "Solo desbloquear" : "Emigrar al programa"}
            </button>
          </div>
        </Modal>
      )}

      {showModalZip && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9500, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowModalZip(false)}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "28px 32px", width: 560, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#1e3a5f", marginBottom: 6 }}>🗜 Descargar ZIP de documentos</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 18 }}>Selecciona los solicitantes cuyos documentos quieres incluir en el ZIP.</div>

            {/* Buscador */}
            <div style={{ marginBottom: 12 }}>
              <input
                autoFocus
                value={zipSearch}
                onChange={e => setZipSearch(e.target.value)}
                placeholder="Buscar por nombre o RUT..."
                style={{ width: "100%", padding: "9px 13px", borderRadius: 9, border: "1.5px solid #ddd", fontSize: 14, boxSizing: "border-box" }}
              />
            </div>

            {/* Lista de resultados */}
            {zipSearch.trim().length >= 2 && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 9, overflow: "hidden", marginBottom: 14, maxHeight: 220, overflowY: "auto" }}>
                {personas
                  .filter(p => {
                    const q = zipSearch.toLowerCase();
                    return (p.nombre || "").toLowerCase().includes(q) || (p.rut || "").toLowerCase().includes(q);
                  })
                  .slice(0, 20)
                  .map(p => {
                    const yaSelec = zipSeleccionados.some(s => s.id === p.id);
                    return (
                      <div key={p.id} onClick={() => {
                        if (!yaSelec) setZipSeleccionados(prev => [...prev, p]);
                      }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", cursor: yaSelec ? "default" : "pointer", background: yaSelec ? "#F0FDF4" : "#fff", borderBottom: "1px solid #f0f0f0" }}>
                        <div style={{ width: 20, height: 20, borderRadius: 5, border: "2px solid " + (yaSelec ? "#059669" : "#D1D5DB"), background: yaSelec ? "#059669" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, flexShrink: 0 }}>
                          {yaSelec ? "✓" : ""}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e3a5f" }}>{p.nombre}</div>
                          <div style={{ fontSize: 11, color: "#888" }}>{p.rut}</div>
                        </div>
                        {!yaSelec && <span style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>+ Agregar</span>}
                      </div>
                    );
                  })}
                {personas.filter(p => { const q = zipSearch.toLowerCase(); return (p.nombre||"").toLowerCase().includes(q)||(p.rut||"").toLowerCase().includes(q); }).length === 0 && (
                  <div style={{ padding: "16px", textAlign: "center", color: "#aaa", fontSize: 13 }}>No se encontraron solicitantes</div>
                )}
              </div>
            )}

            {/* Seleccionados */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 8 }}>
                Seleccionados ({zipSeleccionados.length})
              </div>
              {zipSeleccionados.length === 0 ? (
                <div style={{ fontSize: 13, color: "#bbb", fontStyle: "italic" }}>Busca y agrega solicitantes arriba</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {zipSeleccionados.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1e3a5f" }}>{p.nombre}</div>
                        <div style={{ fontSize: 11, color: "#6B7280" }}>{p.rut}</div>
                      </div>
                      <button onClick={() => setZipSeleccionados(prev => prev.filter(s => s.id !== p.id))}
                        style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => { setShowModalZip(false); setZipSearch(""); }} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button onClick={descargarZip} disabled={zipSeleccionados.length === 0 || generandoZip}
                style={{ padding: "9px 22px", borderRadius: 8, background: zipSeleccionados.length > 0 && !generandoZip ? "#1e3a5f" : "#aaa", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: zipSeleccionados.length > 0 && !generandoZip ? "pointer" : "not-allowed" }}>
                {generandoZip ? "Generando ZIP..." : `🗜 Descargar ZIP (${zipSeleccionados.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {htmlPreview && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", flexDirection: "column", background: "#111" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: "#1e3a5f", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>📄 Vista previa del documento</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { if (iframePreviewRef.current) iframePreviewRef.current.contentWindow.print(); }}
                style={{ padding: "8px 22px", borderRadius: 7, background: "#fff", color: "#1e3a5f", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                🖨 Imprimir
              </button>
              <button
                onClick={() => setHtmlPreview(null)}
                style={{ padding: "8px 16px", borderRadius: 7, background: "rgba(255,255,255,0.18)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                ✕ Cerrar
              </button>
            </div>
          </div>
          <iframe
            ref={iframePreviewRef}
            srcDoc={htmlPreview}
            title="Vista previa documento"
            style={{ flex: 1, border: "none", width: "100%", background: "#e8e8e8" }}
          />
        </div>
      )}
    </div>
  );
}

// ─── VISTA PROGRAMAS ─────────────────────────────────────────────────────────
const COLORES_PROG = [
  { color: "#2563EB", colorLight: "#EFF6FF" },
  { color: "#059669", colorLight: "#ECFDF5" },
  { color: "#D97706", colorLight: "#FFFBEB" },
  { color: "#DC2626", colorLight: "#FEF2F2" },
  { color: "#7C3AED", colorLight: "#F5F3FF" },
  { color: "#0891B2", colorLight: "#E0F7FA" },
  { color: "#B45309", colorLight: "#FEF9C3" },
  { color: "#166534", colorLight: "#F0FDF4" },
];

function ProgramasView({ solicitudes, programasCustom, onAddPrograma, onDeletePrograma, onUpdatePrograma }) {
  const todosProg = combinarProgramas(programasCustom);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [progSeleccionado, setProgSeleccionado] = useState(null);
  const [claveAdmin, setClaveAdmin] = useState("");
  const [pedirClave, setPedirClave] = useState(false);
  const [claveError, setClaveError] = useState(false);
  const [accionPendiente, setAccionPendiente] = useState(null);
  const [editandoProg, setEditandoProg] = useState(null); // prog que se está editando
  const [formEdit, setFormEdit] = useState(null);
  const pedirClaveAdmin = (tipo, progId, prog) => { setAccionPendiente({ tipo, progId, prog }); setClaveAdmin(""); setClaveError(false); setPedirClave(true); };
  const confirmarClave = async () => {
    if (claveAdmin !== ADMIN_KEY) { setClaveError(true); return; }
    setPedirClave(false);
    if (accionPendiente?.tipo === "eliminar") { await onDeletePrograma(accionPendiente.progId); }
    if (accionPendiente?.tipo === "agregar") { setMostrarForm(true); }
    if (accionPendiente?.tipo === "editar") {
      const p = accionPendiente.prog;
      setFormEdit({ id: p.id, nombre: p.nombre, descripcion: p.descripcion || "", color: p.color || "#2563EB", colorLight: p.colorLight || p.colorlight || "#EFF6FF", icon: p.icon || "P", documentos: (p.documentos || []).map(d => ({ ...d })), esCustom: !!p.esCustom, esBase: !!p.esBase });
      setEditandoProg(p.id);
      setProgSeleccionado(p.id);
    }
    setAccionPendiente(null);
  };
  const addDocEdit = () => setFormEdit(f => ({ ...f, documentos: [...f.documentos, { nombre: "", obligatorio: true, requiereArchivo: true, requiereTexto: false, etiquetaTexto: "" }] }));
  const removeDocEdit = (i) => setFormEdit(f => ({ ...f, documentos: f.documentos.filter((_, j) => j !== i) }));
  const setDocEdit = (i, key, val) => setFormEdit(f => ({ ...f, documentos: f.documentos.map((d, j) => j === i ? { ...d, [key]: val } : d) }));
  const guardarEdicion = async () => {
    if (!formEdit.nombre.trim()) { alert("El nombre es obligatorio."); return; }
    if (formEdit.documentos.some(d => !d.nombre.trim())) { alert("Todos los documentos deben tener nombre."); return; }
    await onUpdatePrograma(formEdit);
    setEditandoProg(null); setFormEdit(null);
  };
  const plantillaMave = () => DOCUMENTOS_MAVE.map(d => ({
    ...d,
    requiereArchivo: d.tipo ? false : !((d.nombre || "").toLowerCase().includes("registro social") || (d.nombre || "").toLowerCase().includes("correo") || (d.nombre || "").toLowerCase().includes("telefono")),
    requiereTexto: false,
    etiquetaTexto: ""
  }));
  const [form, setForm] = useState({
    nombre: "", descripcion: "", color: "#2563EB", colorLight: "#EFF6FF", icon: "N",
    documentos: plantillaMave()
  });

  const colIdx = COLORES_PROG.findIndex(c => c.color === form.color);
  const addDoc = () => setForm(f => ({ ...f, documentos: [...f.documentos, { nombre: "", obligatorio: true, requiereArchivo: true, requiereTexto: false, etiquetaTexto: "" }] }));
  const removeDoc = (i) => setForm(f => ({ ...f, documentos: f.documentos.filter((_, j) => j !== i) }));
  const setDoc = (i, key, val) => setForm(f => ({ ...f, documentos: f.documentos.map((d, j) => j === i ? { ...d, [key]: val } : d) }));
  const htmlSeguro = (txt) => String(txt || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const imprimirRequisitos = (prog) => {
    const win = window.open("", "_blank", "width=900,height=760");
    if (!win) { alert("Permite ventanas emergentes para imprimir."); return; }
    const docs = (prog.documentos || []).map((doc, i) => `
      <tr>
        <td style="width:42px;text-align:center">${i + 1}</td>
        <td>${htmlSeguro(doc.nombre)}</td>
        <td style="width:110px;text-align:center">${doc.obligatorio ? "Obligatorio" : "Opcional"}</td>
        <td style="width:150px">${[
          doc.requiereArchivo ? "Subir archivo" : "",
          doc.requiereTexto ? "Ingresar dato" : "",
          !doc.requiereArchivo && !doc.requiereTexto ? "Marcar VB" : ""
        ].filter(Boolean).join(" / ")}</td>
      </tr>
    `).join("");
    const cuerpo = `
      ${_encabezado()}
      <div style="text-align:center;margin:8px 0 18px">
        <h1 style="font-size:16pt;color:#1e3a5f;margin:0 0 6px">REQUISITOS DEL PROGRAMA</h1>
        <div style="font-size:12pt;font-weight:bold">${htmlSeguro(prog.nombre)}</div>
        ${prog.descripcion ? `<div style="font-size:10pt;color:#555;margin-top:4px">${htmlSeguro(prog.descripcion)}</div>` : ""}
        <div style="font-size:9pt;color:#666;margin-top:6px">Generado el ${new Date().toLocaleDateString("es-CL")}</div>
      </div>
      <table>
        <thead><tr><th>N°</th><th>Documento requerido</th><th>Tipo</th><th>Acción requerida</th></tr></thead>
        <tbody>${docs || `<tr><td colspan="4" style="text-align:center">Sin documentos registrados.</td></tr>`}</tbody>
      </table>
      <div style="margin-top:24px;font-size:9pt;color:#555">
        Estos requisitos corresponden a la configuración vigente del programa en el sistema.
      </div>
    `;
    win.document.write(_wrap("Requisitos del programa", cuerpo));
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 500);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { alert("El nombre del programa es obligatorio."); return; }
    if (form.documentos.some(d => !d.nombre.trim())) { alert("Todos los documentos deben tener nombre."); return; }
    setGuardando(true);
    await onAddPrograma({ ...form, documentos: form.documentos });
    setForm({ nombre: "", descripcion: "", color: "#2563EB", colorLight: "#EFF6FF", icon: "N", documentos: plantillaMave() });
    setMostrarForm(false);
    setGuardando(false);
  };

  const tarjeta = (prog) => {
    const sols = solicitudes.filter(s => s.programaId === prog.id);
    const comp = sols.filter(s => pct(s.documentos, s.programaId) === 100).length;
    return (
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e3de", overflow: "hidden" }}>
        <div style={{ background: prog.colorLight || "#F9FAFB", padding: "18px 24px", borderBottom: "3px solid " + (prog.color || "#6B7280"), display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: prog.color || "#6B7280", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{prog.icon || "P"}</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, color: "#1e3a5f" }}>{prog.nombre}</div>
              <div style={{ fontSize: 13, color: "#666" }}>{prog.descripcion}</div>
              <div style={{ fontSize: 10, color: prog.esCustom ? "#7C3AED" : "#059669", fontWeight: 700 }}>{prog.esCustom ? "Programa personalizado" : prog.editadoAdmin ? "Programa base editado" : "Programa base"}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", gap: 20, textAlign: "center" }}>
              <div><div style={{ fontSize: 22, fontWeight: 800, color: prog.color || "#6B7280" }}>{sols.length}</div><div style={{ fontSize: 11, color: "#888" }}>SOLICITUDES</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 800, color: "#059669" }}>{comp}</div><div style={{ fontSize: 11, color: "#888" }}>COMPLETAS</div></div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={() => imprimirRequisitos(prog)}
                style={{ background:"#F0FDF4", border:"1px solid #BBF7D0", color:"#047857", cursor:"pointer", borderRadius:7, padding:"5px 10px", fontSize:12, fontWeight:700 }} title="Imprimir requisitos">🖨 Imprimir</button>
              <button onClick={() => pedirClaveAdmin("editar", prog.id, prog)}
                style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", color:"#1e3a5f", cursor:"pointer", borderRadius:7, padding:"5px 10px", fontSize:12, fontWeight:700 }} title="Editar programa">✏ Editar</button>
              {prog.esCustom && (
                <button onClick={() => pedirClaveAdmin("eliminar", prog.id, null)}
                  style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 18, lineHeight: 1 }} title="Eliminar programa">✕</button>
              )}
            </div>
          </div>
        </div>
        <div style={{ padding: "18px 24px" }}>
          {editandoProg === prog.id && formEdit ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1e3a5f", marginBottom: 14 }}>✏ Editando programa</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 }}>Nombre *</div>
                  <input value={formEdit.nombre} onChange={e => setFormEdit(f => ({ ...f, nombre: e.target.value }))}
                    style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:"1.5px solid #ddd", fontSize:13, boxSizing:"border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 }}>Descripción</div>
                  <input value={formEdit.descripcion} onChange={e => setFormEdit(f => ({ ...f, descripcion: e.target.value }))}
                    style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:"1.5px solid #ddd", fontSize:13, boxSizing:"border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 }}>Ícono</div>
                  <input value={formEdit.icon} maxLength={2} onChange={e => setFormEdit(f => ({ ...f, icon: e.target.value.toUpperCase() }))}
                    style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:"1.5px solid #ddd", fontSize:13, boxSizing:"border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 }}>Color</div>
                  <div style={{ display:"flex", gap:6 }}>
                    {COLORES_PROG.map((c, i) => (
                      <div key={i} onClick={() => setFormEdit(f => ({ ...f, color: c.color, colorLight: c.colorLight }))}
                        style={{ width:24, height:24, borderRadius:12, background:c.color, cursor:"pointer", border: formEdit.color===c.color?"3px solid #000":"2px solid transparent" }} />
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform:"uppercase", marginBottom: 8 }}>Documentos requeridos</div>
              {formEdit.documentos.map((doc, i) => (
                <div key={i} style={{ background:"#F8FAFC", borderRadius:9, padding:"10px 12px", marginBottom:7, border:"1px solid #E2E8F0" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:6, marginBottom:6 }}>
                    <input value={doc.nombre} onChange={e => setDocEdit(i, "nombre", e.target.value)} placeholder={`Documento ${i+1}`}
                      style={{ padding:"6px 9px", borderRadius:6, border:"1.5px solid #ddd", fontSize:12 }} />
                    <button onClick={() => removeDocEdit(i)} disabled={formEdit.documentos.length===1}
                      style={{ background: formEdit.documentos.length===1?"#f0f0f0":"#FEF2F2", border:"none", borderRadius:6, color: formEdit.documentos.length===1?"#aaa":"#DC2626", cursor: formEdit.documentos.length===1?"default":"pointer", padding:"0 10px", fontWeight:700 }}>✕</button>
                  </div>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                    <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, cursor:"pointer" }}>
                      <input type="checkbox" checked={doc.obligatorio} onChange={e => setDocEdit(i,"obligatorio",e.target.checked)} /> Obligatorio
                    </label>
                    <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, cursor:"pointer" }}>
                      <input type="checkbox" checked={doc.requiereArchivo} onChange={e => setDocEdit(i,"requiereArchivo",e.target.checked)} /> 📎 Archivo
                    </label>
                    <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, cursor:"pointer" }}>
                      <input type="checkbox" checked={doc.requiereTexto} onChange={e => setDocEdit(i,"requiereTexto",e.target.checked)} /> 📝 Texto
                    </label>
                  </div>
                </div>
              ))}
              <button onClick={addDocEdit} style={{ padding:"6px 14px", borderRadius:7, border:"1.5px dashed #1e3a5f", background:"transparent", color:"#1e3a5f", fontSize:12, fontWeight:600, cursor:"pointer", marginBottom:12 }}>+ Agregar documento</button>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => { setEditandoProg(null); setFormEdit(null); }} style={{ padding:"7px 16px", borderRadius:7, border:"1px solid #ddd", background:"#fff", fontSize:13, cursor:"pointer" }}>Cancelar</button>
                <button onClick={guardarEdicion} style={{ padding:"7px 18px", borderRadius:7, background:"#059669", color:"#fff", border:"none", fontSize:13, fontWeight:700, cursor:"pointer" }}>💾 Guardar cambios</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 12 }}>Documentos requeridos ({prog.documentos.length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {prog.documentos.map((doc, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 8, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                    <div style={{ width: 6, height: 6, borderRadius: 3, background: doc.obligatorio ? (prog.color || "#6B7280") : "#CBD5E0", marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, color: "#374151" }}>{doc.nombre}</div>
                      <div style={{ fontSize: 10, color: "#aaa" }}>
                        {!doc.obligatorio && "Opcional · "}
                        {doc.requiereArchivo && "📎 Archivo · "}
                        {doc.requiereTexto && "📝 Texto"}
                        {!doc.requiereArchivo && !doc.requiereTexto && "Checkbox"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Programas</div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Programas de subsidio y documentos requeridos</div>
        </div>
        <button onClick={() => { if (mostrarForm) setMostrarForm(false); else pedirClaveAdmin("agregar", null); }}
          style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 9, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {mostrarForm ? "✕ Cancelar" : "+ Agregar Programa"}
        </button>
      </div>

      {mostrarForm && (
        <div style={{ background: "#fff", borderRadius: 14, border: "2px solid #1e3a5f", padding: "24px 28px", marginBottom: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e3a5f", marginBottom: 20 }}>Nuevo Programa</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 }}>Nombre del programa *</div>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Subsidio Vivienda Rural"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 }}>Descripción</div>
              <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Breve descripción del programa"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 }}>Ícono (letra)</div>
              <input value={form.icon} maxLength={2} onChange={e => setForm(f => ({ ...f, icon: e.target.value.toUpperCase() }))} placeholder="Ej: S"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 }}>Color</div>
              <div style={{ display: "flex", gap: 8 }}>
                {COLORES_PROG.map((c, i) => (
                  <div key={i} onClick={() => setForm(f => ({ ...f, color: c.color, colorLight: c.colorLight }))}
                    style={{ width: 28, height: 28, borderRadius: 14, background: c.color, cursor: "pointer", border: form.color === c.color ? "3px solid #000" : "2px solid transparent" }} />
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", textTransform: "uppercase" }}>Documentos requeridos</div>
              <button type="button" onClick={() => setForm(f => ({ ...f, documentos: plantillaMave() }))}
                style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #D97706", background: "#FFFBEB", color: "#92400E", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                Usar estructura MAVE
              </button>
            </div>
            {form.documentos.map((doc, i) => (
              <div key={i} style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: "1px solid #E2E8F0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 8 }}>
                  <input value={doc.nombre} onChange={e => setDoc(i, "nombre", e.target.value)} placeholder={`Nombre del documento ${i + 1}`}
                    style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #ddd", fontSize: 13 }} />
                  <button onClick={() => removeDoc(i)} disabled={form.documentos.length === 1}
                    style={{ background: form.documentos.length === 1 ? "#f0f0f0" : "#FEF2F2", border: "none", borderRadius: 7, color: form.documentos.length === 1 ? "#aaa" : "#DC2626", cursor: form.documentos.length === 1 ? "default" : "pointer", padding: "0 12px", fontWeight: 700 }}>✕</button>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={doc.obligatorio} onChange={e => setDoc(i, "obligatorio", e.target.checked)} />
                    Obligatorio
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={doc.requiereArchivo} onChange={e => setDoc(i, "requiereArchivo", e.target.checked)} />
                    📎 Requiere subir archivo
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={doc.requiereTexto} onChange={e => setDoc(i, "requiereTexto", e.target.checked)} />
                    📝 Requiere texto adicional
                  </label>
                  {doc.requiereTexto && (
                    <input value={doc.etiquetaTexto} onChange={e => setDoc(i, "etiquetaTexto", e.target.value)} placeholder="Etiqueta del campo texto"
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12, width: 180 }} />
                  )}
                </div>
              </div>
            ))}
            <button onClick={addDoc}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px dashed #1e3a5f", background: "transparent", color: "#1e3a5f", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              + Agregar documento
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => setMostrarForm(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardar} disabled={guardando}
              style={{ padding: "9px 22px", borderRadius: 8, background: guardando ? "#aaa" : "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: guardando ? "not-allowed" : "pointer" }}>
              {guardando ? "Guardando..." : "Guardar Programa"}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e3de", padding: "22px 26px", marginBottom: 18 }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: "#1e3a5f", marginBottom: 8 }}>Solicitante registrador</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#333", marginBottom: 14 }}>¿Programa de solicitud? *</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {todosProg.map(prog => {
            const activo = progSeleccionado === prog.id;
            return (
              <button key={prog.id} onClick={() => { setProgSeleccionado(prog.id); setMostrarForm(false); }}
                style={{ minHeight: 190, padding: "18px 16px", borderRadius: 12, border: "3px solid " + (activo ? (prog.color || "#1e3a5f") : "#ddd"), background: activo ? (prog.colorLight || "#F8FAFC") : "#fafafa", cursor: "pointer", textAlign: "center", boxShadow: activo ? "0 10px 24px rgba(30,58,95,0.12)" : "none" }}>
                <ProgramaFigura programa={prog} size={66} />
                <div style={{ fontSize: 17, fontWeight: 900, color: "#333", marginTop: 10, lineHeight: 1.25 }}>{prog.nombre}</div>
                <div style={{ fontSize: 13, color: "#888", marginTop: 5, lineHeight: 1.35 }}>{prog.descripcion || "Con comité"}</div>
                <div style={{ fontSize: 11, color: prog.esCustom ? "#7C3AED" : "#059669", fontWeight: 800, marginTop: 8 }}>{prog.esCustom ? "Personalizado" : "Base"}</div>
              </button>
            );
          })}
        </div>
      </div>

      {progSeleccionado && (() => {
        const prog = todosProg.find(p => p.id === progSeleccionado);
        return prog ? tarjeta(prog) : null;
      })()}

      {pedirClave && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000 }}
          onClick={() => setPedirClave(false)}>
          <div style={{ background:"#fff", borderRadius:14, padding:"28px 32px", width:360, boxShadow:"0 24px 64px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:800, color:"#1e3a5f", marginBottom:8 }}>🔒 Clave de administrador</div>
            <div style={{ fontSize:13, color:"#555", marginBottom:16 }}>
              {accionPendiente?.tipo === "eliminar"
                ? "Ingresa la clave para eliminar este programa."
                : accionPendiente?.tipo === "editar"
                  ? "Ingresa la clave para editar documentos y datos del programa."
                  : "Ingresa la clave para agregar un nuevo programa."}
            </div>
            <input type="password" autoFocus value={claveAdmin}
              onChange={e => { setClaveAdmin(e.target.value); setClaveError(false); }}
              onKeyDown={e => e.key === "Enter" && confirmarClave()}
              placeholder="Clave de administrador"
              style={{ width:"100%", padding:"10px 12px", borderRadius:8, border: claveError ? "2px solid #DC2626" : "1.5px solid #ddd", fontSize:14, boxSizing:"border-box", marginBottom:6 }} />
            {claveError && <div style={{ color:"#DC2626", fontSize:12, marginBottom:8 }}>Clave incorrecta.</div>}
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:12 }}>
              <button onClick={() => setPedirClave(false)} style={{ padding:"8px 16px", borderRadius:8, border:"1px solid #ddd", background:"#fff", fontSize:13, cursor:"pointer" }}>Cancelar</button>
              <button onClick={confirmarClave} style={{ padding:"8px 18px", borderRadius:8, background:"#1e3a5f", color:"#fff", border:"none", fontSize:13, fontWeight:700, cursor:"pointer" }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA SIN COMITÉ ─────────────────────────────────────────────────────────
function SinComiteView({ personas, comites, solicitudes, programasCustom = [], onSavePersonas, onSaveSolicitudes, onDetail }) {
  const [search, setSearch] = useState("");
  const [filtroSector, setFiltroSector] = useState("");
  const [seleccionados, setSeleccionados] = useState([]);
  const [comiteDestino, setComiteDestino] = useState("");
  const [showModalMigrar, setShowModalMigrar] = useState(false);
  const [migrando, setMigrando] = useState(false);
  const [claveMigrar, setClaveMigrar] = useState("");
  const [clavePaso, setClavePaso] = useState(false); // true = clave ya validada
  const todosProgramas = combinarProgramas(programasCustom);

  const normLocal = (v) => (v || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const rutKey = (v) => (v || "").toString().replace(/[^0-9kK]/g, "").toUpperCase();
  const comitesDisponibles = [
    ...COMITES_FIJOS.map(c => ({ id: c.codigo, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo })),
    ...(comites || [])
  ];
  const nombreComitePorId = (id) => {
    if (!id) return "";
    const comite = comitesDisponibles.find(c => c.id === id || c.codigo === id);
    return comite?.nombre || "";
  };
  const nombreComiteAsignado = (p) => {
    const porId = nombreComitePorId(p.comiteId);
    return porId || p.comite || "";
  };
  const comitesPorCedula = new Map();
  personas.forEach(p => {
    const key = rutKey(p.rut);
    const nombreComite = nombreComiteAsignado(p);
    if (!key || !nombreComite) return;
    const actuales = comitesPorCedula.get(key) || [];
    const existe = actuales.some(c => normLocal(c) === normLocal(nombreComite));
    if (!existe) comitesPorCedula.set(key, [...actuales, nombreComite]);
  });
  const comitesPersonaPorCedula = (p) => comitesPorCedula.get(rutKey(p.rut)) || [];
  const textoComitesPersona = (p) => {
    const nombres = comitesPersonaPorCedula(p);
    return nombres.length ? nombres.map(nombre => `Comité: ${nombre}`).join(" | ") : "SIN COMITE";
  };
  const tieneSolicitudDesmarque = (personaId) => solicitudes.some(s => s.personaId === personaId && s.programaId === "habitabilidad");
  const solicitudDesmarquePersona = (personaId) => solicitudes.find(s => s.personaId === personaId && s.programaId === "habitabilidad");
  const estadoDesmarquePersona = (p) => {
    const sol = solicitudes.find(s => s.personaId === p.id && s.programaId === "habitabilidad");
    const estado = estadoActualLineaDesmarque(sol, p.estado_desmarque || p.estadoDesmarque || "");
    return estado;
  };
  const estadoSeguimiento = (p) => {
    const estado = estadoDesmarquePersona(p);
    const clave = normLocal(`${estado.key} ${estado.label} ${p.estado_desmarque || ""}`).toUpperCase();
    if (clave.includes("DESMARCADO")) return "DESMARCADO";
    if (clave.includes("RECHAZADO APELABLE")) return "RECHAZADO APELABLE";
    if (clave.includes("INFORME EN SERVIU")) return "INFORME EN SERVIU";
    return "";
  };
  const comitePersona = (p) => {
    return textoComitesPersona(p);
  };
  const sinComite = personas.filter(p => {
    const sinAsignacionDirecta = !p.comiteId || p.comiteId === "" || p.comiteId === null;
    const esSeguimientoSinComite = estadoSeguimiento(p) && comitesPersonaPorCedula(p).length === 0;
    return sinAsignacionDirecta || esSeguimientoSinComite;
  });
  const sectoresDesmarque = [...new Set(
    sinComite
      .filter(p => tieneSolicitudDesmarque(p.id))
      .map(p => (p.sector || p.direccion || "").toString().trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));
  const seguimientoPorCedula = new Map();
  personas
    .filter(p => tieneSolicitudDesmarque(p.id))
    .forEach(p => {
      const key = rutKey(p.rut) || p.id;
      const estado = estadoSeguimiento(p);
      if (!estado) return;
      const actual = seguimientoPorCedula.get(key);
      const item = { persona: p, estado, comite: comitePersona(p) };
      if (!actual || (actual.comite === "SIN COMITE" && item.comite !== "SIN COMITE")) {
        seguimientoPorCedula.set(key, item);
      }
    });
  const seguimientoDesmarque = Array.from(seguimientoPorCedula.values())
    .sort((a, b) => a.persona.nombre.localeCompare(b.persona.nombre, "es"));
  const imprimirSeguimientoDesmarque = () => {
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const filas = seguimientoDesmarque.map(({ persona: p, estado, comite }) => ({
      rut: formatRut(p.rut),
      nombre: p.nombre || "",
      estado,
      comite
    }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Informe Desmarque</title>
      <style>
        body{font-family:Arial,sans-serif;color:#111827;margin:28px}
        h1{font-size:20px;color:#1e3a5f;margin:0 0 4px}
        .sub{font-size:12px;color:#6b7280;margin-bottom:18px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top}
        th{background:#eff6ff;color:#1e3a5f}
        .sin{color:#b91c1c;font-weight:700}
      </style></head><body>
      <h1>Informe Habitabilidad de Vivienda (DESMARQUE DE VIVIENDA)</h1>
      <div class="sub">Estados: DESMARCADO, RECHAZADO APELABLE o INFORME EN SERVIU. Búsqueda de comité realizada solo por cédula de identidad.</div>
      <table><thead><tr><th>Cédula de identidad</th><th>Solicitante</th><th>Estado</th><th>Comités encontrados</th><th>Línea solicitada</th></tr></thead><tbody>
      ${filas.map(f => `<tr><td>${esc(f.rut)}</td><td>${esc(f.nombre)}</td><td>${esc(f.estado)}</td><td class="${f.comite === "SIN COMITE" ? "sin" : ""}">${esc(f.comite)}</td><td>${esc(`${f.rut}= Estado=${f.estado}=${f.comite}`)}</td></tr>`).join("")}
      </tbody></table></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  const filtered = sinComite.filter(p => {
    const q = normLocal(search);
    const texto = normLocal(`${p.nombre || ""} ${p.rut || ""} ${p.comuna || ""} ${p.sector || ""}`);
    if (q && !texto.includes(q)) return false;
    if (filtroSector && normLocal(p.sector || p.direccion) !== normLocal(filtroSector)) return false;
    return true;
  });

  const toggleSeleccionar = (id) => {
    setSeleccionados(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const seleccionarTodos = () => {
    if (seleccionados.length === filtered.length) {
      setSeleccionados([]);
    } else {
      setSeleccionados(filtered.map(p => p.id));
    }
  };

  const migrar = async () => {
    if (!comiteDestino || seleccionados.length === 0) return;
    setMigrando(true);
    const comite = comites.find(c => c.id === comiteDestino);
    const nuevasPersonas = personas.map(p => {
      if (!seleccionados.includes(p.id)) return p;
      return { ...p, comiteId: comiteDestino, comite: comite ? comite.nombre : "" };
    });
    // Actualizar en Supabase
    const { supabase: sb } = await import("./supabaseClient");
    for (const id of seleccionados) {
      await sb.from("personas").update({ comite_id: comiteDestino, comite: comite ? comite.nombre : "" }).eq("id", id);
    }
    // Si el comité es de un programa, crear solicitudes automáticamente
    if (comite && comite.programaId) {
      const prog = todosProgramas.find(p2 => p2.id === comite.programaId);
      if (prog) {
        const nuevasSols = [...solicitudes];
        for (const id of seleccionados) {
          const persona = personas.find(p2 => p2.id === id);
          const yaExiste = solicitudes.find(s => s.personaId === id && s.programaId === prog.id);
          if (!yaExiste && persona) {
            const nuevaSol = {
              id: uid(), personaId: id, personaNombre: persona.nombre,
              programaId: prog.id, fecha: today(),
              documentos: prog.documentos.map(d => ({
                nombre: d.nombre, obligatorio: d.obligatorio, entregado: false,
                tipo: d.tipo || null, opciones: d.opciones || null, opcionSeleccionada: null, etiqueta: null, valor: d.valor || "",
                requiereArchivo: !!d.requiereArchivo, requiereTexto: !!d.requiereTexto, etiquetaTexto: d.etiquetaTexto || ""
              }))
            };
            await sb.from("solicitudes").insert([{
              id: nuevaSol.id, persona_id: nuevaSol.personaId, persona_nombre: nuevaSol.personaNombre,
              programa_id: nuevaSol.programaId, fecha: nuevaSol.fecha, documentos: nuevaSol.documentos
            }]);
            nuevasSols.push(nuevaSol);
          }
        }
        onSaveSolicitudes(nuevasSols);
      }
    }
    onSavePersonas(nuevasPersonas);
    setSeleccionados([]);
    setComiteDestino("");
    setShowModalMigrar(false);
    setClaveMigrar("");
    setClavePaso(false);
    setMigrando(false);
    alert(`✅ ${seleccionados.length} solicitante(s) migrado(s) al comité "${comite ? comite.nombre : comiteDestino}"`);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Sin Comité</div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>
            {sinComite.length} solicitante(s) pendientes de asignación
          </div>
        </div>
        {seleccionados.length > 0 && (
          <button onClick={() => setShowModalMigrar(true)}
            style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            📦 Migrar {seleccionados.length} seleccionado(s)
          </button>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, border: "1px solid #e8e3de", flexWrap: "wrap" }}>
        <input placeholder="Buscar por nombre, RUT, comuna o sector..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ border: "none", outline: "none", fontSize: 14, flex: 1 }} />
        <select value={filtroSector} onChange={e => setFiltroSector(e.target.value)}
          style={{ border: "1px solid #ddd", borderRadius: 8, padding: "7px 10px", fontSize: 13, minWidth: 230, background: "#fff" }}>
          <option value="">Todos los sectores Desmarque</option>
          {sectoresDesmarque.map(sector => <option key={sector} value={sector}>{sector}</option>)}
        </select>
        {filtered.length > 0 && (
          <button onClick={seleccionarTodos}
            style={{ background: "none", border: "1px solid #ddd", borderRadius: 7, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: "#555", fontWeight: 600 }}>
            {seleccionados.length === filtered.length ? "Deseleccionar todos" : "Seleccionar todos"}
          </button>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", marginBottom: 18, border: "1px solid #e8e3de" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#1e3a5f", marginBottom: 4 }}>Seguimiento Desmarque</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Solicitantes en DESMARCADO, RECHAZADO APELABLE o INFORME EN SERVIU. La revisión de comité usa solo la cédula de identidad.</div>
          </div>
          {seguimientoDesmarque.length > 0 && (
            <button onClick={imprimirSeguimientoDesmarque}
              style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              Imprimir informe
            </button>
          )}
        </div>
        {seguimientoDesmarque.length === 0 ? (
          <div style={{ fontSize: 13, color: "#999", padding: "10px 0" }}>No hay solicitantes en estado DESMARCADO, RECHAZADO APELABLE o INFORME EN SERVIU.</div>
        ) : (
          <div style={{ display: "grid", gap: 7 }}>
            {seguimientoDesmarque.map(({ persona: p, estado, comite }) => (
              <div key={rutKey(p.rut) || p.id} style={{ display: "grid", gridTemplateColumns: "150px 1.4fr 180px 1fr", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 9, background: estado === "DESMARCADO" ? "#E0F7FA" : estado === "RECHAZADO APELABLE" ? "#FEF3C7" : "#ECFDF5", border: "1px solid " + (estado === "DESMARCADO" ? "#99F6E4" : estado === "RECHAZADO APELABLE" ? "#FDE68A" : "#BBF7D0") }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#111827" }}>{formatRut(p.rut)}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1e3a5f" }}>{p.nombre}</div>
                <div style={{ fontSize: 12, fontWeight: 900, color: estado === "DESMARCADO" ? "#0E7490" : estado === "RECHAZADO APELABLE" ? "#A16207" : "#166534" }}>{estado}</div>
                <div style={{ fontSize: 12, color: comite === "SIN COMITE" ? "#B91C1C" : "#374151", fontWeight: 700 }}>{comite}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>
          {sinComite.length === 0 ? "✅ Todos los solicitantes tienen comité asignado." : "No hay resultados para la búsqueda."}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map(p => {
          const sel = seleccionados.includes(p.id);
          const misSols = solicitudes.filter(s => s.personaId === p.id);
          const solHabitabilidad = solicitudDesmarquePersona(p.id);
          const estadoDesmarqueVisible = solHabitabilidad ? estadoActualLineaDesmarque(solHabitabilidad, p.estado_desmarque || p.estadoDesmarque || "") : null;
          return (
            <div key={p.id} style={{
              background: sel ? "#EFF6FF" : "#fff", borderRadius: 12, padding: "14px 18px",
              border: "2px solid " + (sel ? "#2563EB" : "#e8e3de"),
              display: "flex", alignItems: "center", gap: 14, cursor: "pointer"
            }}
              onClick={() => toggleSeleccionar(p.id)}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 6, border: "2px solid " + (sel ? "#2563EB" : "#ccc"),
                background: sel ? "#2563EB" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
              }}>
                {sel && <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>✓</span>}
              </div>
              <div style={{ width: 40, height: 40, borderRadius: 20, background: "#1e3a5f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 17, flexShrink: 0 }}>
                {p.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1e3a5f" }}>{p.nombre}</div>
                <div style={{ fontSize: 13, color: "#888" }}>
                  RUT: {p.rut}{p.comuna ? " · " + p.comuna : ""}
                  {p.fechaIngreso || p.fecha_ingreso ? " · Ingreso: " + (p.fechaIngreso || p.fecha_ingreso) : ""}
                </div>
                {misSols.length > 0 && (
                  <div style={{ fontSize: 12, color: "#7C3AED", marginTop: 2 }}>
                    📋 {misSols.length} programa(s) asignado(s): {misSols.map(s => {
                      const prog = todosProgramas.find(pr => pr.id === s.programaId);
                      return prog ? prog.nombre.split(" ")[0] : s.programaId;
                    }).join(", ")}
                  </div>
                )}
                {estadoDesmarqueVisible && (
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ background: estadoDesmarqueVisible.bg, color: estadoDesmarqueVisible.color, borderRadius: 10, padding: "2px 10px", fontSize: 11, fontWeight: 800 }}>
                      {estadoDesmarqueVisible.label}
                    </span>
                  </div>
                )}
              </div>
              <button onClick={e => { e.stopPropagation(); onDetail(p.id); }}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                Ver ficha
              </button>
            </div>
          );
        })}
      </div>

      {/* MODAL MIGRAR */}
      {showModalMigrar && (
        <Modal title="Migrar solicitantes a comité" onClose={() => { setShowModalMigrar(false); setClaveMigrar(""); setClavePaso(false); }}>
          {!clavePaso ? (
            <div>
              <div style={{ background: "#FFF3CD", borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13, color: "#856404" }}>
                ⚠️ Esta acción moverá <strong>{seleccionados.length}</strong> solicitante(s) a un comité.<br />Ingrese la clave de seguridad para continuar.
              </div>
              <input
                type="password" autoComplete="new-password"
                placeholder="Clave de seguridad"
                value={claveMigrar}
                onChange={e => setClaveMigrar(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    if (claveMigrar === ADMIN_KEY) { setClavePaso(true); setClaveMigrar(""); }
                    else { alert("Clave incorrecta."); setClaveMigrar(""); }
                  }
                }}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 9, border: "1.5px solid #ddd", fontSize: 15, boxSizing: "border-box", marginBottom: 14 }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => { setShowModalMigrar(false); setClaveMigrar(""); }}
                  style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                <button onClick={() => {
                  if (claveMigrar === ADMIN_KEY) { setClavePaso(true); setClaveMigrar(""); }
                  else { alert("Clave incorrecta."); setClaveMigrar(""); }
                }}
                  style={{ padding: "9px 20px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Confirmar</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ background: "#E0F7FA", borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13, color: "#0891B2", fontWeight: 600 }}>
                ✅ Clave correcta. Seleccione el comité de destino para {seleccionados.length} solicitante(s):
              </div>
              <select value={comiteDestino} onChange={e => setComiteDestino(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 9, border: "1.5px solid #ddd", fontSize: 14, background: "#fff", marginBottom: 14, boxSizing: "border-box" }}>
                <option value="">-- Seleccionar comité --</option>
                {comites.map(c => {
                  const prog = todosProgramas.find(p2 => p2.id === c.programaId);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.nombre}{prog ? " (" + prog.nombre.split(" ")[0] + ")" : ""}
                    </option>
                  );
                })}
              </select>
              {comiteDestino && (
                <div style={{ background: "#F0FDF4", borderRadius: 9, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#059669" }}>
                  📋 Comité seleccionado: <strong>{comites.find(c => c.id === comiteDestino)?.nombre}</strong>
                  {(() => {
                    const c = comites.find(c2 => c2.id === comiteDestino);
                    const prog = c ? todosProgramas.find(p2 => p2.id === c.programaId) : null;
                    return prog ? <span> · Programa: <strong>{prog.nombre}</strong></span> : null;
                  })()}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => { setShowModalMigrar(false); setClaveMigrar(""); setClavePaso(false); }}
                  style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                <button onClick={migrar} disabled={!comiteDestino || migrando}
                  style={{ padding: "9px 20px", borderRadius: 8, background: comiteDestino ? "#059669" : "#ccc", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: comiteDestino ? "pointer" : "not-allowed" }}>
                  {migrando ? "Migrando..." : "✅ Migrar al comité"}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── VISTA SOLICITUDES ────────────────────────────────────────────────────────
function SolicitudesView({ solicitudes, personas = [], programasCustom = [], onDetail }) {
  const [filtProg, setFiltProg] = useState("todos");
  const [filtEst, setFiltEst] = useState("todos");
  const [search, setSearch] = useState("");
  const [personaSelId, setPersonaSelId] = useState(null);
  const todosProgramas = combinarProgramas(programasCustom);

  const normBuscar = (txt) => (txt || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9k]+/g, " ").trim();
  const rutBuscar = (rut) => (rut || "").toString().toLowerCase().replace(/[^0-9k]/g, "");
  const idsRelacionados = (persona) => {
    if (!persona) return new Set();
    const rk = rutBuscar(persona.rut);
    const nk = normBuscar(persona.nombre);
    return new Set(personas.filter(p => {
      if (rk) return rutBuscar(p.rut) === rk;
      return nk && normBuscar(p.nombre) === nk;
    }).map(p => p.id));
  };
  const personaSeleccionada = personas.find(p => p.id === personaSelId) || null;
  const personaIdsSeleccionados = idsRelacionados(personaSeleccionada);
  const term = normBuscar(search);
  const buscaPorCedula = /[0-9]/.test(search) && rutBuscar(search).length >= 7;
  const cedulaBusquedaValida = !buscaPorCedula || rutFormatoChilenoValido(search);
  const resultadosPersonas = term.length >= 2
    ? personas.filter(p => {
        if (buscaPorCedula) {
          if (!cedulaBusquedaValida) return false;
          return rutBuscar(p.rut) === rutBuscar(search);
        }
        return normBuscar(`${p.nombre || ""} ${p.rut || ""}`).includes(term);
      }).slice(0, 12)
    : [];

  const solicitudesBase = personaSeleccionada
    ? solicitudes.filter(s => personaIdsSeleccionados.has(s.personaId) || personaIdsSeleccionados.has(s.persona_id))
    : solicitudes;

  const filtered = solicitudesBase.filter(s => {
    const docs = s.documentos || [];
    const p = pct(docs, s.programaId);
    if (filtProg !== "todos" && s.programaId !== filtProg) return false;
    if (filtEst === "completas" && p < 100) return false;
    if (filtEst === "incompletas" && p === 100) return false;
    return true;
  });

  const completas = solicitudesBase.filter(s => pct(s.documentos || [], s.programaId) === 100).length;
  const conteoDocsSolicitudes = solicitudesBase.reduce((acc, s) => {
    const c = conteoDocumentosSolicitud(s.documentos || [], s.programaId);
    return { completos: acc.completos + c.completos, total: acc.total + c.total };
  }, { completos: 0, total: 0 });
  const docsEntregados = conteoDocsSolicitudes.completos;
  const docsTotal = conteoDocsSolicitudes.total;
  const docsPendientes = docsTotal - docsEntregados;

  const seleccionarPersona = (persona) => {
    setPersonaSelId(persona.id);
    setSearch(`${persona.nombre || ""} ${persona.rut ? "- " + persona.rut : ""}`);
  };

  const limpiarPersona = () => {
    setPersonaSelId(null);
    setSearch("");
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Solicitudes</div>
        <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Busca un solicitante por nombre o cédula de identidad para ver sus solicitudes, programas y documentos.</div>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, padding: 18, border: "1px solid #e8e3de", marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#1e3a5f", marginBottom: 8, textTransform: "uppercase" }}>Buscar solicitante</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); if (personaSelId) setPersonaSelId(null); }}
            placeholder="Escribe nombre o cédula/RUT"
            style={{ padding: "11px 14px", borderRadius: 8, border: "1px solid " + (buscaPorCedula && !cedulaBusquedaValida ? "#DC2626" : "#ddd"), fontSize: 14, background: "#fff" }}
          />
          <button onClick={limpiarPersona} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#f8fafc", color: "#555", fontWeight: 700, cursor: "pointer" }}>
            Limpiar
          </button>
        </div>

        {!personaSeleccionada && term.length > 0 && term.length < 2 && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#888" }}>Escribe al menos 2 caracteres para buscar.</div>
        )}

        {!personaSeleccionada && buscaPorCedula && !cedulaBusquedaValida && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#DC2626", fontWeight: 700 }}>
            La cédula ingresada no es válida para Chile. Debe tener dígito verificador correcto.
          </div>
        )}

        {!personaSeleccionada && buscaPorCedula && cedulaBusquedaValida && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#059669", fontWeight: 700 }}>
            Cédula válida: {formatRut(search)}
          </div>
        )}

        {!personaSeleccionada && resultadosPersonas.length > 0 && (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {resultadosPersonas.map(p => {
              const idsPersona = idsRelacionados(p);
              const solsPersona = solicitudes.filter(s => idsPersona.has(s.personaId) || idsPersona.has(s.persona_id));
              const docsPersona = solsPersona.flatMap(s => s.documentos || []);
              const entregados = solsPersona.reduce((acc, s) => {
                const docs = s.documentos || [];
                return acc + docs.filter(d => docCompletoEquivalente(d, docs)).length;
              }, 0);
              return (
                <button key={p.id} onClick={() => seleccionarPersona(p)}
                  style={{ textAlign: "left", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: "11px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <span>
                    <span style={{ display: "block", fontWeight: 800, color: "#111827" }}>{p.nombre}</span>
                    <span style={{ display: "block", fontSize: 12, color: "#6b7280" }}>Cédula: {p.rut || "—"} · {p.comite || "Sin comité"}</span>
                  </span>
                  <span style={{ fontSize: 12, color: "#1e3a5f", fontWeight: 800 }}>{solsPersona.length} programa(s) · {entregados}/{docsPersona.length} docs</span>
                </button>
              );
            })}
          </div>
        )}

        {!personaSeleccionada && term.length >= 2 && resultadosPersonas.length === 0 && (
          <div style={{ marginTop: 12, color: "#999", fontSize: 13 }}>No se encontraron solicitantes con esa búsqueda.</div>
        )}

        {personaSeleccionada && (
          <div style={{ marginTop: 14, background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#1e3a5f" }}>{personaSeleccionada.nombre}</div>
                <div style={{ fontSize: 13, color: "#475569", marginTop: 3 }}>
                  Cédula: {personaSeleccionada.rut || "—"} · Comité: {personaSeleccionada.comite || "Sin comité"}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                  Solicitudes activas: {solicitudesBase.length} · Documentos: {docsEntregados}/{docsTotal} · Pendientes: {docsPendientes}
                </div>
              </div>
              {onDetail && (
                <button onClick={() => onDetail(personaSeleccionada.id)}
                  style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "#1e3a5f", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
                  Ver ficha completa
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 22 }}>
        {[["Total", solicitudesBase.length, "#1e3a5f"], ["Completas", completas, "#059669"], ["Pendientes", solicitudesBase.length - completas, "#DC2626"]].map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #e8e3de", display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase" }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <select value={filtProg} onChange={e => setFiltProg(e.target.value)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, background: "#fff" }}>
          <option value="todos">Todos los programas</option>
          {todosProgramas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {["todos", "completas", "incompletas"].map(k => (
          <button key={k} onClick={() => setFiltEst(k)} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid " + (filtEst === k ? "#1e3a5f" : "#ddd"), background: filtEst === k ? "#1e3a5f" : "#fff", color: filtEst === k ? "#fff" : "#555", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {k === "todos" ? "Todas" : k === "completas" ? "Completas" : "Incompletas"}
          </button>
        ))}
      </div>
      {filtered.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>No hay solicitudes.</div>}
      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map(s => {
          const prog = todosProgramas.find(p => p.id === s.programaId);
          const docs = s.documentos || [];
          const p = pct(docs, s.programaId);
          const conteo = conteoDocumentosSolicitud(docs, s.programaId);
          const ok = conteo.completos;
          return (
            <div key={s.id} style={{ background: "#fff", borderRadius: 12, padding: "16px 22px", border: "1px solid #e8e3de" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 16, background: prog ? prog.colorLight : "#eee", color: prog ? prog.color : "#666", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{prog ? prog.icon : "?"}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{s.personaNombre}</div>
                    <div style={{ fontSize: 12, color: "#888" }}>{prog ? prog.nombre : s.programaId} - {s.fecha}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ background: statusBg(p), color: statusColor(p), borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>{statusLabel(p)}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: statusColor(p) }}>{ok}/{conteo.total}</div>
                </div>
              </div>
              <div style={{ height: 5, background: "#f0ede8", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: p + "%", background: statusColor(p), borderRadius: 3 }} />
              </div>

              {personaSeleccionada && (
                <div style={{ marginTop: 14, borderTop: "1px solid #f0ede8", paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#444", textTransform: "uppercase", marginBottom: 8 }}>Documentos que debe presentar</div>
                  <div style={{ display: "grid", gap: 7 }}>
                    {docs.map((d, i) => {
                      const completoDoc = docCompletoEquivalente(d, docs);
                      return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 8, border: "1px solid " + (completoDoc ? "#BBF7D0" : "#FECACA"), background: completoDoc ? "#F0FDF4" : "#FEF2F2" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#1f2937" }}>{d.nombre}</div>
                          {d.valor && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{d.valor}</div>}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: d.obligatorio ? "#B45309" : "#64748b", textTransform: "uppercase" }}>
                          {d.obligatorio ? "Obligatorio" : "Opcional"}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: completoDoc ? "#047857" : "#DC2626" }}>
                          {completoDoc ? "Entregado" : "Pendiente"}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DETALLE COMITÉ ───────────────────────────────────────────────────────────
function DetalleComite({ comiteId, comites, personas, solicitudes, programasCustom = [], onBack, onSavePersonas, onSaveSolicitudes, onDetail, currentUser, registrarAuditoria }) {
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [tabDesmarque, setTabDesmarque] = useState("todos");
  const [filtroTipoListos, setFiltroTipoListos] = useState("");
  const [filtroLugarRuralListos, setFiltroLugarRuralListos] = useState("");
  const [showModalPersona, setShowModalPersona] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [claveInput, setClaveInput] = useState("");
  const [claveError, setClaveError] = useState(false);
  const [personaMover, setPersonaMover] = useState(null);
  const [comiteDestinoMover, setComiteDestinoMover] = useState("");
  const [motivoMovimiento, setMotivoMovimiento] = useState("");
  const [moviendoPersona, setMoviendoPersona] = useState(false);
  const [personaCondicional, setPersonaCondicional] = useState(null);
  const [notaCondicional, setNotaCondicional] = useState("");
  const [guardandoCondicional, setGuardandoCondicional] = useState(false);
  const EMPTY = { nombre: "", rut: "", fechaNacimiento: "", telefono: "", email: "", direccion: "", comuna: "", integrantesFamiliares: "", puntajeRSH: "", comiteId };
  const [form, setForm] = useState(EMPTY);

  const comite = comites.find(c => c.id === comiteId);
  if (!comite) return null;

  const esComiteDesmarque = comiteId === "comite_desmarque" || comite.programaId === "habitabilidad" || /DESMARQUE/i.test(comite.nombre || "");
  const todosProgramas = combinarProgramas(programasCustom);
  const comitesDestino = [
    { id: "comite_desmarque", nombre: "DESMARQUE DE VIVIENDA", tipo: "DESMARQUE", programaId: "habitabilidad" },
    ...COMITES_FIJOS.map(c => ({
      id: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      programaId: c.tipo === "URBANO" ? "csp_urbano" : "csp_rural",
    })),
    ...(comites || []),
  ].filter((c, idx, arr) => c.id !== comiteId && arr.findIndex(x => x.id === c.id) === idx);

  const ordenarSolicitantes = (lista = []) => [...lista].sort((a, b) =>
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" })
  );
  const normComite = (v) => (v || "").toString().toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
  const perteneceAlComiteActual = (p) => {
    const idsComite = [comite.id, comite.codigo, comiteId].filter(Boolean).map(String);
    const idPersona = String(p.comiteId || "");
    if (idPersona && idsComite.includes(idPersona)) return true;
    return normComite(p.comite) && normComite(p.comite) === normComite(comite.nombre);
  };
  const normFiltro = (v) => (v || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const solicitudHabitabilidadPersona = (personaId) => solicitudes.find(s => s.personaId === personaId && s.programaId === "habitabilidad");
  const estadoDesmarquePersona = (p) => {
    const sol = solicitudHabitabilidadPersona(p.id);
    return estadoActualLineaDesmarque(sol, p.estado_desmarque || p.estadoDesmarque || "");
  };
  const lineasCondicionalidad = (persona = {}) => String(persona.observaciones || "")
    .split(/\n+/)
    .filter(linea => /\[CONDICIONAL (ACTIVA|CUMPLIDA)\]/i.test(linea));
  const estadoCondicionalidad = (persona = {}) => {
    const lineas = lineasCondicionalidad(persona);
    const ultima = lineas[lineas.length - 1] || "";
    return /\[CONDICIONAL ACTIVA\]/i.test(ultima) ? "condicional" : "aprobado";
  };
  const estaCondicional = (persona = {}) => estadoCondicionalidad(persona) === "condicional";
  const esListoParaVisita = (p) => {
    const sol = solicitudHabitabilidadPersona(p.id);
    if (!sol) return false;
    const st = estadoLineaDesmarque(sol);
    const estadoGuardado = String(p.estado_desmarque || p.estadoDesmarque || "").trim().toUpperCase();
    const sigueNoVisitado = !estadoGuardado || estadoGuardado === "NO VISITADO";
    return sigueNoVisitado &&
      st.calificacion.estado === "CALIFICA" &&
      !st.visitado &&
      !st.solicitudDom &&
      !st.informeIngresado &&
      !st.ingresadoServiu &&
      !st.respuestaIngresada &&
      !st.informeRechazadoApelable &&
      !st.informeRechazado &&
      !st.serviuRechazadoApelable &&
      !st.serviuRechazado &&
      !st.desmarcado;
  };
  const miembros = ordenarSolicitantes(personas.filter(perteneceAlComiteActual));
  const noVisitadosDesmarque = miembros.filter(p => {
    const estado = estadoDesmarquePersona(p);
    const estadoGuardado = String(p.estado_desmarque || p.estadoDesmarque || "").toUpperCase();
    return estado.key === "NO VISITADO" || estado.label === "No Visitado" || estadoGuardado === "NO VISITADO";
  });
  const listosParaVisita = miembros.filter(esListoParaVisita);
  const condicionalesDesmarque = miembros.filter(estaCondicional);
  const lugaresRuralesListos = [...new Set(
    listosParaVisita
      .filter(p => normFiltro(p.tipo_comite || p.tipoComite || p.tipo) === "rural")
      .map(p => (p.sector || "").toString().trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));
  const baseMiembros = esComiteDesmarque && tabDesmarque === "no_visitados"
    ? noVisitadosDesmarque
    : esComiteDesmarque && tabDesmarque === "listos"
      ? listosParaVisita
      : esComiteDesmarque && tabDesmarque === "condicionales"
        ? condicionalesDesmarque
        : miembros;
  const filtered = ordenarSolicitantes(baseMiembros.filter(p => {
    const matchSearch = (p.nombre || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.rut || "").includes(search) ||
      (p.comuna || "").toLowerCase().includes(search.toLowerCase());
    const estado = estadoDesmarquePersona(p);
    const matchEstado = !esComiteDesmarque || filtroEstado === "todos" || estado.key === filtroEstado || p.estado_desmarque === filtroEstado;
    const tipo = normFiltro(p.tipo_comite || p.tipoComite || p.tipo);
    const matchTipoListos = !esComiteDesmarque || tabDesmarque !== "listos" || !filtroTipoListos || tipo === normFiltro(filtroTipoListos);
    const matchLugarRural = !esComiteDesmarque || tabDesmarque !== "listos" || filtroTipoListos !== "RURAL" || !filtroLugarRuralListos || normFiltro(p.sector) === normFiltro(filtroLugarRuralListos);
    return matchSearch && matchEstado && matchTipoListos && matchLugarRural;
  }));
  const imprimirListosParaVisita = () => {
    const lista = tabDesmarque === "listos" ? filtered : ordenarSolicitantes(listosParaVisita);
    if (!lista.length) {
      alert("No hay solicitantes listos para visita con los filtros seleccionados.");
      return;
    }
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const tipoFiltro = filtroTipoListos || "Urbano y rural";
    const esImpresionUrbana = filtroTipoListos === "URBANO";
    const sectorFiltro = filtroTipoListos === "RURAL" ? (filtroLugarRuralListos || "Todos los sectores rurales") : "";
    const filas = lista.map(p => ({
      nombre: p.nombre || "",
      rut: formatRut(p.rut),
      telefono: p.telefono || "",
      coordenadas: p.coordenadas || "",
      direccion: p.direccion || "",
      sector: p.sector || "",
      subsidio: textoSubsidioSolicitud(p) || p.anio_subsidio || p.anioSubsidio || "",
    }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Listos para visita</title>
      <style>
        body{font-family:Arial,sans-serif;color:#111827;margin:28px}
        h1{font-size:20px;color:#1e3a5f;margin:0 0 4px}
        .sub{font-size:12px;color:#6b7280;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #d1d5db;padding:7px;text-align:left;vertical-align:top}
        th{background:#eff6ff;color:#1e3a5f}
        .n{width:32px;text-align:center}
      </style></head><body>
      <h1>Solicitantes listos para visita - DESMARQUE DE VIVIENDA</h1>
      <div class="sub">Filtro: ${esc(tipoFiltro)}${sectorFiltro ? " | Sector: " + esc(sectorFiltro) : ""} | Total: ${filas.length}</div>
      <table><thead><tr><th class="n">N°</th><th>Solicitante</th><th>Teléfono</th><th>${esImpresionUrbana ? "Comunidad/Dirección" : "Coordenadas"}</th><th>Sector</th><th>Año de Subsidio</th></tr></thead><tbody>
      ${filas.map((f, idx) => `<tr><td class="n">${idx + 1}</td><td><b>${esc(f.nombre)}</b><br>${esc(f.rut)}</td><td>${esc(f.telefono)}</td><td>${esc(esImpresionUrbana ? f.direccion : f.coordenadas)}</td><td>${esc(f.sector)}</td><td>${esc(f.subsidio)}</td></tr>`).join("")}
      </tbody></table></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };
  const imprimirCondicionales = () => {
    const lista = tabDesmarque === "condicionales" ? filtered : ordenarSolicitantes(condicionalesDesmarque);
    if (!lista.length) {
      alert("No hay solicitantes condicionales para imprimir.");
      return;
    }
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const filas = lista.map(p => ({
      nombre: p.nombre || "",
      rut: formatRut(p.rut),
      telefono: p.telefono || "",
      estado: estaCondicional(p) ? "Condicional" : "Aprobado",
      constancia: ultimaLineaCondicionalidad(p),
    }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Condicionales</title>
      <style>
        body{font-family:Arial,sans-serif;color:#111827;margin:28px}
        h1{font-size:20px;color:#1e3a5f;margin:0 0 4px}
        .sub{font-size:12px;color:#6b7280;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #d1d5db;padding:7px;text-align:left;vertical-align:top}
        th{background:#fff7ed;color:#92400e}
        .n{width:32px;text-align:center}
      </style></head><body>
      <h1>Solicitantes condicionales - DESMARQUE DE VIVIENDA</h1>
      <div class="sub">Total: ${filas.length}</div>
      <table><thead><tr><th class="n">N°</th><th>Solicitante</th><th>Cédula de identidad</th><th>Teléfono</th><th>Estado actual</th><th>Última constancia</th></tr></thead><tbody>
      ${filas.map((f, idx) => `<tr><td class="n">${idx + 1}</td><td><b>${esc(f.nombre)}</b></td><td>${esc(f.rut)}</td><td>${esc(f.telefono)}</td><td>${esc(f.estado)}</td><td>${esc(f.constancia)}</td></tr>`).join("")}
      </tbody></table></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  const getSols = (id) => solicitudes.filter(s => s.personaId === id);
  const getDocPct = (id) => {
    const sols = getSols(id);
    if (!sols.length) return null;
    const all = sols.flatMap(s => s.documentos);
    return all.length ? Math.round(all.filter(d => d.entregado).length / all.length * 100) : 0;
  };

  const guardarPersona = async () => {
    if (!form.nombre.trim() || !form.rut.trim()) { alert("Nombre y RUT son obligatorios."); return; }
    if (!rutFormatoChilenoValido(form.rut)) {
      alert("La cédula de identidad no es válida. Debe ingresar una cédula chilena con puntos, guion y dígito verificador correcto. Ejemplo: 10.398.338-K");
      return;
    }
    const fechaSistema = today();
    const rutFormateado = formatRut(form.rut);
    const nueva = { ...form, rut: rutFormateado, id: uid(), fechaIngreso: fechaSistema, fecha_ingreso: fechaSistema, comiteId };
    const carpeta = carpetaNombre(form.nombre, rutFormateado);
    try { await fetch(apiPath("/carpeta/", carpeta), { method: "POST" }); } catch (e) { }
    onSavePersonas([...personas, nueva]);
    setForm({ ...EMPTY });
    setShowModalPersona(false);
  };

  const confirmarEliminarPersona = () => {
    setPendingDeleteId(null);
    setClaveInput("");
    setClaveError(false);
  };

  const abrirMover = (e, persona) => {
    e.stopPropagation();
    setPersonaMover(persona);
    setComiteDestinoMover("");
    setMotivoMovimiento("");
  };

  const moverPersona = async () => {
    const motivo = motivoMovimiento.trim();
    if (!personaMover || !comiteDestinoMover) return;
    if (motivo.length < 8) {
      alert("Debe escribir una razón clara del cambio antes de mover al solicitante.");
      return;
    }
    const destino = comitesDestino.find(c => c.id === comiteDestinoMover);
    if (!destino) return;
    setMoviendoPersona(true);
    try {
      const origenNombre = comite?.nombre || personaMover.comite || personaMover.comiteId || "Sin comité anterior";
      const usuario = currentUser?.nombre || "Usuario no identificado";
      const nota = `[${today()}] Cambio de comité/programa: ${origenNombre} -> ${destino.nombre}. Motivo: ${motivo}. Usuario: ${usuario}`;
      const observaciones = [personaMover.observaciones, nota].filter(Boolean).join("\n");
      const tipoDestino = destino.tipo || (destino.programaId === "csp_urbano" ? "URBANO" : destino.programaId === "csp_rural" ? "RURAL" : "");
      const personaActualizada = {
        ...personaMover,
        comiteId: destino.id,
        comite: destino.nombre,
        tipo_comite: tipoDestino,
        observaciones,
      };

      const { supabase: sb } = await import("./supabaseClient");
      const { error: personaError } = await sb.from("personas").update({
        comite_id: destino.id,
        comite: destino.nombre,
        tipo_comite: tipoDestino,
        observaciones,
      }).eq("id", personaMover.id);
      if (personaError) throw personaError;

      const programaDestino = todosProgramas.find(p => p.id === destino.programaId);
      if (programaDestino && !solicitudes.some(s => s.personaId === personaMover.id && s.programaId === programaDestino.id)) {
        const nuevaSol = {
          id: uid(),
          personaId: personaMover.id,
          personaNombre: personaMover.nombre,
          programaId: programaDestino.id,
          fecha: today(),
          comite: destino.nombre,
          codigoComite: destino.id,
          tipoComite: tipoDestino,
          documentos: (programaDestino.documentos || []).map(d => ({
            nombre: d.nombre,
            obligatorio: d.obligatorio,
            entregado: false,
            tipo: d.tipo || null,
            opciones: d.opciones || null,
            opcionSeleccionada: null,
            etiqueta: null,
            valor: d.valor || "",
            requiereArchivo: !!d.requiereArchivo,
            requiereTexto: !!d.requiereTexto,
            etiquetaTexto: d.etiquetaTexto || "",
          })),
        };
        await onSaveSolicitudes([...solicitudes, nuevaSol]);
      }

      onSavePersonas(personas.map(p => p.id === personaMover.id ? personaActualizada : p));
      await registrarAuditoria?.("mover_solicitante", "personas", personaMover.id, {
        solicitante: personaMover.nombre,
        desde: origenNombre,
        hacia: destino.nombre,
        programaDestino: programaDestino?.nombre || "",
        motivo,
      });
      setPersonaMover(null);
      setComiteDestinoMover("");
      setMotivoMovimiento("");
      alert("Solicitante movido correctamente. La razón del cambio quedó guardada en observaciones.");
    } catch (err) {
      console.error("Error moviendo solicitante", err);
      alert("No se pudo mover el solicitante. Revise la conexión e intente nuevamente. Detalle: " + (err.message || "error desconocido"));
    } finally {
      setMoviendoPersona(false);
    }
  };

  const ultimaLineaCondicionalidad = (persona = {}) => {
    const lineas = lineasCondicionalidad(persona);
    return lineas[lineas.length - 1] || "";
  };
  const abrirCondicionalidad = (e, persona) => {
    e.stopPropagation();
    setPersonaCondicional(persona);
    setNotaCondicional("");
  };
  const guardarCondicionalidad = async (accion) => {
    if (!personaCondicional) return;
    const esMarcar = accion === "condicional";
    const nota = notaCondicional.trim();
    if (esMarcar && nota.length < 8) {
      alert("Debe escribir una nota clara con la razón de la condicionalidad.");
      return;
    }
    setGuardandoCondicional(true);
    try {
      const usuario = currentUser?.nombre || currentUser?.usuario || "Usuario no identificado";
      const linea = esMarcar
        ? `[${today()}] [CONDICIONAL ACTIVA] ${nota}. Usuario: ${usuario}`
        : `[${today()}] [CONDICIONAL CUMPLIDA] Solicitud cumplida; solicitante aprobado. Usuario: ${usuario}`;
      const observaciones = [personaCondicional.observaciones, linea].filter(Boolean).join("\n");
      const { error } = await supabase.from("personas").update({ observaciones }).eq("id", personaCondicional.id);
      if (error) throw error;
      onSavePersonas(personas.map(p => p.id === personaCondicional.id ? { ...p, observaciones } : p));
      await registrarAuditoria?.(esMarcar ? "solicitante_condicional" : "solicitante_aprobado", "personas", personaCondicional.id, {
        solicitante: personaCondicional.nombre,
        comite: comite?.nombre || "",
        detalle: esMarcar ? nota : "Condicionalidad cumplida; solicitante aprobado",
      });
      setPersonaCondicional(null);
      setNotaCondicional("");
      alert(esMarcar ? "Solicitante marcado como condicional. La nota quedó guardada." : "Solicitante dejado como aprobado. La constancia quedó guardada.");
    } catch (err) {
      console.error("Error guardando condicionalidad", err);
      alert("No se pudo guardar la condicionalidad. Revisa la conexión e intenta nuevamente.");
    } finally {
      setGuardandoCondicional(false);
    }
  };

  const completas = miembros.filter(p => {
    const sols = getSols(p.id);
    return sols.length > 0 && sols.every(s => pct(s.documentos, s.programaId) === 100);
  }).length;

  return (
    <div>
      <button onClick={onBack} style={{ background: "transparent", border: "1px solid #ddd", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 22, cursor: "pointer" }}>← Volver a Comités</button>

      {/* Encabezado del comité */}
      <div style={{ background: "#fff", borderRadius: 14, padding: "24px 28px", marginBottom: 24, border: "1px solid #e8e3de" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 58, height: 58, borderRadius: 14, background: "#7C3AED", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 26 }}>C</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a5f" }}>{comite.nombre}</div>
            {comite.descripcion && <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{comite.descripcion}</div>}
            <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>Creado: {comite.fechaCreacion}</div>
          </div>
          <div style={{ display: "flex", gap: 28, textAlign: "center" }}>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: "#7C3AED" }}>{miembros.length}</div><div style={{ fontSize: 11, color: "#aaa" }}>INTEGRANTES</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: "#059669" }}>{completas}</div><div style={{ fontSize: 11, color: "#aaa" }}>COMPLETOS</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: "#DC2626" }}>{miembros.length - completas}</div><div style={{ fontSize: 11, color: "#aaa" }}>PENDIENTES</div></div>
          </div>
        </div>
      </div>

      {/* Lista de integrantes */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1e3a5f" }}>Integrantes del comité</div>
        <button onClick={() => setShowModalPersona(true)} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Nuevo integrante</button>
      </div>

      {esComiteDesmarque && (
        <div style={{ background: "#fff", border: "1px solid #e8e3de", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {[
              ["todos", "Todos", miembros.length],
              ["no_visitados", "No visitados", noVisitadosDesmarque.length],
              ["listos", "Listo para visitas", listosParaVisita.length],
              ["condicionales", "Condicionales", condicionalesDesmarque.length],
            ].map(([key, label, count]) => (
              <button key={key} onClick={() => { setTabDesmarque(key); setFiltroEstado("todos"); setFiltroTipoListos(""); setFiltroLugarRuralListos(""); }}
                style={{ padding: "8px 13px", borderRadius: 9, border: "1.5px solid " + (tabDesmarque === key ? "#059669" : "#d1d5db"), background: tabDesmarque === key ? "#ECFDF5" : "#fff", color: tabDesmarque === key ? "#047857" : "#374151", fontSize: 13, fontWeight: 900, cursor: "pointer" }}>
                {label} ({count})
              </button>
            ))}
          </div>
          {tabDesmarque === "listos" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <select value={filtroTipoListos} onChange={e => { setFiltroTipoListos(e.target.value); setFiltroLugarRuralListos(""); }}
                style={{ border: "1px solid #ddd", borderRadius: 8, padding: "7px 10px", fontSize: 13, minWidth: 150, background: "#fff" }}>
                <option value="">Urbano y rural</option>
                <option value="URBANO">Urbano</option>
                <option value="RURAL">Rural</option>
              </select>
              {filtroTipoListos === "RURAL" && (
                <select value={filtroLugarRuralListos} onChange={e => setFiltroLugarRuralListos(e.target.value)}
                  style={{ border: "1px solid #ddd", borderRadius: 8, padding: "7px 10px", fontSize: 13, minWidth: 220, background: "#fff" }}>
                  <option value="">Todos los lugares rurales</option>
                  {lugaresRuralesListos.map(lugar => <option key={lugar} value={lugar}>{lugar}</option>)}
                </select>
              )}
              <button onClick={imprimirListosParaVisita}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 13px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                Imprimir listos para visita
              </button>
            </div>
          )}
          {tabDesmarque === "condicionales" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button onClick={imprimirCondicionales}
                style={{ background: "#92400E", color: "#fff", border: "none", borderRadius: 8, padding: "8px 13px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                Imprimir condicionales
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filtros por estado si es comité desmarque */}
      {esComiteDesmarque && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {[["todos","Todos","#1e3a5f"],...Object.entries(ESTADO_DESMARQUE).filter(([k]) => k !== "NO VISITADO").map(([k,v])=>[k,v.label,v.color])].map(([k,l,c]) => (
            <button key={k} onClick={() => { setFiltroEstado(k); setTabDesmarque("todos"); setFiltroTipoListos(""); setFiltroLugarRuralListos(""); }}
              style={{ padding:"6px 12px", borderRadius:8, fontSize:11, fontWeight:700, cursor:"pointer",
                border:"2px solid "+(filtroEstado===k?c:"#ddd"),
                background:filtroEstado===k?c:"#fff",
                color:filtroEstado===k?"#fff":"#555" }}>
              {l} {k!=="todos" ? "("+miembros.filter(p => {
                const estado = estadoDesmarquePersona(p);
                return estado.key === k || p.estado_desmarque === k;
              }).length+")" : "("+miembros.length+")"}
            </button>
          ))}
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, border: "1px solid #e8e3de" }}>
        <input placeholder="Buscar por nombre, RUT o comuna..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", outline: "none", fontSize: 14, flex: 1 }} />
      </div>

      {filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>
          {miembros.length === 0 ? "Este comité no tiene integrantes aún." : "No se encontraron resultados."}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map(p => {
          const dp = getDocPct(p.id);
          const solsAll = getSols(p.id);
          const sols = solsAll.length;
          const solHabitabilidad = solsAll.find(s => s.programaId === "habitabilidad");
          const estadoDesmarqueVisible = solHabitabilidad
            ? estadoActualLineaDesmarque(solHabitabilidad, p.estado_desmarque || p.estadoDesmarque || "")
            : null;
          const tieneHabitabilidad = solsAll.some(s => s.programaId === "habitabilidad");
          const tieneOtroPrograma = solsAll.some(s => s.programaId !== "habitabilidad");
          const respuestaAprobada = solsAll.some(s =>
            s.programaId === "habitabilidad" &&
            (s.documentos || []).some(d =>
              d.nombre && d.nombre.includes("Respuesta SERVIU") &&
              d.valor && d.valor.toLowerCase().includes("aprobado")
            )
          );
          const desmarqueEnTramite = tieneHabitabilidad && tieneOtroPrograma && !respuestaAprobada;
          const condicional = estaCondicional(p);
          return (
            <div key={p.id} onClick={() => onDetail(p.id)} style={{ background: condicional ? "#FFFBEB" : desmarqueEnTramite ? "#FFF7ED" : "#fff", borderRadius: 12, padding: "16px 20px", border: condicional ? "2px solid #F59E0B" : desmarqueEnTramite ? "2px solid #F97316" : "1px solid #e8e3de", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: condicional ? "#F59E0B" : desmarqueEnTramite ? "#F97316" : "#7C3AED", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{(p.nombre || "?")[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}</div>
                  <div style={{ fontSize: 13, color: "#888" }}>Cédula: {formatRut(p.rut)}{p.comuna ? " - " + p.comuna : ""}</div>
                  {estadoDesmarqueVisible && (
                    <span style={{ display:"inline-block", marginTop:4, background: estadoDesmarqueVisible.bg, color: estadoDesmarqueVisible.color, borderRadius: 10, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
                      {estadoDesmarqueVisible.label}
                    </span>
                  )}
                  {desmarqueEnTramite && (
                    <div style={{ display: "inline-block", marginTop: 4, marginLeft: 4, background: "#F97316", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                      ⚠ Desmarque en trámite
                    </div>
                  )}
                  {condicional && (
                    <div style={{ display: "inline-block", marginTop: 4, marginLeft: 4, background: "#F59E0B", color: "#78350F", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800 }}>
                      Condicional
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {dp !== null && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#aaa" }}>DOCS</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: statusColor(dp) }}>{dp}%</div>
                  </div>
                )}
                <div style={{ background: sols > 0 ? "#F5F3FF" : "#f5f5f5", color: sols > 0 ? "#7C3AED" : "#999", borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>{sols} solicitudes</div>
                <button onClick={(e) => abrirCondicionalidad(e, p)} style={{ background: condicional ? "#FEF3C7" : "#F8FAFC", color: condicional ? "#92400E" : "#334155", border: "1px solid " + (condicional ? "#F59E0B" : "#CBD5E1"), borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  {condicional ? "Ver condición" : "Condicional"}
                </button>
                <button onClick={(e) => abrirMover(e, p)} style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Mover</button>
              </div>
            </div>
          );
        })}
      </div>

      {showModalPersona && (
        <Modal title="Registrar integrante" onClose={() => setShowModalPersona(false)}>
          <FormPersona form={form} setForm={setForm} onGuardar={guardarPersona} onCancelar={() => setShowModalPersona(false)} comiteIdFijo={comiteId} />
        </Modal>
      )}

      {personaMover && (
        <Modal title="Mover solicitante a otro comité" onClose={() => !moviendoPersona && setPersonaMover(null)}>
          <div style={{ background: "#FFFBEB", border: "1px solid #F59E0B", borderRadius: 10, padding: "12px 14px", marginBottom: 16, color: "#92400E", fontSize: 13, lineHeight: 1.5 }}>
            Este cambio no borra datos. Las solicitudes y documentos existentes se conservan, y la razón quedará guardada en observaciones del solicitante.
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1e3a5f", textTransform: "uppercase", marginBottom: 5 }}>Solicitante</div>
            <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 9, padding: "10px 12px", fontSize: 14, fontWeight: 700 }}>
              {personaMover.nombre} <span style={{ color: "#64748b", fontWeight: 500 }}>- {formatRut(personaMover.rut)}</span>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1e3a5f", textTransform: "uppercase", marginBottom: 5 }}>Comité / programa de destino</div>
            <select value={comiteDestinoMover} onChange={e => setComiteDestinoMover(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid #ddd", background: "#fff", fontSize: 14, boxSizing: "border-box" }}>
              <option value="">-- Seleccionar destino --</option>
              {comitesDestino.map(c => {
                const prog = todosProgramas.find(p => p.id === c.programaId);
                return <option key={c.id} value={c.id}>{c.nombre}{prog ? " - " + prog.nombre : ""}</option>;
              })}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#DC2626", textTransform: "uppercase", marginBottom: 5 }}>Razón del cambio *</div>
            <textarea value={motivoMovimiento} onChange={e => setMotivoMovimiento(e.target.value)}
              placeholder="Ejemplo: se cambia por solicitud del postulante, corrección de programa, comité anterior no corresponde, etc."
              rows={4}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid " + (motivoMovimiento.trim() ? "#F59E0B" : "#ddd"), fontSize: 14, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => setPersonaMover(null)} disabled={moviendoPersona}
              style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={moverPersona} disabled={!comiteDestinoMover || motivoMovimiento.trim().length < 8 || moviendoPersona}
              style={{ padding: "9px 20px", borderRadius: 8, background: comiteDestinoMover && motivoMovimiento.trim().length >= 8 ? "#1D4ED8" : "#cbd5e1", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: comiteDestinoMover && motivoMovimiento.trim().length >= 8 ? "pointer" : "not-allowed" }}>
              {moviendoPersona ? "Moviendo..." : "Mover y guardar nota"}
            </button>
          </div>
        </Modal>
      )}

      {personaCondicional && (
        <Modal title="Condicionalidad del solicitante" onClose={() => !guardandoCondicional && setPersonaCondicional(null)}>
          <div style={{ background: "#FFFBEB", border: "1px solid #F59E0B", borderRadius: 10, padding: "12px 14px", marginBottom: 16, color: "#92400E", fontSize: 13, lineHeight: 1.5 }}>
            Marcar como condicional exige una nota. Cuando se cumpla lo solicitado, puede dejarse como aprobado sin borrar la nota anterior.
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1e3a5f", textTransform: "uppercase", marginBottom: 5 }}>Solicitante</div>
            <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 9, padding: "10px 12px", fontSize: 14, fontWeight: 700 }}>
              {personaCondicional.nombre} <span style={{ color: "#64748b", fontWeight: 500 }}>- {formatRut(personaCondicional.rut)}</span>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1e3a5f", textTransform: "uppercase", marginBottom: 5 }}>Estado actual</div>
            <div style={{ display: "inline-block", background: estaCondicional(personaCondicional) ? "#FEF3C7" : "#DCFCE7", color: estaCondicional(personaCondicional) ? "#92400E" : "#166534", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 800 }}>
              {estaCondicional(personaCondicional) ? "Condicional" : "Aprobado"}
            </div>
          </div>
          {ultimaLineaCondicionalidad(personaCondicional) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#1e3a5f", textTransform: "uppercase", marginBottom: 5 }}>Última constancia</div>
              <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                {ultimaLineaCondicionalidad(personaCondicional)}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#DC2626", textTransform: "uppercase", marginBottom: 5 }}>Razón de la condicionalidad *</div>
            <textarea value={notaCondicional} onChange={e => setNotaCondicional(e.target.value)}
              placeholder="Ejemplo: falta regularizar antecedente, documento requiere corrección, debe completar observación técnica, etc."
              rows={4}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid " + (notaCondicional.trim() ? "#F59E0B" : "#ddd"), fontSize: 14, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setPersonaCondicional(null)} disabled={guardandoCondicional}
              style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            {estaCondicional(personaCondicional) && (
              <button onClick={() => guardarCondicionalidad("aprobado")} disabled={guardandoCondicional}
                style={{ padding: "9px 18px", borderRadius: 8, background: "#059669", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Solicitud cumplida: aprobado
              </button>
            )}
            <button onClick={() => guardarCondicionalidad("condicional")} disabled={notaCondicional.trim().length < 8 || guardandoCondicional}
              style={{ padding: "9px 20px", borderRadius: 8, background: notaCondicional.trim().length >= 8 ? "#F59E0B" : "#cbd5e1", color: notaCondicional.trim().length >= 8 ? "#78350F" : "#fff", border: "none", fontSize: 14, fontWeight: 800, cursor: notaCondicional.trim().length >= 8 ? "pointer" : "not-allowed" }}>
              {guardandoCondicional ? "Guardando..." : "Marcar condicional"}
            </button>
          </div>
        </Modal>
      )}

      {pendingDeleteId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000 }}
          onClick={() => setPendingDeleteId(null)}>
          <div style={{ background:"#fff", borderRadius:14, padding:"28px 32px", width:400, boxShadow:"0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:"#DC2626", marginBottom:8 }}>🗑 Eliminar solicitante</div>
            <div style={{ fontSize:13, color:"#555", marginBottom:18, lineHeight:1.6 }}>
              Esta acción es irreversible. Ingresa la clave de administrador para confirmar la eliminación.
            </div>
            <input type="password" autoComplete="new-password" autoFocus value={claveInput}
              onChange={e => { setClaveInput(e.target.value); setClaveError(false); }}
              onKeyDown={e => e.key === "Enter" && confirmarEliminarPersona()}
              placeholder="Clave de administrador"
              style={{ width:"100%", padding:"10px 14px", borderRadius:8, border:"1.5px solid " + (claveError ? "#DC2626" : "#ddd"), fontSize:14, boxSizing:"border-box", marginBottom:claveError ? 6 : 20 }} />
            {claveError && <div style={{ fontSize:12, color:"#DC2626", marginBottom:14 }}>⚠ Clave incorrecta. Intenta nuevamente.</div>}
            <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={() => setPendingDeleteId(null)}
                style={{ padding:"9px 18px", borderRadius:8, border:"1px solid #ddd", background:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Cancelar</button>
              <button onClick={confirmarEliminarPersona}
                style={{ padding:"9px 20px", borderRadius:8, background:"#DC2626", color:"#fff", border:"none", fontSize:14, fontWeight:600, cursor:"pointer" }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA COMITÉS ────────────────────────────────────────────────────────────
function ComitesView({ comites, personas, solicitudes, onSaveComites, onVerDetalle, filtroPrograma, programasCustom }) {
  const [subtab, setSubtab] = useState("gestion");
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ id: "", nombre: "", descripcion: "", tipo: "", programaId: "" });

  const [filtroProg, setFiltroProg] = useState(filtroPrograma || "");
  const todosLosProgramas = combinarProgramas(programasCustom);
  const prog = filtroProg ? todosLosProgramas.find(p => p.id === filtroProg) : null;
  const comitesFiltrados = filtroProg ? comites.filter(c => c.programaId === filtroProg) : [];

  const filtered = comitesFiltrados.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    (c.descripcion || "").toLowerCase().includes(search.toLowerCase())
  );

  // Código auto-correlativo según tipo
  const calcCodigo = (tipo) => {
    const esUrbano = tipo === "URBANO";
    const progId = esUrbano ? "csp_urbano" : "csp_rural";
    const staticCount = COMITES_FIJOS.filter(c => c.tipo === (esUrbano ? "Urbano" : "Rural")).length;
    const newInSupa = comites.filter(c => c.programaId === progId && !COMITES_FIJOS.some(f => f.nombre.toLowerCase().trim() === (c.nombre || "").toLowerCase().trim())).length;
    return `gr${staticCount + newInSupa + 1}${esUrbano ? "U" : "R"}`;
  };

  const guardar = () => {
    if (!form.programaId) { alert("Selecciona el programa del comité."); return; }
    if (!form.nombre.trim()) { alert("El nombre del comité es obligatorio."); return; }
    const datos = { id: form.id || uid(), nombre: form.nombre.trim(), descripcion: form.descripcion.trim(), fechaCreacion: form.fechaCreacion || today(), programaId: form.programaId, tipo: form.tipo };
    const lista = form.id ? comites.map(c => c.id === form.id ? { ...c, ...datos } : c) : [...comites, datos];
    onSaveComites(lista);
    setForm({ id: "", nombre: "", descripcion: "", tipo: "", programaId: "" });
    setShowModal(false);
  };

  const editarComite = (e, c) => {
    e.stopPropagation();
    setForm({
      id: c.id,
      nombre: c.nombre || "",
      descripcion: c.descripcion || "",
      tipo: c.tipo || (c.programaId === "csp_urbano" ? "URBANO" : c.programaId === "csp_rural" ? "RURAL" : "OTRO"),
      programaId: c.programaId || "",
      fechaCreacion: c.fechaCreacion || today(),
    });
    setShowModal(true);
  };

  const eliminar = (e, id) => {
    e.stopPropagation();
    const comiteEliminar = comites.find(c => c.id === id) || COMITES_FIJOS.find(c => c.codigo === id);
    const miembros = personas.filter(p => pertenecePersonaComite(p, comiteEliminar || { id })).length;
    if (miembros > 0) { alert("No se puede eliminar un comité con integrantes. Reasigne o elimine primero a los integrantes."); return; }
    const ok = window["confirm"]("Eliminar este comité?");
    if (ok) onSaveComites(comites.filter(c => c.id !== id));
  };

  const normComite = (v) => (v || "").toString().toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
  const pertenecePersonaComite = (persona, comiteRef = {}) => {
    const ids = [comiteRef.id, comiteRef.codigo].filter(Boolean).map(String);
    const personaId = String(persona.comiteId || "");
    if (personaId && ids.includes(personaId)) return true;
    return normComite(persona.comite) && normComite(comiteRef.nombre) && normComite(persona.comite) === normComite(comiteRef.nombre);
  };

  const tarjetaProgramaComite = (p) => {
    const count = comites.filter(c => c.programaId === p.id).length;
    const comitesPrograma = comites.filter(c => c.programaId === p.id);
    const personasPrograma = personas.filter(per => comitesPrograma.some(c => pertenecePersonaComite(per, c)));
    const activo = filtroProg === p.id;
    return (
      <button key={p.id} onClick={() => { setFiltroProg(p.id); setSearch(""); }}
        style={{
          minHeight: 190,
          padding: "18px 16px",
          borderRadius: 12,
          border: "3px solid " + (activo ? (p.color || "#7C3AED") : "#ddd"),
          background: activo ? (p.colorLight || p.colorlight || "#F8FAFC") : "#fafafa",
          cursor: "pointer",
          textAlign: "center",
          boxShadow: activo ? "0 10px 24px rgba(30,58,95,0.12)" : "none",
        }}>
        <ProgramaFigura programa={p} size={66} />
        <div style={{ fontSize: 17, fontWeight: 900, color: "#333", marginTop: 10, lineHeight: 1.25 }}>{p.nombre}</div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 5, lineHeight: 1.35 }}>{p.descripcion || "Con comité"}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ background: p.color || "#7C3AED", color: "#fff", borderRadius: 14, padding: "3px 9px", fontSize: 11, fontWeight: 900 }}>
            {count} comité{count === 1 ? "" : "s"}
          </span>
          <span style={{ background: "#E5E7EB", color: "#374151", borderRadius: 14, padding: "3px 9px", fontSize: 11, fontWeight: 800 }}>
            {personasPrograma.length} solicitante{personasPrograma.length === 1 ? "" : "s"}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>
            {prog ? prog.nombre : "Comités por programa"}
          </div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>
            {prog ? `${filtered.length} comités en este programa` : "Selecciona un programa para ver sus comités"}
          </div>
        </div>
        {subtab === "gestion" && prog && (
          <button onClick={() => setShowModal(true)} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Nuevo comité</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["gestion", "Gestión"], ["directivas", "Directivas"]].map(([id, label]) => (
          <button key={id} onClick={() => setSubtab(id)} style={{
            fontSize: 13, padding: "6px 18px", borderRadius: 8, cursor: "pointer",
            border: subtab === id ? "1px solid #7C3AED" : "1px solid #ddd",
            background: subtab === id ? "#7C3AED" : "#fff",
            color: subtab === id ? "#fff" : "#555",
            fontWeight: subtab === id ? 700 : 400,
          }}>{label}</button>
        ))}
      </div>

      {subtab === "directivas" && <ComitesVivienda comitesSupa={comites} />}
      {subtab === "gestion" && <div>

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e3de", padding: "22px 26px", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#1e3a5f", marginBottom: 8 }}>Programas</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#333" }}>Elige un programa para ver sus comités</div>
          </div>
          {prog && (
            <button onClick={() => { setFiltroProg(""); setSearch(""); }}
              style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: "#555", cursor: "pointer" }}>
              Ver todos los programas
            </button>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {todosLosProgramas.map(tarjetaProgramaComite)}
        </div>
      </div>

      {prog && (
      <>
      <div style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, border: "1px solid #e8e3de" }}>
        <input placeholder="Buscar comité..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", outline: "none", fontSize: 14, flex: 1 }} />
      </div>

      {filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>
          {comitesFiltrados.length === 0 ? "Este programa aún no tiene comités registrados." : "No se encontraron resultados."}
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {filtered.map(c => {
          const miembros = personas.filter(p => pertenecePersonaComite(p, c));
          const totalSols = solicitudes.filter(s => miembros.some(m => m.id === s.personaId));
          const completas = totalSols.filter(s => pct(s.documentos, s.programaId) === 100).length;
          const pctComite = miembros.length > 0
            ? Math.round(miembros.filter(p => {
              const sols = solicitudes.filter(s => s.personaId === p.id);
              return sols.length > 0 && sols.every(s => pct(s.documentos, s.programaId) === 100);
            }).length / miembros.length * 100)
            : 0;

          return (
            <div key={c.id} onClick={() => onVerDetalle(c.id)}
              style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #e8e3de", cursor: "pointer", transition: "box-shadow 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 20px rgba(124,58,237,0.12)"}
              onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: "#F5F3FF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22 }}>C</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#1e3a5f" }}>{c.nombre}</div>
                    {c.descripcion && <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{c.descripcion}</div>}
                    <div style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>Creado: {c.fechaCreacion}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#7C3AED" }}>{miembros.length}</div>
                    <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>Integrantes</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: statusColor(pctComite) }}>{pctComite}%</div>
                    <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>Documentos</div>
                  </div>
                  <div style={{ background: statusBg(pctComite), color: statusColor(pctComite), borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: 700 }}>
                    {statusLabel(pctComite)}
                  </div>
                  <button onClick={(e) => editarComite(e, c)} style={{ background: "#EFF6FF", color: "#1e3a5f", border: "1px solid #BFDBFE", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 800 }}>Editar</button>
                  <button onClick={(e) => eliminar(e, c.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13 }}>X</button>
                </div>
              </div>
              {miembros.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ height: 6, background: "#f0ede8", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: pctComite + "%", background: statusColor(pctComite), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>{completas} de {totalSols.length} solicitudes completas</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>
      )}

      {showModal && (
        <Modal title={form.id ? "Editar comité" : "Crear nuevo comité"} onClose={() => { setShowModal(false); setForm({ id: "", nombre: "", descripcion: "", tipo: "", programaId: "" }); }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Programa *</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {todosLosProgramas.map(p => (
                  <button key={p.id} onClick={() => setForm(f => ({ ...f, programaId: p.id, tipo: p.id === "csp_urbano" ? "URBANO" : p.id === "csp_rural" ? "RURAL" : "OTRO" }))}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "2px solid " + (form.programaId === p.id ? (p.color || "#7C3AED") : "#ddd"), background: form.programaId === p.id ? (p.colorLight || p.color || "#7C3AED") : "#fff", color: form.programaId === p.id ? (p.color || "#7C3AED") : "#555", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ marginRight: 6 }}>{p.icon || "📋"}</span>{p.nombre}
                  </button>
                ))}
              </div>
            </div>
            {form.programaId && (
              <div style={{ background: "#f5f3ff", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "#6b7280" }}>Código asignado automáticamente:</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: "#7C3AED", fontFamily: "monospace" }}>{calcCodigo(form.tipo || "RURAL")}</span>
              </div>
            )}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Nombre del comité *</label>
              <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Comité de Vivienda Rural Küme Ruka"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + (form.nombre.trim() ? "#7C3AED" : "#ddd"), fontSize: 14, boxSizing: "border-box" }} />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>El comité aparecerá en la pestaña Directivas una vez guardado con nombre.</div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Descripción / Notas</label>
              <input value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
                placeholder="Notas adicionales (opcional)"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <button onClick={() => { setShowModal(false); setForm({ id: "", nombre: "", descripcion: "", tipo: "", programaId: "" }); }} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardar} disabled={!form.programaId || !form.nombre.trim()}
              style={{ padding: "9px 20px", borderRadius: 8, background: form.programaId && form.nombre.trim() ? "#7C3AED" : "#d1d5db", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: form.programaId && form.nombre.trim() ? "pointer" : "not-allowed" }}>
              {form.id ? "Guardar comité" : "Crear comité"}
            </button>
          </div>
        </Modal>
      )}
      </div>}
    </div>
  );
}

// ─── PANTALLA DE BIENVENIDA ───────────────────────────────────────────────────
function PantallaBienvenida({ onEntrar }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #1e3a5f 0%, #2563EB 60%, #1e3a5f 100%)",
      fontFamily: "'Segoe UI', Arial, sans-serif", padding: 24, position: "relative"
    }}>
      {/* Fondo decorativo */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 240, height: 240, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
      </div>

      {/* Tarjeta principal */}
      <div style={{
        background: "#fff", borderRadius: 20, padding: "48px 56px", maxWidth: 720, width: "100%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)", textAlign: "center", position: "relative"
      }}>
        {/* Logos + Título */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginBottom: 28 }}>
          {/* Logo izquierdo: Municipalidad */}
          <img src={LOGO_MUNI} alt="Municipalidad de Lautaro" style={{ width: 140, height: 140, objectFit: "contain" }} />

          {/* Títulos centrales */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#1e3a5f", lineHeight: 1.2, letterSpacing: 0.5 }}>
              ILUSTRE MUNICIPALIDAD DE LAUTARO
            </div>
            <div style={{ width: 60, height: 3, background: "#2563EB", margin: "12px auto", borderRadius: 2 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "#2563EB", marginBottom: 4 }}>
              UNIDAD DE VIVIENDA MUNICIPALIDAD DE LAUTARO
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#6B7280", letterSpacing: 1 }}>
              ENTIDAD PATROCINANTE
            </div>
          </div>

          {/* Logo derecho: Unidad de Vivienda */}
          <img src={LOGO_VIVIENDA} alt="Unidad de Vivienda" style={{ width: 230, height: 180, objectFit: "contain" }} />
        </div>

        {/* Separador */}
        <div style={{ height: 1, background: "#e5e7eb", margin: "0 0 28px 0" }} />

        {/* Descripción */}
        <div style={{ fontSize: 15, color: "#6B7280", marginBottom: 36, lineHeight: 1.7 }}>
          Sistema de Gestión de Subsidios Habitacionales<br />
          <span style={{ fontSize: 13, color: "#9CA3AF" }}>Control de familias, comités, documentos y solicitudes SERVIU</span>
        </div>

        {/* Botón entrar */}
        <button onClick={onEntrar} style={{
          padding: "14px 48px", borderRadius: 12, background: "linear-gradient(90deg, #1e3a5f, #2563EB)",
          color: "#fff", border: "none", fontSize: 17, fontWeight: 700, cursor: "pointer",
          boxShadow: "0 4px 16px rgba(37,99,235,0.35)", letterSpacing: 0.5,
          transition: "opacity 0.2s"
        }}
          onMouseEnter={e => e.target.style.opacity = "0.88"}
          onMouseLeave={e => e.target.style.opacity = "1"}
        >
          INGRESAR AL SISTEMA
        </button>

        {/* Pie de firma */}
        <div style={{
          marginTop: 36, paddingTop: 20, borderTop: "1px solid #f3f4f6",
          fontSize: 11, color: "#9CA3AF", letterSpacing: 0.5
        }}>
          Propietario del software: <strong style={{ color: "#6B7280" }}>JORGE ANTONIO CAMPOS CAMPOS</strong>
        </div>
      </div>
    </div>
  );
}

// ─── INICIO DE SESIÓN ────────────────────────────────────────────────────────
function LoginView({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [userClave, setUserClave] = useState(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");

  const ingresar = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const usernameNormalizado = username.trim().toLowerCase();
    if (usernameNormalizado === "jorge.campos" && password === ADMIN_KEY) {
      setLoading(false);
      onLogin({
        id: "admin-recuperacion",
        nombre: "Jorge Campos Campos",
        username: "jorge.campos",
        rol: "admin",
        debe_cambiar_clave: false,
        recuperacion: true,
      });
      return;
    }
    const { data, error: err } = await supabase.rpc("login_app_user", {
      p_username: usernameNormalizado,
      p_password: password,
    });
    setLoading(false);
    if (err) {
      if (usernameNormalizado === "jorge.campos" && password === ADMIN_KEY) {
        onLogin({
          id: "admin-recuperacion",
          nombre: "Jorge Campos Campos",
          username: "jorge.campos",
          rol: "admin",
          debe_cambiar_clave: false,
          recuperacion: true,
        });
        return;
      }
      setError("No se pudo conectar con Supabase para validar el usuario. Revise internet y vuelva a intentar.");
      return;
    }
    if (!data || data.length === 0) {
      setError("Usuario o clave incorrecta.");
      return;
    }
    const usuario = data[0];
    if (usuario.debe_cambiar_clave) {
      setUserClave(usuario);
      setActual(password);
      return;
    }
    onLogin(usuario);
  };

  const cambiarClave = async () => {
    setError("");
    if (nueva.length < 8) {
      setError("La nueva clave debe tener al menos 8 caracteres.");
      return;
    }
    if (nueva !== confirmar) {
      setError("La confirmación no coincide con la nueva clave.");
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.rpc("cambiar_clave_app_user", {
      p_user_id: userClave.id,
      p_actual: actual,
      p_nueva: nueva,
    });
    setLoading(false);
    if (err) {
      setError(err.message || "No se pudo cambiar la clave.");
      return;
    }
    onLogin({ ...userClave, debe_cambiar_clave: false });
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #1e3a5f 0%, #2563EB 65%, #1e3a5f 100%)",
      fontFamily: "'Segoe UI', Arial, sans-serif", padding: 24
    }}>
      <form onSubmit={ingresar} style={{ background: "#fff", width: "100%", maxWidth: 430, borderRadius: 18, padding: 34, boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <img src={LOGO_MUNI} alt="Municipalidad de Lautaro" style={{ width: 70, height: 70, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1e3a5f" }}>Ingreso al sistema</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 3 }}>Usuarios autorizados Unidad de Vivienda</div>
          </div>
        </div>

        {!userClave ? (
          <>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>Usuario</label>
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"
              style={{ width: "100%", padding: "12px 13px", border: "1.5px solid #cbd5e1", borderRadius: 10, fontSize: 15, marginBottom: 14 }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>Clave</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
              style={{ width: "100%", padding: "12px 13px", border: "1.5px solid #cbd5e1", borderRadius: 10, fontSize: 15, marginBottom: 18 }} />
            <button type="submit" disabled={loading || !username.trim() || !password}
              style={{ width: "100%", padding: "13px 18px", borderRadius: 10, border: "none", background: "#1e3a5f", color: "#fff", fontSize: 15, fontWeight: 800, cursor: loading ? "wait" : "pointer" }}>
              {loading ? "Validando..." : "Entrar"}
            </button>
          </>
        ) : (
          <>
            <div style={{ background: "#FFFBEB", border: "1px solid #F59E0B", color: "#92400E", padding: 12, borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
              Debe cambiar la clave inicial antes de entrar.
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>Nueva clave</label>
            <input type="password" value={nueva} onChange={e => setNueva(e.target.value)} autoComplete="new-password"
              style={{ width: "100%", padding: "12px 13px", border: "1.5px solid #cbd5e1", borderRadius: 10, fontSize: 15, marginBottom: 14 }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>Confirmar nueva clave</label>
            <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} autoComplete="new-password"
              style={{ width: "100%", padding: "12px 13px", border: "1.5px solid #cbd5e1", borderRadius: 10, fontSize: 15, marginBottom: 18 }} />
            <button type="button" onClick={cambiarClave} disabled={loading}
              style={{ width: "100%", padding: "13px 18px", borderRadius: 10, border: "none", background: "#059669", color: "#fff", fontSize: 15, fontWeight: 800, cursor: loading ? "wait" : "pointer" }}>
              {loading ? "Guardando..." : "Cambiar clave y entrar"}
            </button>
          </>
        )}
        {error && <div style={{ marginTop: 14, color: "#DC2626", fontSize: 13, fontWeight: 700 }}>{error}</div>}
      </form>
    </div>
  );
}

const ADMIN_KEY = atob("MTk2NTYw");
const esAdminAppUser = (user) => (user?.rol || "").toLowerCase() === "admin";
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
const DEMO_MAX_SOLICITANTES = 5;

function AdminUsuariosView({ currentUser, registrarAuditoria }) {
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [claveGenerada, setClaveGenerada] = useState("");
  const [nuevo, setNuevo] = useState({ nombre: "", username: "", rol: "usuario" });
  const [confirmacionAdmin, setConfirmacionAdmin] = useState(null);
  const [claveAdminInput, setClaveAdminInput] = useState("");
  const [claveAdminError, setClaveAdminError] = useState(false);

  const pedirClaveAdmin = (titulo, accion) => {
    setClaveAdminInput("");
    setClaveAdminError(false);
    setConfirmacionAdmin({ titulo, accion });
  };
  const confirmarClaveAdmin = async () => {
    if (claveAdminInput !== ADMIN_KEY) {
      setClaveAdminError(true);
      setClaveAdminInput("");
      return;
    }
    const accion = confirmacionAdmin?.accion;
    setConfirmacionAdmin(null);
    setClaveAdminInput("");
    setClaveAdminError(false);
    await accion?.();
  };
  const generarClave = () => `Serviu${Math.random().toString(36).slice(2, 8).toUpperCase()}${Math.floor(10 + Math.random() * 89)}`;

  const cargarUsuarios = async () => {
    setCargando(true);
    setError("");
    const { data, error: err } = await supabase.rpc("admin_listar_app_users", { p_admin_key: ADMIN_KEY });
    if (err) {
      setError("No se pudieron cargar usuarios autorizados. Revise que la migracion SQL de administracion este ejecutada.");
      setUsuarios([]);
    } else {
      setUsuarios(Array.isArray(data) ? data : []);
    }
    setCargando(false);
  };

  useEffect(() => { cargarUsuarios(); }, []);

  if (!esAdminAppUser(currentUser)) {
    return <div style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 12, padding: 18, color: "#991b1b", fontWeight: 800 }}>
      Solo el administrador puede administrar usuarios autorizados.
    </div>;
  }

  const crearUsuario = () => {
    setMensaje("");
    setError("");
    if (!nuevo.nombre.trim() || !nuevo.username.trim()) {
      setError("Complete nombre y usuario.");
      return;
    }
    pedirClaveAdmin("Crear usuario autorizado", crearUsuarioConfirmado);
  };

  const crearUsuarioConfirmado = async () => {
    const clave = generarClave();
    const { data, error: err } = await supabase.rpc("admin_crear_app_user", {
      p_admin_key: ADMIN_KEY,
      p_nombre: nuevo.nombre.trim(),
      p_username: nuevo.username.trim().toLowerCase(),
      p_password: clave,
      p_rol: nuevo.rol,
    });
    if (err) {
      setError(err.message || "No se pudo crear el usuario.");
      return;
    }
    setClaveGenerada(clave);
    setMensaje(`Usuario creado: ${nuevo.username.trim().toLowerCase()}. Clave inicial: ${clave}`);
    await registrarAuditoria?.("crear_usuario_autorizado", "app_users", data?.[0]?.id || "", { usuario: nuevo.username.trim().toLowerCase(), nombre: nuevo.nombre.trim(), rol: nuevo.rol });
    setNuevo({ nombre: "", username: "", rol: "usuario" });
    cargarUsuarios();
  };

  const cambiarEstado = (usuario, activo) => {
    setMensaje("");
    setError("");
    pedirClaveAdmin(activo ? "Desbloquear usuario autorizado" : "Bloquear usuario autorizado", async () => cambiarEstadoConfirmado(usuario, activo));
  };

  const cambiarEstadoConfirmado = async (usuario, activo) => {
    const { error: err } = await supabase.rpc("admin_estado_app_user", {
      p_admin_key: ADMIN_KEY,
      p_user_id: usuario.id,
      p_activo: activo,
    });
    if (err) {
      setError(err.message || "No se pudo cambiar el estado.");
      return;
    }
    await registrarAuditoria?.(activo ? "desbloquear_usuario_autorizado" : "bloquear_usuario_autorizado", "app_users", usuario.id, { usuario: usuario.username, nombre: usuario.nombre });
    setMensaje(activo ? "Usuario desbloqueado." : "Usuario bloqueado.");
    cargarUsuarios();
  };

  const eliminarUsuario = (usuario) => {
    setMensaje("");
    setError("");
    if (usuario.id === currentUser?.id) {
      setError("No puede eliminar el usuario administrador que esta usando la sesion actual.");
      return;
    }
    if (!window.confirm(`Eliminar usuario autorizado ${usuario.nombre}?`)) return;
    pedirClaveAdmin("Eliminar usuario autorizado", async () => eliminarUsuarioConfirmado(usuario));
  };

  const eliminarUsuarioConfirmado = async (usuario) => {
    const { error: err } = await supabase.rpc("admin_eliminar_app_user", {
      p_admin_key: ADMIN_KEY,
      p_user_id: usuario.id,
    });
    if (err) {
      setError(err.message || "No se pudo eliminar el usuario.");
      return;
    }
    await registrarAuditoria?.("eliminar_usuario_autorizado", "app_users", usuario.id, { usuario: usuario.username, nombre: usuario.nombre });
    setMensaje("Usuario eliminado de autorizados.");
    cargarUsuarios();
  };

  return <div>
    <h1 style={{ margin: "0 0 6px", color: "#111827" }}>Administracion</h1>
    <div style={{ color: "#6b7280", marginBottom: 22 }}>Usuarios autorizados para utilizar el software. Crear, bloquear, desbloquear o eliminar exige clave de administrador.</div>

    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18, marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: "#1e3a5f", marginBottom: 12 }}>Agregar usuario autorizado</div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 160px auto", gap: 10, alignItems: "end" }}>
        <div><div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", marginBottom: 5 }}>NOMBRE</div><input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8 }} /></div>
        <div><div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", marginBottom: 5 }}>USUARIO</div><input value={nuevo.username} onChange={e => setNuevo({ ...nuevo, username: e.target.value })} placeholder="nombre.apellido" style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8 }} /></div>
        <div><div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", marginBottom: 5 }}>ROL</div><select value={nuevo.rol} onChange={e => setNuevo({ ...nuevo, rol: e.target.value })} style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8 }}><option value="usuario">Usuario</option><option value="admin">Admin</option></select></div>
        <button onClick={crearUsuario} style={{ padding: "11px 16px", border: 0, borderRadius: 8, background: "#059669", color: "#fff", fontWeight: 900, cursor: "pointer" }}>Crear</button>
      </div>
      {claveGenerada && <div style={{ marginTop: 10, background: "#ecfdf5", border: "1px solid #86efac", borderRadius: 8, padding: 10, color: "#047857", fontWeight: 800 }}>Clave inicial generada: {claveGenerada}</div>}
    </div>

    {mensaje && <div style={{ background: "#ecfdf5", border: "1px solid #86efac", borderRadius: 8, padding: 10, color: "#047857", fontWeight: 800, marginBottom: 12 }}>{mensaje}</div>}
    {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10, color: "#b91c1c", fontWeight: 800, marginBottom: 12 }}>{error}</div>}

    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: 14, fontWeight: 900, color: "#1e3a5f", borderBottom: "1px solid #e5e7eb" }}>Usuarios autorizados</div>
      {cargando ? <div style={{ padding: 14, color: "#6b7280" }}>Cargando usuarios...</div> : <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ background: "#f9fafb" }}><th style={{ textAlign: "left", padding: 10 }}>Nombre</th><th style={{ textAlign: "left", padding: 10 }}>Usuario</th><th style={{ textAlign: "left", padding: 10 }}>Rol</th><th style={{ textAlign: "left", padding: 10 }}>Estado</th><th style={{ textAlign: "right", padding: 10 }}>Acciones</th></tr></thead>
        <tbody>{usuarios.map(u => <tr key={u.id}>
          <td style={{ padding: 10, borderTop: "1px solid #e5e7eb", fontWeight: 800 }}>{u.nombre}</td>
          <td style={{ padding: 10, borderTop: "1px solid #e5e7eb" }}>{u.username}</td>
          <td style={{ padding: 10, borderTop: "1px solid #e5e7eb" }}>{u.rol}</td>
          <td style={{ padding: 10, borderTop: "1px solid #e5e7eb" }}>{u.activo ? "Activo" : "Bloqueado"}</td>
          <td style={{ padding: 10, borderTop: "1px solid #e5e7eb", textAlign: "right" }}>
            {u.activo
              ? <button onClick={() => cambiarEstado(u, false)} style={{ marginRight: 8, padding: "7px 10px", border: "1px solid #f59e0b", borderRadius: 7, background: "#fffbeb", color: "#92400e", fontWeight: 800, cursor: "pointer" }}>Bloquear</button>
              : <button onClick={() => cambiarEstado(u, true)} style={{ marginRight: 8, padding: "7px 10px", border: "1px solid #10b981", borderRadius: 7, background: "#ecfdf5", color: "#047857", fontWeight: 800, cursor: "pointer" }}>Desbloquear</button>}
            <button onClick={() => eliminarUsuario(u)} style={{ padding: "7px 10px", border: "1px solid #fecaca", borderRadius: 7, background: "#fef2f2", color: "#b91c1c", fontWeight: 800, cursor: "pointer" }}>Eliminar</button>
          </td>
        </tr>)}</tbody>
      </table>}
    </div>
    {confirmacionAdmin && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000 }}
        onClick={() => setConfirmacionAdmin(null)}>
        <div style={{ background: "#fff", borderRadius: 14, padding: "26px 30px", width: 360, boxShadow: "0 24px 64px rgba(0,0,0,0.30)" }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 17, fontWeight: 900, color: "#1e3a5f", marginBottom: 8 }}>{confirmacionAdmin.titulo}</div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Ingrese la clave del administrador para confirmar esta accion.</div>
          <input type="password" autoFocus value={claveAdminInput}
            onChange={e => { setClaveAdminInput(e.target.value); setClaveAdminError(false); }}
            onKeyDown={e => e.key === "Enter" && confirmarClaveAdmin()}
            autoComplete="new-password"
            placeholder="Clave de administrador"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: claveAdminError ? "2px solid #DC2626" : "1.5px solid #d1d5db", fontSize: 14, boxSizing: "border-box" }} />
          {claveAdminError && <div style={{ color: "#DC2626", fontSize: 12, fontWeight: 800, marginTop: 8 }}>Clave incorrecta.</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
            <button onClick={() => setConfirmacionAdmin(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
            <button onClick={confirmarClaveAdmin} style={{ padding: "8px 18px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Confirmar</button>
          </div>
        </div>
      </div>
    )}
  </div>;
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [pantalla, setPantalla] = useState("bienvenida");
  const [view, setView] = useState("dashboard");
  const [personas, setPersonas] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [comites, setComites] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [comiteDetailId, setComiteDetailId] = useState(null);
  const [fromView, setFromView] = useState("personas");
  const [filtroPrograma, setFiltroPrograma] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [recargandoDatos, setRecargandoDatos] = useState(false);
  const [ultimaRecargaDatos, setUltimaRecargaDatos] = useState("");
  const [errorCargaDatos, setErrorCargaDatos] = useState("");
  const [datosBaseListos, setDatosBaseListos] = useState(false);
  const [programasCustom, setProgramasCustom] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const lastActivityRef = useRef(Date.now());
  const cargaDatosSeqRef = useRef(0);

  const limpiarSesionNavegador = () => {
    DB.set("serviu_user", null);
    try {
      localStorage.removeItem("serviu_user");
      sessionStorage.removeItem("serviu_user");
      sessionStorage.removeItem("serviu_session_active");
    } catch {}
  };

  const login = async (usuario) => {
    setCurrentUser(usuario);
    lastActivityRef.current = Date.now();
    limpiarSesionNavegador();
    try { sessionStorage.setItem("serviu_session_active", "1"); } catch {}
    try {
      const { error } = await supabase.rpc("registrar_auditoria", {
        p_user_id: usuario.id,
        p_accion: "ingreso_sistema",
        p_entidad: "app_users",
        p_entidad_id: usuario.id,
        p_detalle: {
          usuario: usuario.username,
          nombre: usuario.nombre,
          navegador: navigator.userAgent?.slice(0, 120) || "",
        },
      });
      if (error) console.warn("[auditoria login]", error.message);
    } catch (err) {
      console.warn("[auditoria login]", err.message);
    }
  };

  const logout = () => {
    setCurrentUser(null);
    limpiarSesionNavegador();
    setPantalla("bienvenida");
  };

  useEffect(() => {
    limpiarSesionNavegador();
    const cerrarAlSalir = () => {
      limpiarSesionNavegador();
      setCurrentUser(null);
      setPantalla("bienvenida");
    };
    const cerrarSiVuelveDesdeCache = (event) => {
      if (event.persisted) cerrarAlSalir();
    };
    window.addEventListener("beforeunload", cerrarAlSalir);
    window.addEventListener("pagehide", cerrarAlSalir);
    window.addEventListener("pageshow", cerrarSiVuelveDesdeCache);
    return () => {
      window.removeEventListener("beforeunload", cerrarAlSalir);
      window.removeEventListener("pagehide", cerrarAlSalir);
      window.removeEventListener("pageshow", cerrarSiVuelveDesdeCache);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return undefined;
    const marcarActividad = () => { lastActivityRef.current = Date.now(); };
    const revisarInactividad = () => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_LIMIT_MS) {
        alert("Sesion cerrada por inactividad mayor a una hora. Ingrese nuevamente con su clave.");
        logout();
      }
    };
    const eventos = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    eventos.forEach(ev => window.addEventListener(ev, marcarActividad, { passive: true }));
    const timer = window.setInterval(revisarInactividad, 60 * 1000);
    return () => {
      eventos.forEach(ev => window.removeEventListener(ev, marcarActividad));
      window.clearInterval(timer);
    };
  }, [currentUser]);

  const registrarAuditoria = async (accion, entidad, entidadId, detalle = {}) => {
    if (!currentUser?.id) return;
    try {
      const { error } = await supabase.rpc("registrar_auditoria", {
        p_user_id: currentUser.id,
        p_accion: accion,
        p_entidad: entidad,
        p_entidad_id: entidadId || "",
        p_detalle: detalle,
      });
      if (error) console.warn("[auditoria]", error.message);
    } catch (err) {
      console.warn("[auditoria]", err.message);
    }
  };

  const textoAuditoria = (valor) => {
    if (valor === undefined || valor === null) return "";
    if (typeof valor === "object") return JSON.stringify(valor);
    return String(valor);
  };

  const valorCortoAuditoria = (valor) => {
    const texto = textoAuditoria(valor).trim();
    return texto.length > 120 ? texto.slice(0, 117) + "..." : texto;
  };

  const LABELS_AUDITORIA_PERSONA = {
    nombre: "Nombre",
    rut: "Cedula de identidad",
    fechaNacimiento: "Fecha de nacimiento",
    telefono: "Telefono",
    email: "Correo electronico",
    direccion: "Direccion",
    comuna: "Comuna",
    puntajeRSH: "RSH %",
    integrantesFamiliares: "N integrantes",
    comiteId: "Comite",
    comite: "Comite",
    estadoCivil: "Estado civil",
    cuentaAhorro: "Numero cuenta ahorro",
    banco: "Banco",
    dominio_terreno: "Dominio de la propiedad",
    dominiopropiedad: "Dominio de la propiedad",
    rol_propiedad: "Rol propiedad",
    rol: "Rol",
    coordenadas: "Coordenadas",
    avaluoFiscal: "Avaluo fiscal",
    rutColores: "RUT colores",
    cargo_comite: "Cargo en comite",
    estado_desmarque: "Estado desmarque",
    observaciones: "Observaciones",
  };

  const resumenCambiosPersona = (anterior = {}, actual = {}) => {
    if (!anterior?.id) return [];
    return Object.keys(LABELS_AUDITORIA_PERSONA).reduce((acc, key) => {
      const antes = valorCortoAuditoria(anterior[key]);
      const despues = valorCortoAuditoria(actual[key]);
      if (antes !== despues) {
        acc.push(`${LABELS_AUDITORIA_PERSONA[key]}: ${antes || "(vacio)"} -> ${despues || "(vacio)"}`);
      }
      return acc;
    }, []);
  };

  const nombrePersonaAuditoria = (solicitud = {}) => {
    const porId = personas.find(p => p.id === (solicitud.personaId || solicitud.persona_id));
    return solicitud.personaNombre || solicitud.persona_nombre || porId?.nombre || "";
  };

  const resumenCambiosDocumentos = (anterior = [], actual = []) => {
    const prevPorNombre = new Map((anterior || []).map((doc, idx) => [doc?.nombre || `doc_${idx}`, doc || {}]));
    const cambios = [];
    (actual || []).forEach((doc, idx) => {
      const nombre = doc?.nombre || `Documento ${idx + 1}`;
      const prev = prevPorNombre.get(nombre);
      if (!prev) {
        cambios.push(`Documento solicitado: ${nombre}`);
        return;
      }
      const cambiosDoc = [];
      if (!!prev.entregado !== !!doc.entregado) {
        cambiosDoc.push(doc.entregado ? "VB marcado" : "VB retirado");
      }
      const valorAntes = valorCortoAuditoria(prev.valor);
      const valorDespues = valorCortoAuditoria(doc.valor);
      if (valorAntes !== valorDespues) {
        cambiosDoc.push(`dato: ${valorAntes || "(vacio)"} -> ${valorDespues || "(vacio)"}`);
      }
      const archivoAntes = valorCortoAuditoria(prev.archivo);
      const archivoDespues = valorCortoAuditoria(doc.archivo);
      if (archivoAntes !== archivoDespues && archivoDespues) {
        cambiosDoc.push(`archivo guardado: ${archivoDespues}`);
      }
      if (cambiosDoc.length) cambios.push(`${nombre}: ${cambiosDoc.join(", ")}`);
    });
    return cambios;
  };

  const aligerarSolicitudesEnSegundoPlano = async (lista = []) => {
    const pesadas = (lista || []).filter(sol => tieneDocumentoPesadoConStorage(sol.documentos));
    if (!pesadas.length) return;
    for (const sol of pesadas) {
      const documentos = aliviarDocumentosSolicitud(sol.documentos);
      try {
        const { error } = await supabase.from("solicitudes").update({ documentos }).eq("id", sol.id);
        if (error) console.warn("[rendimiento] No se pudo aligerar solicitud:", sol.id, error.message);
      } catch (err) {
        console.warn("[rendimiento] Excepción al aligerar solicitud:", sol.id, err.message);
      }
    }
  };

  const conTiempoMaximo = (promesa, ms, mensaje) => Promise.race([
    promesa,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error(mensaje)), ms))
  ]);

  const cargarBaseServidor = async () => {
    const res = await conTiempoMaximo(
      fetch(API + "/api/bootstrap", { cache: "no-store" }),
      8000,
      "Tiempo agotado cargando datos base desde Render."
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || "No se pudo cargar datos base desde Render.");
    return {
      comites: json.comites || [],
      personas: json.personas || [],
      programasCustom: json.programasCustom || [],
    };
  };

  const cargarBaseSupabaseDirecto = async () => {
    const [comitesRes, personasRes, programasRes] = await conTiempoMaximo(
      Promise.all([
        supabase.from("comites").select("*"),
        supabase.from("personas").select("*"),
        supabase.from("programas_custom").select("*"),
      ]),
      6000,
      "Tiempo agotado cargando solicitantes y comités desde Supabase."
    );
    const erroresBase = [comitesRes, personasRes, programasRes]
      .map(r => r.error?.message)
      .filter(Boolean);
    if (erroresBase.length) {
      throw new Error("Recarga incompleta desde Supabase: " + erroresBase.join(" | "));
    }
    return {
      comites: comitesRes.data || [],
      personas: personasRes.data || [],
      programasCustom: programasRes.data || [],
    };
  };

  const cargarBaseRespaldoEstatico = async () => {
    const res = await conTiempoMaximo(
      fetch("/respaldo_base.json", { cache: "no-store" }),
      5000,
      "Tiempo agotado cargando respaldo local."
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (!json.personas?.length && !json.comites?.length)) {
      throw new Error("No se pudo cargar respaldo local.");
    }
    return {
      comites: json.comites || [],
      personas: json.personas || [],
      programasCustom: json.programasCustom || [],
      solicitudes: json.solicitudes || [],
      desdeRespaldo: true,
      fuente: json.fuente || "respaldo local",
    };
  };

  const mapearPersonaDb = (x = {}) => ({
    ...x,
    // Mapeos snake_case -> camelCase (campos existentes)
    comiteId:             x.comite_id,
    fechaNacimiento:      x.fecha_nacimiento,
    puntajeRSH:           x.puntaje_rsh,
    integrantesFamiliares:x.integrantes_familiares,
    fechaIngreso:         x.fecha_ingreso,
    tipo_comite:          x.tipo_comite || x.tipo || "",
    rol_propiedad:        x.rol_propiedad || "",
    dominio_terreno:      x.dominio_terreno || "",
    anio_subsidio:        x.anio_subsidio || "",
    sector:               x.sector || "",
    coordenadas:          x.coordenadas || "",
    numero_recepcion:     x.numero_recepcion || "",
    fecha_recepcion:      x.fecha_recepcion || "",
    estado_desmarque:     x.estado_desmarque || "",
    observaciones:        x.observaciones || "",
    // Mapeos lowercase DB -> camelCase app (campos de fichas técnicas)
    dominiopropiedad:      x.dominiopropiedad || "",
    nFJS:                  x.nfjs || "",
    sistemaAgua:           x.sistemaagua || "",
    nServicioAgua:         x.nservicioagua || "",
    proveedorElectrico:    x.proveedorelectrico || "",
    nClienteElectricidad:  x.nclienteelectricidad || "",
    certRuralidad:         x.certruralidad || "",
    avaluoFiscal:          x.avaluofiscal || "",
    informacionesPrevias:  x.informacionesprevias || "",
    infPrevias:            x.infprevias || x.informacionesprevias || "",
    antecedentesVivienda:  x.antecedentesvivienda || "",
    discapacidad:          x.discapacidad || "",
    movilidadReducida:     x.movilidadreducida || "",
    credencialDiscapacidad:x.credencialdiscapacidad || "",
    cuentaAhorro:          x.cuentaahorro || "",
    banco:                 x.banco || "",
    rutColores:            x.rutcolores || "",
    subsidioAnterior:      x.subsidio_anterior || "",
    estadoCivil:           x.estadocivil || "",
    ahorroPostular:        x.ahorropostular || "",
    adultoMayor:           x.adultomayor || "",
    cargo_comite:          x.cargo_comite || "",
    numero_lista:          x.numero_lista || "",
    rol:                   x.rol || "",
    permisoEdificacion:    x.permisoedificacion || "",
    recepcionDefinitiva:   x.recepciondefinitiva || "",
    constructoraSeleccionada: x.constructoraseleccionada || "",
    metrosOriginal:        x.metrosoriginal || "",
    metrosAmpl:            x.metrosampl || "",
    metrosNoRegul:         x.metrosnoregul || "",
    totalMetros:           x.totalmetros || "",
    modalidadPostulacion:  x.modalidadpostulacion || "",
  });

  const aplicarDatosBase = (base = {}, guardarCache = true) => {
    const c = base.comites || [];
    const p = base.personas || [];
    const pc = base.programasCustom || [];
    if (!p.length && !c.length) return combinarProgramas(programasCustom);
    const programasCustomCargados = (pc || []).map(x => ({
      ...x,
      colorLight: x.colorlight || "#F9FAFB",
      documentos: Array.isArray(x.documentos) ? x.documentos : [],
      esCustom: true,
    }));
    setProgramasCustom(programasCustomCargados);
    setComites((c || []).map(x => ({
      ...x,
      programaId: x.programa_id,
      fechaCreacion: x.fecha_creacion,
    })));
    setPersonas((p || []).map(mapearPersonaDb));
    setDatosBaseListos(true);
    if (guardarCache) {
      DB.set("serviu_cache_base", {
        comites: c,
        personas: p,
        programasCustom: pc,
        actualizado: new Date().toISOString(),
      });
    }
    return combinarProgramas(programasCustomCargados);
  };

  const mapearSolicitudDb = (sol = {}, programasCarga = combinarProgramas(programasCustom)) => {
    const documentosCargados = Array.isArray(sol.documentos);
    const mapped = {
      ...sol,
      personaId: sol.persona_id,
      personaNombre: sol.persona_nombre,
      programaId: sol.programa_id,
      codigoComite: sol.codigo_comite,
      tipoComite: sol.tipo_comite,
      profesionalComite: sol.profesional_comite,
      documentos: documentosCargados ? aliviarDocumentosSolicitud(sol.documentos) : [],
      documentosCargados,
    };
    mapped.fecha_visita = fechaVisitaSolicitud(mapped);
    // Migrar solicitudes CSP antiguas solo cuando sus documentos completos ya fueron cargados.
    if ((mapped.programaId === "csp_rural" || mapped.programaId === "csp_urbano") && documentosCargados) {
      const prog = programasCarga.find(p => p.id === mapped.programaId);
      if (prog && mapped.documentos) {
        const nombresExistentes = new Set(mapped.documentos.map(d => d.nombre));
        const faltantes = prog.documentos.filter(d => !nombresExistentes.has(d.nombre));
        if (faltantes.length > 0) {
          mapped.documentos = [
            ...mapped.documentos,
            ...faltantes.map(d => ({ nombre: d.nombre, obligatorio: d.obligatorio, entregado: false, tipo: d.tipo || null, opciones: d.opciones || null, opcionSeleccionada: null, etiqueta: null }))
          ];
        }
      }
    }
    return mapped;
  };

  const cargarSolicitudesPorPartes = async () => {
    try {
      const res = await conTiempoMaximo(
        fetch(API + "/api/solicitudes", { cache: "no-store" }),
        10000,
        "Tiempo agotado cargando solicitudes desde Render."
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok !== false) return json.solicitudes || [];
    } catch (err) {
      console.warn("[solicitudes render]", err.message);
    }
    const pageSize = 100;
    const todas = [];
    for (let inicio = 0; ; inicio += pageSize) {
      const { data, error } = await conTiempoMaximo(
        supabase
          .from("solicitudes")
          .select(SOLICITUDES_SELECT_LISTADO)
          .range(inicio, inicio + pageSize - 1),
        6000,
        "Tiempo agotado cargando solicitudes."
      );
      if (error) throw error;
      todas.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return todas;
  };

  // Cargar datos desde Supabase al iniciar
  useEffect(() => {
    if (!currentUser) {
      setCargando(false);
      setDatosBaseListos(false);
      return undefined;
    }
    const cacheBase = DB.get("serviu_cache_base");
    if (cacheBase && ((cacheBase.personas || []).length || (cacheBase.comites || []).length)) {
      aplicarDatosBase(cacheBase, false);
      setUltimaRecargaDatos("respaldo local");
    } else {
      setDatosBaseListos(false);
    }
    const cargarDatos = async (silencioso = false) => {
      const secuencia = ++cargaDatosSeqRef.current;
      if (!silencioso) setCargando(false);
      if (!silencioso) setErrorCargaDatos("");
      let respaldoActivo = false;
      if (!silencioso && !datosBaseListos) {
        try {
          const respaldo = await cargarBaseRespaldoEstatico();
          if (secuencia === cargaDatosSeqRef.current) {
            const programasRespaldo = aplicarDatosBase(respaldo, false);
            setSolicitudes((respaldo.solicitudes || []).map(sol => mapearSolicitudDb(sol, programasRespaldo)));
            setUltimaRecargaDatos("respaldo emergencia");
            setErrorCargaDatos(`Supabase está demorando. Se muestran datos desde ${respaldo.fuente}; no se borró información. El sistema intentará reconectar.`);
            respaldoActivo = true;
          }
        } catch (respaldoErr) {
          console.warn("[respaldo inicial]", respaldoErr.message);
        }
      }
      try {
        let base;
        let usandoRespaldo = false;
        try {
          base = await cargarBaseServidor();
        } catch (renderErr) {
          console.warn("[bootstrap render]", renderErr.message);
          try {
            base = await cargarBaseSupabaseDirecto();
          } catch (supabaseErr) {
            console.warn("[bootstrap supabase]", supabaseErr.message);
            base = await cargarBaseRespaldoEstatico();
            usandoRespaldo = true;
          }
        }
        if (secuencia !== cargaDatosSeqRef.current) return;
        const programasCarga = aplicarDatosBase(base);
        setUltimaRecargaDatos(new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }));
        setErrorCargaDatos(usandoRespaldo
          ? `Supabase no responde. Se muestran datos desde ${base.fuente}; no se borró información. Presione Actualizar datos para reconectar.`
          : "");
        if (!silencioso) setCargando(false);

        if (usandoRespaldo && (base.solicitudes || []).length) {
          setSolicitudes((base.solicitudes || []).map(sol => mapearSolicitudDb(sol, programasCarga)));
          return;
        }

        cargarSolicitudesPorPartes()
          .then(s => {
            if (secuencia !== cargaDatosSeqRef.current) return;
            const solicitudesMapeadas = (s || []).map(sol => mapearSolicitudDb(sol, programasCarga));
            setSolicitudes(solicitudesMapeadas);
            setTimeout(() => { aligerarSolicitudesEnSegundoPlano(solicitudesMapeadas); }, 1500);
            setUltimaRecargaDatos(new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }));
            setErrorCargaDatos("");
          })
          .catch(solErr => {
            console.error("Error cargando solicitudes:", solErr);
            setErrorCargaDatos("Se cargaron solicitantes y comités, pero no se pudieron cargar las solicitudes/documentos. Presione Actualizar datos.");
          });
      } catch (err) {
        console.error("Error cargando datos:", err);
        if (respaldoActivo) {
          setErrorCargaDatos("Supabase no responde. Se mantiene el respaldo de emergencia; no se borró información. Presione Actualizar datos para reconectar.");
        } else {
          setErrorCargaDatos(err?.message || "No se pudieron cargar los datos desde Supabase.");
        }
      } finally {
        if (!silencioso) setCargando(false);
      }
    };
    cargarDatos();
    window.serviuRecargarDatos = async () => {
      setRecargandoDatos(true);
      try {
        await cargarDatos(true);
      } finally {
        setRecargandoDatos(false);
      }
    };
    const usuarioEstaEditando = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      return ["input", "textarea", "select"].includes(tag) || el.isContentEditable;
    };
    const recargarSiVisible = () => {
      if (document.visibilityState === "visible" && !usuarioEstaEditando()) cargarDatos(true);
    };
    const timer = window.setInterval(recargarSiVisible, 60 * 1000);
    document.addEventListener("visibilitychange", recargarSiVisible);
    window.addEventListener("focus", recargarSiVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", recargarSiVisible);
      window.removeEventListener("focus", recargarSiVisible);
      if (window.serviuRecargarDatos) delete window.serviuRecargarDatos;
    };
  }, [currentUser?.id]);

  // Guardar personas en Supabase
  const savePersonas = async (lista) => {
    if (IS_DEMO_MODE) {
      const idsActuales = new Set(personas.map(p => p.id));
      const nuevos = lista.filter(p => !idsActuales.has(p.id));
      if (personas.length + nuevos.length > DEMO_MAX_SOLICITANTES) {
        alert(`Demo limitado a ${DEMO_MAX_SOLICITANTES} solicitantes. Para seguir usando el sistema completo se debe contratar/activar la version institucional.`);
        return;
      }
    }
    setPersonas(lista);
    const ultima = lista[lista.length - 1];
    if (ultima && !personas.find(p => p.id === ultima.id)) {
      await supabase.from("personas").insert([{
        id: ultima.id, nombre: ultima.nombre, rut: ultima.rut,
        fecha_nacimiento: ultima.fechaNacimiento, telefono: ultima.telefono,
        email: ultima.email, direccion: ultima.direccion, comuna: ultima.comuna,
        puntaje_rsh: ultima.puntajeRSH, integrantes_familiares: ultima.integrantesFamiliares,
        comite_id: ultima.comiteId || null, comite: ultima.comite || null,
        fecha_ingreso: ultima.fechaIngreso || ultima.fecha_ingreso || today(),
        tipo_comite: ultima.tipo_comite || "",
        rol_propiedad: ultima.rol_propiedad || "",
        dominio_terreno: ultima.dominio_terreno || "",
        anio_subsidio: ultima.anio_subsidio || "",
        sector: ultima.sector || "",
        coordenadas: ultima.coordenadas || "",
        numero_recepcion: ultima.numero_recepcion || "",
        fecha_recepcion: ultima.fecha_recepcion || "",
        estado_desmarque: ultima.estado_desmarque || "NO VISITADO",
        observaciones: ultima.observaciones || "",
      }]);
      await registrarAuditoria("crear_solicitante", "personas", ultima.id, { nombre: ultima.nombre, rut: ultima.rut });
      // Si es comité desmarque → crear solicitud Habitabilidad automáticamente
      if (ultima.comiteId === "comite_desmarque") {
        const progHab = combinarProgramas(programasCustom).find(p => p.id === "habitabilidad");
        const solExistente = solicitudes.find(s => s.personaId === ultima.id && s.programaId === "habitabilidad");
        if (progHab && !solExistente) {
          const nuevaSol = {
            id: uid(),
            personaId: ultima.id,
            personaNombre: ultima.nombre,
            programaId: "habitabilidad",
            fecha: today(),
            documentos: progHab.documentos.map(d => ({
              nombre: d.nombre, obligatorio: d.obligatorio, entregado: false,
              tipo: d.tipo || null, opciones: d.opciones || null, opcionSeleccionada: null, etiqueta: null, valor: d.valor || ""
            }))
          };
          await supabase.from("solicitudes").insert([{
            id: nuevaSol.id, persona_id: nuevaSol.personaId, persona_nombre: nuevaSol.personaNombre,
            programa_id: nuevaSol.programaId, fecha: nuevaSol.fecha, documentos: nuevaSol.documentos
          }]);
          await registrarAuditoria("crear_solicitud_automatica", "solicitudes", nuevaSol.id, { persona: nuevaSol.personaNombre, programa: "habitabilidad" });
          setSolicitudes(prev => [...prev, nuevaSol]);
        }
      }
    } else {
      // Actualizar sin borrar registros ausentes de la lista local.
      // En modo web multiusuario, una lista local incompleta no debe eliminar datos de Supabase.
      const anterioresPorId = new Map(personas.map(p => [p.id, p]));
      for (const p of lista) {
        await supabase.from("personas").upsert({
          id: p.id, nombre: p.nombre, rut: p.rut,
          fecha_nacimiento: p.fechaNacimiento, telefono: p.telefono,
          email: p.email, direccion: p.direccion, comuna: p.comuna,
          puntaje_rsh: p.puntajeRSH, integrantes_familiares: p.integrantesFamiliares,
          comite_id: p.comiteId || null, comite: p.comite || null,
          fecha_ingreso: p.fechaIngreso || p.fecha_ingreso || today()
        });
        const cambios = resumenCambiosPersona(anterioresPorId.get(p.id), p);
        if (cambios.length) {
          await registrarAuditoria("actualizar_solicitantes", "personas", p.id, {
            solicitante: p.nombre || anterioresPorId.get(p.id)?.nombre || "",
            cambios,
            resumen: cambios.join("; "),
          });
        }
      }
    }
  };

  // Guardar solicitudes en Supabase
  const saveSolicitudes = async (lista) => {
    setSolicitudes(lista);
    const anterioresPorId = new Map(solicitudes.map(s => [s.id, s]));
    for (const s of lista) {
      const anterior = anterioresPorId.get(s.id);
      const documentosCargados = s.documentosCargados !== false || (s.documentos || []).length > 0 || !anterior;
      const cambioBase = !anterior ||
        anterior.personaId !== s.personaId ||
        anterior.personaNombre !== s.personaNombre ||
        anterior.programaId !== s.programaId ||
        anterior.fecha !== s.fecha ||
        (anterior.comite || "") !== (s.comite || "") ||
        (anterior.codigoComite || "") !== (s.codigoComite || "") ||
        (anterior.tipoComite || "") !== (s.tipoComite || "") ||
        (anterior.profesionalComite || "") !== (s.profesionalComite || "") ||
        (anterior.fecha_visita || "") !== (s.fecha_visita || "") ||
        (documentosCargados && JSON.stringify(anterior.documentos || []) !== JSON.stringify(s.documentos || []));
      if (!cambioBase) continue;
      const payload = {
        id: s.id, persona_id: s.personaId, persona_nombre: s.personaNombre,
        programa_id: s.programaId, fecha: s.fecha, comite: s.comite || null,
        codigo_comite: s.codigoComite || null, tipo_comite: s.tipoComite || null,
        profesional_comite: s.profesionalComite || null
      };
      if (documentosCargados) payload.documentos = s.documentos;
      await supabase.from("solicitudes").upsert(payload);
      const cambios = documentosCargados ? resumenCambiosDocumentos(anterior?.documentos, s.documentos) : [];
      if (cambios.length) {
        await registrarAuditoria("guardar_solicitudes", "solicitudes", s.id, {
          solicitante: nombrePersonaAuditoria(s),
          programa: s.programaId || "",
          documentos: cambios,
          resumen: cambios.join("; "),
        });
      }
    }
    // No borrar solicitudes ausentes de la lista local: protege datos en producción multiusuario.
  };

  // Guardar comités en Supabase
  const saveComites = async (lista) => {
    setComites(lista);
    // No borrar comités ausentes de la lista local: protege datos en producción multiusuario.
    try {
      for (const c of lista) {
        const { error } = await supabase.from("comites").upsert({
          id: c.id, nombre: c.nombre, descripcion: c.descripcion || null,
          programa_id: c.programaId || null, fecha_creacion: c.fechaCreacion
        });
        if (error) throw error;
      }
      await registrarAuditoria("guardar_comites", "comites", "", { cantidad: lista.length });
    } catch (err) {
      console.warn("[saveComites] No se pudo guardar comité:", err?.message || err);
      alert("No se pudo guardar el comité en la nube. La pantalla seguirá funcionando; revise conexión o Supabase.");
    }
  };

  const cargarSolicitudesPersona = async (personaId) => {
    if (!personaId) return;
    try {
      let data = null;
      try {
        const params = new URLSearchParams({ select: "*", [`eq[persona_id]`]: personaId });
        const res = await conTiempoMaximo(
          fetch(`${API}/api/db/solicitudes?${params.toString()}`, { cache: "no-store" }),
          12000,
          "Tiempo agotado cargando documentos del solicitante desde Render."
        );
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok !== false) data = json.data || [];
      } catch (apiErr) {
        console.warn("[detalle solicitante render]", apiErr?.message || apiErr);
      }
      if (!data) {
        const { data: dataSupabase, error } = await conTiempoMaximo(
          supabase.from("solicitudes").select("*").eq("persona_id", personaId),
          12000,
          "Tiempo agotado cargando documentos del solicitante."
        );
        if (error) throw error;
        data = dataSupabase || [];
      }
      const programasCarga = combinarProgramas(programasCustom);
      const solicitudesCompletas = (data || []).map(sol => mapearSolicitudDb(sol, programasCarga));
      setSolicitudes(prev => {
        const porId = new Map((prev || []).map(sol => [sol.id, sol]));
        solicitudesCompletas.forEach(sol => {
          porId.set(sol.id, { ...(porId.get(sol.id) || {}), ...sol, documentosCargados: true });
        });
        return Array.from(porId.values());
      });
    } catch (err) {
      console.warn("[detalle solicitante] No se pudieron cargar documentos completos:", err?.message || err);
    }
  };

  const goDetail = (id) => {
    setFromView(view);
    setDetailId(id);
    setView("detalle");
    cargarSolicitudesPersona(id);
  };
  const nav = (v) => {
    if (v.startsWith("comites_prog_")) {
      setFiltroPrograma(v.replace("comites_prog_", ""));
      setView("comites");
    } else {
      setFiltroPrograma(null);
      setView(v);
    }
    setDetailId(null);
    setComiteDetailId(null);
  };

  const verDetalleComite = (id) => { setComiteDetailId(id); setView("detalleComite"); };

  const sinComiteCount = personas.filter(p => !p.comiteId || p.comiteId === "").length;
  const esAdmin = esAdminAppUser(currentUser);

  const NAV_ITEMS = [
    ["dashboard", "Inicio"],
    ["personas", "Solicitantes"],
    ["sincomite", "Sin Comité"],
    ["comites", "Comités"],
    ["programas", "Programas"],
    ["solicitudes", "Solicitudes"],
    ["informes", "Informes"],
    ["auditoria", "Auditoría"],
    ["admin", "Administración"],
  ];
  const NAV_VISIBLE = NAV_ITEMS.filter(([k]) => !["auditoria", "admin"].includes(k) || esAdmin);

  const navActivo = (k) =>
    view === k ||
    (view === "detalle" && k === "personas") ||
    (view === "detalleComite" && k === "comites");

  if (!currentUser) {
    return <LoginView onLogin={login} />;
  }

  if (pantalla === "bienvenida") {
    return <PantallaBienvenida onEntrar={() => setPantalla("sistema")} />;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Segoe UI, sans-serif", background: "#F0EDE8" }}>
      <aside style={{ width: 240, background: "#1e3a5f", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "28px 24px 20px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", lineHeight: 1.25 }}>Sistema de Gestión de Subsidios Habitacionales</div>
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "0 24px" }} />
        <nav style={{ padding: "16px 12px", flex: 1 }}>
          {NAV_VISIBLE.map(([k, l]) => (
            <div key={k} onClick={() => nav(k)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, marginBottom: 4, cursor: "pointer",
              background: navActivo(k) ? "rgba(255,255,255,0.13)" : "transparent",
              borderLeft: navActivo(k) ? "3px solid #4ECDC4" : "3px solid transparent",
              color: navActivo(k) ? "#fff" : "#7BAFD4",
              fontSize: 14, fontWeight: 500
            }}>
              {l}
              {k === "comites" && comites.length > 0 && (
                <span style={{ marginLeft: "auto", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "1px 8px", fontSize: 11 }}>{comites.length}</span>
              )}
              {k === "sincomite" && sinComiteCount > 0 && (
                <span style={{ marginLeft: "auto", background: "#DC2626", borderRadius: 10, padding: "1px 8px", fontSize: 11, color: "#fff", fontWeight: 700 }}>{sinComiteCount}</span>
              )}
            </div>
          ))}
        </nav>
        <div style={{ padding: "16px 24px 24px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "#fff" }}>
            <div style={{ fontSize: 10, color: "#7BAFD4", textTransform: "uppercase", letterSpacing: 1 }}>Usuario activo</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{currentUser.nombre}</div>
            <div style={{ fontSize: 11, color: "#BBD7EA", marginTop: 2 }}>{currentUser.rol}</div>
          </div>
          <div
            onClick={() => setPantalla("bienvenida")}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
              borderRadius: 10, cursor: "pointer", marginBottom: 10,
              background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.35)",
              color: "#FCA5A5", fontSize: 14, fontWeight: 600,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(220,38,38,0.3)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(220,38,38,0.15)"}
          >
            ⏻ Cerrar programa
          </div>
          <div
            onClick={logout}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
              borderRadius: 10, cursor: "pointer", marginBottom: 10,
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
              color: "#E0F2FE", fontSize: 14, fontWeight: 600,
            }}
          >
            Cerrar sesión
          </div>
          <div style={{ fontSize: 11, color: "#5A8BB0", lineHeight: 1.6 }}>Sistema de gestion de subsidios habitacionales</div>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: "32px 36px" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 12 }}>
          {ultimaRecargaDatos && (
            <span style={{ fontSize: 11, color: "#64748b" }}>
              Datos actualizados: {ultimaRecargaDatos}
            </span>
          )}
          <button
            onClick={() => window.serviuRecargarDatos?.()}
            disabled={recargandoDatos || cargando}
            style={{
              background: recargandoDatos ? "#94A3B8" : "#1e3a5f",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "7px 12px",
              fontSize: 12,
              fontWeight: 800,
              cursor: recargandoDatos || cargando ? "not-allowed" : "pointer",
            }}>
            {recargandoDatos ? "Actualizando..." : "Actualizar datos"}
          </button>
        </div>
        {errorCargaDatos && (
          <div style={{ marginBottom: 14, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#991B1B", borderRadius: 10, padding: "12px 14px", fontSize: 13, fontWeight: 700 }}>
            No se pudieron cargar los datos desde Supabase. No se borró información; revise la conexión y presione “Actualizar datos”.
            <div style={{ marginTop: 4, fontSize: 11, fontWeight: 500, color: "#B91C1C" }}>{errorCargaDatos}</div>
          </div>
        )}
        {IS_DEMO_MODE && (
          <div style={{ background: "#FFFBEB", border: "1px solid #F59E0B", color: "#92400E", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 13, fontWeight: 800 }}>
            MODO DEMO: datos locales de muestra, sin solicitantes reales. Limite: {DEMO_MAX_SOLICITANTES} solicitantes.
          </div>
        )}
        {!datosBaseListos && view !== "admin" && (
          <div style={{ background: "#fff", border: "1px solid #BFDBFE", borderRadius: 14, padding: 26, color: "#1e3a5f", fontWeight: 800 }}>
            Cargando datos reales del sistema...
            <div style={{ marginTop: 8, color: "#64748b", fontSize: 13, fontWeight: 500 }}>
              No se muestran ceros mientras la base no responda. Presione Actualizar datos si tarda demasiado.
            </div>
          </div>
        )}
        {datosBaseListos && view === "sincomite" && <SinComiteView personas={personas} comites={comites} solicitudes={solicitudes} programasCustom={programasCustom} onSavePersonas={savePersonas} onSaveSolicitudes={saveSolicitudes} onDetail={goDetail} />}
        {datosBaseListos && view === "dashboard" && <Dashboard personas={personas} solicitudes={solicitudes} comites={comites} programasCustom={programasCustom} onNav={nav} />}
        {datosBaseListos && view === "personas" && <PersonasView personas={personas} solicitudes={solicitudes} comites={comites} onSave={savePersonas} onDetail={goDetail} programasCustom={programasCustom} />}
        {datosBaseListos && view === "comites" && <ComitesView comites={comites} personas={personas} solicitudes={solicitudes} onSaveComites={saveComites} onVerDetalle={verDetalleComite} filtroPrograma={filtroPrograma} programasCustom={programasCustom} />}
        {datosBaseListos && view === "detalleComite" && <DetalleComite comiteId={comiteDetailId} comites={comites} personas={personas} solicitudes={solicitudes} programasCustom={programasCustom} onBack={() => nav("comites")} onSavePersonas={savePersonas} onSaveSolicitudes={saveSolicitudes} onDetail={goDetail} currentUser={currentUser} registrarAuditoria={registrarAuditoria} />}
        {datosBaseListos && view === "programas" && <ProgramasView solicitudes={solicitudes} programasCustom={programasCustom} onAddPrograma={async (prog) => {
          const { data, error } = await supabase.from("programas_custom").insert([{
            id: uid(), nombre: prog.nombre, descripcion: prog.descripcion,
            color: prog.color, colorlight: prog.colorLight, icon: prog.icon, documentos: prog.documentos
          }]).select();
          if (error) { alert("Error al guardar programa: " + error.message); return; }
          if (data && data[0]) {
            const np = { ...data[0], colorLight: data[0].colorlight || prog.colorLight, documentos: data[0].documentos || prog.documentos, esCustom: true };
            setProgramasCustom(prev => [...prev, np]);
            await registrarAuditoria("crear_programa", "programas_custom", np.id, { nombre: np.nombre });
          } else {
            const np = { id: uid(), ...prog, esCustom: true };
            setProgramasCustom(prev => [...prev, np]);
            await registrarAuditoria("crear_programa", "programas_custom", np.id, { nombre: np.nombre });
          }
        }} onDeletePrograma={async (id) => {
          await supabase.from("programas_custom").delete().eq("id", id);
          setProgramasCustom(prev => prev.filter(p => p.id !== id));
          await registrarAuditoria("eliminar_programa", "programas_custom", id, {});
        }} onUpdatePrograma={async (prog) => {
          const esBase = PROGRAMAS.some(p => p.id === prog.id);
          const payload = {
            id: prog.id,
            nombre: prog.nombre,
            descripcion: prog.descripcion,
            color: prog.color,
            colorlight: prog.colorLight,
            icon: prog.icon,
            documentos: prog.documentos
          };
          const { error } = esBase
            ? await supabase.from("programas_custom").upsert([payload], { onConflict: "id" })
            : await supabase.from("programas_custom").update(payload).eq("id", prog.id);
          if (error) { alert("Error al actualizar programa: " + error.message); return; }
          setProgramasCustom(prev => {
            const nuevo = { ...prog, colorlight: prog.colorLight, colorLight: prog.colorLight, esCustom: !esBase };
            return prev.some(p => p.id === prog.id)
              ? prev.map(p => p.id !== prog.id ? p : { ...p, ...nuevo })
              : [...prev, nuevo];
          });
          await registrarAuditoria("actualizar_programa", "programas_custom", prog.id, { nombre: prog.nombre });
        }} />}
        {datosBaseListos && view === "solicitudes" && <SolicitudesView solicitudes={solicitudes} personas={personas} programasCustom={programasCustom} onDetail={goDetail} />}
        {datosBaseListos && view === "detalle" && <DetallePersona personaId={detailId} personas={personas} solicitudes={solicitudes} comites={comites} programasCustom={programasCustom} onBack={() => fromView === "detalleComite" ? setView("detalleComite") : fromView === "sincomite" ? nav("sincomite") : nav("personas")} onSaveSolicitudes={saveSolicitudes} onSavePersonas={savePersonas} currentUser={currentUser} registrarAuditoria={registrarAuditoria} />}
        {datosBaseListos && view === "informes" && <InformesView personas={personas} comites={comites} solicitudes={solicitudes} currentUser={currentUser} onSavePersonas={savePersonas} programasCustom={programasCustom} />}
        {datosBaseListos && view === "auditoria" && esAdmin && <InformesView personas={personas} comites={comites} solicitudes={solicitudes} currentUser={currentUser} soloAuditoria />}
        {view === "admin" && esAdmin && <AdminUsuariosView currentUser={currentUser} registrarAuditoria={registrarAuditoria} />}
      </main>
    </div>
  );
}
