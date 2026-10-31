import Link from "next/link";
import { Suspense } from "react";
import { Monatsauswahl } from "@/app/monatsauswahl";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { berlinerDatum } from "@/lib/berliner-zeit";
import { monatVon } from "@/lib/rechnungsvorbereitung/zeitraum";
import { createClient } from "@/lib/supabase/server";
import { istUnvollstaendig, tagUndZeit, wasUndWo } from "@/lib/zeiterfassung/anzeige";
import type { FreigabeFilter } from "@/lib/zeiterfassung/freigabe";
import { zeitAlsText } from "@/lib/zeiterfassung/protokoll";
import {
  ladeEintraegeZurFreigabe,
  ladeFreigabeFilterAuswahl,
  type ZeiteintragDerFirma,
} from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { FreigabeFormular, type FreigabeZeile } from "./freigabe-formular";

// Zeitraum und Filter stehen in der Adresszeile (von, bis, mitarbeiter,
// kunde, objekt, freigegebene), damit sich eine Auswahl als Link merken lässt.
export default function Freigabe({ searchParams }: PageProps<"/freigabe">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.freigabe.titel}</h1>
        <Suspense fallback={<p>{texte.freigabe.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.freigabe.keineBerechtigung}>
            {() => <Liste parameter={searchParams} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

// Die noch nicht freigegebenen Zeiteinträge im Zeitraum, nach Mitarbeiter
// und Beginn, oder auf Wunsch die schon freigegebenen. Nachträge sind
// markiert. Jeder führt zu seinem Änderungsprotokoll, wo sich eine
// Freigabe auch zurücknehmen lässt.
async function Liste({ parameter }: { parameter: PageProps<"/freigabe">["searchParams"] }) {
  const t = texte.freigabe;
  const supabase = await createClient();
  const [{ filter, eintraege, jetzt }, auswahl] = await Promise.all([
    ladeEintraegeZurFreigabe(supabase, await parameter),
    ladeFreigabeFilterAuswahl(supabase),
  ]);

  const zeilen: FreigabeZeile[] = eintraege.map((e) => {
    const unvollstaendig = istUnvollstaendig(e, jetzt);
    return {
      id: e.id,
      mitarbeiter: e.mitarbeiter_name,
      zeit: tagUndZeit(
        e.beginn,
        e.ende,
        unvollstaendig ? texte.zeiteintraege.unvollstaendig : texte.zeiteintraege.laeuft,
      ),
      was: wasUndWo(e),
      kunde: e.kunde_name ?? "",
      nachtrag: e.nachtrag,
      angelegtVon: e.angelegt_von_name ?? texte.protokoll.unbekannt,
      freigebbar: e.ende !== null,
    };
  });

  return (
    <>
      <p>{filter.freigegebene ? t.hinweisFreigegebene : t.hinweis}</p>
      <FilterFormular
        filter={filter}
        auswahl={auswahl}
        aktuellerMonat={monatVon(berlinerDatum(jetzt))}
      />
      <p>
        <Link href={zurRechnungsvorbereitung(filter)}>{t.zurRechnungsvorbereitung}</Link>
      </p>
      {filter.freigegebene ? (
        <Freigegebene eintraege={eintraege} />
      ) : zeilen.length === 0 ? (
        <p>{t.keine}</p>
      ) : (
        <FreigabeFormular zeilen={zeilen} />
      )}
      <p>
        <Link href="/zeiteintraege">{texte.zeiteintraege.zurUebersicht}</Link>
      </p>
    </>
  );
}

// Der nächste Arbeitsschritt nach dem Freigeben: die Rechnungsvorbereitung
// mit dem gewählten Kunden (falls einer gewählt ist) und dem Monat des
// Von-Datums.
function zurRechnungsvorbereitung(filter: FreigabeFilter): string {
  const auswahl = new URLSearchParams(filter.kunde ? { kunde: filter.kunde } : {});
  auswahl.set("monat", monatVon(filter.von));
  return `/rechnungsvorbereitung?${auswahl}`;
}

// Die schon freigegebenen Einträge mit wann und von wem. Zurückgenommen
// wird eine Freigabe im Änderungsprotokoll des Eintrags.
function Freigegebene({ eintraege }: { eintraege: ZeiteintragDerFirma[] }) {
  const t = texte.freigabe;
  if (eintraege.length === 0) return <p>{t.keineFreigegebenen}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{texte.zeiteintraege.spalteMitarbeiter}</th>
          <th>{texte.zeiteintraege.spalteZeit}</th>
          <th>{texte.zeiteintraege.spalteWas}</th>
          <th>{t.kunde}</th>
          <th>{texte.zeiteintraege.spalteNachtrag}</th>
          <th>{t.markierung}</th>
          <th>{texte.zeiteintraege.protokollOeffnen}</th>
        </tr>
      </thead>
      <tbody>
        {eintraege.map((e) => (
          <tr key={e.id}>
            <td>{e.mitarbeiter_name}</td>
            <td>{tagUndZeit(e.beginn, e.ende, texte.zeiteintraege.laeuft)}</td>
            <td>{wasUndWo(e)}</td>
            <td>{e.kunde_name ?? ""}</td>
            <td>{e.nachtrag ? texte.nachtrag.markierung : ""}</td>
            <td>
              {t.freigegebenAmVon(
                zeitAlsText(e.freigegeben_am),
                e.freigegeben_von_name ?? texte.protokoll.unbekannt,
              )}
            </td>
            <td>
              <Link href={`/zeiteintraege/${e.id}`}>{texte.zeiteintraege.protokollOeffnen}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Ein einfaches Formular, das die Seite mit neuen Angaben in der
// Adresszeile aufruft.
function FilterFormular({
  filter,
  auswahl,
  aktuellerMonat,
}: {
  filter: FreigabeFilter;
  auswahl: Awaited<ReturnType<typeof ladeFreigabeFilterAuswahl>>;
  aktuellerMonat: string;
}) {
  const t = texte.freigabe;
  return (
    <form action="/freigabe">
      {/* Ein Monat zeigt sofort an, mit den übrigen Filtern im Formular. */}
      <Monatsauswahl
        gewaehlt={filter.monat}
        jahr={Number(filter.von.slice(0, 4))}
        aktuellerMonat={aktuellerMonat}
      />
      <label>
        {t.von} <input type="date" name="von" defaultValue={filter.von} required />
      </label>{" "}
      <label>
        {t.bis} <input type="date" name="bis" defaultValue={filter.bis} required />
      </label>{" "}
      <label>
        {t.mitarbeiter}{" "}
        <select name="mitarbeiter" defaultValue={filter.mitarbeiter ?? ""}>
          <option value="">{t.alle}</option>
          {auswahl.mitarbeiter.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        {t.kunde}{" "}
        <select name="kunde" defaultValue={filter.kunde ?? ""}>
          <option value="">{t.alle}</option>
          {auswahl.kunden.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        {t.objekt}{" "}
        <select name="objekt" defaultValue={filter.objekt ?? ""}>
          <option value="">{t.alle}</option>
          {auswahl.objekte.map((o) => (
            <option key={o.id} value={o.id}>
              {o.bezeichnung}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        <input
          type="checkbox"
          name="freigegebene"
          value="ja"
          defaultChecked={filter.freigegebene}
        />{" "}
        {t.freigegebeneZeigen}
      </label>{" "}
      <button type="submit">{t.anzeigen}</button>
    </form>
  );
}
