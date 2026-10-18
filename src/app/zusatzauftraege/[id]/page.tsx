import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { createClient } from "@/lib/supabase/server";
import { ladeZusatzauftrag, zusatzauftragStatus } from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";
import styles from "../../page.module.css";
import { zusatzauftragErledigt, zusatzauftragSpeichern } from "../actions";
import { abrechnungDesZusatzauftrags } from "../zusatzauftraege";
import { ZusatzauftragFormular } from "../zusatzauftrag-formular";

export default function ZusatzauftragBearbeiten({ params }: PageProps<"/zusatzauftraege/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.zusatzauftraege.titel}</h1>
        <Suspense fallback={<p>{texte.zusatzauftraege.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.stammdaten.keineBerechtigung}>
            {() => <Bearbeiten id={params.then((p) => p.id)} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

// Bearbeiten und als erledigt markieren, solange er nicht abgerechnet ist.
async function Bearbeiten({ id: idVersprechen }: { id: Promise<string> }) {
  const t = texte.zusatzauftraege;
  const za = await ladeZusatzauftrag(await createClient(), await idVersprechen);

  if (!za) {
    return (
      <>
        <p>{t.nichtGefunden}</p>
        <p>
          <Link href="/objekte">{texte.objekte.zurUebersicht}</Link>
        </p>
      </>
    );
  }

  const status = zusatzauftragStatus(za);
  return (
    <>
      <h2>{za.beschreibung}</h2>
      <p>
        {texte.objekte.titel}:{" "}
        <Link href={`/objekte/${za.objekt_id}`}>{za.objekt.bezeichnung}</Link>
        {" · "}
        {abrechnungDesZusatzauftrags(za)}
        {" · "}
        {t.status[status]}
      </p>
      {status === "abgerechnet" ? (
        <p>{t.abgerechnetHinweis}</p>
      ) : (
        <>
          <ZusatzauftragFormular
            // Neu aufbauen, wenn sich der Zusatzauftrag geändert hat.
            key={JSON.stringify(za)}
            aktion={zusatzauftragSpeichern.bind(null, za.id)}
            vorgabe={za}
            knopf={texte.stammdaten.speichern}
            knopfLaeuft={texte.stammdaten.speichernLaeuft}
          />
          {za.erledigt && <p>{t.erledigtHinweis}</p>}
          {/* Neuer Knopf nach jedem Wechsel, damit keine alte Meldung stehen
              bleibt. */}
          <AktionsKnopf
            key={String(za.erledigt)}
            aktion={zusatzauftragErledigt.bind(null, za.id, !za.erledigt)}
            knopf={za.erledigt ? t.wiederOeffnen : t.alsErledigtMarkieren}
            knopfLaeuft={texte.stammdaten.speichernLaeuft}
          />
        </>
      )}
      <p>
        <Link href={`/objekte/${za.objekt_id}`}>{t.zumObjekt}</Link>
      </p>
    </>
  );
}
