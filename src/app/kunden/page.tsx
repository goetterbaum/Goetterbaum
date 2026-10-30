import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { ladeKundenliste, type Kunde } from "@/lib/kunden/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../page.module.css";

export default function KundenUebersicht() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.kunden.titel}</h1>
        <Suspense fallback={<p>{texte.kunden.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.stammdaten.keineBerechtigung}>
            {() => <Liste />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Liste() {
  const kunden = await ladeKundenliste(await createClient());
  const aktive = kunden.filter((k) => !k.archiviert);
  const archivierte = kunden.filter((k) => k.archiviert);

  return (
    <>
      <p>
        <Link href="/kunden/neu">{texte.kunden.neu}</Link>
        {" · "}
        <Link href="/objekte">{texte.objekte.titel}</Link>
      </p>
      {aktive.length === 0 ? <p>{texte.kunden.keine}</p> : <Tabelle kunden={aktive} />}
      {archivierte.length > 0 && (
        <>
          <h2>{texte.kunden.archivierteTitel}</h2>
          <Tabelle kunden={archivierte} />
        </>
      )}
    </>
  );
}

function Tabelle({ kunden }: { kunden: Kunde[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{texte.kunden.spalteName}</th>
          <th>{texte.kunden.spalteOrt}</th>
          <th>{texte.kunden.spalteAbrechnungszeitraum}</th>
        </tr>
      </thead>
      <tbody>
        {kunden.map((k) => (
          <tr key={k.id}>
            <td>
              <Link href={`/kunden/${k.id}`}>{k.name}</Link>
            </td>
            <td>{k.ort}</td>
            <td>{texte.abrechnungszeitraeume[k.abrechnungszeitraum]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
