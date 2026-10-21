import Link from "next/link";
import { Suspense } from "react";
import { AktionsKnopf } from "@/app/aktions-knopf";
import { KnopfMitRueckfrage } from "@/app/knopf-mit-rueckfrage";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { berlinerDatum } from "@/lib/berliner-zeit";
import { euroAlsText } from "@/lib/geld";
import { ladeKundenliste } from "@/lib/kunden/verwaltung";
import { abrechnungsStand } from "@/lib/rechnungsvorbereitung/abrechnung";
import {
  ladeAbrechnungen,
  ladeRechnungsvorbereitungAusAdresse,
  type RechnungsvorbereitungAusAdresse,
} from "@/lib/rechnungsvorbereitung/verwaltung";
import { gewaehlterZeitraum, monatVon } from "@/lib/rechnungsvorbereitung/zeitraum";
import { rechnungsZeilen, stundenAlsText } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { zeitAlsText } from "@/lib/zeiterfassung/protokoll";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { abrechnungZuruecknehmen, alsAbgerechnetMarkieren } from "./actions";

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
      <p>
        <Link href="/">{texte.stammdaten.zurStartseite}</Link>
      </p>
    </>
  );
}

function Ergebnis({ geladen }: { geladen: RechnungsvorbereitungAusAdresse }) {
  const t = texte.rechnungsvorbereitung;
  const { kunde, zeitraum, nichtFreigegeben } = geladen;
  const { zeilen, summeCent } = rechnungsZeilen(geladen.ergebnis, geladen.namen);
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
      {zeilen.length === 0 ? (
        <p>{t.keinePositionen}</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>{t.spaltePosition}</th>
                <th>{t.spalteObjekt}</th>
                <th>{t.spalteZusatzauftrag}</th>
                <th>{t.spalteTaetigkeit}</th>
                <th>{t.spalteMonat}</th>
                <th>{t.spalteStunden}</th>
                <th>{t.spalteStundensatz}</th>
                <th>{t.spalteBetrag}</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z, i) => (
                <tr key={i}>
                  <td>{z.position}</td>
                  <td>{z.objekt}</td>
                  <td>{z.zusatzauftrag}</td>
                  <td>{z.taetigkeit}</td>
                  <td>{z.monat}</td>
                  <td>{z.minuten === null ? "" : t.stunden(stundenAlsText(z.minuten))}</td>
                  <td>{z.stundensatzCent === null ? "" : euroAlsText(z.stundensatzCent)}</td>
                  <td>{euroAlsText(z.betragCent)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={7}>{t.summe}</th>
                <td>{euroAlsText(summeCent)}</td>
              </tr>
            </tfoot>
          </table>
          <p>
            {/* Ein normaler Link: Die Datei kommt vom Server, nicht als Seite. */}
            <a href={`/rechnungsvorbereitung/csv?${auswahl}`} download>
              {t.csvExport}
            </a>
          </p>
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

// Die bisherigen Abrechnungen des Kunden; gültige lassen sich nach einer
// Rückfrage zurücknehmen.
async function Abrechnungen({ kundeId }: { kundeId: string }) {
  const t = texte.rechnungsvorbereitung;
  const abrechnungen = await ladeAbrechnungen(await createClient(), kundeId);
  return (
    <>
      <h2>{t.bisherigeAbrechnungen}</h2>
      {abrechnungen.length === 0 ? (
        <p>{t.keineAbrechnungen}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteZeitraum}</th>
              <th>{t.spalteBetrag}</th>
              <th>{t.spalteAbgerechnet}</th>
              <th>{t.spalteStatus}</th>
            </tr>
          </thead>
          <tbody>
            {abrechnungen.map((a) => (
              <tr key={a.id}>
                <td>
                  {
                    gewaehlterZeitraum(monatVon(a.erster_monat), a.abrechnungszeitraum, 0)
                      .bezeichnung
                  }
                </td>
                <td>{euroAlsText(a.summe_cent)}</td>
                <td>{t.amVon(zeitAlsText(a.abgerechnet_am), a.abgerechnet_von_name)}</td>
                <td>
                  {a.zurueckgenommen_am !== null ? (
                    t.zurueckgenommenAmVon(
                      zeitAlsText(a.zurueckgenommen_am),
                      a.zurueckgenommen_von_name ?? texte.protokoll.unbekannt,
                    )
                  ) : (
                    <>
                      {t.gueltig}
                      <KnopfMitRueckfrage
                        aktion={abrechnungZuruecknehmen.bind(null, a.id)}
                        knopf={t.zuruecknehmen}
                        rueckfrage={t.rueckfrage}
                        bestaetigen={t.jaZuruecknehmen}
                        abbrechen={t.abbrechen}
                        knopfLaeuft={t.zuruecknehmenLaeuft}
                      />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
