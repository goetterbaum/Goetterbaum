import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { endeNachtragen, zeiteintragAendern } from "@/app/erfassung/actions";
import { erfassterMitarbeiter, erfassungVon } from "@/app/fuer-andere/erfasster-mitarbeiter";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { berlinerDatum, berlinerUhrzeit } from "@/lib/berliner-zeit";
import { createClient } from "@/lib/supabase/server";
import { tagUndZeit, UNVOLLSTAENDIG_NACH_STUNDEN } from "@/lib/zeiterfassung/anzeige";
import { ladeAuswahl, ladeZeiteintragZumAendern } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import styles from "../../page.module.css";
import { EndeFormular } from "../ende-formular";
import { NachtragFormular } from "../nachtrag-formular";

// Mit ?aus=pruefliste kommt das Büro von der Prüfliste der unvollständigen
// Einträge und kehrt nach dem Speichern dorthin zurück.
export default function ZeiteintragAendern({ params, searchParams }: PageProps<"/nachtrag/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.nachtrag.aendernTitel}</h1>
        <Suspense fallback={<p>{texte.nachtrag.laedt}</p>}>
          <Aendern
            id={params.then((p) => p.id)}
            ausPruefliste={searchParams.then((p) => p.aus === "pruefliste")}
          />
        </Suspense>
      </main>
    </div>
  );
}

async function Aendern({
  id: idVersprechen,
  ausPruefliste: ausPrueflisteVersprechen,
}: {
  id: Promise<string>;
  ausPruefliste: Promise<boolean>;
}) {
  const [id, ausPruefliste] = await Promise.all([idVersprechen, ausPrueflisteVersprechen]);
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich) redirect("/anmelden");

  // Normale Mitarbeiter bekommen von der Datenbank nur eigene Einträge.
  const eintrag = await ladeZeiteintragZumAendern(supabase, id);
  // Ein laufender Eintrag lässt sich nur ändern, wenn er unvollständig ist,
  // und dann nur sein Ende.
  if (!eintrag || (eintrag.ende === null && !eintrag.unvollstaendig)) {
    return (
      <>
        <p>{eintrag ? texte.nachtrag.laeuftNoch : texte.nachtrag.nichtGefunden}</p>
        <p>
          <Link
            href={
              eintrag && eintrag.mitarbeiter_id !== ich.id
                ? `/fuer-andere/${eintrag.mitarbeiter_id}`
                : "/"
            }
          >
            {texte.nachtrag.zurueck}
          </Link>
        </p>
      </>
    );
  }
  // Abgerechnete Einträge ändert niemand, freigegebene nur noch das Büro;
  // die Datenbank sperrt sie ohnehin.
  if (eintrag.abgerechnet || (eintrag.freigegeben && ich.rolle !== "buero")) {
    return (
      <>
        <p>{eintrag.abgerechnet ? texte.abrechnung.gesperrt : texte.freigabe.gesperrt}</p>
        <p>
          <Link
            href={
              eintrag.mitarbeiter_id !== ich.id ? `/fuer-andere/${eintrag.mitarbeiter_id}` : "/"
            }
          >
            {texte.nachtrag.zurueck}
          </Link>
        </p>
      </>
    );
  }
  const erfasst = await erfassterMitarbeiter(supabase, ich, eintrag.mitarbeiter_id, {
    zumAendern: true,
  });
  if ("hinweis" in erfasst) return erfasst.hinweis;
  const { mitarbeiter } = erfasst;
  const zurueck = ausPruefliste ? "/unvollstaendige-eintraege" : erfassungVon(ich, mitarbeiter);

  const beginn = Date.parse(eintrag.beginn);
  if (eintrag.ende === null) {
    return (
      <>
        {mitarbeiter.id !== ich.id && <p>{texte.fuerAndere.fuer(mitarbeiter.name)}</p>}
        <h2>{texte.erfassung.unvollstaendig}</h2>
        <p>{texte.erfassung.unvollstaendigHinweis(UNVOLLSTAENDIG_NACH_STUNDEN)}</p>
        <p>{tagUndZeit(eintrag.beginn, null, texte.zeiteintraege.unvollstaendig)}</p>
        <EndeFormular
          aktion={endeNachtragen.bind(null, eintrag.id)}
          datum={berlinerDatum(beginn)}
          zurueck={zurueck}
        />
        <p>
          <Link href={zurueck}>
            {ausPruefliste ? texte.pruefliste.zurueck : texte.nachtrag.zurueck}
          </Link>
        </p>
      </>
    );
  }
  return (
    <>
      {mitarbeiter.id !== ich.id && <p>{texte.fuerAndere.fuer(mitarbeiter.name)}</p>}
      <NachtragFormular
        // Neu aufbauen, wenn sich der Eintrag geändert hat: Next.js hält die
        // Seite samt Formularzustand vorrätig.
        key={JSON.stringify(eintrag)}
        aktion={zeiteintragAendern.bind(null, eintrag.id)}
        zurueck={zurueck}
        {...await ladeAuswahl(supabase, eintrag.zusatzauftrag_id)}
        vorgabe={{
          art: eintrag.art,
          objekt_id: eintrag.objekt_id ?? "",
          taetigkeit_id: eintrag.taetigkeit_id ?? "",
          zusatzauftrag_id: eintrag.zusatzauftrag_id ?? "",
          datum: berlinerDatum(beginn),
          von: berlinerUhrzeit(beginn),
          bis: berlinerUhrzeit(Date.parse(eintrag.ende)),
        }}
      />
    </>
  );
}
