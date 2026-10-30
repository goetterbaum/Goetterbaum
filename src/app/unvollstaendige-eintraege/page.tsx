import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { createClient } from "@/lib/supabase/server";
import { laeuftSeit, UNVOLLSTAENDIG_NACH_STUNDEN, wasUndWo } from "@/lib/zeiterfassung/anzeige";
import { ladeUnvollstaendigeEintraege } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import styles from "../page.module.css";

export default function Pruefliste() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.pruefliste.titel}</h1>
        <Suspense fallback={<p>{texte.pruefliste.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.pruefliste.keineBerechtigung}>
            {() => <Liste />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

// Alle unvollständigen Zeiteinträge der Firma, der älteste zuerst. Jeder
// führt zum Nachtragen des Endes und zu seinem Änderungsprotokoll.
async function Liste() {
  const t = texte.pruefliste;
  const { eintraege, jetzt } = await ladeUnvollstaendigeEintraege(await createClient());

  return (
    <>
      <p>{t.hinweis(UNVOLLSTAENDIG_NACH_STUNDEN)}</p>
      {eintraege.length === 0 ? (
        <p>{t.keine}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{texte.zeiteintraege.spalteMitarbeiter}</th>
              <th>{t.spalteSeit}</th>
              <th>{texte.zeiteintraege.spalteWas}</th>
              <th>{texte.zeiteintraege.spalteAngelegtVon}</th>
              <th>{texte.nachtrag.endeNachtragen}</th>
              <th>{texte.zeiteintraege.protokollOeffnen}</th>
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e) => (
              <tr key={e.id}>
                <td>{e.mitarbeiter_name}</td>
                <td>{laeuftSeit(e.beginn, jetzt)}</td>
                <td>{wasUndWo(e)}</td>
                <td>{e.angelegt_von_name ?? texte.protokoll.unbekannt}</td>
                <td>
                  <Link href={`/nachtrag/${e.id}?aus=pruefliste`}>
                    {texte.nachtrag.endeNachtragen}
                  </Link>
                </td>
                <td>
                  <Link href={`/zeiteintraege/${e.id}`}>
                    {texte.zeiteintraege.protokollOeffnen}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        <Link href="/zeiteintraege">{texte.zeiteintraege.zurUebersicht}</Link>
      </p>
    </>
  );
}
