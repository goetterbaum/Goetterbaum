import Link from "next/link";
import { Fragment, Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { berlinerUhrzeit, datumAlsText, tagVerschoben } from "@/lib/berliner-zeit";
import { euroAlsText } from "@/lib/geld";
import type { Bewertung, Tagesansicht } from "@/lib/kostenanalyse";
import { ladeTagesansicht, type Namen } from "@/lib/kostenanalyse/verwaltung";
import {
  euroOderLeer as euro,
  hinweis,
  name,
  stundenFuerSeite as stunden,
} from "@/lib/kostenanalyse/zeilen";
import { monatDerKosten } from "@/lib/kostenanalyse/zeitraum";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../../page.module.css";

// Der Tag steht in der Adresszeile (datum), damit ‹ › und die Details der
// Objektübersicht auf genau diesen Tag verlinken können.
export default function Tag({ searchParams }: PageProps<"/kostenanalyse/tag">) {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.kostenanalyse.tagTitel}</h1>
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
  parameter: PageProps<"/kostenanalyse/tag">["searchParams"];
}) {
  const t = texte.kostenanalyse;
  const parameter = await parameterVersprechen;
  const supabase = await createClient();
  const { datum, ergebnis, namen } = await ladeTagesansicht(supabase, firmaId, parameter);
  const monat = monatDerKosten(datum);
  const zumTag = (tage: number) =>
    `/kostenanalyse/tag?${new URLSearchParams({ datum: tagVerschoben(datum, tage) })}`;

  return (
    <>
      <p>
        <Link href={`/kostenanalyse?${new URLSearchParams({ von: monat.von, bis: monat.bis })}`}>
          {t.zurueck}
        </Link>
      </p>
      <p>{t.tagHinweis}</p>
      <form action="/kostenanalyse/tag">
        <Link href={zumTag(-1)} aria-label={t.vortag}>
          {t.pfeilVortag}
        </Link>{" "}
        <label>
          {t.tag} <input type="date" name="datum" defaultValue={datum} required />
        </label>{" "}
        <button type="submit">{t.anzeigen}</button>{" "}
        <Link href={zumTag(1)} aria-label={t.folgetag}>
          {t.pfeilFolgetag}
        </Link>
      </form>
      <h2>{t.tagUeberschrift(datumAlsText(datum))}</h2>
      <p>{t.heutigePreise}</p>
      {ergebnis.mitarbeiter.length === 0 ? (
        <p>{t.keineArbeitstage}</p>
      ) : (
        <>
          {ergebnis.summe.vorlaeufig && <p>{t.hinweisVorlaeufig}</p>}
          <table>
            <thead>
              <tr>
                <th>{t.spalteObjekt}</th>
                <th>{t.spalteArbeitszeit}</th>
                <th>{t.spalteFahrzeitAnteil}</th>
                <th>{t.spalteEinnahme}</th>
                <th>{t.spalteKosten}</th>
                <th>{t.spalteDeckungsbeitrag}</th>
                <th>{t.spalteHinweis}</th>
              </tr>
            </thead>
            <tbody>
              {ergebnis.mitarbeiter.map((m) => (
                <Mitarbeiter key={m.mitarbeiterId} mitarbeiter={m} namen={namen} />
              ))}
            </tbody>
            <tfoot>
              <Zeile bezeichnung={t.summeDesTags} bewertung={ergebnis.summe} namen={namen} summe />
            </tfoot>
          </table>
        </>
      )}
    </>
  );
}

function Mitarbeiter({
  mitarbeiter: m,
  namen,
}: {
  mitarbeiter: Tagesansicht["mitarbeiter"][number];
  namen: Namen;
}) {
  const t = texte.kostenanalyse;
  const mitarbeiter = name(namen.mitarbeiter, m.mitarbeiterId);
  // Alle Arbeitstage eines Kalendertags haben denselben Wert.
  const herkunft = m.arbeitstage
    .flatMap((a) => a.zeilen.flatMap((z) => z.eintraege))
    .find((e) => e.herkunft)?.herkunft;
  const uhrzeit = (zeitpunkt: string) => berlinerUhrzeit(Date.parse(zeitpunkt));
  return (
    <>
      <tr>
        <th colSpan={7}>
          {herkunft ? t.mitHerkunft(mitarbeiter, t.herkunft[herkunft]) : mitarbeiter}
        </th>
      </tr>
      {m.arbeitstage.map((a) => (
        <Fragment key={a.beginn}>
          <tr>
            <td colSpan={7}>{t.arbeitstag(t.vonBis(uhrzeit(a.beginn), uhrzeit(a.ende)))}</td>
          </tr>
          {a.zeilen.map((z) => (
            <Zeile
              key={`${z.objektId}|${z.zusatzauftragId ?? ""}`}
              bezeichnung={
                z.zusatzauftragId
                  ? `${name(namen.objekte, z.objektId)} ${t.zusatzauftrag(name(namen.zusatzauftraege, z.zusatzauftragId))}`
                  : name(namen.objekte, z.objektId)
              }
              bewertung={z}
              namen={namen}
            />
          ))}
          {a.fahrtenOhneObjekt && (
            <Zeile
              bezeichnung={t.fahrtenOhneObjekt}
              bewertung={a.fahrtenOhneObjekt}
              namen={namen}
            />
          )}
        </Fragment>
      ))}
      <Zeile
        bezeichnung={t.tagessummeMitarbeiter(mitarbeiter)}
        bewertung={m.summe}
        namen={namen}
        summe
      />
    </>
  );
}

function Zeile({
  bezeichnung,
  bewertung: b,
  namen,
  summe = false,
}: {
  bezeichnung: string;
  bewertung: Bewertung;
  namen: Namen;
  summe?: boolean;
}) {
  const Zelle = summe ? "th" : "td";
  return (
    <tr>
      <Zelle>{bezeichnung}</Zelle>
      <Zelle>{stunden(b.arbeitsMinuten)}</Zelle>
      <Zelle>{stunden(b.fahrtMinuten)}</Zelle>
      <Zelle>{euroAlsText(b.einnahmenCent)}</Zelle>
      <Zelle>{euro(b.kostenCent)}</Zelle>
      <Zelle>{euro(b.deckungsbeitragCent)}</Zelle>
      <Zelle>{hinweis(b, namen)}</Zelle>
    </tr>
  );
}
