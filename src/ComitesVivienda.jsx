import { useState } from "react";

const comites = [
  {
    codigo: "gr1R", nombre: "Comité de Vivienda Rural Mi Nuevo Hogar", familias: 30, tipo: "Rural",
    constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curín Castro",
    pj: "P.J. 376054", venc: "Venc. 07/02/2028",
    directiva: [
      { rol: "Presidente", nombre: "Maritza Alejandra Burgos Iturra" },
      { rol: "Secretario", nombre: "Carlos Hernán Paillaleo Paillaleo" },
      { rol: "Tesorero", nombre: "Elías Fernando Apablaza Riffo" },
      { rol: "1er Director", nombre: "Juan Carlos Huenchuan Méndez" },
    ],
  },
  {
    codigo: "gr2R", nombre: "Comité de Vivienda Rural La Fuerza", familias: 30, tipo: "Rural",
    constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.",
    pj: "P.J. 379826", venc: "Venc. 14/05/2028",
    directiva: [
      { rol: "Presidente", nombre: "Liber Omar Cancino Campos" },
      { rol: "Vicepresidente", nombre: "Orfelina Leonor Inostroza Burgos" },
      { rol: "Secretario", nombre: "Alejandra Maribel Lefián Silva" },
      { rol: "Tesorero", nombre: "Mirta Rosa Martín Vallejos" },
      { rol: "1er Director", nombre: "Luis Fernando Sánchez Llancamil" },
    ],
  },
  {
    codigo: "gr3R", nombre: "Comité de Vivienda Rural Küme Ruka", familias: 29, tipo: "Rural",
    constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Jacqueline Ortega B.",
    pj: "En trámite", venc: "—",
    directiva: [
      { rol: "Presidente", nombre: "Rosa Llancapan Liempe" },
      { rol: "Vicepresidente", nombre: "María Angélica Antinao Liempe" },
      { rol: "Secretario", nombre: "Elías Rivas Espinoza" },
      { rol: "Tesorero", nombre: "Mónica Maribel Rubilar Antilaf" },
      { rol: "1er Director", nombre: "Juan Miguel Tripaiñan Huenulao" },
    ],
  },
  {
    codigo: "gr4R", nombre: "Comité de Vivienda Rural Newen Mapu", familias: 26, tipo: "Rural",
    constructora: "Falta Licitar", profesional: "Priscilla Curín Castro",
    pj: "—", venc: "—", directiva: [],
  },
  {
    codigo: "gr5R", nombre: "Comité de Vivienda Rural Kimey Ruca", familias: 28, tipo: "Rural",
    constructora: "Falta Licitar", profesional: "Jacqueline Ortega B.",
    pj: "—", venc: "—", directiva: [],
  },
  {
    codigo: "gr6R", nombre: "Comité de Vivienda Rural (Por Constituir)", familias: 25, tipo: "Rural",
    constructora: "Falta Licitar", profesional: "Priscilla Curín Castro",
    pj: "—", venc: "—", directiva: [],
  },
  {
    codigo: "gr1U", nombre: "Comité de Vivienda Urbano Pioneros de Lautaro", familias: 30, tipo: "Urbano",
    constructora: "Sociedad Constructora Torres Venegas Limitada", profesional: "Priscilla Curín Castro",
    pj: "P.J. 379720", venc: "Venc. 08/05/2028",
    directiva: [
      { rol: "Presidente", nombre: "Luis Armando Espinoza Mendoza" },
      { rol: "Vicepresidente", nombre: "Tomás Salvador Díaz Barrientos" },
      { rol: "Secretario", nombre: "Margot Leticia Contreras Márquez" },
      { rol: "Tesorero", nombre: "Iris del Carmen Godoy Morales" },
      { rol: "1er Director", nombre: "Domingo Antonio Bucarey Torres" },
    ],
  },
  {
    codigo: "gr2U", nombre: "Comité de Vivienda Urbano (Por Constituir)", familias: 8, tipo: "Urbano",
    constructora: "Falta Licitar", profesional: "Jacqueline Ortega B.",
    pj: "—", venc: "—", directiva: [],
  },
];

const styles = {
  container: { fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: 960, margin: "0 auto" },
  header: { marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid #e5e7eb" },
  title: { fontSize: 18, fontWeight: 600, color: "#111827", margin: 0 },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 4 },
  metrics: { display: "flex", gap: 12, marginBottom: "1rem" },
  metric: { flex: 1, background: "#f9fafb", borderRadius: 8, padding: "10px 14px", border: "1px solid #e5e7eb" },
  metricLabel: { fontSize: 11, color: "#9ca3af", marginBottom: 2 },
  metricValue: { fontSize: 22, fontWeight: 600, color: "#111827" },
  tabs: { display: "flex", gap: 6, marginBottom: "1rem", flexWrap: "wrap" },
  tab: (active) => ({
    fontSize: 12, padding: "5px 14px", borderRadius: 6, cursor: "pointer", transition: "all 0.15s",
    border: active ? "1px solid #374151" : "1px solid #d1d5db",
    background: active ? "#111827" : "transparent",
    color: active ? "#fff" : "#6b7280",
    fontWeight: active ? 600 : 400,
  }),
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { fontSize: 11, fontWeight: 600, color: "#6b7280", padding: "8px 10px", borderBottom: "1px solid #e5e7eb", textAlign: "left", background: "#f9fafb" },
  td: (selected) => ({ padding: "9px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top", background: selected ? "#eff6ff" : "transparent", cursor: "pointer" }),
  sectionRow: { background: "#f9fafb" },
  sectionLabel: { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af", padding: "8px 10px" },
  code: { fontSize: 11, fontWeight: 500, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace", color: "#374151" },
  tagRural: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#d1fae5", color: "#065f46" },
  tagUrban: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#dbeafe", color: "#1e40af" },
  tagPending: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#fef3c7", color: "#92400e" },
  tagPj: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 9999, background: "#d1fae5", color: "#065f46" },
  panel: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem", marginTop: "1rem" },
  panelTitle: { fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 },
  infoRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" },
  dirGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8, marginTop: 8 },
  dirCard: { background: "#f9fafb", borderRadius: 8, padding: "8px 10px" },
  dirRole: { fontSize: 11, color: "#9ca3af", marginBottom: 2 },
  dirName: { fontSize: 12, fontWeight: 500, color: "#111827" },
  placeholder: { fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "1.5rem" },
  closeBtn: { float: "right", fontSize: 12, color: "#6b7280", cursor: "pointer", background: "none", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 8px" },
};

export default function ComitesVivienda() {
  const [tab, setTab] = useState("todos");
  const [selected, setSelected] = useState(null);

  const filtered = comites.filter(c =>
    tab === "todos" || c.tipo.toLowerCase() === tab
  );

  const handleRow = (codigo) => {
    setSelected(prev => prev === codigo ? null : codigo);
  };

  const selectedComite = comites.find(c => c.codigo === selected);

  let lastTipo = null;
  const rows = [];
  filtered.forEach(c => {
    if (c.tipo !== lastTipo) {
      rows.push(
        <tr key={`sep-${c.tipo}`} style={styles.sectionRow}>
          <td colSpan={6} style={styles.sectionLabel}>
            {c.tipo === "Rural" ? "Comités rurales" : "Comités urbanos"}
          </td>
        </tr>
      );
      lastTipo = c.tipo;
    }
    const isSelected = selected === c.codigo;
    rows.push(
      <tr key={c.codigo} onClick={() => handleRow(c.codigo)} style={{ cursor: "pointer" }}>
        <td style={styles.td(isSelected)}><span style={styles.code}>{c.codigo}</span></td>
        <td style={{ ...styles.td(isSelected), maxWidth: 220 }}>{c.nombre}</td>
        <td style={{ ...styles.td(isSelected), textAlign: "center", fontWeight: 600 }}>{c.familias}</td>
        <td style={styles.td(isSelected)}>
          <span style={c.tipo === "Rural" ? styles.tagRural : styles.tagUrban}>{c.tipo}</span>
        </td>
        <td style={{ ...styles.td(isSelected), fontSize: 12 }}>
          {c.constructora.startsWith("Falta")
            ? <span style={styles.tagPending}>{c.constructora}</span>
            : <span style={{ color: "#6b7280" }}>{c.constructora}</span>}
        </td>
        <td style={{ ...styles.td(isSelected), fontSize: 12 }}>{c.profesional}</td>
      </tr>
    );
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Municipalidad de Lautaro</h2>
        <p style={styles.subtitle}>Unidad de Vivienda - Entidad Patrocinante. Haz clic en una fila para ver los datos completos del comite.</p>
      </div>

      <div style={styles.metrics}>
        <div style={styles.metric}><div style={styles.metricLabel}>Total familias</div><div style={styles.metricValue}>206</div></div>
        <div style={styles.metric}><div style={styles.metricLabel}>Comités rurales</div><div style={styles.metricValue}>6</div></div>
        <div style={styles.metric}><div style={styles.metricLabel}>Comités urbanos</div><div style={styles.metricValue}>2</div></div>
      </div>

      <div style={styles.tabs}>
        {["todos", "rural", "urbano"].map(t => (
          <button key={t} style={styles.tab(tab === t)} onClick={() => { setTab(t); setSelected(null); }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Código</th>
            <th style={styles.th}>Nombre del comité</th>
            <th style={{ ...styles.th, textAlign: "center" }}>Familias</th>
            <th style={styles.th}>Tipo</th>
            <th style={styles.th}>Constructora</th>
            <th style={styles.th}>Profesional a cargo</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>

      {selectedComite && (
        <div style={styles.panel}>
          <button style={styles.closeBtn} onClick={() => setSelected(null)}>✕ cerrar</button>
          <h3 style={styles.panelTitle}>{selectedComite.nombre}</h3>
          <div style={styles.infoRow}>
            <span style={styles.code}>{selectedComite.codigo}</span>
            {selectedComite.pj !== "—" && <span style={styles.tagPj}>{selectedComite.pj}</span>}
            {selectedComite.venc !== "—" && <span style={{ fontSize: 12, color: "#6b7280" }}>{selectedComite.venc}</span>}
            <span style={selectedComite.tipo === "Rural" ? styles.tagRural : styles.tagUrban}>{selectedComite.tipo}</span>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            Profesional: <strong style={{ color: "#111827" }}>{selectedComite.profesional}</strong>
            &nbsp;·&nbsp; Familias: <strong style={{ color: "#111827" }}>{selectedComite.familias}</strong>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            Constructora:{" "}
            {selectedComite.constructora.startsWith("Falta")
              ? <span style={styles.tagPending}>{selectedComite.constructora}</span>
              : selectedComite.constructora}
          </div>

          {selectedComite.directiva.length > 0 ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af", marginBottom: 6 }}>Directiva</div>
              <div style={styles.dirGrid}>
                {selectedComite.directiva.map(d => (
                  <div key={d.rol} style={styles.dirCard}>
                    <div style={styles.dirRole}>{d.rol}</div>
                    <div style={styles.dirName}>{d.nombre}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={styles.placeholder}>Directiva no constituida aún</div>
          )}
        </div>
      )}
    </div>
  );
}
