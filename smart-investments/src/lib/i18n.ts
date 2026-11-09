export type Lang = "en" | "es";

const dict = {
  "nav.home": { en: "Home", es: "Inicio" },
  "nav.analyzer": { en: "Analyzer", es: "Analizador" },
  "nav.leads": { en: "Leads", es: "Prospectos" },
  "nav.data": { en: "Data", es: "Datos" },
  "home.title": { en: "Throw any property at it.", es: "Analice cualquier propiedad." },
  "home.sub": {
    en: "Type a Miami-Dade address or folio number. You get the owner, sales, violations, a value estimate and every exit strategy, each number with its source.",
    es: "Escriba una dirección o número de folio de Miami-Dade. Verá el dueño, las ventas, las violaciones, un estimado de valor y cada estrategia de salida, con la fuente de cada número.",
  },
  "search.placeholder": { en: "Address or folio — e.g. 10236 W 32 Way, Hialeah", es: "Dirección o folio — ej. 10236 W 32 Way, Hialeah" },
  "search.button": { en: "Analyze", es: "Analizar" },
  "search.none": { en: "No Miami-Dade property matched", es: "Ninguna propiedad de Miami-Dade coincide con" },
  "search.many": { en: "More than one property matches. Pick one:", es: "Hay más de una propiedad. Elija una:" },
  "search.coverage": {
    en: "Only Miami-Dade County is connected so far. Broward and Palm Beach come in Phase 5.",
    es: "Por ahora solo está conectado el condado de Miami-Dade. Broward y Palm Beach llegan en la Fase 5.",
  },
  "report.snapshot": { en: "Snapshot", es: "Resumen" },
  "report.owner": { en: "Owner", es: "Dueño" },
  "report.signals": { en: "Violations and distress signals", es: "Violaciones y señales de presión" },
  "report.score": { en: "Motivation score", es: "Puntaje de motivación" },
  "report.value": { en: "Value from recent sales", es: "Valor según ventas recientes" },
  "report.numbers": { en: "Your numbers", es: "Sus números" },
  "report.strategies": { en: "Exit strategies, side by side", es: "Estrategias de salida, lado a lado" },
  "report.gotchas": { en: "Florida checks", es: "Revisiones de Florida" },
  "report.approach": { en: "How to approach the owner", es: "Cómo acercarse al dueño" },
  "report.export": { en: "Export PDF", es: "Exportar PDF" },
  "report.unknown": { en: "Unknown", es: "Desconocido" },
  "report.notChecked": { en: "Not checked with current data", es: "No verificado con los datos actuales" },
  "report.whyScore": { en: "Why this score", es: "Por qué este puntaje" },
  "report.noSignals": { en: "No scoring signals found in the data we have.", es: "No se encontraron señales en los datos disponibles." },
  "approach.angle": { en: "Suggested angle", es: "Enfoque sugerido" },
  "approach.call": { en: "Opening call script", es: "Guion de llamada inicial" },
  "approach.letter": { en: "Letter", es: "Carta" },
  "approach.review": {
    en: "Draft only. Have your broker review the license disclosure and wording before you use it. Calls only 8 am – 8 pm, max 3 attempts per 24 hours, never to a Do Not Call number.",
    es: "Solo un borrador. Pida a su bróker que revise la divulgación de licencia y el texto antes de usarlo. Llamadas solo de 8 am a 8 pm, máximo 3 intentos cada 24 horas, nunca a un número en la lista de No Llamar.",
  },
  "leads.title": { en: "Lead Finder", es: "Buscador de prospectos" },
  "leads.sub": {
    en: "Scores every property in a zip code using the signals the free data can prove, and shows why.",
    es: "Califica cada propiedad de un código postal con las señales que los datos gratuitos pueden comprobar, y explica por qué.",
  },
  "leads.find": { en: "Find leads", es: "Buscar prospectos" },
  "data.title": { en: "Data sources", es: "Fuentes de datos" },
} as const;

export type Key = keyof typeof dict;

export function t(lang: Lang, key: Key): string {
  return dict[key][lang];
}

export function parseLang(v: string | undefined | null): Lang {
  return v === "es" ? "es" : "en";
}
