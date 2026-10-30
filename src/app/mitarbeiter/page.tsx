import Link from "next/link";
import { Suspense } from "react";
import { zugangsStatus } from "@/lib/mitarbeiter/regeln";
import { ladeMitarbeiterliste } from "@/lib/mitarbeiter/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { NurFuerBuero } from "@/app/nur-fuer-buero";

export default function MitarbeiterUebersicht() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.mitarbeiter.titel}</h1>
        <Suspense fallback={<p>{texte.mitarbeiter.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.mitarbeiter.keineBerechtigung}>
            {() => <Liste />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Liste() {
  const mitarbeiter = await ladeMitarbeiterliste(await createClient());

  return (
    <>
      <p>
        <Link href="/mitarbeiter/neu">{texte.mitarbeiter.neu}</Link>
      </p>
      {mitarbeiter.length === 0 ? (
        <p>{texte.mitarbeiter.keine}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{texte.mitarbeiter.spalteName}</th>
              <th>{texte.mitarbeiter.spalteEmail}</th>
              <th>{texte.mitarbeiter.spalteRolle}</th>
              <th>{texte.mitarbeiter.spalteZugang}</th>
            </tr>
          </thead>
          <tbody>
            {mitarbeiter.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/mitarbeiter/${m.id}`}>{m.name}</Link>
                </td>
                <td>{m.email}</td>
                <td>{texte.rollen[m.rolle]}</td>
                <td>{zugangsStatus(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
