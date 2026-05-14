import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const PROGRAMAS = {
  habitabilidad: "Habitabilidad de Vivienda (Desmarque de Vivienda)",
  csp_rural: "Construcción Sitio Propio Rural",
  csp_urbano: "Construcción Sitio Propio Urbano",
};

const COMITES_BASE = [
  { codigo: "gr1R", nombre: "Comite de Vivienda Rural Mi Nuevo Hogar", familias: 30, tipo: "Rural", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curin Castro", pj: "P.J. 376054", venc: "Venc. 07/02/2028", directiva: [{ rol: "Presidente", nombre: "Juan Perez Gonzalez" }, { rol: "Secretario", nombre: "Carlos Hernan Paillaleo Paillaleo" }, { rol: "Tesorero", nombre: "Elias Fernando Apablaza Riffo" }] },
  { codigo: "gr2R", nombre: "Comite de Vivienda Rural La Fuerza", familias: 30, tipo: "Rural", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.", pj: "P.J. 379826", venc: "Venc. 14/05/2028", directiva: [] },
  { codigo: "gr3R", nombre: "Comite de Vivienda Rural Kume Ruka", familias: 29, tipo: "Rural", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.", pj: "En tramite", venc: "-", directiva: [] },
  { codigo: "gr4R", nombre: "Comite de Vivienda Rural Newen Mapu", familias: 26, tipo: "Rural", constructora: "Falta Licitar", profesional: "Priscilla Curin Castro", pj: "-", venc: "-", directiva: [] },
  { codigo: "gr5R", nombre: "Comite de Vivienda Rural Kimey Ruca", familias: 28, tipo: "Rural", constructora: "Falta Licitar", profesional: "Jacqueline Ortega B.", pj: "-", venc: "-", directiva: [] },
  { codigo: "gr6R", nombre: "Comite de Vivienda Rural Por Constituir", familias: 25, tipo: "Rural", constructora: "Falta Licitar", profesional: "Priscilla Curin Castro", pj: "-", venc: "-", directiva: [] },
  { codigo: "gr1U", nombre: "Comite de Vivienda Urbano Pioneros de Lautaro", familias: 30, tipo: "Urbano", constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curin Castro", pj: "P.J. 379720", venc: "Venc. 08/05/2028", directiva: [] },
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

function programaId(sol) {
  return sol?.programaId || sol?.programa_id || "";
}

function programaNombre(id) {
  return PROGRAMAS[id] || id || "Programa";
}

function mergeComites(comitesSupa = []) {
  const base = COMITES_BASE.map(c => ({ ...c }));
  const usados = new Set(base.map(c => norm(c.nombre)));
  let nextR = base.filter(c => c.tipo === "Rural").length + 1;
  let nextU = base.filter(c => c.tipo === "Urbano").length + 1;

  (comitesSupa || []).forEach(sc => {
    if (!sc?.nombre || usados.has(norm(sc.nombre))) return;
    const texto = `${sc.programaId || ""} ${sc.programa_id || ""} ${sc.tipo || ""} ${sc.nombre || ""}`.toUpperCase();
    const tipo = texto.includes("URBANO") ? "Urbano" : "Rural";
    const codigo = tipo === "Urbano" ? `gr${nextU++}U` : `gr${nextR++}R`;
    base.push({
      id: sc.id,
      codigo,
      nombre: sc.nombre,
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

function personaEnComite(persona, comite) {
  return persona?.comiteId === comite.codigo ||
    persona?.comiteId === comite.id ||
    norm(persona?.comite) === norm(comite.nombre);
}

function miembrosComite(comite, personas) {
  return (personas || []).filter(p => personaEnComite(p, comite));
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
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>${estilosImpresion()}</head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
}

function formatFechaHora(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("es-CL");
  } catch {
    return value;
  }
}

function accionTexto(accion) {
  const map = {
    ingreso_sistema: "Ingreso al sistema",
    cambio_clave: "Cambio de clave",
    crear_solicitante: "Creacion de solicitante",
    actualizar_solicitantes: "Actualizacion de solicitantes",
    crear_solicitud_automatica: "Solicitud automatica creada",
    guardar_solicitudes: "Solicitud/documentos guardados",
    guardar_comites: "Comites guardados",
    crear_programa: "Programa creado",
    actualizar_programa: "Programa actualizado",
    eliminar_programa: "Programa eliminado",
    registrar_visita: "Visita registrada",
    mover_solicitante: "Solicitante movido",
  };
  return map[accion] || accion || "-";
}

function detalleAuditoria(detalle) {
  if (!detalle) return "";
  if (typeof detalle === "string") return detalle;
  const partes = [];
  Object.entries(detalle || {}).forEach(([k, val]) => {
    if (val === undefined || val === null || val === "") return;
    partes.push(`${k}: ${typeof val === "object" ? JSON.stringify(val) : val}`);
  });
  return partes.join(" | ");
}

function imprimirAuditoria(fecha, logs) {
  const grupos = logs.reduce((acc, log) => {
    const usuario = log.usuario || "Usuario no identificado";
    if (!acc[usuario]) acc[usuario] = [];
    acc[usuario].push(log);
    return acc;
  }, {});
  const totalIngresos = logs.filter(l => l.accion === "ingreso_sistema").length;
  const html = `<div class="page">
    <div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe diario de usuarios</h1><div class="muted">Fecha: ${fecha}</div></div></div>
    <div class="stats">
      <div class="stat"><span class="k">Usuarios con actividad</span><b>${Object.keys(grupos).length}</b></div>
      <div class="stat"><span class="k">Ingresos al sistema</span><b>${totalIngresos}</b></div>
      <div class="stat"><span class="k">Acciones registradas</span><b>${logs.length}</b></div>
      <div class="stat"><span class="k">Generado</span><b style="font-size:16px">${new Date().toLocaleTimeString("es-CL")}</b></div>
    </div>
    ${Object.entries(grupos).map(([usuario, items]) => `<div class="program-box">
      <div class="program-title">${usuario} - ${items.length} accion(es)</div>
      <table><thead><tr><th>Hora</th><th>Accion</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>
        ${items.map(log => `<tr><td>${formatFechaHora(log.creado)}</td><td>${accionTexto(log.accion)}</td><td>${v(log.entidad)}</td><td>${v(detalleAuditoria(log.detalle))}</td></tr>`).join("")}
      </tbody></table>
    </div>`).join("")}
  </div>`;
  imprimirVentana("Informe diario de usuarios", html);
}

function estilosImpresion() {
  return `<style>
    body{font-family:Arial,sans-serif;color:#111827;margin:0;padding:28px;background:#fff;font-size:12px}
    .page{max-width:940px;margin:0 auto;page-break-after:always}.page:last-child{page-break-after:auto}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid #333;padding-bottom:16px;margin-bottom:24px}
    h1{font-size:18px;margin:0 0 4px;text-transform:uppercase}.muted{color:#6b7280}.bar{background:#333;color:#fff;padding:14px 20px;border-radius:6px;margin-bottom:10px;display:flex;justify-content:space-between;gap:16px;font-size:14px;font-weight:700}
    .section{margin-top:22px}.section h2{font-size:12px;text-transform:uppercase;border-bottom:2px solid #d1d5db;padding-bottom:6px;letter-spacing:.03em}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.person-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:12px}.person-col{border:1px solid #d1d5db;border-radius:6px;padding:12px;background:#f9fafb}.person-col h3{font-size:11px;text-transform:uppercase;margin:0 0 10px;color:#374151;border-bottom:1px solid #d1d5db;padding-bottom:6px}.row{display:grid;grid-template-columns:42% 1fr;gap:8px;margin:6px 0}.card{border:1px solid #d1d5db;border-radius:6px;padding:12px;background:#f9fafb}.k{font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:700}.v{font-size:12px;font-weight:700;margin-top:3px;white-space:pre-wrap}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{border:1px solid #d1d5db;border-radius:6px;text-align:center;padding:12px;background:#f3f4f6}.stat b{display:block;font-size:28px;margin-top:8px;color:#4b5563}
    .program-box{border:1px solid #d1d5db;border-radius:7px;margin-top:12px;overflow:hidden}.program-title{background:#f3f4f6;border-bottom:1px solid #d1d5db;padding:9px 10px;font-weight:800;text-transform:uppercase}.pending td{background:#fef2f2;color:#991b1b;font-weight:700}.pending .estado{color:#dc2626}.complete .estado{color:#047857;font-weight:700}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #d1d5db;padding:7px;text-align:left;vertical-align:top}th{background:#f3f4f6;text-transform:uppercase;font-size:10px}
    @media print{body{padding:0}.page{max-width:none;margin:0;padding:22px}}
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
  const datos = [
    ["Programa informado", programaTxt],
    ["Nombre del Comité", primerDato(comite?.nombre, persona.comite)],
    ["Cargo en el Comité", cargoEnComite(persona, comites)],
    ["Nombre del solicitante", persona.nombre],
    ["Cédula de identidad", persona.rut],
    ["Colores RUT", rutColores],
    ["Fecha de nacimiento", fechaNacimientoPersona(persona)],
    ["Adulto mayor", primerDato(persona.adultoMayor, persona.adulto_mayor)],
    ["Teléfono", persona.telefono],
    ["Correo electrónico", primerDato(persona.email, persona.correo)],
    ["Dirección", persona.direccion],
    ["Coordenadas", persona.coordenadas],
    ["RSH %", valorRsh(persona)],
    ["Comuna RSH", primerDato(persona.comunaRsh, persona.comuna_rsh, persona.comuna)],
    ["Estado civil", primerDato(persona.estadoCivil, persona.estado_civil, persona.estadocivil)],
    ["Numero de integrantes", primerDato(persona.integrantesFamiliares, persona.integrantes_familiares)],
    ["Subsidio anterior", primerDato(persona.subsidioAnterior, persona.subsidio_anterior)],
    ["Rol de avalúo", primerDato(persona.rol, persona.rolAvaluo, persona.rol_avaluo)],
    ["Avalúo fiscal", primerDato(persona.avaluoFiscal, persona.avaluo_fiscal)],
    ["Dominio de la propiedad", primerDato(persona.dominioPropiedad, persona.dominio_propiedad)],
    ["Número cuenta ahorro", primerDato(persona.numeroCuentaAhorro, persona.numero_cuenta_ahorro)],
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
  const grupos = docs.reduce((acc, doc) => {
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

function imprimirComite(comite, personas, solicitudes) {
  if (!comite) return;
  const miembros = miembrosComite(comite, personas);
  const filas = miembros.map((p, i) => {
    const stats = estadisticasDocs(solPersonasRelacionadas(p, solicitudes, personas));
    return `<tr><td>${i + 1}</td><td>${v(p.nombre)}</td><td>${v(p.rut)}</td><td>${v(p.telefono)}</td><td>${v(p.direccion)}</td><td>${stats.completos}/${stats.total}</td></tr>`;
  }).join("");

  const directiva = (comite.directiva || []).map(d => `<tr><td>${v(d.rol)}</td><td>${v(d.nombre)}</td></tr>`).join("");
  imprimirVentana("Informe de Comité", `<div class="page"><div class="top"><div><h1>Unidad de Vivienda</h1><div class="muted">Ilustre Municipalidad de Lautaro</div></div><div style="text-align:right"><h1>Informe de Comité</h1><div class="muted">${new Date().toLocaleDateString("es-CL")}</div></div></div><div class="bar"><span>${v(comite.nombre)}</span><span>${v(comite.tipo)}</span></div><div class="grid">${campoHtml("Constructora", comite.constructora)}${campoHtml("Profesional", comite.profesional)}${campoHtml("Personalidad jurídica", comite.pj)}${campoHtml("Vencimiento", comite.venc)}</div><div class="section"><h2>Directiva</h2>${directiva ? `<table><tbody>${directiva}</tbody></table>` : `<div class="muted">Sin directiva registrada.</div>`}</div><div class="section"><h2>Solicitantes</h2><table><thead><tr><th>#</th><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>Dirección</th><th>Documentos</th></tr></thead><tbody>${filas}</tbody></table></div></div>`);
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

function PanelIndividual({ personas, solicitudes, comites }) {
  const [busqueda, setBusqueda] = useState("");
  const [seleccionados, setSeleccionados] = useState([]);
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

  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 14 }}>
      <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre, cédula o comité" style={{ padding: 10, border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }} />
      <button onClick={() => imprimirIndividualMultiple(seleccionados, solicitudes, personas, comites)} disabled={!seleccionados.length} style={{ padding: "10px 16px", border: "none", borderRadius: 8, background: seleccionados.length ? "#2563eb" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: seleccionados.length ? "pointer" : "not-allowed" }}>Generar informe</button>
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
  const [fecha, setFecha] = useState(hoyIso);
  const [logs, setLogs] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      setError("");
      const inicio = new Date(fecha + "T00:00:00");
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + 1);
      const { data, error: err } = await supabase
        .from("audit_log")
        .select("*")
        .gte("creado", inicio.toISOString())
        .lt("creado", fin.toISOString())
        .order("creado", { ascending: false });
      if (err) {
        setError(err.message);
        setLogs([]);
      } else {
        setLogs(data || []);
      }
      setCargando(false);
    };
    cargar();
  }, [fecha]);

  const grupos = logs.reduce((acc, log) => {
    const usuario = log.usuario || "Usuario no identificado";
    if (!acc[usuario]) acc[usuario] = [];
    acc[usuario].push(log);
    return acc;
  }, {});
  const ingresos = logs.filter(l => l.accion === "ingreso_sistema").length;
  const modificaciones = logs.filter(l => l.accion !== "ingreso_sistema").length;

  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "220px auto", gap: 10, alignItems: "end", marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", marginBottom: 5 }}>Fecha del informe</div>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
          style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }} />
      </div>
      <button onClick={() => imprimirAuditoria(fecha, logs)} disabled={!logs.length}
        style={{ width: 210, padding: "10px 18px", border: "none", borderRadius: 8, background: logs.length ? "#0f766e" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: logs.length ? "pointer" : "not-allowed" }}>
        Generar informe
      </button>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>USUARIO ACTUAL</div><div style={{ fontWeight: 900, marginTop: 4 }}>{currentUser?.nombre || "-"}</div></div>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>USUARIOS CON ACTIVIDAD</div><div style={{ fontSize: 22, fontWeight: 900, color: "#0f766e" }}>{Object.keys(grupos).length}</div></div>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>INGRESOS</div><div style={{ fontSize: 22, fontWeight: 900, color: "#2563eb" }}>{ingresos}</div></div>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 800 }}>MODIFICACIONES</div><div style={{ fontSize: 22, fontWeight: 900, color: "#d97706" }}>{modificaciones}</div></div>
    </div>

    {cargando && <div style={{ color: "#6b7280", fontSize: 13 }}>Cargando auditoria...</div>}
    {error && <div style={{ color: "#b91c1c", fontWeight: 800, fontSize: 13 }}>Error al leer auditoria: {error}</div>}
    {!cargando && !error && logs.length === 0 && <div style={{ color: "#6b7280", fontSize: 13 }}>No hay movimientos registrados para esta fecha.</div>}

    <div style={{ display: "grid", gap: 10, maxHeight: 520, overflow: "auto" }}>
      {Object.entries(grupos).map(([usuario, items]) => <div key={usuario} style={{ border: "1px solid #d1d5db", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
        <div style={{ background: "#f3f4f6", padding: "10px 12px", fontWeight: 900, color: "#111827" }}>{usuario} <span style={{ color: "#6b7280", fontWeight: 700 }}>- {items.length} accion(es)</span></div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f9fafb" }}><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Hora</th><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Accion</th><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Entidad</th><th style={{ textAlign: "left", padding: 8, borderTop: "1px solid #e5e7eb" }}>Detalle</th></tr></thead>
          <tbody>{items.map(log => <tr key={log.id}>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{formatFechaHora(log.creado)}</td>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb", fontWeight: 800 }}>{accionTexto(log.accion)}</td>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb" }}>{v(log.entidad)}</td>
            <td style={{ padding: 8, borderTop: "1px solid #e5e7eb" }}>{v(detalleAuditoria(log.detalle))}</td>
          </tr>)}</tbody>
        </table>
      </div>)}
    </div>
  </div>;
}

export default function InformesView({ personas = [], comites: comitesSupa = [], solicitudes = [], currentUser, soloAuditoria = false }) {
  const comites = useMemo(() => mergeComites(comitesSupa), [comitesSupa]);
  const [comiteSelId, setComiteSelId] = useState("");
  const comiteSel = comites.find(c => c.codigo === comiteSelId || c.id === comiteSelId) || null;

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
      <div style={{ color: "#6b7280", marginBottom: 22 }}>Generación de informes individuales, comités rurales, comités urbanos y resumen completo.</div>

      <Section title="Informe Individual del Solicitante" subtitle="Selecciona uno o mas solicitantes y el programa que debe informar cada uno" color="#2563eb">
        <PanelIndividual personas={personas} solicitudes={solicitudes} comites={comites} />
      </Section>

      <Section title="Informe CSP Rural" subtitle="Construcción Sitio Propio Rural - selecciona comité, contenido y detalle de documentos" color="#d97706">
        <PanelOpcionesCsp tipo="Rural" comites={comites} personas={personas} solicitudes={solicitudes} color="#d97706" />
      </Section>

      <Section title="Informe CSP Urbano" subtitle="Construcción Sitio Propio Urbano - selecciona comité, contenido y detalle de documentos" color="#059669">
        <PanelOpcionesCsp tipo="Urbano" comites={comites} personas={personas} solicitudes={solicitudes} color="#059669" />
      </Section>

      <Section title="Informe Completo del Comité" subtitle="Datos completos del comité y listado de postulantes" color="#7c3aed">
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <select value={comiteSelId} onChange={e => setComiteSelId(e.target.value)} style={{ padding: 10, border: "1px solid #c4b5fd", borderRadius: 8, fontSize: 14 }}>
            <option value="">Selecciona un comité</option>
            {comites.map(c => <option key={c.id || c.codigo} value={c.id || c.codigo}>{c.nombre} ({c.tipo})</option>)}
          </select>
          <button onClick={() => imprimirComite(comiteSel, personas, solicitudes)} disabled={!comiteSel} style={{ padding: "10px 18px", border: "none", borderRadius: 8, background: comiteSel ? "#7c3aed" : "#d1d5db", color: "#fff", fontWeight: 800, cursor: comiteSel ? "pointer" : "not-allowed" }}>Generar informe</button>
        </div>
        {comiteSel && <div style={{ marginTop: 12, color: "#6b7280", fontSize: 13 }}><strong>{comiteSel.nombre}</strong> · {miembrosComite(comiteSel, personas).length} postulantes</div>}
      </Section>
    </div>
  </div>;
}
