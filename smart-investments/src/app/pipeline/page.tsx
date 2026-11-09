import { cookies } from "next/headers";
import Link from "next/link";
import { scoreTone } from "@/components/ui";
import { titleCase } from "@/lib/analysis/florida";
import { parseLang } from "@/lib/i18n";
import { fmtDate } from "@/lib/sourced";
import { listLeads, STAGES } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const lang = parseLang((await cookies()).get("lang")?.value);
  const es = lang === "es";
  const leads = await listLeads();
  const active = STAGES.filter((s) => leads.some((l) => l.stage === s));

  return (
    <div className="stagger flex flex-col gap-5">
      <section className="card">
        <h1 className="text-3xl font-bold tracking-tight">{es ? "Seguimiento" : "Pipeline"}</h1>
        <p className="muted mt-1">
          {es
            ? "Prospectos guardados, por etapa. Cambie la etapa, el rol (inversionista o agente) y agregue notas."
            : "Saved leads by stage. Change the stage, the hat you are wearing (investor or agent), and add notes."}
        </p>
        <p className="text-warn mt-2 text-sm">
          {es
            ? "Almacenamiento de prueba: se guarda en un archivo de esta máquina, sin inicio de sesión. Se pierde si la sesión termina. La versión real usa Supabase."
            : "Test storage: saved to a file on this machine, with no login. It is lost when this session ends. The real version uses Supabase."}
        </p>
      </section>

      {leads.length === 0 ? (
        <section className="card">
          <p>
            {es ? "Aún no hay prospectos guardados. Abra un reporte y pulse «Guardar en seguimiento»." : "No saved leads yet. Open a report and press “Save to pipeline”."}
          </p>
          <div className="mt-3 flex gap-2">
            <Link className="btn" href="/">
              {es ? "Analizar una propiedad" : "Analyze a property"}
            </Link>
            <Link className="btn btn-ghost" href="/leads">
              {es ? "Buscar prospectos" : "Find leads"}
            </Link>
          </div>
        </section>
      ) : null}

      {active.map((stage) => {
        const inStage = leads.filter((l) => l.stage === stage);
        return (
          <section key={stage} className="card">
            <div className="flex items-baseline justify-between">
              <div className="text-lg font-semibold">{stage}</div>
              <span className="pill">{inStage.length}</span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {inStage.map((l) => (
                <div key={l.folio} className="card-flat">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link className="text-accent text-[15px] font-semibold" href={`/property/${l.folio}`}>
                        {l.address}
                      </Link>
                      <div className="muted text-xs">
                        {l.city ? titleCase(l.city) : ""} · {l.owner ?? "Owner unknown"} · {es ? "guardado" : "saved"} {fmtDate(l.savedAt)}
                      </div>
                    </div>
                    <span className={`pill pill-${scoreTone(l.score)} num`}>{l.score}</span>
                  </div>
                  {l.reasons.length ? <div className="muted mt-1 text-xs">{l.reasons.join(" · ")}</div> : null}

                  <form action="/api/pipeline" method="post" className="mt-3 grid grid-cols-2 gap-2">
                    <input type="hidden" name="_action" value="update" />
                    <input type="hidden" name="folio" value={l.folio} />
                    <label>
                      <span className="label">{es ? "Etapa" : "Stage"}</span>
                      <select className="input" name="stage" defaultValue={l.stage}>
                        {STAGES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="label">{es ? "Rol" : "Hat"}</span>
                      <select className="input" name="hat" defaultValue={l.hat}>
                        <option value="investor">{es ? "Inversionista (comprador)" : "Investor (buyer)"}</option>
                        <option value="agent">{es ? "Agente (listado)" : "Agent (listing)"}</option>
                      </select>
                    </label>
                    <label className="col-span-2">
                      <span className="label">{es ? "Nueva nota" : "New note"}</span>
                      <input className="input" name="note" placeholder={es ? "Qué pasó, próximo paso…" : "What happened, next step…"} maxLength={2000} />
                    </label>
                    <button className="btn col-span-2 !py-2">{es ? "Guardar cambios" : "Save changes"}</button>
                  </form>

                  {l.notes.length ? (
                    <ul className="mt-3 space-y-1 text-sm">
                      {l.notes.slice(0, 5).map((n) => (
                        <li key={n.at}>
                          <span className="muted num text-xs">{fmtDate(n.at)}</span> {n.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <form action="/api/pipeline" method="post" className="mt-2 text-right">
                    <input type="hidden" name="_action" value="remove" />
                    <input type="hidden" name="folio" value={l.folio} />
                    <button className="text-bad text-xs font-semibold">{es ? "Quitar" : "Remove"}</button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
