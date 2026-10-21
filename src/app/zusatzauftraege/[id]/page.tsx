import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { createClient } from "@/lib/supabase/server";
import { ladeZusatzauftrag, type Zusatzauftrag } from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";
import styles from "../../page.module.css";
import { zusatzauftragErledigen, zusatzauftragSpeichern } from "../actions";
import { ZusatzauftragFormular } from "../zusatzauftrag-formular";
import { zusatzauftragAbrechnungAlsText, zusatzauftragStatus } from "../zusatzauftraege";

export default function ZusatzauftragBearbeiten({ params }: PageProps<"/zusatzauftraege/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.zusatzauftraege.titelBearbeiten}</h1>
        <Suspense fallback={<p>{texte.zusatzauftraege.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.stammdaten.keineBerechtigung}>
            {() => <Bearbeiten id={params.then((p) => p.id)} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Bearbeiten({ id: idVersprechen }: { id: Promise<string> }) {
  const t = texte.zusatzauftraege;
  const zusatzauftrag = await ladeZusatzauftrag(await createClient(), await idVersprechen);

  if (!zusatzauftrag) {
    return (
      <>
        <p>{t.nichtGefunden}</p>
        <p>
          <Link href="/objekte">{texte.objekte.zurUebersicht}</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h2>{zusatzauftrag.beschreibung}</h2>
      <p>
        {t.objekt}: {zusatzauftrag.objekt.bezeichnung}
        {" · "}
        {zusatzauftragAbrechnungAlsText(zusatzauftrag)}
        {" · "}
        {zusatzauftragStatus(zusatzauftrag)}
      </p>
      {zusatzauftrag.abgerechnet_in ? (
        <p>{t.abgerechnetHinweis}</p>
      ) : (
        <Aendern zusatzauftrag={zusatzauftrag} />
      )}

      <p>
        <Link href={`/objekte/${zusatzauftrag.objekt_id}`}>{t.zumObjekt}</Link>
      </p>
    </>
  );
}

// Bearbeiten und erledigen, solange der Zusatzauftrag nicht abgerechnet ist.
function Aendern({ zusatzauftrag }: { zusatzauftrag: Zusatzauftrag }) {
  const t = texte.zusatzauftraege;
  return (
    <>
      {zusatzauftrag.erledigt && <p>{t.erledigtHinweis}</p>}

      <ZusatzauftragFormular
        aktion={zusatzauftragSpeichern.bind(null, zusatzauftrag.id)}
        vorgabe={zusatzauftrag}
        knopf={texte.stammdaten.speichern}
        knopfLaeuft={texte.stammdaten.speichernLaeuft}
      />

      {!zusatzauftrag.erledigt && <p>{t.offenHinweis}</p>}
      {/* Neuer Knopf nach jedem Wechsel, damit keine alte Meldung stehen
          bleibt. */}
      <AktionsKnopf
        key={String(zusatzauftrag.erledigt)}
        aktion={zusatzauftragErledigen.bind(null, zusatzauftrag.id, !zusatzauftrag.erledigt)}
        knopf={zusatzauftrag.erledigt ? t.wiederOeffnen : t.alsErledigtMarkieren}
        knopfLaeuft={texte.stammdaten.speichernLaeuft}
      />
    </>
  );
}
