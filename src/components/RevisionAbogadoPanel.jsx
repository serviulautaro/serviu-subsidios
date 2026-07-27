import React, { useEffect, useMemo, useState } from "react";

const API = typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? window.location.origin
  : "http://localhost:3001";

const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const normalizar = value => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase();
const fmtFecha = value => {
  if (!value) return "";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
};

const TIPOS_DOMINIO = [
  { id: "DV", label: "D.V." },
  { id: "DRU", label: "D.R.U." },
  { id: "GOCE", label: "GOCE con resolución CONADI" },
  { id: "USUFRUCTO", label: "USUFRUCTO" },
  { id: "OTRO", label: "Otro documento" },
];
const ESTADOS = ["Aprobado", "Condicional", "Rechazado"];
const REVISIONES_DOMINIO = {
  DV: ["Nombre del propietario", "Cédula de identidad del propietario", "Inscripción en CBR", "Redacción del D.V."],
  DRU: ["Nombre del beneficiario", "Cédula de identidad", "Inscripción en CBR", "Redacción del D.R.U."],
  GOCE: ["Nombre del beneficiario", "Cédula de identidad", "Inscripción en CBR (si corresponde)", "Resolución del D.R.U.", "Redacción del D.R.U."],
  USUFRUCTO: ["Nombre del beneficiario", "Cédula de identidad", "Inscripción en CBR (si corresponde)", "Redacción del D.R.U."],
  OTRO: ["Nombre del beneficiario", "Cédula de identidad", "Inscripción en CBR (si corresponde)", "Redacción del documento"],
};

const formularioInicial = profesional => ({
  fecha: todayISO(),
  profesional: profesional || "",
  cedula_color: false,
  cedula_vigente: false,
  dominio_tipo: "",
  dominio_otro: "",
  dominio_checks: {},
  dominio_observaciones: "",
  dominio_estado: "",
  dominio_nota: "",
  avaluo_estado: "",
  avaluo_nota: "",
  ruralidad_estado: "",
  ruralidad_nota: "",
});

const formularioDesdeRegistro = (registro, profesional) => {
  if (!registro) return formularioInicial(profesional);
  const detalle = registro.dominio_detalle && typeof registro.dominio_detalle === "object"
    ? registro.dominio_detalle
    : {};
  return {
    fecha: registro.fecha || todayISO(),
    profesional: registro.profesional || profesional || "",
    cedula_color: !!registro.cedula_color,
    cedula_vigente: !!registro.cedula_vigente,
    dominio_tipo: registro.dominio_tipo || "",
    dominio_otro: registro.dominio_otro || "",
    dominio_checks: detalle.checks || {},
    dominio_observaciones: detalle.observaciones || "",
    dominio_estado: registro.dominio_estado || "",
    dominio_nota: registro.dominio_nota || "",
    avaluo_estado: registro.avaluo_estado || "",
    avaluo_nota: registro.avaluo_nota || "",
    ruralidad_estado: registro.ruralidad_estado || "",
    ruralidad_nota: registro.ruralidad_nota || "",
  };
};

const notaResultado = (tipo, estado, nota = "") => {
  if (!estado) return "";
  const base = `Revisión Abogado Terreno= ${estado}`;
  const detalle = String(nota || "").trim();
  return `${tipo ? `${tipo}. ` : ""}${base}${detalle ? `. Observación: ${detalle}` : ""}`;
};

const coloresEstado = estado => {
  if (estado === "Aprobado") return { fondo: "#dcfce7", borde: "#059669", texto: "#047857" };
  if (estado === "Condicional") return { fondo: "#fef3c7", borde: "#d97706", texto: "#92400e" };
  if (estado === "Rechazado") return { fondo: "#fee2e2", borde: "#dc2626", texto: "#b91c1c" };
  return { fondo: "#f8fafc", borde: "#dbeafe", texto: "#475569" };
};

function EstadoSelect({ label, value, onChange, nota, onNota }) {
  const exigeNota = ["Condicional", "Rechazado"].includes(value);
  const colores = coloresEstado(value);
  return (
    <div style={{ border: `2px solid ${colores.borde}`, borderRadius: 10, padding: 12, background: colores.fondo }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#1e3a5f", marginBottom: 6 }}>{label}</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ESTADOS.map(estado => (
          <button key={estado} type="button" onClick={() => onChange(estado)}
            style={{
              border: `1.5px solid ${value === estado ? coloresEstado(estado).borde : "#cbd5e1"}`,
              background: value === estado ? coloresEstado(estado).fondo : "#fff",
              color: value === estado ? coloresEstado(estado).texto : "#475569",
              borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer",
            }}>
            {estado}
          </button>
        ))}
      </div>
      {(exigeNota || nota) && (
        <textarea value={nota} onChange={e => onNota(e.target.value)}
          placeholder={exigeNota ? "Describa obligatoriamente la condición o causa del rechazo..." : "Observación opcional"}
          rows={2}
          style={{ width: "100%", marginTop: 8, border: `1.5px solid ${exigeNota && !nota.trim() ? "#ef4444" : "#cbd5e1"}`, borderRadius: 8, padding: 8, fontFamily: "inherit", boxSizing: "border-box" }} />
      )}
      {value && <div style={{ fontSize: 11, color: "#475569", marginTop: 7 }}>{notaResultado("", value, nota)}</div>}
    </div>
  );
}

export default function RevisionAbogadoPanel({
  persona,
  solicitud,
  currentUser,
  solicitudes,
  onSaveSolicitudes,
}) {
  const programaId = solicitud?.programaId || solicitud?.programa_id || "";
  const esRural = programaId === "csp_rural";
  const esUrbano = programaId === "csp_urbano";
  const esCsp = esRural || esUrbano;
  const nombrePrograma = esUrbano ? "Construcción Sitio Propio Urbano" : "Construcción Sitio Propio Rural";
  const nombreCertificado = esUrbano ? "Certificado de informaciones previas" : "Certificado de ruralidad";
  const tituloCertificado = esUrbano ? "Informaciones previas" : "Ruralidad";
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [revisiones, setRevisiones] = useState([]);
  const profesionalActual = currentUser?.nombre || currentUser?.username || "";
  const [form, setForm] = useState(() => formularioInicial(profesionalActual));
  const checksDominio = useMemo(() => REVISIONES_DOMINIO[form.dominio_tipo] || [], [form.dominio_tipo]);
  const revisionExistente = revisiones[0] || null;

  const cargar = async () => {
    if (!persona?.id || !esCsp) return;
    try {
      const res = await fetch(`${API}/api/db/revisiones_abogado?eq[persona_id]=${encodeURIComponent(persona.id)}&orderBy=fecha&orderAsc=false`, { cache: "no-store" });
      const json = await res.json();
      const filas = (json.data || []).filter(row =>
        row.programa_id === programaId &&
        (!solicitud?.id || !row.solicitud_id || String(row.solicitud_id) === String(solicitud.id))
      );
      setRevisiones(filas);
    } catch (error) {
      console.warn("[revision abogado cargar]", error.message);
    }
  };

  useEffect(() => {
    cargar();
    setAbierto(false);
    setForm(formularioInicial(profesionalActual));
  }, [persona?.id, solicitud?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!esCsp) return null;

  const setCampo = (campo, valor) => setForm(actual => ({ ...actual, [campo]: valor }));
  const abrirFormulario = () => {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setForm(formularioDesdeRegistro(revisionExistente, profesionalActual));
    setAbierto(true);
  };
  const documentoCoincide = (doc, palabras) => {
    const nombre = normalizar(doc?.nombre || doc?.label || "");
    return palabras.some(palabra => nombre.includes(normalizar(palabra)));
  };
  const actualizarNotasDocumentos = async registro => {
    if (!solicitud?.id) return;
    const documentos = (solicitud.documentos || []).map(doc => {
      let revision = null;
      if (documentoCoincide(doc, ["CEDULA", "CÉDULA", "IDENTIDAD"])) {
        revision = {
          estado: registro.cedula_color && registro.cedula_vigente ? "Aprobado" : "Pendiente",
          nota: `Revisión Abogado: copia en colores ${registro.cedula_color ? "VB" : "pendiente"}; vigencia ${registro.cedula_vigente ? "VB" : "pendiente"}.`,
        };
      } else if (documentoCoincide(doc, ["DOMINIO DE LA PROPIEDAD"])) {
        const tipo = registro.dominio_tipo === "OTRO" ? registro.dominio_otro : registro.dominio_tipo;
        revision = { estado: registro.dominio_estado, nota: notaResultado(tipo, registro.dominio_estado, registro.dominio_nota) };
      } else if (documentoCoincide(doc, ["AVALUO FISCAL", "AVALÚO FISCAL"])) {
        revision = { estado: registro.avaluo_estado, nota: notaResultado("", registro.avaluo_estado, registro.avaluo_nota) };
      } else if (documentoCoincide(doc, esUrbano
        ? ["CERTIFICADO DE INFORMACIONES PREVIAS", "INFORMACIONES PREVIAS"]
        : ["CERTIFICADO DE RURALIDAD", "RURALIDAD"])) {
        revision = { estado: registro.ruralidad_estado, nota: notaResultado("", registro.ruralidad_estado, registro.ruralidad_nota) };
      }
      return revision ? { ...doc, revision_abogado: revision, nota_revision_abogado: revision.nota } : doc;
    });
    const res = await fetch(`${API}/api/db/solicitudes/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: [{ col: "id", value: solicitud.id }], values: { documentos } }),
    });
    if (!res.ok) throw new Error("No se pudieron registrar las notas en la solicitud.");
    onSaveSolicitudes?.((solicitudes || []).map(sol => String(sol.id) === String(solicitud.id) ? { ...sol, documentos } : sol));
  };

  const validar = () => {
    if (!form.fecha || !form.profesional.trim()) return "Fecha y profesional son obligatorios.";
    if (!form.dominio_tipo) return "Seleccione el tipo de documento de dominio.";
    if (form.dominio_tipo === "OTRO" && !form.dominio_otro.trim()) return "Describa el nombre del otro documento.";
    if (!form.dominio_estado || !form.avaluo_estado || !form.ruralidad_estado) return `Debe indicar el resultado de Dominio, Avalúo Fiscal y ${nombreCertificado}.`;
    for (const [estado, nota, nombre] of [
      [form.dominio_estado, form.dominio_nota, "Dominio de la propiedad"],
      [form.avaluo_estado, form.avaluo_nota, "Avalúo Fiscal Detallado"],
      [form.ruralidad_estado, form.ruralidad_nota, nombreCertificado],
    ]) {
      if (["Condicional", "Rechazado"].includes(estado) && !nota.trim()) return `Debe describir la condición de ${nombre}.`;
    }
    return "";
  };

  const guardar = async () => {
    const error = validar();
    if (error) {
      window.alert(error);
      return;
    }
    setGuardando(true);
    const registro = {
      id: revisionExistente?.id || uid(),
      persona_id: persona.id,
      solicitud_id: solicitud?.id || null,
      programa_id: programaId,
      comite: solicitud?.comite || persona.comite || "",
      codigo_comite: solicitud?.codigoComite || solicitud?.codigo_comite || persona.comiteId || persona.comite_id || "",
      fecha: form.fecha,
      profesional: form.profesional.trim(),
      cedula_color: form.cedula_color,
      cedula_vigente: form.cedula_vigente,
      dominio_tipo: form.dominio_tipo,
      dominio_otro: form.dominio_otro.trim(),
      dominio_detalle: {
        checks: form.dominio_checks,
        observaciones: form.dominio_observaciones.trim(),
      },
      dominio_estado: form.dominio_estado,
      dominio_nota: form.dominio_nota.trim(),
      avaluo_estado: form.avaluo_estado,
      avaluo_nota: form.avaluo_nota.trim(),
      ruralidad_estado: form.ruralidad_estado,
      ruralidad_nota: form.ruralidad_nota.trim(),
    };
    try {
      const res = await fetch(`${API}/api/db/revisiones_abogado/${revisionExistente ? "update" : "insert"}`, {
        method: revisionExistente ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(revisionExistente
          ? { filters: [{ col: "id", value: revisionExistente.id }], values: { ...registro, actualizado: new Date().toISOString() } }
          : [registro]),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "No se pudo guardar la revisión.");
      await actualizarNotasDocumentos(registro);
      setRevisiones([registro]);
      setForm(formularioInicial(profesionalActual));
      setAbierto(false);
    } catch (err) {
      window.alert(`No se pudo guardar la Revisión Abogado. ${err.message || err}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div style={{ background: "#eff6ff", borderRadius: 14, border: "2px solid #1d4ed8", marginBottom: 20, overflow: "hidden", boxShadow: "0 8px 20px rgba(29,78,216,.14)" }}>
      <div style={{ background: "linear-gradient(90deg,#172554,#1d4ed8)", padding: "15px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ color: "#fff", fontSize: 17, fontWeight: 900 }}>⚖ Revisión Abogado</div>
          <div style={{ color: "#bfdbfe", fontSize: 11, marginTop: 2 }}>{nombrePrograma} · {solicitud?.comite || persona.comite || "Comité sin nombre"}</div>
        </div>
        <button type="button" onClick={abrirFormulario}
          style={{ background: "#fff", color: "#1e3a5f", border: "none", borderRadius: 8, padding: "9px 15px", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
          {abierto ? "Cancelar" : revisionExistente ? "Editar revisión abogado" : "+ Realizar revisión abogado"}
        </button>
      </div>

      {abierto && (
        <div style={{ padding: 18, background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: "#334155" }}>FECHA DE REVISIÓN *
              <input type="date" value={form.fecha} onChange={e => setCampo("fecha", e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 5, border: "1.5px solid #93c5fd", borderRadius: 8, padding: 8, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 800, color: "#334155" }}>PROFESIONAL QUE REVISÓ *
              <input value={form.profesional} onChange={e => setCampo("profesional", e.target.value)}
                placeholder="Nombre del abogado o profesional"
                style={{ display: "block", width: "100%", marginTop: 5, border: "1.5px solid #93c5fd", borderRadius: 8, padding: 8, boxSizing: "border-box" }} />
            </label>
          </div>

          <section style={{ borderTop: "1px solid #dbeafe", paddingTop: 12, marginTop: 6 }}>
            <h4 style={{ margin: "0 0 8px", color: "#1e3a5f" }}>1. Cédula de identidad</h4>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              {[["cedula_color", "Copia en colores"], ["cedula_vigente", "Documento vigente"]].map(([campo, label]) => (
                <label key={campo} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13, fontWeight: 700, color: form[campo] ? "#047857" : "#475569" }}>
                  <input type="checkbox" checked={form[campo]} onChange={e => setCampo(campo, e.target.checked)} /> {label} {form[campo] ? "· VB" : ""}
                </label>
              ))}
            </div>
          </section>

          <section style={{ borderTop: "1px solid #dbeafe", paddingTop: 12, marginTop: 14 }}>
            <h4 style={{ margin: "0 0 8px", color: "#1e3a5f" }}>2. Dominio de la propiedad</h4>
            <label style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>Documento válido para postular
              <select value={form.dominio_tipo} onChange={e => setForm(actual => ({ ...actual, dominio_tipo: e.target.value, dominio_checks: {} }))}
                style={{ display: "block", width: "100%", marginTop: 5, border: "1.5px solid #93c5fd", borderRadius: 8, padding: 8, background: "#fff" }}>
                <option value="">Seleccionar tipo de documento...</option>
                {TIPOS_DOMINIO.map(tipo => <option key={tipo.id} value={tipo.id}>{tipo.label}</option>)}
              </select>
            </label>
            {form.dominio_tipo === "OTRO" && (
              <input value={form.dominio_otro} onChange={e => setCampo("dominio_otro", e.target.value)}
                placeholder="Nombre del documento"
                style={{ width: "100%", marginTop: 8, border: "1.5px solid #93c5fd", borderRadius: 8, padding: 8, boxSizing: "border-box" }} />
            )}
            {checksDominio.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 7, marginTop: 10 }}>
                {checksDominio.map(item => (
                  <label key={item} style={{ background: form.dominio_checks[item] ? "#ecfdf5" : "#f8fafc", border: `1px solid ${form.dominio_checks[item] ? "#86efac" : "#e2e8f0"}`, borderRadius: 8, padding: 8, fontSize: 12, color: "#334155" }}>
                    <input type="checkbox" checked={!!form.dominio_checks[item]}
                      onChange={e => setCampo("dominio_checks", { ...form.dominio_checks, [item]: e.target.checked })} /> {item} {form.dominio_checks[item] ? "· VB" : ""}
                  </label>
                ))}
              </div>
            )}
            <textarea value={form.dominio_observaciones} onChange={e => setCampo("dominio_observaciones", e.target.value)}
              placeholder="Observaciones de la revisión del documento (si corresponde)"
              rows={2} style={{ width: "100%", marginTop: 9, border: "1px solid #cbd5e1", borderRadius: 8, padding: 8, fontFamily: "inherit", boxSizing: "border-box" }} />
            <div style={{ marginTop: 10 }}>
              <EstadoSelect label="Resultado del dominio" value={form.dominio_estado} onChange={value => setCampo("dominio_estado", value)} nota={form.dominio_nota} onNota={value => setCampo("dominio_nota", value)} />
            </div>
          </section>

          <section style={{ borderTop: "1px solid #dbeafe", paddingTop: 12, marginTop: 14 }}>
            <h4 style={{ margin: "0 0 8px", color: "#1e3a5f" }}>3. Avalúo Fiscal Detallado</h4>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Revisar que corresponda a la propiedad.</div>
            <EstadoSelect label="Resultado del Avalúo Fiscal Detallado" value={form.avaluo_estado} onChange={value => setCampo("avaluo_estado", value)} nota={form.avaluo_nota} onNota={value => setCampo("avaluo_nota", value)} />
          </section>

          <section style={{ borderTop: "1px solid #dbeafe", paddingTop: 12, marginTop: 14 }}>
            <h4 style={{ margin: "0 0 8px", color: "#1e3a5f" }}>4. {nombreCertificado}</h4>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Revisar que corresponda a la propiedad.</div>
            <EstadoSelect label={`Resultado del ${nombreCertificado}`} value={form.ruralidad_estado} onChange={value => setCampo("ruralidad_estado", value)} nota={form.ruralidad_nota} onNota={value => setCampo("ruralidad_nota", value)} />
          </section>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={guardar} disabled={guardando}
              style={{ background: guardando ? "#94a3b8" : "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 900, cursor: guardando ? "wait" : "pointer" }}>
              {guardando ? "Guardando..." : "Guardar revisión abogado"}
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: "12px 18px 16px" }}>
        {revisiones.length === 0 ? (
          <div style={{ textAlign: "center", color: "#64748b", fontSize: 12, padding: 8 }}>Sin revisiones de abogado registradas.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>{["Fecha", "Profesional", "Cédula", "Dominio", "Avalúo", tituloCertificado].map(t => <th key={t} style={{ textAlign: "left", padding: 7, color: "#64748b", borderBottom: "1px solid #bfdbfe" }}>{t}</th>)}</tr></thead>
              <tbody>{revisiones.map(rev => (
                <tr key={rev.id}>
                  <td style={{ padding: 7, fontWeight: 800 }}>{fmtFecha(rev.fecha)}</td>
                  <td style={{ padding: 7 }}>{rev.profesional}</td>
                  <td style={{ padding: 7 }}>{rev.cedula_color && rev.cedula_vigente ? "VB completo" : "Pendiente"}</td>
                  <td style={{ padding: 7, background: coloresEstado(rev.dominio_estado).fondo, color: coloresEstado(rev.dominio_estado).texto }}>
                    <strong>{rev.dominio_estado || "Pendiente"}</strong>
                    {rev.dominio_estado && <div style={{ marginTop: 3, color: "#475569", fontSize: 10 }}>{notaResultado(rev.dominio_tipo === "OTRO" ? rev.dominio_otro : rev.dominio_tipo, rev.dominio_estado, rev.dominio_nota)}</div>}
                  </td>
                  <td style={{ padding: 7, background: coloresEstado(rev.avaluo_estado).fondo, color: coloresEstado(rev.avaluo_estado).texto }}>
                    <strong>{rev.avaluo_estado || "Pendiente"}</strong>
                    {rev.avaluo_estado && <div style={{ marginTop: 3, color: "#475569", fontSize: 10 }}>{notaResultado("", rev.avaluo_estado, rev.avaluo_nota)}</div>}
                  </td>
                  <td style={{ padding: 7, background: coloresEstado(rev.ruralidad_estado).fondo, color: coloresEstado(rev.ruralidad_estado).texto }}>
                    <strong>{rev.ruralidad_estado || "Pendiente"}</strong>
                    {rev.ruralidad_estado && <div style={{ marginTop: 3, color: "#475569", fontSize: 10 }}>{notaResultado("", rev.ruralidad_estado, rev.ruralidad_nota)}</div>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
