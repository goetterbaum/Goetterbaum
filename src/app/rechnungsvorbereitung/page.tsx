import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { berlinerDatum } from "@/lib/berliner-zeit";
import { ladeKundenliste } from "@/lib/kunden/verwaltung";
import { abrechnungsStand } from "@/lib/rechnungsvorbereitung/abrechnung";
import {
  ladeRechnungsvorbereitungAusAdresse,
  type RechnungsvorbereitungAusAdresse,
} from "@/lib/rechnungsvorbereitung/verwaltung";
import { rechnungsZeilen } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { Abrechnungen } from "./abrechnungen";
import { alsAbgerechnetMarkieren } from "./actions";
import { Positionen } from "./positionen";
import { Stundennachweis } from "./stundennachweis";

// Kunde und erster Monat stehen in der Adresszeile (kunde, monat), damit
// sich eine Auswahl als Link merken lässt und der CSV-Export dieselbe
// Auswahl bekommt.
export default function Rechnungsvorbereitung({
  searchParams,
}: PageProps<"/rechnungsvorbereitung">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.rechnungsvorbereitung.titel}</h1>
        <Suspense fallback={<p>{texte.rechnungsvorbereitung.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.rechnungsvorbereitung.keineBerechtigung}>
            {(ich) => <Inhalt firmaId={ich.firma_id} parameter={searchParams} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

// Alle Beträge kommen aus dem Rechenbaustein; hier wird nur angezeigt.
async function Inhalt({
  firmaId,
  parameter: parameterVersprechen,
}: {
  firmaId: string;
  parameter: PageProps<"/rechnungsvorbereitung">["searchParams"];
}) {
  const t = texte.rechnungsvorbereitung;
  const parameter = await parameterVersprechen;
  const supabase = await createClient();
  const [kunden, geladen] = await Promise.all([
    ladeKundenliste(supabase),
    ladeRechnungsvorbereitungAusAdresse(supabase, firmaId, parameter),
  ]);

  const kundeGewaehlt = typeof parameter.kunde === "string" && parameter.kunde !== "";
  return (
    <>
      <p>{t.hinweis}</p>
      {kunden.length === 0 ? (
        <p>{t.keineKunden}</p>
      ) : (
        <form action="/rechnungsvorbereitung">
          <label>
            {t.kunde}{" "}
            <select name="kunde" defaultValue={geladen?.kunde.id ?? ""} required>
              <option value="">{t.kundeWaehlen}</option>
              {kunden.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.archiviert ? `${k.name} (${texte.stammdaten.archiviert})` : k.name}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            {t.monat}{" "}
            <input type="month" name="monat" defaultValue={geladen?.zeitraum.ersterMonat} />
          </label>{" "}
          <button type="submit">{t.anzeigen}</button>
        </form>
      )}
      {kundeGewaehlt && !geladen && <p>{t.kundeNichtGefunden}</p>}
      {geladen && (
        <>
          <Ergebnis geladen={geladen} />
          <Abrechnungen kundeId={geladen.kunde.id} />
        </>
      )}
    </>
  );
}

function Ergebnis({ geladen }: { geladen: RechnungsvorbereitungAusAdresse }) {
  const t = texte.rechnungsvorbereitung;
  const { kunde, zeitraum, nichtFreigegeben } = geladen;
  const zeilen = rechnungsZeilen(geladen.ergebnis, geladen.namen, zeitraum.monate);
  const auswahl = new URLSearchParams({ kunde: kunde.id, monat: zeitraum.ersterMonat });
  const zurFreigabe = new URLSearchParams({
    kunde: kunde.id,
    von: `${zeitraum.ersterMonat}-01`,
    bis: berlinerDatum(Date.parse(zeitraum.bisVor) - 1),
  });

  return (
    <>
      <h2>{t.ueberschrift(kunde.name, zeitraum.bezeichnung)}</h2>
      <p>{t.rundungsregel(texte.rundungsregeln[geladen.rundungsregel])}</p>
      {nichtFreigegeben > 0 && (
        <p role="alert">
          {t.warnungNichtFreigegeben(nichtFreigegeben)}{" "}
          <Link href={`/freigabe?${zurFreigabe}`}>{t.zurFreigabe}</Link>
        </p>
      )}
      {zeilen.zeilen.length === 0 ? (
        <p>{t.keinePositionen}</p>
      ) : (
        <>
          <Positionen {...zeilen} />
          <p>
            {/* Ein normaler Link: Die Datei kommt vom Server, nicht als Seite. */}
            <a href={`/rechnungsvorbereitung/csv?${auswahl}`} download>
              {t.csvExport}
            </a>
          </p>
          <Stundennachweis
            href={`/rechnungsvorbereitung/stundennachweis?${auswahl}`}
            tage={geladen.ergebnis.stundennachweis}
            namen={geladen.namen}
          />
          <p>{t.hinweisMarkieren}</p>
          <AktionsKnopf
            aktion={alsAbgerechnetMarkieren.bind(
              null,
              kunde.id,
              zeitraum.ersterMonat,
              abrechnungsStand(geladen.ergebnis),
            )}
            knopf={t.alsAbgerechnetMarkieren}
            knopfLaeuft={t.markierenLaeuft}
          />
        </>
      )}
    </>
  );
}
