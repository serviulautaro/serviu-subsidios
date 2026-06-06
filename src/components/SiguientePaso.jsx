import React from "react";

// Formatea YYYY-MM-DD → DD/MM/YYYY sin new Date() para evitar el bug de zona horaria chilena
function fmtF(f) {
  if (!f) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
    const [y, m, d] = f.split("-");
    return `${d}/${m}/${y}`;
  }
  return f;
}

export default function SiguientePaso({ visitas = [], onBorrar }) {
  const conPaso = [...visitas]
    .filter(v => v.siguiente_paso && v.siguiente_paso.trim())
    .sort((a, b) => {
      // Orden de más antiguo a más nuevo (izquierda → derecha)
      if (a.fecha < b.fecha) return -1;
      if (a.fecha > b.fecha) return 1;
      return 0;
    });

  if (!conPaso.length) return null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {conPaso.map(v => (
        <div
          key={v.id}
          style={{
            display: "inline-flex",
            alignItems: "flex-start",
            gap: 6,
            background: "#FFFBEB",
            border: "1.5px solid #FCD34D",
            borderRadius: 10,
            padding: "5px 10px 5px 12px",
            fontSize: 12,
            maxWidth: 260,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#92400E", lineHeight: 1.3, wordBreak: "break-word" }}>
              {v.siguiente_paso}
            </div>
            <div style={{ color: "#B45309", fontSize: 11, marginTop: 3 }}>
              Solicitud: {fmtF(v.fecha)}
              {v.fecha_compromiso && (
                <span style={{ marginLeft: 6 }}>· Compromiso: {fmtF(v.fecha_compromiso)}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => onBorrar && onBorrar(v.id)}
            title="Eliminar este siguiente paso"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#D97706",
              fontSize: 14,
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
