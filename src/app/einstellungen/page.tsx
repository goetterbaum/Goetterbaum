import { Suspense } from "react";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { ladeFirma } from "@/lib/firma/verwaltung";
import { createClient } from "@/lib/supabase/server";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { EinstellungenFormular } from "./einstellungen-formular";

export default function Einstellungen() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.einstellungen.titel}</h1>
        <Suspense fallback={<p>{texte.einstellungen.laedt}</p>}>
          <NurFuerBuero keineBerechtigung={texte.einstellungen.keineBerechtigung}>
            {(ich) => <Formular firmaId={ich.firma_id} />}
          </NurFuerBuero>
        </Suspense>
      </main>
    </div>
  );
}

async function Formular({ firmaId }: { firmaId: string }) {
  const firma = await ladeFirma(await createClient(), firmaId);
  return (
    <>
      <EinstellungenFormular rundungsregel={firma.rundungsregel} />
    </>
  );
}
