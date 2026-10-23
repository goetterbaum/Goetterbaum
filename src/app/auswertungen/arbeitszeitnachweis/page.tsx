import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import type { NachweisZeile } from "@/lib/auswertungen/arbeitszeitnachweis";
import {
  ladeArbeitszeitnachweis,
  ladeMitarbeiterZurAuswahl,
  zeitraumAusAdresse,
  type GeladenerArbeitszeitnachweis,
} from "@/lib/auswertungen/verwaltung";
import { datumAlsText } from "@/lib/berliner-zeit";
import { stundenAlsText } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { artAlsText } from "@/lib/zeiterfassung/anzeige";
import { texte } from "@/texte";
import styles from "../../page.module.css";

// Mitarbeiter und Zeitraum stehen in der Adresszeile (mitarbeiter, von,
// bis), damit sich eine Auswahl als Link merken lässt und der CSV-Export
// dieselbe Auswahl bekommt.
export default function Arbeitszeitnachweis({
  searchParams,
}: PageProps<"/auswertungen/arbeitszeitnachweis">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.arbeitszeitnachweis.titel}</h1>
        <Suspense fallback={<p>{texte.arbeitszeitnachweis.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.arbeitszeitnachweis.keineBerechtigung}>
            {() => <Inhalt parameter={searchParams} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Inhalt({
  parameter: parameterVersprechen,
}: {
  parameter: PageProps<"/auswertungen/arbeitszeitnachweis">["searchParams"];
}) {
  const t = texte.arbeitszeitnachweis;
  const parameter = await parameterVersprechen;
  const supabase = await createClient();
  const [mitarbeiter, geladen] = await Promise.all([
    ladeMitarbeiterZurAuswahl(supabase),
    ladeArbeitszeitnachweis(supabase, parameter),
  ]);
  const zeitraum = geladen?.zeitraum ?? zeitraumAusAdresse(parameter);
  const gewaehlt = typeof parameter.mitarbeiter === "string" && parameter.mitarbeiter !== "";

  return (
    <>
      <p>{t.hinweis}</p>
      <form action="/auswertungen/arbeitszeitnachweis">
        <label>
          {t.mitarbeiter}{" "}
          <select name="mitarbeiter" defaultValue={geladen?.mitarbeiter.id ?? ""} required>
            <option value="">{t.mitarbeiterWaehlen}</option>
            {mitarbeiter.map((m) => (
              <option key={m.id} value={m.id}>
                {m.aktiv ? m.name : t.deaktiviert(m.name)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          {t.von} <input type="date" name="von" defaultValue={zeitraum.von} required />
        </label>{" "}
        <label>
          {t.bis} <input type="date" name="bis" defaultValue={zeitraum.bis} required />
        </label>{" "}
        <button type="submit">{t.anzeigen}</button>
      </form>
      {gewaehlt && !geladen && <p>{t.mitarbeiterNichtGefunden}</p>}
      {geladen && <Nachweis geladen={geladen} />}
      <p>
        <Link href="/">{texte.stammdaten.zurStartseite}</Link>
      </p>
    </>
  );
}

function Nachweis({ geladen }: { geladen: GeladenerArbeitszeitnachweis }) {
  const t = texte.arbeitszeitnachweis;
  const { mitarbeiter, zeitraum, nachweis, laufend } = geladen;
  const name = mitarbeiter.aktiv ? mitarbeiter.name : t.deaktiviert(mitarbeiter.name);
  const auswahl = new URLSearchParams({
    mitarbeiter: mitarbeiter.id,
    von: zeitraum.von,
    bis: zeitraum.bis,
  });

  return (
    <>
      <h2>{t.ueberschrift(name, datumAlsText(zeitraum.von), datumAlsText(zeitraum.bis))}</h2>
      {laufend > 0 && <p role="alert">{t.warnungLaufend(laufend)}</p>}
      {nachweis.tage.length === 0 ? (
        <p>{t.keine}</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>{t.spalteDatum}</th>
                <th>{t.spalteVon}</th>
                <th>{t.spalteBis}</th>
                <th>{t.spalteArt}</th>
                <th>{t.spalteObjekt}</th>
                <th>{t.spalteTaetigkeit}</th>
                <th>{t.spalteZusatzauftrag}</th>
                <th>{t.spalteNachtrag}</th>
                <th>{t.spalteStunden}</th>
              </tr>
            </thead>
            <tbody>
              {nachweis.tage.flatMap((tag) => [
                ...tag.zeilen.map((z, i) => (
                  <Zeile key={`${tag.datum}-${i}`} datum={tag.datum} zeile={z} />
                )),
                <tr key={`${tag.datum}-summe`}>
                  <th colSpan={8}>
                    {t.tagessumme} {datumAlsText(tag.datum)}
                  </th>
                  <th>{t.stunden(stundenAlsText(tag.minuten))}</th>
                </tr>,
              ])}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={8}>{t.summe}</th>
                <td>{t.stunden(stundenAlsText(nachweis.minuten))}</td>
              </tr>
            </tfoot>
          </table>
          <p>
            {/* Ein normaler Link: Die Datei kommt vom Server, nicht als Seite. */}
            <a href={`/auswertungen/arbeitszeitnachweis/csv?${auswahl}`} download>
              {t.csvExport}
            </a>
          </p>
        </>
      )}
    </>
  );
}

function Zeile({ datum, zeile }: { datum: string; zeile: NachweisZeile }) {
  const t = texte.arbeitszeitnachweis;
  return (
    <tr>
      <td>{datumAlsText(datum)}</td>
      <td>{zeile.von}</td>
      <td>{zeile.bis}</td>
      <td>{artAlsText(zeile.art)}</td>
      <td>{zeile.objekt ?? ""}</td>
      <td>{zeile.taetigkeit ?? ""}</td>
      <td>{zeile.zusatzauftrag ?? ""}</td>
      <td>{zeile.nachtrag ? texte.nachtrag.markierung : ""}</td>
      <td>{t.stunden(stundenAlsText(zeile.minuten))}</td>
    </tr>
  );
}
