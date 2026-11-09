// "How to approach the owner": picks an angle from the facts we actually have and
// fills an English and a Spanish opener. Drafts only — the license disclosure and all
// wording need broker review before use.

import type { DistressSignal } from "@/lib/adapters/types";
import type { OwnerIntel } from "./owner";

export interface Approach {
  angleKey: string;
  angle: { en: string; es: string };
  callScript: { en: string; es: string };
  letter: { en: string; es: string };
}

export function buildApproach(args: {
  address: string;
  owner: OwnerIntel;
  signals: DistressSignal[];
}): Approach {
  const { owner, address } = args;
  const open = args.signals.filter((s) => s.open);
  const has = (t: DistressSignal["type"]) => open.some((s) => s.type === t);

  let angleKey = "general";
  let angle = {
    en: "No specific pressure point found in the data. Lead with a simple, respectful question about whether they would consider an offer.",
    es: "No se encontró un motivo específico en los datos. Empiece con una pregunta sencilla y respetuosa sobre si consideraría una oferta.",
  };
  let hook = {
    en: "I'm reaching out to a few owners in the neighborhood",
    es: "estoy contactando a algunos propietarios de la zona",
  };
  let benefit = {
    en: "I can buy as-is, with no repairs or cleaning on your side, and close on the date that works for you.",
    es: "Puedo comprar la propiedad tal como está, sin reparaciones ni limpieza de su parte, y cerrar en la fecha que a usted le convenga.",
  };

  if (owner.kind === "government") {
    angleKey = "government";
    angle = {
      en: "Government-owned. Not a seller lead; these are sold through public surplus or bid processes.",
      es: "Propiedad del gobierno. No es un prospecto de venta; estas propiedades se venden por procesos públicos.",
    };
  } else if (has("unsafe_structure") || has("code_violation_lien") || has("code_violation") || has("building_violation")) {
    angleKey = "violations";
    angle = {
      en: "Open county violation(s). The owner may be facing fines or repairs they don't want to deal with. Offer to take the property as-is and handle the violations after closing.",
      es: "Tiene violaciones abiertas del condado. El dueño puede estar enfrentando multas o reparaciones que no quiere hacer. Ofrezca comprar tal como está y encargarse de las violaciones después del cierre.",
    };
    hook = {
      en: "I noticed the property may have some open items with the county",
      es: "noté que la propiedad puede tener algunos asuntos pendientes con el condado",
    };
    benefit = {
      en: "I buy as-is and take care of the repairs and the county paperwork myself after closing.",
      es: "Compro tal como está y yo me encargo de las reparaciones y los trámites con el condado después del cierre.",
    };
  } else if (owner.outOfState) {
    angleKey = "out_of_state";
    angle = {
      en: "Owner lives out of state. Managing a Florida property from far away is a hassle. Offer a simple remote closing with no trips needed.",
      es: "El dueño vive fuera del estado. Manejar una propiedad en Florida a distancia es complicado. Ofrezca un cierre sencillo a distancia, sin necesidad de viajar.",
    };
    hook = {
      en: "I see you own this property from out of state",
      es: "veo que usted es dueño de esta propiedad desde fuera del estado",
    };
    benefit = {
      en: "Everything can be handled remotely through a local title company. No trips, no repairs, no showings.",
      es: "Todo se puede hacer a distancia con una compañía de título local. Sin viajes, sin reparaciones y sin mostrar la propiedad.",
    };
  } else if (owner.absentee && owner.yearsSinceTransfer !== null && owner.yearsSinceTransfer >= 15) {
    angleKey = "tired_landlord";
    angle = {
      en: "Long-time absentee owner, likely a landlord. Ask about tenants and upkeep; offer to buy with tenants in place.",
      es: "Dueño ausente desde hace muchos años, probablemente arrendador. Pregunte por los inquilinos y el mantenimiento; ofrezca comprar con los inquilinos adentro.",
    };
    hook = {
      en: "I understand you've owned this property for a long time",
      es: "entiendo que usted ha sido dueño de esta propiedad por mucho tiempo",
    };
    benefit = {
      en: "I can buy with the tenants in place, as-is, so you don't have to deal with repairs or move-outs.",
      es: "Puedo comprar con los inquilinos adentro y tal como está, para que usted no tenga que ocuparse de reparaciones ni desalojos.",
    };
  } else if (owner.absentee) {
    angleKey = "absentee";
    angle = {
      en: "Owner does not live at the property. Ask how the property is being used and whether owning it is still worth the effort.",
      es: "El dueño no vive en la propiedad. Pregunte cómo se está usando y si todavía le vale la pena mantenerla.",
    };
  } else if (owner.yearsSinceTransfer !== null && owner.yearsSinceTransfer >= 15) {
    angleKey = "long_term_owner";
    angle = {
      en: "Long-time owner-occupant. Often high equity and thinking about a next step (downsizing, moving closer to family). Be patient; this may be a listing rather than a cash purchase.",
      es: "Dueño que vive en la casa desde hace muchos años. Suele tener mucho capital acumulado y estar pensando en su próximo paso. Tenga paciencia; puede convenirle más listar la propiedad que venderla en efectivo.",
    };
  }

  const callScript = {
    en: `Hi, is this the owner of ${address}? My name is [YOUR NAME]. I'm a licensed real estate agent in Florida, and I'm calling as a buyer for my own account, not to list your home. ${cap(hook.en)}, and I wanted to ask: would you consider an offer on the property? ... ${benefit.en} If it's not a good time or you're not interested, just tell me and I won't call again.`,
    es: `Hola, ¿hablo con el dueño de ${address}? Mi nombre es [SU NOMBRE]. Soy agente de bienes raíces con licencia en Florida y le llamo como comprador por cuenta propia, no para listar su casa. ${cap(hook.es)}, y quería preguntarle: ¿consideraría una oferta por la propiedad? ... ${benefit.es} Si no es buen momento o no le interesa, solo dígamelo y no le vuelvo a llamar.`,
  };

  const letter = {
    en: `Dear owner of ${address},\n\nMy name is [YOUR NAME]. I am a licensed Florida real estate agent writing to you as a buyer for my own account. ${cap(hook.en)}, and I would like to make you a fair offer for your property.\n\n${benefit.en}\n\nIf you would like to talk, call or text me at [PHONE]. If you are not interested, no reply is needed and I will not contact you again.\n\nSincerely,\n[YOUR NAME]\n[BROKERAGE NAME], License #[LICENSE NUMBER]`,
    es: `Estimado propietario de ${address}:\n\nMi nombre es [SU NOMBRE]. Soy agente de bienes raíces con licencia en Florida y le escribo como comprador por cuenta propia. ${cap(hook.es)}, y me gustaría hacerle una oferta justa por su propiedad.\n\n${benefit.es}\n\nSi desea conversar, llámeme o envíeme un mensaje al [TELÉFONO]. Si no le interesa, no necesita responder y no volveré a contactarle.\n\nAtentamente,\n[SU NOMBRE]\n[NOMBRE DE LA INMOBILIARIA], Licencia n.º [NÚMERO DE LICENCIA]`,
  };

  return { angleKey, angle, callScript, letter };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
