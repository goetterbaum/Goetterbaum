import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import {
  ladeIstZeit,
  ladePauschalObjekte,
  zeitraumAusAdresse,
  type GeladeneIstZeit,
} from "@/lib/auswertungen/verwaltung";
import { datumAlsText } from "@/lib/berliner-zeit";
import { euroAlsText } from "@/lib/geld";
import { stundenAlsText } from "@/lib/rechnungsvorbereitung/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../../page.module.css";

// Objekt und Zeitraum stehen in der Adresszeile (objekt, von, bis), damit
// sich eine Auswahl als Link merken lässt.
export default function IstZeit({ searchParams }: PageProps<"/auswertungen/ist-zeit">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.istZeit.titel}</h1>
        <Suspense fallback={<p>{texte.istZeit.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.istZeit.keineBerechtigung}>
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
  parameter: PageProps<"/auswertungen/ist-zeit">["searchParams"];
}) {
  const t = texte.istZeit;
  const parameter = await parameterVersprechen;
  const supabase = await createClient();
  const [objekte, geladen] = await Promise.all([
    ladePauschalObjekte(supabase),
    ladeIstZeit(supabase, parameter),
  ]);
  const zeitraum = geladen?.zeitraum ?? zeitraumAusAdresse(parameter);
  const gewaehlt = typeof parameter.objekt === "string" && parameter.objekt !== "";

  return (
    <>
      <p>{t.hinweis}</p>
      {objekte.length === 0 ? (
        <p>{t.keineObjekte}</p>
      ) : (
        <form action="/auswertungen/ist-zeit">
          <label>
            {t.objekt}{" "}
            <select name="objekt" defaultValue={geladen?.objekt.id ?? ""} required>
              <option value="">{t.objektWaehlen}</option>
              {objekte.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.archiviert ? t.archiviert(o.bezeichnung) : o.bezeichnung}
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
      )}
      {gewaehlt && !geladen && <p>{t.objektNichtGefunden}</p>}
      {geladen && <Ergebnis geladen={geladen} />}
      <p>
        <Link href="/">{texte.stammdaten.zurStartseite}</Link>
      </p>
    </>
  );
}

function Ergebnis({ geladen }: { geladen: GeladeneIstZeit }) {
  const t = texte.istZeit;
  const { objekt, zeitraum, istZeit, laufend } = geladen;
  const zeilen = [...istZeit.jeTaetigkeit].sort((a, b) =>
    a.taetigkeit.localeCompare(b.taetigkeit, "de"),
  );
  const stunden = (minuten: number) => t.stunden(stundenAlsText(minuten));

  return (
    <>
      <h2>
        {t.ueberschrift(objekt.bezeichnung, datumAlsText(zeitraum.von), datumAlsText(zeitraum.bis))}
      </h2>
      <p>{t.kundeUndPauschale(objekt.kunde.name, euroAlsText(objekt.pauschale_cent))}</p>
      {laufend > 0 && <p role="alert">{t.warnungLaufend(laufend)}</p>}
      {zeilen.length === 0 ? (
        <p>{t.keine}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteTaetigkeit}</th>
              <th>{t.spalteStunden}</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.taetigkeit}>
                <td>{z.taetigkeit}</td>
                <td>{stunden(z.minuten)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>{t.summe}</th>
              <td>{stunden(istZeit.minuten)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {istZeit.zusatzauftraegeMinuten > 0 && (
        <p>{t.zusatzauftraege(stundenAlsText(istZeit.zusatzauftraegeMinuten))}</p>
      )}
    </>
  );
}
