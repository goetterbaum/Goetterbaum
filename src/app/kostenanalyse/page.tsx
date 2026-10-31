import Link from "next/link";
import { Suspense } from "react";
import { Monatsauswahl } from "@/app/monatsauswahl";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { heuteInBerlin } from "@/lib/berliner-zeit";
import { euroAlsText } from "@/lib/geld";
import { ladeKostenanalyse } from "@/lib/kostenanalyse/verwaltung";
import {
  euroOderLeer as euro,
  prozentAlsText,
  stundenFuerSeite as stunden,
  uebersichtsZeilen,
  type UebersichtsZeile,
} from "@/lib/kostenanalyse/zeilen";
import { monatVon } from "@/lib/rechnungsvorbereitung/zeitraum";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../page.module.css";

// Der Zeitraum steht in der Adresszeile (von, bis), damit sich eine
// Auswahl als Link merken lässt und Details und CSV-Export dieselbe
// Auswahl bekommen.
export default function Kostenanalyse({ searchParams }: PageProps<"/kostenanalyse">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.kostenanalyse.titel}</h1>
        <Suspense fallback={<p>{texte.kostenanalyse.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.kostenanalyse.keineBerechtigung}>
            {(ich) => <Inhalt firmaId={ich.firma_id} parameter={searchParams} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

// Alle Zahlen kommen aus dem Rechenbaustein; hier wird nur angezeigt.
async function Inhalt({
  firmaId,
  parameter: parameterVersprechen,
}: {
  firmaId: string;
  parameter: PageProps<"/kostenanalyse">["searchParams"];
}) {
  const t = texte.kostenanalyse;
  const parameter = await parameterVersprechen;
  const supabase = await createClient();
  const { zeitraum, ergebnis, namen } = await ladeKostenanalyse(supabase, firmaId, parameter);
  const zeilen = uebersichtsZeilen(ergebnis, namen);
  const auswahl = new URLSearchParams({ von: zeitraum.von, bis: zeitraum.bis });

  return (
    <>
      <p>{t.hinweis}</p>
      <p>
        <Link href="/kostenanalyse/tag">{t.zurTagesansicht}</Link>
      </p>
      <form action="/kostenanalyse">
        <Monatsauswahl
          gewaehlt={zeitraum.ganzesJahr ? null : zeitraum.monate[0]}
          jahr={Number(zeitraum.von.slice(0, 4))}
          aktuellerMonat={monatVon(heuteInBerlin())}
          ganzesJahr={{ gewaehlt: zeitraum.ganzesJahr }}
        />
        <input type="hidden" name="von" defaultValue={zeitraum.von} />
        <input type="hidden" name="bis" defaultValue={zeitraum.bis} />
      </form>
      <h2>{t.ueberschrift(zeitraum.bezeichnung)}</h2>
      <p>{t.heutigePreise}</p>
      {ergebnis.kunden.length === 0 && !ergebnis.fahrtenOhneObjekt ? (
        <p>{t.keine}</p>
      ) : (
        <>
          {ergebnis.summe.vorlaeufig && <p>{t.hinweisVorlaeufig}</p>}
          <table>
            <thead>
              <tr>
                <th>{t.spalteObjekt}</th>
                <th>{t.spalteEinnahmen}</th>
                <th>{t.spalteArbeitsstunden}</th>
                <th>{t.spalteArbeitskosten}</th>
                <th>{t.spalteFahrzeit}</th>
                <th>{t.spalteFahrkosten}</th>
                <th>{t.spalteDeckungsbeitrag}</th>
                <th>{t.spalteDeckungsbeitragProzent}</th>
                <th>{t.spalteHinweis}</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z, i) => (
                <Zeile key={i} zeile={z} auswahl={auswahl} />
              ))}
            </tbody>
          </table>
          <p>
            {/* Ein normaler Link: Die Datei kommt vom Server, nicht als Seite. */}
            <a href={`/kostenanalyse/csv?${auswahl}`} download>
              {t.csvExport}
            </a>
          </p>
        </>
      )}
    </>
  );
}

function Zeile({ zeile, auswahl }: { zeile: UebersichtsZeile; auswahl: URLSearchParams }) {
  const b = zeile.bewertung;
  const istSumme = zeile.objektId === null;
  const details = new URLSearchParams(auswahl);
  if (zeile.objektId) details.set("objekt", zeile.objektId);
  if (zeile.zusatzauftragId) details.set("zusatzauftrag", zeile.zusatzauftragId);
  const Zelle = istSumme ? "th" : "td";

  return (
    <tr>
      <Zelle>
        {istSumme ? (
          zeile.bezeichnung
        ) : (
          <Link href={`/kostenanalyse/details?${details}`}>{zeile.bezeichnung}</Link>
        )}
      </Zelle>
      <Zelle>{euroAlsText(b.einnahmenCent)}</Zelle>
      <Zelle>{stunden(b.arbeitsMinuten)}</Zelle>
      <Zelle>{euro(b.arbeitskostenCent)}</Zelle>
      <Zelle>{stunden(b.fahrtMinuten)}</Zelle>
      <Zelle>{euro(b.fahrkostenCent)}</Zelle>
      <Zelle>{euro(b.deckungsbeitragCent)}</Zelle>
      <Zelle>{prozentAlsText(b.deckungsbeitragAnteil)}</Zelle>
      <Zelle>{zeile.hinweis}</Zelle>
    </tr>
  );
}
