// Reglas puras de asignacion de solicitantes a comites y programas.

export const COMITE_DESMARQUE = "comite_desmarque";
export const PROGRAMA_DESMARQUE = "habitabilidad";
export const NOMBRE_COMITE_DESMARQUE = "DESMARQUE DE VIVIENDA";

const textoPlano = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

const docNombreNorm = (doc = {}) => textoPlano(doc.nombre);
const docConVb = (doc = {}) => doc?.vb === true || doc?.vb === "true" || doc?.entregado === true;
const valorDocTexto = (doc = {}) => textoPlano(doc.valor || doc.opcionSeleccionada || doc.etiqueta);
const buscarDoc = (docs = [], palabras = []) =>
  docs.find((doc) => palabras.every((palabra) => docNombreNorm(doc).includes(textoPlano(palabra))));

export const respuestaServiuLista = (solDesmarque = {}) => {
  const respuestaServiu = buscarDoc(solDesmarque?.documentos || [], ["respuesta", "serviu"]);
  const respuestaTexto = valorDocTexto(respuestaServiu);
  return docConVb(respuestaServiu) &&
    (respuestaTexto.includes("DESMARCADO") || respuestaTexto.includes("APROBADO"));
};

export const esDesmarcado = (persona) =>
  textoPlano(persona?.estado_desmarque || persona?.estadoDesmarque) === "DESMARCADO";

export const solicitudesNormalesPersona = (personaId, solicitudes = []) =>
  (solicitudes || []).filter(
    (s) =>
      (s.personaId || s.persona_id) === personaId &&
      (s.programaId || s.programa_id) !== PROGRAMA_DESMARQUE
  );

export const yaMovido = (persona, tieneSolicitudDesmarque) =>
  typeof tieneSolicitudDesmarque === "function" &&
  tieneSolicitudDesmarque(persona?.id) &&
  (persona?.comiteId || persona?.comite_id) !== COMITE_DESMARQUE;

export const grupoDesmarcado = (persona, tieneSolicitudDesmarque) => {
  if (yaMovido(persona, tieneSolicitudDesmarque)) return "con_programa";
  if (persona?.pendiente_calificar) return "pendiente_calificar";
  return "sin_programa";
};

export const puedeMoverDesmarcado = (persona, tieneSolicitudDesmarque) =>
  esDesmarcado(persona) && !yaMovido(persona, tieneSolicitudDesmarque);

export const puedeAsignarNormal = (personaId, solicitudes = []) => {
  const activas = solicitudesNormalesPersona(personaId, solicitudes);
  if (activas.length > 1) {
    return {
      ok: false,
      motivo: `Tiene ${activas.length} solicitudes activas (${activas
        .map((s) => s.programaId || s.programa_id)
        .join(", ")}). Solo se permite una.`,
    };
  }
  return { ok: true, motivo: "" };
};
