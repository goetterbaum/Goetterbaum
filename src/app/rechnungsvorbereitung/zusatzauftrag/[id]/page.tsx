import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { abrechnungsStand } from "@/lib/rechnungsvorbereitung/abrechnung";
import {
  ladeRechnungsvorbereitungFuerZusatzauftrag,
  type RechnungsvorbereitungFuerZusatzauftrag,
} from "@/lib/rechnungsvorbereitung/verwaltung";
import { rechnungsZeilen } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../../../page.module.css";
import { Abrechnungen } from "../../abrechnungen";
import { zusatzauftragEinzelnAbrechnen } from "../../actions";
import { Positionen } from "../../positionen";
import { Stundennachweis } from "../../stundennachweis";

// Die Rechnungsvorbereitung nur für einen erledigten Zusatzauftrag, den
// das Büro sofort abrechnet, ohne das Ende des Abrechnungszeitraums
// abzuwarten. Darunter die Abrechnungen des Kunden, damit sich auch diese
// zurücknehmen lässt.
export default function ZusatzauftragEinzelnAbrechnen({
  params,
}: PageProps<"/rechnungsvorbereitung/zusatzauftrag/[id]">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.rechnungsvorbereitung.einzelnTitel}</h1>
        <Suspense fallback={<p>{texte.rechnungsvorbereitung.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.rechnungsvorbereitung.keineBerechtigung}>
            {(ich) => <Inhalt firmaId={ich.firma_id} id={params.then((p) => p.id)} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Inhalt({ firmaId, id }: { firmaId: string; id: Promise<string> }) {
  const geladen = await ladeRechnungsvorbereitungFuerZusatzauftrag(
    await createClient(),
    firmaId,
    await id,
  );

  if (!geladen) {
    return (
      <>
        <p>{texte.zusatzauftraege.nichtGefunden}</p>
        <p>
          <Link href="/rechnungsvorbereitung">
            {texte.rechnungsvorbereitung.zurRechnungsvorbereitung}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <Ergebnis geladen={geladen} />
      <Abrechnungen kundeId={geladen.kunde.id} />
      <p>
        <Link href={`/zusatzauftraege/${geladen.zusatzauftrag.id}`}>
          {texte.rechnungsvorbereitung.zumZusatzauftrag}
        </Link>
      </p>
    </>
  );
}

// Alle Beträge kommen aus dem Rechenbaustein; hier wird nur angezeigt.
function Ergebnis({ geladen }: { geladen: RechnungsvorbereitungFuerZusatzauftrag }) {
  const t = texte.rechnungsvorbereitung;
  const { kunde, zusatzauftrag, nichtFreigegeben } = geladen;
  const zeilen = rechnungsZeilen(geladen.ergebnis, geladen.namen);

  return (
    <>
      <h2>{t.ueberschrift(kunde.name, zusatzauftrag.beschreibung)}</h2>
      <p>{t.einzelnHinweis}</p>
      <p>{t.rundungsregel(texte.rundungsregeln[geladen.rundungsregel])}</p>
      {nichtFreigegeben > 0 && (
        <p role="alert">
          {zusatzauftrag.wartetAufFreigabe
            ? t.einzelnWartetAufFreigabe(nichtFreigegeben)
            : t.einzelnNichtFreigegeben(nichtFreigegeben)}
        </p>
      )}
      {zeilen.zeilen.length === 0 ? (
        <p>
          {zusatzauftrag.abgerechnetIn !== null
            ? t.einzelnSchonAbgerechnet
            : !zusatzauftrag.erledigt
              ? t.einzelnNichtErledigt
              : t.einzelnNichtsAbzurechnen}
        </p>
      ) : (
        <>
          <Positionen {...zeilen} />
          <p>
            {/* Ein normaler Link: Die Datei kommt vom Server, nicht als Seite. */}
            <a href={`/rechnungsvorbereitung/zusatzauftrag/${zusatzauftrag.id}/csv`} download>
              {t.csvExport}
            </a>
          </p>
          <Stundennachweis
            href={`/rechnungsvorbereitung/zusatzauftrag/${zusatzauftrag.id}/stundennachweis`}
            anzahlTage={geladen.ergebnis.stundennachweis.length}
          />
          {!zusatzauftrag.wartetAufFreigabe && (
            <>
              <p>{t.einzelnHinweisMarkieren}</p>
              <AktionsKnopf
                aktion={zusatzauftragEinzelnAbrechnen.bind(
                  null,
                  zusatzauftrag.id,
                  abrechnungsStand(geladen.ergebnis),
                )}
                knopf={t.alsAbgerechnetMarkieren}
                knopfLaeuft={t.markierenLaeuft}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
