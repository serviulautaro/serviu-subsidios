import { useState, useRef, useEffect } from "react";

const initialComites = [
  { codigo:"gr1R", nombre:"Comité de Vivienda Rural Mi Nuevo Hogar", familias:30, tipo:"Rural", constructora:"Sociedad Constructora Torres Venegas Limitada", profesional:"Priscilla Curín Castro", pj:"P.J. 376054", venc:"Venc. 07/02/2028", directiva:[{rol:"Presidente",nombre:"Juan Pérez González"},{rol:"Secretario",nombre:"Carlos Hernán Paillaleo Paillaleo"},{rol:"Tesorero",nombre:"Elías Fernando Apablaza Riffo"},{rol:"1er Director",nombre:"Juan Carlos Huenchuan Méndez"}]},
  { codigo:"gr2R", nombre:"Comité de Vivienda Rural La Fuerza", familias:30, tipo:"Rural", constructora:"Sociedad Constructora Torres Venegas Limitada", profesional:"Jacqueline Ortega B.", pj:"P.J. 379826", venc:"Venc. 14/05/2028", directiva:[{rol:"Presidente",nombre:"Liber Omar Cancino Campos"},{rol:"Vicepresidente",nombre:"Orfelina Leonor Inostroza Burgos"},{rol:"Secretario",nombre:"Alejandra Maribel Lefián Silva"},{rol:"Tesorero",nombre:"Mirta Rosa Martín Vallejos"},{rol:"1er Director",nombre:"Luis Fernando Sánchez Llancamil"}]},
  { codigo:"gr3R", nombre:"Comité de Vivienda Rural Küme Ruka", familias:29, tipo:"Rural", constructora:"Sociedad Constructora Torres Venegas Limitada", profesional:"Jacqueline Ortega B.", pj:"En trámite", venc:"—", directiva:[{rol:"Presidente",nombre:"Rosa Llancapan Liempe"},{rol:"Vicepresidente",nombre:"María Angélica Antinao Liempe"},{rol:"Secretario",nombre:"Elías Rivas Espinoza"},{rol:"Tesorero",nombre:"Mónica Maribel Rubilar Antilaf"},{rol:"1er Director",nombre:"Juan Miguel Tripaiñan Huenulao"}]},
  { codigo:"gr4R", nombre:"Comité de Vivienda Rural Newen Mapu", familias:26, tipo:"Rural", constructora:"Falta Licitar", profesional:"Priscilla Curín Castro", pj:"—", venc:"—", directiva:[]},
  { codigo:"gr5R", nombre:"Comité de Vivienda Rural Kimey Ruca", familias:28, tipo:"Rural", constructora:"Falta Licitar", profesional:"Jacqueline Ortega B.", pj:"—", venc:"—", directiva:[]},
  { codigo:"gr6R", nombre:"Comité de Vivienda Rural (Por Constituir)", familias:25, tipo:"Rural", constructora:"Falta Licitar", profesional:"Priscilla Curín Castro", pj:"—", venc:"—", directiva:[]},
  { codigo:"gr1U", nombre:"Comité de Vivienda Urbano Pioneros de Lautaro", familias:30, tipo:"Urbano", constructora:"Sociedad Constructora Torres Venegas Limitada", profesional:"Priscilla Curín Castro", pj:"P.J. 379720", venc:"Venc. 08/05/2028", directiva:[{rol:"Presidente",nombre:"Luis Armando Espinoza Mendoza"},{rol:"Vicepresidente",nombre:"Tomás Salvador Díaz Barrientos"},{rol:"Secretario",nombre:"Margot Leticia Contreras Márquez"},{rol:"Tesorero",nombre:"Iris del Carmen Godoy Morales"},{rol:"1er Director",nombre:"Domingo Antonio Bucarey Torres"}]},
  { codigo:"gr2U", nombre:"Comité de Vivienda Urbano (Por Constituir)", familias:8, tipo:"Urbano", constructora:"Falta Licitar", profesional:"Jacqueline Ortega B.", pj:"—", venc:"—", directiva:[]},
];

// Normaliza un nombre para comparación robusta (minúsculas, sin tildes, sin espacios extra)
function normNombre(s) {
  return (s || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

// Fusiona los comités estáticos (con directiva) con los genuinamente nuevos de Supabase
function mergeConSupa(comitesSupa = []) {
  const base = initialComites.map(c => ({ ...c }));
  const nombresBase = new Set(base.map(c => normNombre(c.nombre)));
  let nextRural = base.filter(c => c.tipo === "Rural").length + 1;
  let nextUrbano = base.filter(c => c.tipo === "Urbano").length + 1;

  comitesSupa.forEach(sc => {
    if (!sc.nombre || !sc.nombre.trim()) return;           // sin nombre → ignorar
    if (nombresBase.has(normNombre(sc.nombre))) return;    // duplicado del estático → ignorar
    const esUrbano = sc.programaId === "csp_urbano" || sc.nombre.toUpperCase().includes("URBANO");
    const tipo = esUrbano ? "Urbano" : "Rural";
    const codigo = esUrbano ? `gr${nextUrbano}U` : `gr${nextRural}R`;
    if (esUrbano) nextUrbano++; else nextRural++;
    base.push({ codigo, nombre: sc.nombre, familias: 0, tipo, constructora: sc.descripcion || "—", profesional: "—", pj: "—", venc: "—", directiva: [] });
    nombresBase.add(normNombre(sc.nombre));
  });
  return base;
}

const inp = {
  width: "100%", padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6,
  fontSize: 13, color: "#111827", background: "#fff", boxSizing: "border-box", outline: "none",
};

const styles = {
  container: { fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: 1180, margin: "0 auto" },
  header: { marginBottom: "1.25rem", padding: "20px 22px", border: "1px solid #dbeafe", borderRadius: 18, background: "linear-gradient(135deg,#eff6ff 0%,#ffffff 62%,#ecfdf5 100%)", boxShadow: "0 14px 32px rgba(15,23,42,0.06)" },
  title: { fontSize: 24, fontWeight: 900, color: "#173b67", margin: 0, textTransform: "uppercase", letterSpacing: ".02em" },
  subtitle: { fontSize: 13, color: "#475569", marginTop: 6 },
  institution: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 16 },
  institutionItem: { background: "#fff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "10px 12px", color: "#1e3a5f", fontSize: 12, fontWeight: 800, textTransform: "uppercase", textAlign: "center" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: "1rem" },
  metric: { flex: 1, background: "#fff", borderRadius: 14, padding: "14px 16px", border: "1px solid #e5e7eb", boxShadow: "0 8px 20px rgba(15,23,42,0.04)" },
  metricLabel: { fontSize: 11, color: "#9ca3af", marginBottom: 2 },
  metricValue: { fontSize: 22, fontWeight: 600, color: "#111827" },
  tabs: { display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" },
  tab: (active) => ({ fontSize: 12, padding: "8px 16px", borderRadius: 999, cursor: "pointer", border: active ? "1px solid #173b67" : "1px solid #d1d5db", background: active ? "#173b67" : "#fff", color: active ? "#fff" : "#475569", fontWeight: 800, boxShadow: active ? "0 8px 18px rgba(23,59,103,.18)" : "none" }),
  tableWrap: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden", boxShadow: "0 12px 28px rgba(15,23,42,0.05)" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 },
  th: { fontSize: 11, fontWeight: 900, color: "#475569", padding: "12px 12px", borderBottom: "1px solid #e5e7eb", textAlign: "left", background: "#f8fafc", textTransform: "uppercase", letterSpacing: ".04em" },
  td: (selected, tipo) => ({ padding: "12px", borderBottom: "1px solid #eef2f7", verticalAlign: "top", background: selected ? "#dbeafe" : tipo === "Rural" ? "#f0fdf4" : "#eff6ff", cursor: "pointer" }),
  sectionRow: { background: "#ffffff" },
  sectionLabel: { fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "#173b67", padding: "10px 12px", background: "#e0f2fe", borderTop: "1px solid #bae6fd", borderBottom: "1px solid #bae6fd" },
  code: { fontSize: 11, fontWeight: 500, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace", color: "#374151" },
  tagRural: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#d1fae5", color: "#065f46" },
  tagUrban: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#dbeafe", color: "#1e40af" },
  tagPending: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#fef3c7", color: "#92400e" },
  tagPj: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#d1fae5", color: "#065f46" },
  panel: { background: "#fff", border: "1px solid #bfdbfe", borderLeft: "6px solid #2563eb", borderRadius: 16, padding: "1.25rem", marginBottom: "1rem", boxShadow: "0 16px 36px rgba(15,23,42,0.08)" },
  panelHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  panelTitle: { fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 },
  infoRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" },
  dirGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8, marginTop: 8 },
  dirCard: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" },
  dirRole: { fontSize: 11, color: "#9ca3af", marginBottom: 2 },
  dirName: { fontSize: 12, fontWeight: 500, color: "#111827" },
  placeholder: { fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "1.5rem" },
  closeBtn: { flexShrink: 0, fontSize: 12, color: "#6b7280", cursor: "pointer", background: "none", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 8px" },
  editBtn: { fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 12px" },
  saveBtn: { fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px" },
  cancelBtn: { fontSize: 12, fontWeight: 600, cursor: "pointer", background: "none", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 14px" },
  addMemberBtn: { fontSize: 12, cursor: "pointer", background: "none", color: "#1d4ed8", border: "1px dashed #bfdbfe", borderRadius: 6, padding: "5px 12px", width: "100%", marginTop: 8 },
  removeMemberBtn: { fontSize: 11, cursor: "pointer", background: "none", color: "#dc2626", border: "none", padding: "0 4px", lineHeight: 1 },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: "0.04em" },
  editGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 14 },
  editDivider: { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af", margin: "12px 0 8px" },
  memberRow: { display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 8, alignItems: "center", marginBottom: 6 },
};

export default function ComitesVivienda({ comitesSupa = [] }) {
  const [tab, setTab] = useState("todos");
  const [selected, setSelected] = useState(null);
  const [comites, setComites] = useState(() => mergeConSupa(comitesSupa));
  const [editing, setEditing] = useState(null);
  const panelRef = useRef(null);

  // Re-fusionar cuando llegan nuevos comités desde Supabase
  useEffect(() => {
    setComites(mergeConSupa(comitesSupa));
    setSelected(null);
    setEditing(null);
  }, [comitesSupa.length]);

  const filtered = comites.filter(c => tab === "todos" || c.tipo.toLowerCase() === tab);

  useEffect(() => {
    if (selected && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected]);

  useEffect(() => {
    setEditing(null);
  }, [selected]);

  const handleRow = (codigo) => setSelected(prev => prev === codigo ? null : codigo);
  const selectedComite = comites.find(c => c.codigo === selected);

  const startEdit = () => {
    const c = comites.find(x => x.codigo === selected);
    setEditing({
      nombre: c.nombre,
      constructora: c.constructora,
      profesional: c.profesional,
      pj: c.pj,
      venc: c.venc,
      directiva: c.directiva.map(d => ({ ...d })),
    });
  };

  const saveEdit = () => {
    setComites(prev => prev.map(c => c.codigo === selected ? { ...c, ...editing } : c));
    setEditing(null);
  };

  const setField = (field, value) => setEditing(prev => ({ ...prev, [field]: value }));

  const setMemberField = (i, field, value) =>
    setEditing(prev => ({
      ...prev,
      directiva: prev.directiva.map((d, idx) => idx === i ? { ...d, [field]: value } : d),
    }));

  const addMember = () =>
    setEditing(prev => ({ ...prev, directiva: [...prev.directiva, { rol: "", nombre: "" }] }));

  const removeMember = (i) =>
    setEditing(prev => ({ ...prev, directiva: prev.directiva.filter((_, idx) => idx !== i) }));

  let lastTipo = null;
  const rows = [];
  filtered.forEach(c => {
    if (c.tipo !== lastTipo) {
      rows.push(<tr key={"sep-"+c.tipo} style={styles.sectionRow}><td colSpan={6} style={styles.sectionLabel}>{c.tipo === "Rural" ? "Comités rurales" : "Comités urbanos"}</td></tr>);
      lastTipo = c.tipo;
    }
    const isSelected = selected === c.codigo;
    rows.push(
      <tr key={c.codigo} onClick={() => handleRow(c.codigo)} style={{cursor:"pointer"}}>
        <td style={styles.td(isSelected, c.tipo)}><span style={styles.code}>{c.codigo}</span></td>
        <td style={{...styles.td(isSelected, c.tipo), maxWidth:260, fontWeight:800, color:"#0f172a"}}>{c.nombre}</td>
        <td style={{...styles.td(isSelected, c.tipo), textAlign:"center", fontWeight:900, color:"#173b67"}}>{c.familias}</td>
        <td style={styles.td(isSelected, c.tipo)}><span style={c.tipo==="Rural"?styles.tagRural:styles.tagUrban}>{c.tipo}</span></td>
        <td style={{...styles.td(isSelected, c.tipo), fontSize:12}}>{c.constructora.startsWith("Falta")?<span style={styles.tagPending}>{c.constructora}</span>:<span style={{color:"#475569",fontWeight:700}}>{c.constructora}</span>}</td>
        <td style={{...styles.td(isSelected, c.tipo), fontSize:12, fontWeight:700}}>{c.profesional}</td>
      </tr>
    );
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Municipalidad de Lautaro</h2>
        <p style={styles.subtitle}>Unidad de Vivienda - Entidad Patrocinante. Selecciona un programa o tipo de comite para revisar sus datos completos.</p>
        <div style={styles.institution}>
          <div style={styles.institutionItem}>Municipalidad de Lautaro</div>
          <div style={styles.institutionItem}>Unidad de Vivienda</div>
          <div style={styles.institutionItem}>Entidad Patrocinante</div>
        </div>
      </div>
      <div style={styles.metrics}>
        <div style={styles.metric}><div style={styles.metricLabel}>Total familias</div><div style={styles.metricValue}>{comites.reduce((s,c)=>s+c.familias,0)}</div></div>
        <div style={styles.metric}><div style={styles.metricLabel}>Comités rurales</div><div style={styles.metricValue}>{comites.filter(c=>c.tipo==="Rural").length}</div></div>
        <div style={styles.metric}><div style={styles.metricLabel}>Comités urbanos</div><div style={styles.metricValue}>{comites.filter(c=>c.tipo==="Urbano").length}</div></div>
      </div>
      <div style={styles.tabs}>
        {["todos","rural","urbano"].map(t => <button key={t} style={styles.tab(tab===t)} onClick={()=>{setTab(t);setSelected(null);}}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
      </div>

      {selectedComite && (
        <div ref={panelRef} style={styles.panel}>
          {editing ? (
            <>
              <div style={styles.panelHeader}>
                <h3 style={styles.panelTitle}>Editando: <span style={{color:"#6b7280",fontWeight:400}}>{selectedComite.codigo}</span></h3>
                <div style={{display:"flex", gap:8}}>
                  <button style={styles.cancelBtn} onClick={()=>setEditing(null)}>Cancelar</button>
                  <button style={styles.saveBtn} onClick={saveEdit}>Guardar cambios</button>
                </div>
              </div>

              <div style={styles.editGrid}>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={styles.fieldLabel}>Nombre del comité</label>
                  <input style={inp} value={editing.nombre} onChange={e=>setField("nombre",e.target.value)} />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Constructora</label>
                  <input style={inp} value={editing.constructora} onChange={e=>setField("constructora",e.target.value)} />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Profesional a cargo</label>
                  <input style={inp} value={editing.profesional} onChange={e=>setField("profesional",e.target.value)} />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Personalidad jurídica (PJ)</label>
                  <input style={inp} value={editing.pj} onChange={e=>setField("pj",e.target.value)} />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Vencimiento</label>
                  <input style={inp} value={editing.venc} onChange={e=>setField("venc",e.target.value)} />
                </div>
              </div>

              <div style={styles.editDivider}>Directiva</div>
              {editing.directiva.map((d, i) => (
                <div key={i} style={styles.memberRow}>
                  <input style={inp} placeholder="Rol" value={d.rol} onChange={e=>setMemberField(i,"rol",e.target.value)} />
                  <input style={inp} placeholder="Nombre completo" value={d.nombre} onChange={e=>setMemberField(i,"nombre",e.target.value)} />
                  <button style={styles.removeMemberBtn} onClick={()=>removeMember(i)} title="Eliminar">✕</button>
                </div>
              ))}
              <button style={styles.addMemberBtn} onClick={addMember}>+ Agregar miembro</button>
            </>
          ) : (
            <>
              <div style={styles.panelHeader}>
                <h3 style={styles.panelTitle}>{selectedComite.nombre}</h3>
                <div style={{display:"flex", gap:8}}>
                  <button style={styles.editBtn} onClick={startEdit}>Editar</button>
                  <button style={styles.closeBtn} onClick={()=>setSelected(null)}>✕ cerrar</button>
                </div>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.code}>{selectedComite.codigo}</span>
                {selectedComite.pj!=="—"&&<span style={styles.tagPj}>{selectedComite.pj}</span>}
                {selectedComite.venc!=="—"&&<span style={{fontSize:12,color:"#6b7280"}}>{selectedComite.venc}</span>}
                <span style={selectedComite.tipo==="Rural"?styles.tagRural:styles.tagUrban}>{selectedComite.tipo}</span>
              </div>
              <div style={{fontSize:12,color:"#6b7280",marginBottom:4}}>Profesional: <strong style={{color:"#111827"}}>{selectedComite.profesional}</strong> · Familias: <strong style={{color:"#111827"}}>{selectedComite.familias}</strong></div>
              <div style={{fontSize:12,color:"#6b7280",marginBottom:10}}>Constructora: {selectedComite.constructora.startsWith("Falta")?<span style={styles.tagPending}>{selectedComite.constructora}</span>:selectedComite.constructora}</div>
              {selectedComite.directiva.length>0
                ? (<>
                    <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",color:"#9ca3af",marginBottom:6}}>Directiva</div>
                    <div style={styles.dirGrid}>
                      {selectedComite.directiva.map((d,i)=>(
                        <div key={i} style={styles.dirCard}>
                          <div style={styles.dirRole}>{d.rol}</div>
                          <div style={styles.dirName}>{d.nombre}</div>
                        </div>
                      ))}
                    </div>
                  </>)
                : <div style={styles.placeholder}>Directiva no constituida aún</div>
              }
            </>
          )}
        </div>
      )}

      <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead><tr><th style={styles.th}>Código</th><th style={styles.th}>Nombre del comité</th><th style={{...styles.th,textAlign:"center"}}>Familias</th><th style={styles.th}>Tipo</th><th style={styles.th}>Constructora</th><th style={styles.th}>Profesional a cargo</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
      </div>
    </div>
  );
}
