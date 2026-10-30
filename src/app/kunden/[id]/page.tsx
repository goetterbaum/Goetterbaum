import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { ObjektTabelle } from "@/app/objekte/objekt-tabelle";
import { ladeFirma } from "@/lib/firma/verwaltung";
import { ladeKunde } from "@/lib/kunden/verwaltung";
import { ladeObjektliste } from "@/lib/objekte/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../../page.module.css";
import { kundeArchivieren, kundeSpeichern } from "../actions";
import { KundenFormular } from "../kunden-formular";
import { Stundensaetze } from "../stundensaetze";

export default function KundeBearbeiten({ params }: PageProps<"/kunden/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.kunden.titel}</h1>
        <Suspense fallback={<p>{texte.kunden.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.stammdaten.keineBerechtigung}>
            {(ich) => <Bearbeiten id={params.then((p) => p.id)} firmaId={ich.firma_id} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Bearbeiten({
  id: idVersprechen,
  firmaId,
}: {
  id: Promise<string>;
  firmaId: string;
}) {
  const id = await idVersprechen;
  const supabase = await createClient();
  const kunde = await ladeKunde(supabase, id);

  if (!kunde) {
    return (
      <>
        <p>{texte.kunden.nichtGefunden}</p>
        <ZurUebersicht />
      </>
    );
  }

  const [objekte, firma] = await Promise.all([
    ladeObjektliste(supabase, { kundeId: kunde.id }),
    ladeFirma(supabase, firmaId),
  ]);

  return (
    <>
      <h2>{kunde.name}</h2>
      {kunde.archiviert && <p>{texte.kunden.archiviertHinweis}</p>}

      <KundenFormular
        aktion={kundeSpeichern.bind(null, kunde.id)}
        vorgabe={kunde}
        knopf={texte.stammdaten.speichern}
        knopfLaeuft={texte.stammdaten.speichernLaeuft}
        standardDerFirma={firma.rundungsregel}
      />

      {!kunde.archiviert && <p>{texte.kunden.archivierenHinweis}</p>}
      {/* Neuer Knopf nach jedem Wechsel, damit keine alte Meldung stehen
          bleibt. */}
      <AktionsKnopf
        key={String(kunde.archiviert)}
        aktion={kundeArchivieren.bind(null, kunde.id, !kunde.archiviert)}
        knopf={kunde.archiviert ? texte.stammdaten.aktivieren : texte.stammdaten.archivieren}
        knopfLaeuft={texte.stammdaten.speichernLaeuft}
      />

      <h2>{texte.kunden.objekte}</h2>
      {!kunde.archiviert && (
        <p>
          <Link href={`/objekte/neu?kunde=${kunde.id}`}>{texte.objekte.neu}</Link>
        </p>
      )}
      {objekte.length === 0 ? (
        <p>{texte.kunden.keineObjekte}</p>
      ) : (
        <ObjektTabelle objekte={objekte} mitKunde={false} />
      )}

      <Stundensaetze supabase={supabase} kundeId={kunde.id} objekte={objekte} />

      <ZurUebersicht />
    </>
  );
}

function ZurUebersicht() {
  return (
    <p>
      <Link href="/kunden">{texte.kunden.zurUebersicht}</Link>
    </p>
  );
}
