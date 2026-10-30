import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { euroAlsText } from "@/lib/geld";
import { createClient } from "@/lib/supabase/server";
import { ladeTaetigkeitenliste, type Taetigkeit } from "@/lib/taetigkeiten/verwaltung";
import { texte } from "@/texte";
import styles from "../page.module.css";

export default function TaetigkeitenUebersicht() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.taetigkeiten.titel}</h1>
        <Suspense fallback={<p>{texte.taetigkeiten.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.taetigkeiten.keineBerechtigung}>
            {() => <Liste />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Liste() {
  const taetigkeiten = await ladeTaetigkeitenliste(await createClient());
  const aktive = taetigkeiten.filter((t) => !t.archiviert);
  const archivierte = taetigkeiten.filter((t) => t.archiviert);

  return (
    <>
      <p>
        <Link href="/taetigkeiten/neu">{texte.taetigkeiten.neu}</Link>
      </p>
      {aktive.length === 0 ? <p>{texte.taetigkeiten.keine}</p> : <Tabelle taetigkeiten={aktive} />}
      {archivierte.length > 0 && (
        <>
          <h2>{texte.taetigkeiten.archivierteTitel}</h2>
          <Tabelle taetigkeiten={archivierte} />
        </>
      )}
    </>
  );
}

function Tabelle({ taetigkeiten }: { taetigkeiten: Taetigkeit[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{texte.taetigkeiten.spalteName}</th>
          <th>{texte.taetigkeiten.spalteSparte}</th>
          <th>{texte.taetigkeiten.spalteStundensatz}</th>
        </tr>
      </thead>
      <tbody>
        {taetigkeiten.map((t) => (
          <tr key={t.id}>
            <td>
              <Link href={`/taetigkeiten/${t.id}`}>{t.name}</Link>
            </td>
            <td>{texte.sparten[t.sparte]}</td>
            <td>{euroAlsText(t.standard_stundensatz_cent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
