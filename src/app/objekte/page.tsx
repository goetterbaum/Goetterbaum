import Link from "next/link";
import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { ladeObjektliste } from "@/lib/objekte/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { ObjektTabelle } from "./objekt-tabelle";

export default function ObjekteUebersicht() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.objekte.titel}</h1>
        <Suspense fallback={<p>{texte.objekte.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.stammdaten.keineBerechtigung}>
            {() => <Liste />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Liste() {
  const objekte = await ladeObjektliste(await createClient());
  const aktive = objekte.filter((o) => !o.archiviert);
  const archivierte = objekte.filter((o) => o.archiviert);

  return (
    <>
      <p>
        <Link href="/objekte/neu">{texte.objekte.neu}</Link>
        {" · "}
        <Link href="/kunden">{texte.kunden.titel}</Link>
      </p>
      {aktive.length === 0 ? (
        <p>{texte.objekte.keine}</p>
      ) : (
        <ObjektTabelle objekte={aktive} mitKunde />
      )}
      {archivierte.length > 0 && (
        <>
          <h2>{texte.objekte.archivierteTitel}</h2>
          <ObjektTabelle objekte={archivierte} mitKunde />
        </>
      )}
    </>
  );
}
