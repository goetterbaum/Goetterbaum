import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { createClient } from "@/lib/supabase/server";
import { ANGEZEIGTE_TAGE, istUnvollstaendig, spalten, wasUndWo } from "@/lib/zeiterfassung/anzeige";
import { ladeZeiteintraegeDerFirma } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import styles from "../page.module.css";

export default function ZeiteintraegeUebersicht() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.zeiteintraege.titel}</h1>
        <Suspense fallback={<p>{texte.zeiteintraege.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.zeiteintraege.keineBerechtigung}>
            {() => <Liste />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

// Alle Zeiteinträge der Firma, der neueste zuerst. Nachträge und
// freigegebene Einträge sind markiert, und bei jedem steht, wer ihn angelegt hat. Jeder Eintrag führt
// zu seinem Änderungsprotokoll, beendete auch zum Ändern, unvollständige
// zum Nachtragen des Endes.
async function Liste() {
  const t = texte.zeiteintraege;
  const { eintraege, jetzt } = await ladeZeiteintraegeDerFirma(await createClient());

  return (
    <>
      <p>{t.hinweis(ANGEZEIGTE_TAGE)}</p>
      <p>
        <Link href="/unvollstaendige-eintraege">{t.zurPruefliste}</Link>
        {" · "}
        <Link href="/freigabe">{texte.freigabe.titel}</Link>
      </p>
      {eintraege.length === 0 ? (
        <p>{t.keine(ANGEZEIGTE_TAGE)}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.spalteMitarbeiter}</th>
              <th>{t.spalteDatum}</th>
              <th>{t.spalteArbeitszeit}</th>
              <th>{t.spalteDauer}</th>
              <th>{t.spalteWas}</th>
              <th>{t.spalteNachtrag}</th>
              <th>{texte.freigabe.markierung}</th>
              <th>{t.spalteAngelegtVon}</th>
              <th>{t.protokollOeffnen}</th>
              <th>{texte.nachtrag.aendern}</th>
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e) => {
              const unvollstaendig = istUnvollstaendig(e, jetzt);
              const zeit = spalten(e.beginn, e.ende, unvollstaendig ? t.unvollstaendig : t.laeuft);
              return (
                <tr key={e.id}>
                  <td>{e.mitarbeiter_name}</td>
                  <td>{zeit.datum}</td>
                  <td>{zeit.arbeitszeit}</td>
                  <td>{zeit.dauer}</td>
                  <td>{wasUndWo(e)}</td>
                  <td>{e.nachtrag ? texte.nachtrag.markierung : ""}</td>
                  <td>{e.freigegeben_am !== null ? texte.freigabe.markierung : ""}</td>
                  <td>{e.angelegt_von_name ?? texte.protokoll.unbekannt}</td>
                  <td>
                    <Link href={`/zeiteintraege/${e.id}`}>{t.protokollOeffnen}</Link>
                  </td>
                  <td>
                    {e.ende !== null && (
                      <Link href={`/nachtrag/${e.id}`}>{texte.nachtrag.aendern}</Link>
                    )}
                    {unvollstaendig && (
                      <Link href={`/nachtrag/${e.id}`}>{texte.nachtrag.endeNachtragen}</Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
