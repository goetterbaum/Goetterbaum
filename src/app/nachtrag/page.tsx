import { redirect } from "next/navigation";
import { Suspense } from "react";
import { zeiteintragNachtragen } from "@/app/erfassung/actions";
import { erfassterMitarbeiter, erfassungVon } from "@/app/fuer-andere/erfasster-mitarbeiter";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { heuteInBerlin } from "@/lib/berliner-zeit";
import { createClient } from "@/lib/supabase/server";
import { ladeAuswahl } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { NachtragFormular } from "./nachtrag-formular";

export default function Nachtragen({ searchParams }: PageProps<"/nachtrag">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.nachtrag.titel}</h1>
        <Suspense fallback={<p>{texte.nachtrag.laedt}</p>}>
          <Formular fuer={searchParams.then((p) => p.fuer)} />
        </Suspense>
      </main>
    </div>
  );
}

// fuer ist der Mitarbeiter, für den nachgetragen wird; ohne ihn trägt der
// angemeldete Nutzer für sich selbst nach.
async function Formular({
  fuer: fuerVersprechen,
}: {
  fuer: Promise<string | string[] | undefined>;
}) {
  const fuer = await fuerVersprechen;
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich) redirect("/anmelden");

  const erfasst = await erfassterMitarbeiter(
    supabase,
    ich,
    typeof fuer === "string" ? fuer : ich.id,
  );
  if ("hinweis" in erfasst) return erfasst.hinweis;
  const { mitarbeiter } = erfasst;

  return (
    <>
      {mitarbeiter.id !== ich.id && <p>{texte.fuerAndere.fuer(mitarbeiter.name)}</p>}
      <NachtragFormular
        aktion={zeiteintragNachtragen.bind(null, mitarbeiter.id)}
        zurueck={erfassungVon(ich, mitarbeiter)}
        {...await ladeAuswahl(supabase)}
        vorgabe={{
          art: "taetigkeit",
          objekt_id: "",
          taetigkeit_id: "",
          zusatzauftrag_id: "",
          datum: heuteInBerlin(),
          von: "",
          bis: "",
        }}
      />
    </>
  );
}
