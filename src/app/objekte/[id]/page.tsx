import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { Zusatzauftraege } from "@/app/zusatzauftraege/zusatzauftraege";
import { ladeKundenliste } from "@/lib/kunden/verwaltung";
import { ladeObjekt } from "@/lib/objekte/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../../page.module.css";
import { objektArchivieren, objektSpeichern } from "../actions";
import { ObjektFormular } from "../objekt-formular";
import { abrechnungAlsText } from "../objekt-tabelle";

export default function ObjektBearbeiten({ params }: PageProps<"/objekte/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.objekte.titel}</h1>
        <Suspense fallback={<p>{texte.objekte.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.stammdaten.keineBerechtigung}>
            {() => <Bearbeiten id={params.then((p) => p.id)} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Bearbeiten({ id: idVersprechen }: { id: Promise<string> }) {
  const id = await idVersprechen;
  const supabase = await createClient();
  const objekt = await ladeObjekt(supabase, id);

  if (!objekt) {
    return (
      <>
        <p>{texte.objekte.nichtGefunden}</p>
        <ZurUebersicht />
      </>
    );
  }

  // Zur Auswahl stehen die aktiven Kunden und, falls archiviert, der
  // bisherige.
  const kunden = (await ladeKundenliste(supabase)).filter(
    (k) => !k.archiviert || k.id === objekt.kunde_id,
  );

  return (
    <>
      <h2>{objekt.bezeichnung}</h2>
      <p>
        {texte.objekte.kunde}: <Link href={`/kunden/${objekt.kunde_id}`}>{objekt.kunde.name}</Link>
        {" · "}
        {abrechnungAlsText(objekt)}
      </p>
      {objekt.archiviert && <p>{texte.objekte.archiviertHinweis}</p>}

      <ObjektFormular
        aktion={objektSpeichern.bind(null, objekt.id)}
        kunden={kunden}
        vorgabe={objekt}
        knopf={texte.stammdaten.speichern}
        knopfLaeuft={texte.stammdaten.speichernLaeuft}
      />

      {!objekt.archiviert && <p>{texte.objekte.archivierenHinweis}</p>}
      {/* Neuer Knopf nach jedem Wechsel, damit keine alte Meldung stehen
          bleibt. */}
      <AktionsKnopf
        key={String(objekt.archiviert)}
        aktion={objektArchivieren.bind(null, objekt.id, !objekt.archiviert)}
        knopf={objekt.archiviert ? texte.stammdaten.aktivieren : texte.stammdaten.archivieren}
        knopfLaeuft={texte.stammdaten.speichernLaeuft}
      />

      <Zusatzauftraege supabase={supabase} objekt={objekt} />

      <ZurUebersicht />
    </>
  );
}

function ZurUebersicht() {
  return (
    <p>
      <Link href="/objekte">{texte.objekte.zurUebersicht}</Link>
    </p>
  );
}
