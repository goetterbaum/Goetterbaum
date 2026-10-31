import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { berlinerUhrzeit, datumAlsText } from "@/lib/berliner-zeit";
import { euroAlsText } from "@/lib/geld";
import type { Bewertung, BewerteterEintrag, Kostenanalyse, Zeile } from "@/lib/kostenanalyse";
import { ladeKostenanalyse, type Namen } from "@/lib/kostenanalyse/verwaltung";
import {
  euroOderLeer as euro,
  hinweis,
  name,
  stundenFuerSeite as stunden,
} from "@/lib/kostenanalyse/zeilen";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../../page.module.css";

// Zeitraum, Objekt und Zusatzauftrag stehen in der Adresszeile (von, bis,
// objekt, zusatzauftrag), wie sie die Objektübersicht verlinkt.
export default function Details({ searchParams }: PageProps<"/kostenanalyse/details">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.kostenanalyse.detailsTitel}</h1>
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
  parameter: PageProps<"/kostenanalyse/details">["searchParams"];
}) {
  const t = texte.kostenanalyse;
  const parameter = await parameterVersprechen;
  const supabase = await createClient();
  const { zeitraum, ergebnis, namen } = await ladeKostenanalyse(supabase, firmaId, parameter);
  const text = (wert: unknown) => (typeof wert === "string" ? wert : "");
  const zeile = gesuchteZeile(ergebnis, text(parameter.objekt), text(parameter.zusatzauftrag));
  const zurueck = (
    <p>
      <Link
        href={`/kostenanalyse?${new URLSearchParams({ von: zeitraum.von, bis: zeitraum.bis })}`}
      >
        {t.zurueck}
      </Link>
    </p>
  );
  if (!zeile) {
    return (
      <>
        <p>{t.zeileNichtGefunden}</p>
        {zurueck}
      </>
    );
  }

  const bezeichnung = zeile.zusatzauftragId
    ? `${name(namen.objekte, zeile.objektId)} ${t.zusatzauftrag(name(namen.zusatzauftraege, zeile.zusatzauftragId))}`
    : name(namen.objekte, zeile.objektId);

  return (
    <>
      {zurueck}
      <h2>{t.detailsUeberschrift(bezeichnung, zeitraum.bezeichnung)}</h2>
      <p>{t.heutigePreise}</p>
      {zeile.eintraege.length === 0 ? (
        <p>{t.keineEintraege}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteDatum}</th>
              <th>{t.spalteMitarbeiter}</th>
              <th>{t.spalteVonBis}</th>
              <th>{t.spalteDauer}</th>
              <th>{t.spalteFahrzeitAnteil}</th>
              <th>{t.spalteKosten}</th>
              <th>{t.spalteEinnahme}</th>
              <th>{t.spalteHinweis}</th>
            </tr>
          </thead>
          <tbody>
            {zeile.tage.flatMap((tag) => [
              ...tag.eintraege.map((e) => (
                <EintragsZeile key={e.zeiteintragId} eintrag={e} namen={namen} />
              )),
              <tr key={`${tag.datum}-summe`}>
                <th colSpan={3}>{t.tagessumme(datumAlsText(tag.datum))}</th>
                <Summe summe={tag.summe} />
                <th>{hinweis(tag.summe, namen)}</th>
              </tr>,
            ])}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>{t.summe}</th>
              <Summe summe={zeile} />
              <th>{hinweis(zeile, namen)}</th>
            </tr>
          </tfoot>
        </table>
      )}
      {zeile.einnahmenOhneZeiteintragCent > 0 && (
        <p>{t.ohneZeiteintrag(euroAlsText(zeile.einnahmenOhneZeiteintragCent))}</p>
      )}
    </>
  );
}

function gesuchteZeile(
  ergebnis: Kostenanalyse,
  objektId: string,
  zusatzauftragId: string,
): Zeile | undefined {
  return ergebnis.kunden
    .flatMap((k) => k.objekte.flatMap((o) => [o.zeile, ...o.zusatzauftraege]))
    .find((z) => z.objektId === objektId && (z.zusatzauftragId ?? "") === zusatzauftragId);
}

function EintragsZeile({ eintrag: e, namen }: { eintrag: BewerteterEintrag; namen: Namen }) {
  const t = texte.kostenanalyse;
  const mitarbeiter = name(namen.mitarbeiter, e.mitarbeiterId);
  const fehlt = e.kostenCent === null;
  return (
    <tr>
      <td>{datumAlsText(e.datum)}</td>
      <td>{e.herkunft ? t.mitHerkunft(mitarbeiter, t.herkunft[e.herkunft]) : mitarbeiter}</td>
      <td>
        {t.vonBis(berlinerUhrzeit(Date.parse(e.beginn)), berlinerUhrzeit(Date.parse(e.ende)))}
      </td>
      <td>{stunden(e.arbeitsMinuten)}</td>
      <td>{stunden(e.fahrtMinuten)}</td>
      <td>{euro(e.kostenCent)}</td>
      <td>{euroAlsText(e.einnahmeCent)}</td>
      <td>
        {[e.vorlaeufig ? t.vorlaeufig : "", fehlt ? t.kostenFehlen(mitarbeiter) : ""]
          .filter(Boolean)
          .join(" · ")}
      </td>
    </tr>
  );
}

function Summe({ summe }: { summe: Bewertung }) {
  return (
    <>
      <th>{stunden(summe.arbeitsMinuten)}</th>
      <th>{stunden(summe.fahrtMinuten)}</th>
      <th>{euro(summe.kostenCent)}</th>
      <th>{euroAlsText(summe.einnahmenCent)}</th>
    </>
  );
}
