import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => new Date().toLocaleDateString("es-CL");
const pct = (docs) => docs.length ? Math.round(docs.filter(d => d.entregado).length / docs.length * 100) : 0;
const statusColor = (p) => p === 100 ? "#059669" : p >= 50 ? "#D97706" : "#DC2626";
const statusLabel = (p) => p === 100 ? "Completo" : p >= 50 ? "En proceso" : "Incompleto";
const statusBg = (p) => p === 100 ? "#ECFDF5" : p >= 50 ? "#FFFBEB" : "#FEF2F2";
const API = "http://localhost:3001";

const PROGRAMAS = [
  {
    id: "habitabilidad",
    nombre: "Habitabilidad de Vivienda (DESMARQUE DE VIVIENDA)",
    descripcion: "Evaluacion de condiciones habitables de la vivienda",
    color: "#2563EB", colorLight: "#EFF6FF", icon: "H",
    documentos: [
      { nombre: "Cedula de identidad (escaneada a color)", obligatorio: true },
      { nombre: "Titulo de dominio / Derecho real de uso / Usufructo / Goce de tierra", obligatorio: true },
      { nombre: "Certificado de avaluo detallado de la propiedad", obligatorio: true }
    ]
  },
  {
    id: "csp_urbano",
    nombre: "Construccion Sitio Propio Urbano",
    descripcion: "Subsidio de construccion en sitio propio - zona urbana",
    color: "#059669", colorLight: "#ECFDF5", icon: "U",
    documentos: [
      { nombre: "Cedula de identidad", obligatorio: true },
      { nombre: "Titulo de dominio del terreno", obligatorio: true },
      { nombre: "Registro Social de Hogares en la comuna", obligatorio: true },
      { nombre: "Fecha de nacimiento", obligatorio: true },
      { nombre: "Certificado de avaluo detallado de la propiedad", obligatorio: true },
      { nombre: "Informaciones previas", obligatorio: true },
      { nombre: "Certificado de la vivienda", obligatorio: true },
      { nombre: "Boleta de luz", obligatorio: true, tipo: "luz", opciones: ["Con empalme", "Sin empalme"] },
      { nombre: "Boleta de agua (APR o Pozo)", obligatorio: true, tipo: "agua", opciones: ["Con arranque", "Pozo"] },
      { nombre: "Credencial de discapacidad (si corresponde)", obligatorio: false, tipo: "discapacidad", opciones: ["Con discapacidad", "Sin discapacidad"] }
    ]
  },
  {
    id: "csp_rural",
    nombre: "Construccion Sitio Propio Rural",
    descripcion: "Subsidio de construccion en sitio propio - zona rural",
    color: "#D97706", colorLight: "#FFFBEB", icon: "R",
    documentos: [
      { nombre: "Cedula de identidad", obligatorio: true },
      { nombre: "Titulo de dominio del terreno", obligatorio: true },
      { nombre: "Registro Social de Hogares en la comuna", obligatorio: true },
      { nombre: "Fecha de nacimiento", obligatorio: true },
      { nombre: "Certificado de ruralidad", obligatorio: true },
      { nombre: "Certificado de avaluo detallado de la propiedad", obligatorio: true },
      { nombre: "Boleta de luz", obligatorio: true, tipo: "luz", opciones: ["Con empalme", "Sin empalme"] },
      { nombre: "Boleta de agua (APR o Pozo)", obligatorio: true, tipo: "agua", opciones: ["Con arranque", "Pozo"] },
      { nombre: "Credencial de discapacidad (si corresponde)", obligatorio: false, tipo: "discapacidad", opciones: ["Con discapacidad", "Sin discapacidad"] }
    ]
  }
];

const DB = {
  get: (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const carpetaNombre = (nombre, rut) => nombre.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "") + "_" + rut.replace(/[^0-9kK]/g, "");

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

function Dashboard({ personas, solicitudes, comites, onNav }) {
  const completas = solicitudes.filter(s => pct(s.documentos) === 100).length;
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
        {PROGRAMAS.map(p => {
          const comitesPrograma = comites.filter(c => c.programaId === p.id);
          const personasPrograma = personas.filter(per => comitesPrograma.some(c => c.id === per.comiteId));
          const sols = solicitudes.filter(s => s.programaId === p.id);
          const comp = sols.filter(s => pct(s.documentos) === 100).length;
          return (
            <div key={p.id} onClick={() => onNav("comites_prog_" + p.id)} style={{ background: "#fff", borderRadius: 14, padding: "20px 22px", border: "1px solid #e8e3de", cursor: "pointer" }}>
              <div style={{ width: 40, height: 40, borderRadius: 20, background: p.colorLight, color: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, marginBottom: 10 }}>{p.icon}</div>
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
function FormPersona({ form, setForm, onGuardar, onCancelar, comites, comiteIdFijo }) {
  const CAMPOS = [
    ["nombre", "Nombre completo *", "text", "12"],
    ["rut", "RUT *", "text", "6"],
    ["fechaNacimiento", "Fecha de nacimiento", "date", "6"],
    ["telefono", "Telefono", "tel", "6"],
    ["email", "Correo electronico", "email", "6"],
    ["direccion", "Direccion", "text", "12"],
    ["comuna", "Comuna", "text", "6"],
    ["puntajeRSH", "Puntaje RSH", "text", "6"],
    ["integrantesFamiliares", "Integrantes grupo familiar", "number", "6"],
  ];
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {CAMPOS.map(([k, l, t, cols]) => (
          <div key={k} style={{ gridColumn: "span " + cols }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>{l}</label>
            <input type={t} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })}
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
          </div>
        ))}
        {/* Selector de comité solo si no hay comité fijo */}
        {!comiteIdFijo && comites && comites.length > 0 && (
          <div style={{ gridColumn: "span 12" }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Comité</label>
            <select value={form.comiteId || ""} onChange={e => setForm({ ...form, comiteId: e.target.value })}
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", background: "#fff" }}>
              <option value="">-- Sin comité --</option>
              {comites.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
        <button onClick={onCancelar} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
        <button onClick={onGuardar} style={{ padding: "9px 20px", borderRadius: 8, background: "#1e3a5f", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </div>
    </>
  );
}

// ─── VISTA SOLICITANTES ──────────────────────────────────────────────────────
function PersonasView({ personas, solicitudes, comites, onSave, onDetail }) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const EMPTY = { nombre: "", rut: "", fechaNacimiento: "", telefono: "", email: "", direccion: "", comuna: "", integrantesFamiliares: "", puntajeRSH: "", comiteId: "" };
  const [form, setForm] = useState(EMPTY);

  const filtered = personas.filter(p =>
    p.nombre.toLowerCase().includes(search.toLowerCase()) ||
    p.rut.includes(search) ||
    (p.comuna || "").toLowerCase().includes(search.toLowerCase())
  );

  const getSols = (id) => solicitudes.filter(s => s.personaId === id);
  const getDocPct = (id) => {
    const sols = getSols(id);
    if (!sols.length) return null;
    const all = sols.flatMap(s => s.documentos);
    return all.length ? Math.round(all.filter(d => d.entregado).length / all.length * 100) : 0;
  };

  const eliminar = (e, id) => {
    e.stopPropagation();
    const ok = window["confirm"]("Eliminar este solicitante?");
    if (ok) onSave(personas.filter(x => x.id !== id));
  };

  const guardar = async () => {
    if (!form.nombre.trim() || !form.rut.trim()) { alert("Nombre y RUT son obligatorios."); return; }
    const nueva = { ...form, id: uid(), fechaIngreso: today() };
    const carpeta = carpetaNombre(form.nombre, form.rut);
    try { await fetch(API + "/carpeta/" + encodeURIComponent(carpeta), { method: "POST" }); } catch (e) { }
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

      <div style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, border: "1px solid #e8e3de" }}>
        <input placeholder="Buscar por nombre, RUT o comuna..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", outline: "none", fontSize: 14, flex: 1 }} />
      </div>

      {filtered.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>No hay solicitantes registrados aun.</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map(p => {
          const dp = getDocPct(p.id);
          const sols = getSols(p.id).length;
          const comite = comites.find(c => c.id === p.comiteId);
          return (
            <div key={p.id} onClick={() => onDetail(p.id)} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #e8e3de", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: "#1e3a5f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{p.nombre[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}</div>
                  <div style={{ fontSize: 13, color: "#888" }}>RUT: {p.rut}{p.comuna ? " - " + p.comuna : ""}</div>
                  {comite && <div style={{ fontSize: 11, color: "#7C3AED", marginTop: 2 }}>● {comite.nombre}</div>}
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
          <FormPersona form={form} setForm={setForm} onGuardar={guardar} onCancelar={() => setShowModal(false)} comites={comites} />
        </Modal>
      )}
    </div>
  );
}

// ─── DETALLE PERSONA ─────────────────────────────────────────────────────────
function DetallePersona({ personaId, personas, solicitudes, comites, onBack, onSaveSolicitudes, onSavePersonas }) {
  const [showModal, setShowModal] = useState(false);
  const [progSel, setProgSel] = useState("");
  const [archivos, setArchivos] = useState([]);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef();

  const persona = personas.find(p => p.id === personaId);
  const carpeta = persona ? carpetaNombre(persona.nombre, persona.rut) : "";

  useEffect(() => {
    if (persona) cargarArchivos();
  }, [personaId]);

  if (!persona) return null;

  const misSols = solicitudes.filter(s => s.personaId === personaId);
  const comite = comites.find(c => c.id === persona.comiteId);

  const cargarArchivos = async () => {
    try {
      const r = await fetch(API + "/archivos/" + encodeURIComponent(carpeta));
      const data = await r.json();
      setArchivos(data);
    } catch (e) { setArchivos([]); }
  };

  const subirArchivo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSubiendo(true);
    const fd = new FormData();
    fd.append("archivo", file);
    try {
      await fetch(API + "/subir/" + encodeURIComponent(carpeta), { method: "POST", body: fd });
      await cargarArchivos();
    } catch (err) { alert("Error al subir el archivo."); }
    setSubiendo(false);
    e.target.value = "";
  };

  const eliminarArchivo = async (nombre) => {
    const ok = window["confirm"]("Eliminar " + nombre + "?");
    if (!ok) return;
    await fetch(API + "/archivos/" + encodeURIComponent(carpeta) + "/" + encodeURIComponent(nombre), { method: "DELETE" });
    await cargarArchivos();
  };

  const yaInscritos = misSols.map(s => s.programaId);
  const disponibles = PROGRAMAS.filter(p => !yaInscritos.includes(p.id));

  const agregar = () => {
    if (!progSel) return;
    const prog = PROGRAMAS.find(p => p.id === progSel);
    const nueva = {
      id: uid(), personaId, personaNombre: persona.nombre,
      programaId: prog.id, fecha: today(),
      documentos: prog.documentos.map(d => ({
        nombre: d.nombre, obligatorio: d.obligatorio, entregado: false,
        tipo: d.tipo || null, opciones: d.opciones || null, opcionSeleccionada: null, etiqueta: null
      }))
    };
    onSaveSolicitudes([...solicitudes, nueva]);
    setProgSel("");
    setShowModal(false);
  };

  const toggleDoc = (solId, idx) => {
    onSaveSolicitudes(solicitudes.map(s => s.id !== solId ? s : {
      ...s, documentos: s.documentos.map((d, i) => i === idx ? { ...d, entregado: !d.entregado } : d)
    }));
  };

  // Setea la opción especial de un documento (luz/agua/discapacidad)
  const setDocOpcion = (solId, idx, opcion, tipoReal) => {
    onSaveSolicitudes(solicitudes.map(s => s.id !== solId ? s : {
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
        return { ...d, opcionSeleccionada: opcion, entregado: autoMarcar, etiqueta, tipo: tipoReal };
      })
    }));
  };

  const totalDocs = misSols.flatMap(s => s.documentos);
  const docsOk = totalDocs.filter(d => d.entregado).length;

  return (
    <div>
      <button onClick={onBack} style={{ background: "transparent", border: "1px solid #ddd", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 22, cursor: "pointer" }}>← Volver</button>

      <div style={{ background: "#fff", borderRadius: 14, padding: "24px 28px", marginBottom: 20, border: "1px solid #e8e3de" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 58, height: 58, borderRadius: 29, background: "#1e3a5f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24 }}>{persona.nombre[0].toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a5f" }}>{persona.nombre}</div>
            <div style={{ fontSize: 13, color: "#888" }}>RUT: {persona.rut}{persona.telefono ? " - " + persona.telefono : ""}{persona.email ? " - " + persona.email : ""}</div>
            {(persona.direccion || persona.comuna) && <div style={{ fontSize: 13, color: "#888" }}>{[persona.direccion, persona.comuna].filter(Boolean).join(", ")}</div>}
            {(persona.puntajeRSH || persona.integrantesFamiliares) && <div style={{ fontSize: 13, color: "#888" }}>{persona.puntajeRSH ? "RSH: " + persona.puntajeRSH : ""}{persona.integrantesFamiliares ? " - Grupo familiar: " + persona.integrantesFamiliares + " personas" : ""}</div>}
            {comite && <div style={{ fontSize: 12, color: "#7C3AED", marginTop: 4, fontWeight: 600 }}>Comité: {comite.nombre}</div>}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 28, textAlign: "center" }}>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: "#1e3a5f" }}>{misSols.length}</div><div style={{ fontSize: 11, color: "#aaa" }}>PROGRAMAS</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: docsOk === totalDocs.length && totalDocs.length > 0 ? "#059669" : "#DC2626" }}>{docsOk}/{totalDocs.length}</div><div style={{ fontSize: 11, color: "#aaa" }}>DOCUMENTOS</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 800, color: "#7C3AED" }}>{archivos.length}</div><div style={{ fontSize: 11, color: "#aaa" }}>ARCHIVOS</div></div>
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, padding: "22px 26px", marginBottom: 20, border: "1px solid #e8e3de" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f" }}>Carpeta de documentos</div>
            <div style={{ fontSize: 12, color: "#888" }}>Carpeta: {carpeta}</div>
          </div>
          <div>
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={subirArchivo} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
            <button onClick={() => fileRef.current.click()} disabled={subiendo} style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {subiendo ? "Subiendo..." : "Subir documento"}
            </button>
          </div>
        </div>
        {archivos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 0", color: "#bbb" }}>No hay archivos subidos aun. Haz clic en Subir documento.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {archivos.map(arch => (
              <div key={arch} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 9, border: "1px solid #e5e7eb", background: "#fafafa" }}>
                <a href={API + "/archivos/" + encodeURIComponent(carpeta) + "/" + encodeURIComponent(arch)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 500, color: "#1e3a5f", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{arch}</a>
                <button onClick={() => eliminarArchivo(arch)} style={{ background: "transparent", border: "none", color: "#DC2626", cursor: "pointer", marginLeft: 6 }}>X</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1e3a5f" }}>Solicitudes activas</div>
        {disponibles.length > 0 && <button onClick={() => setShowModal(true)} style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Agregar programa</button>}
      </div>

      {misSols.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>No tiene programas asignados aun.</div>}

      {misSols.map(sol => {
        const prog = PROGRAMAS.find(p => p.id === sol.programaId);
        const p = pct(sol.documentos);
        const ok = sol.documentos.filter(d => d.entregado).length;
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
                <div style={{ fontSize: 14, fontWeight: 800, color: statusColor(p) }}>{ok}/{sol.documentos.length}</div>
              </div>
            </div>
            <div style={{ height: 8, background: "#f0ede8", borderRadius: 4, marginBottom: 18, overflow: "hidden" }}>
              <div style={{ height: "100%", width: p + "%", background: statusColor(p), borderRadius: 4 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {sol.documentos.map((doc, i) => {
                // Detectar tipo especial por nombre (independiente del campo tipo)
                const nom = doc.nombre.toLowerCase();
                const tipoReal = doc.tipo ||
                  (nom.includes("boleta de luz") ? "luz" :
                   nom.includes("boleta de agua") || nom.includes("agua (apr") ? "agua" :
                   nom.includes("credencial de discapacidad") ? "discapacidad" : null);

                const opcionesReal = doc.opciones ||
                  (tipoReal === "luz" ? ["Con empalme", "Sin empalme"] :
                   tipoReal === "agua" ? ["Con arranque", "Pozo"] :
                   tipoReal === "discapacidad" ? ["Con discapacidad", "Sin discapacidad"] : null);

                const esEspecial = !!tipoReal;
                const opSel = doc.opcionSeleccionada || null;
                const sinOpcion = esEspecial && !opSel;

                const necesitaArchivo = esEspecial && (
                  (tipoReal === "luz" && opSel === "Con empalme") ||
                  (tipoReal === "agua" && opSel === "Con arranque") ||
                  (tipoReal === "discapacidad" && opSel === "Con discapacidad")
                );

                const bordeColor = doc.entregado ? "#BBF7D0" : sinOpcion ? "#FDE68A" : doc.obligatorio ? "#FED7D7" : "#E5E7EB";
                const bgColor = doc.entregado ? "#F0FDF4" : sinOpcion ? "#FFFBEB" : doc.obligatorio ? "#FFF5F5" : "#FAFAFA";

                return (
                  <div key={i} style={{ borderRadius: 9, border: "1.5px solid " + bordeColor, background: bgColor, padding: "10px 14px" }}>
                    {/* Fila superior: checkbox + nombre */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: esEspecial ? 8 : 0,
                      cursor: !esEspecial ? "pointer" : "default" }}
                      onClick={() => { if (!esEspecial) toggleDoc(sol.id, i); }}>
                      <div style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid " + (doc.entregado ? "#059669" : "#D1D5DB"), background: doc.entregado ? "#059669" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0, fontSize: 13 }}>
                        {doc.entregado ? "✓" : ""}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: doc.entregado ? "#065f46" : "#374151", fontWeight: 600 }}>{doc.nombre}</div>
                        {doc.etiqueta && <div style={{ fontSize: 12, fontWeight: 800, color: "#059669", marginTop: 2 }}>{doc.etiqueta}</div>}
                        {!doc.obligatorio && !opSel && <div style={{ fontSize: 10, color: "#aaa" }}>Opcional</div>}
                      </div>
                    </div>

                    {/* Botones de opción para docs especiales — siempre visibles */}
                    {esEspecial && opcionesReal && (
                      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                        {opcionesReal.map((op, oi) => (
                          <button key={oi} onClick={() => setDocOpcion(sol.id, i, op, tipoReal)}
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

                    {/* Mensaje según opción seleccionada */}
                    {necesitaArchivo && !doc.entregado && (
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, background: "#FFFBEB", borderRadius: 6, padding: "5px 8px" }}>
                        <span style={{ fontSize: 11, color: "#D97706", fontWeight: 700 }}>⬆ Debe subir el archivo</span>
                        <button onClick={() => toggleDoc(sol.id, i)}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, background: "#059669", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, marginLeft: "auto" }}>
                          ✓ Marcar subido
                        </button>
                      </div>
                    )}
                    {necesitaArchivo && doc.entregado && (
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, background: "#F0FDF4", borderRadius: 6, padding: "5px 8px" }}>
                        <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>✓ Archivo subido</span>
                        <button onClick={() => toggleDoc(sol.id, i)}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, background: "#DC2626", color: "#fff", border: "none", cursor: "pointer", marginLeft: "auto" }}>
                          Desmarcar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

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
    </div>
  );
}

// ─── VISTA PROGRAMAS ─────────────────────────────────────────────────────────
function ProgramasView({ solicitudes }) {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Programas</div>
        <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Programas de subsidio y documentos requeridos</div>
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        {PROGRAMAS.map(prog => {
          const sols = solicitudes.filter(s => s.programaId === prog.id);
          const comp = sols.filter(s => pct(s.documentos) === 100).length;
          return (
            <div key={prog.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e3de", overflow: "hidden" }}>
              <div style={{ background: prog.colorLight, padding: "18px 24px", borderBottom: "3px solid " + prog.color, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 20, background: prog.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{prog.icon}</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 17, color: "#1e3a5f" }}>{prog.nombre}</div>
                    <div style={{ fontSize: 13, color: "#666" }}>{prog.descripcion}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 20, textAlign: "center" }}>
                  <div><div style={{ fontSize: 22, fontWeight: 800, color: prog.color }}>{sols.length}</div><div style={{ fontSize: 11, color: "#888" }}>SOLICITUDES</div></div>
                  <div><div style={{ fontSize: 22, fontWeight: 800, color: "#059669" }}>{comp}</div><div style={{ fontSize: 11, color: "#888" }}>COMPLETAS</div></div>
                </div>
              </div>
              <div style={{ padding: "18px 24px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 12 }}>Documentos requeridos</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {prog.documentos.map((doc, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 8, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, background: doc.obligatorio ? prog.color : "#CBD5E0", marginTop: 5, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 12, color: "#374151" }}>{doc.nombre}</div>
                        {!doc.obligatorio && <div style={{ fontSize: 10, color: "#aaa" }}>Opcional</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── VISTA SOLICITUDES ────────────────────────────────────────────────────────
function SolicitudesView({ solicitudes }) {
  const [filtProg, setFiltProg] = useState("todos");
  const [filtEst, setFiltEst] = useState("todos");

  const filtered = solicitudes.filter(s => {
    const p = pct(s.documentos);
    if (filtProg !== "todos" && s.programaId !== filtProg) return false;
    if (filtEst === "completas" && p < 100) return false;
    if (filtEst === "incompletas" && p === 100) return false;
    return true;
  });

  const completas = solicitudes.filter(s => pct(s.documentos) === 100).length;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>Solicitudes</div>
        <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Todas las solicitudes y estado de documentacion</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 22 }}>
        {[["Total", solicitudes.length, "#1e3a5f"], ["Completas", completas, "#059669"], ["Pendientes", solicitudes.length - completas, "#DC2626"]].map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #e8e3de", display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase" }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <select value={filtProg} onChange={e => setFiltProg(e.target.value)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, background: "#fff" }}>
          <option value="todos">Todos los programas</option>
          {PROGRAMAS.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
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
          const prog = PROGRAMAS.find(p => p.id === s.programaId);
          const p = pct(s.documentos);
          const ok = s.documentos.filter(d => d.entregado).length;
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
                  <div style={{ fontSize: 14, fontWeight: 800, color: statusColor(p) }}>{ok}/{s.documentos.length}</div>
                </div>
              </div>
              <div style={{ height: 5, background: "#f0ede8", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: p + "%", background: statusColor(p), borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DETALLE COMITÉ ───────────────────────────────────────────────────────────
function DetalleComite({ comiteId, comites, personas, solicitudes, onBack, onSavePersonas, onSaveSolicitudes, onDetail }) {
  const [search, setSearch] = useState("");
  const [showModalPersona, setShowModalPersona] = useState(false);
  const EMPTY = { nombre: "", rut: "", fechaNacimiento: "", telefono: "", email: "", direccion: "", comuna: "", integrantesFamiliares: "", puntajeRSH: "", comiteId };
  const [form, setForm] = useState(EMPTY);

  const comite = comites.find(c => c.id === comiteId);
  if (!comite) return null;

  const miembros = personas.filter(p => p.comiteId === comiteId);
  const filtered = miembros.filter(p =>
    p.nombre.toLowerCase().includes(search.toLowerCase()) ||
    p.rut.includes(search) ||
    (p.comuna || "").toLowerCase().includes(search.toLowerCase())
  );

  const getSols = (id) => solicitudes.filter(s => s.personaId === id);
  const getDocPct = (id) => {
    const sols = getSols(id);
    if (!sols.length) return null;
    const all = sols.flatMap(s => s.documentos);
    return all.length ? Math.round(all.filter(d => d.entregado).length / all.length * 100) : 0;
  };

  const guardarPersona = async () => {
    if (!form.nombre.trim() || !form.rut.trim()) { alert("Nombre y RUT son obligatorios."); return; }
    const nueva = { ...form, id: uid(), fechaIngreso: today(), comiteId };
    const carpeta = carpetaNombre(form.nombre, form.rut);
    try { await fetch(API + "/carpeta/" + encodeURIComponent(carpeta), { method: "POST" }); } catch (e) { }
    onSavePersonas([...personas, nueva]);
    setForm({ ...EMPTY });
    setShowModalPersona(false);
  };

  const eliminarPersona = (e, id) => {
    e.stopPropagation();
    const ok = window["confirm"]("Eliminar este integrante del comité?");
    if (ok) onSavePersonas(personas.filter(x => x.id !== id));
  };

  const completas = miembros.filter(p => {
    const sols = getSols(p.id);
    return sols.length > 0 && sols.every(s => pct(s.documentos) === 100);
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
          const sols = getSols(p.id).length;
          return (
            <div key={p.id} onClick={() => onDetail(p.id)} style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #e8e3de", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: "#7C3AED", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{p.nombre[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}</div>
                  <div style={{ fontSize: 13, color: "#888" }}>RUT: {p.rut}{p.comuna ? " - " + p.comuna : ""}</div>
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
                <button onClick={(e) => eliminarPersona(e, p.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>X</button>
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
    </div>
  );
}

// ─── VISTA COMITÉS ────────────────────────────────────────────────────────────
function ComitesView({ comites, personas, solicitudes, onSaveComites, onVerDetalle, filtroPrograma }) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ nombre: "", descripcion: "" });

  const [filtroProg, setFiltroProg] = useState(filtroPrograma || "todos");
  const prog = filtroProg !== "todos" ? PROGRAMAS.find(p => p.id === filtroProg) : null;
  const comitesFiltrados = filtroProg !== "todos" ? comites.filter(c => c.programaId === filtroProg) : comites;

  const filtered = comitesFiltrados.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    (c.descripcion || "").toLowerCase().includes(search.toLowerCase())
  );

  const guardar = () => {
    if (!form.nombre.trim()) { alert("El nombre del comité es obligatorio."); return; }
    const nom = form.nombre.toUpperCase();
    const programaId = nom.includes("URBANO") ? "csp_urbano" :
                       nom.includes("RURAL") ? "csp_rural" : "habitabilidad";
    const nuevo = { id: uid(), nombre: form.nombre.trim(), descripcion: form.descripcion.trim(), fechaCreacion: today(), programaId };
    onSaveComites([...comites, nuevo]);
    setForm({ nombre: "", descripcion: "" });
    setShowModal(false);
  };

  const eliminar = (e, id) => {
    e.stopPropagation();
    const miembros = personas.filter(p => p.comiteId === id).length;
    if (miembros > 0) { alert("No se puede eliminar un comité con integrantes. Reasigne o elimine primero a los integrantes."); return; }
    const ok = window["confirm"]("Eliminar este comité?");
    if (ok) onSaveComites(comites.filter(c => c.id !== id));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>
            {prog ? prog.nombre : "Comités"}
          </div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>
            {filtered.length} comités{prog ? " en este programa" : " registrados"}
          </div>
        </div>
        <button onClick={() => setShowModal(true)} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Nuevo comité</button>
      </div>

      {/* Filtros por programa */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          ["todos", "Todos", "#1e3a5f"],
          ["csp_rural", "Vivienda Rural", "#D97706"],
          ["csp_urbano", "Vivienda Urbano", "#059669"],
          ["habitabilidad", "Desmarque de Vivienda", "#2563EB"],
        ].map(([id, label, color]) => {
          const count = id === "todos" ? comites.length : comites.filter(c => c.programaId === id).length;
          return (
            <button key={id} onClick={() => setFiltroProg(id)}
              style={{
                padding: "9px 18px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700,
                border: "2px solid " + (filtroProg === id ? color : "#ddd"),
                background: filtroProg === id ? color : "#fff",
                color: filtroProg === id ? "#fff" : "#555",
                display: "flex", alignItems: "center", gap: 8
              }}>
              {label}
              <span style={{ background: filtroProg === id ? "rgba(255,255,255,0.25)" : "#f0ede8", color: filtroProg === id ? "#fff" : "#888", borderRadius: 10, padding: "1px 8px", fontSize: 11 }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, border: "1px solid #e8e3de" }}>
        <input placeholder="Buscar comité..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", outline: "none", fontSize: 14, flex: 1 }} />
      </div>

      {filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px solid #e8e3de" }}>
          {comites.length === 0 ? "No hay comités registrados aún." : "No se encontraron resultados."}
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {filtered.map(c => {
          const miembros = personas.filter(p => p.comiteId === c.id);
          const totalSols = solicitudes.filter(s => miembros.some(m => m.id === s.personaId));
          const completas = totalSols.filter(s => pct(s.documentos) === 100).length;
          const pctComite = miembros.length > 0
            ? Math.round(miembros.filter(p => {
              const sols = solicitudes.filter(s => s.personaId === p.id);
              return sols.length > 0 && sols.every(s => pct(s.documentos) === 100);
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

      {showModal && (
        <Modal title="Crear nuevo comité" onClose={() => setShowModal(false)}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Nombre del comité *</label>
              <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Comité de Vivienda Rural Mi Nuevo Hogar"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#555", display: "block", marginBottom: 5, textTransform: "uppercase" }}>Descripción</label>
              <input value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
                placeholder="Descripción opcional"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <button onClick={() => setShowModal(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardar} style={{ padding: "9px 20px", borderRadius: 8, background: "#7C3AED", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Crear comité</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("dashboard");
  const [personas, setPersonas] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [comites, setComites] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [comiteDetailId, setComiteDetailId] = useState(null);
  const [filtroPrograma, setFiltroPrograma] = useState(null);
  const [cargando, setCargando] = useState(true);

  // Cargar datos desde Supabase al iniciar
  useEffect(() => {
    const cargarDatos = async () => {
      setCargando(true);
      try {
        const [{ data: c }, { data: p }, { data: s }] = await Promise.all([
          supabase.from("comites").select("*"),
          supabase.from("personas").select("*"),
          supabase.from("solicitudes").select("*"),
        ]);
        setComites((c || []).map(x => ({
          ...x,
          programaId: x.programa_id,
          fechaCreacion: x.fecha_creacion,
        })));
        setPersonas((p || []).map(x => ({
          ...x,
          comiteId: x.comite_id,
          fechaNacimiento: x.fecha_nacimiento,
          puntajeRSH: x.puntaje_rsh,
          integrantesFamiliares: x.integrantes_familiares,
          fechaIngreso: x.fecha_ingreso,
        })));
        setSolicitudes((s || []).map(sol => ({
          ...sol,
          personaId: sol.persona_id,
          personaNombre: sol.persona_nombre,
          programaId: sol.programa_id,
          codigoComite: sol.codigo_comite,
          tipoComite: sol.tipo_comite,
          profesionalComite: sol.profesional_comite,
        })));
      } catch (err) {
        console.error("Error cargando datos:", err);
      }
      setCargando(false);
    };
    cargarDatos();
  }, []);

  // Guardar personas en Supabase
  const savePersonas = async (lista) => {
    setPersonas(lista);
    const ultima = lista[lista.length - 1];
    if (ultima && !personas.find(p => p.id === ultima.id)) {
      await supabase.from("personas").insert([{
        id: ultima.id, nombre: ultima.nombre, rut: ultima.rut,
        fecha_nacimiento: ultima.fechaNacimiento, telefono: ultima.telefono,
        email: ultima.email, direccion: ultima.direccion, comuna: ultima.comuna,
        puntaje_rsh: ultima.puntajeRSH, integrantes_familiares: ultima.integrantesFamiliares,
        comite_id: ultima.comiteId || null, comite: ultima.comite || null,
        fecha_ingreso: ultima.fechaIngreso
      }]);
    } else {
      // Actualizar o eliminar
      const ids = lista.map(p => p.id);
      const eliminados = personas.filter(p => !ids.includes(p.id));
      for (const p of eliminados) {
        await supabase.from("personas").delete().eq("id", p.id);
      }
      for (const p of lista) {
        await supabase.from("personas").upsert({
          id: p.id, nombre: p.nombre, rut: p.rut,
          fecha_nacimiento: p.fechaNacimiento, telefono: p.telefono,
          email: p.email, direccion: p.direccion, comuna: p.comuna,
          puntaje_rsh: p.puntajeRSH, integrantes_familiares: p.integrantesFamiliares,
          comite_id: p.comiteId || null, comite: p.comite || null,
          fecha_ingreso: p.fechaIngreso
        });
      }
    }
  };

  // Guardar solicitudes en Supabase
  const saveSolicitudes = async (lista) => {
    setSolicitudes(lista);
    for (const s of lista) {
      await supabase.from("solicitudes").upsert({
        id: s.id, persona_id: s.personaId, persona_nombre: s.personaNombre,
        programa_id: s.programaId, fecha: s.fecha, comite: s.comite || null,
        codigo_comite: s.codigoComite || null, tipo_comite: s.tipoComite || null,
        profesional_comite: s.profesionalComite || null,
        documentos: s.documentos
      });
    }
    const ids = lista.map(s => s.id);
    const eliminados = solicitudes.filter(s => !ids.includes(s.id));
    for (const s of eliminados) {
      await supabase.from("solicitudes").delete().eq("id", s.id);
    }
  };

  // Guardar comités en Supabase
  const saveComites = async (lista) => {
    setComites(lista);
    const ids = lista.map(c => c.id);
    const eliminados = comites.filter(c => !ids.includes(c.id));
    for (const c of eliminados) {
      await supabase.from("comites").delete().eq("id", c.id);
    }
    for (const c of lista) {
      await supabase.from("comites").upsert({
        id: c.id, nombre: c.nombre, descripcion: c.descripcion || null,
        programa_id: c.programaId || null, fecha_creacion: c.fechaCreacion
      });
    }
  };

  const goDetail = (id) => { setDetailId(id); setView("detalle"); };
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

  const NAV_ITEMS = [
    ["dashboard", "Inicio"],
    ["personas", "Solicitantes"],
    ["comites", "Comités"],
    ["programas", "Programas"],
    ["solicitudes", "Solicitudes"],
  ];

  const navActivo = (k) =>
    view === k ||
    (view === "detalle" && k === "personas") ||
    (view === "detalleComite" && k === "comites");

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Segoe UI, sans-serif", background: "#F0EDE8" }}>
      <aside style={{ width: 240, background: "#1e3a5f", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "28px 24px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7BAFD4", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 6 }}>SERVIU</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>Control de Subsidios</div>
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "0 24px" }} />
        <nav style={{ padding: "16px 12px", flex: 1 }}>
          {NAV_ITEMS.map(([k, l]) => (
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
            </div>
          ))}
        </nav>
        <div style={{ padding: "16px 24px 24px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 11, color: "#5A8BB0", lineHeight: 1.6 }}>Sistema de gestion de subsidios habitacionales</div>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: "32px 36px" }}>
        {cargando && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", flexDirection: "column", gap: 16 }}>
            <div style={{ width: 48, height: 48, border: "4px solid #e8e3de", borderTop: "4px solid #1e3a5f", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            <div style={{ fontSize: 16, color: "#888" }}>Cargando datos...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
        {!cargando && view === "dashboard" && <Dashboard personas={personas} solicitudes={solicitudes} comites={comites} onNav={nav} />}
        {!cargando && view === "personas" && <PersonasView personas={personas} solicitudes={solicitudes} comites={comites} onSave={savePersonas} onDetail={goDetail} />}
        {!cargando && view === "comites" && <ComitesView comites={comites} personas={personas} solicitudes={solicitudes} onSaveComites={saveComites} onVerDetalle={verDetalleComite} filtroPrograma={filtroPrograma} />}
        {!cargando && view === "detalleComite" && <DetalleComite comiteId={comiteDetailId} comites={comites} personas={personas} solicitudes={solicitudes} onBack={() => nav("comites")} onSavePersonas={savePersonas} onSaveSolicitudes={saveSolicitudes} onDetail={goDetail} />}
        {!cargando && view === "programas" && <ProgramasView solicitudes={solicitudes} />}
        {!cargando && view === "solicitudes" && <SolicitudesView solicitudes={solicitudes} />}
        {!cargando && view === "detalle" && <DetallePersona personaId={detailId} personas={personas} solicitudes={solicitudes} comites={comites} onBack={() => view === "detalleComite" ? setView("detalleComite") : nav("personas")} onSaveSolicitudes={saveSolicitudes} onSavePersonas={savePersonas} />}
      </main>
    </div>
  );
}
