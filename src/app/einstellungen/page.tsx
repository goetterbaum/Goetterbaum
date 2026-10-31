import { Suspense } from "react";
import { ArbeitgeberkostenVerlauf } from "@/app/arbeitgeberkosten/verlauf";
import { NurFuerBuero } from "@/app/nur-fuer-buero";
import { ladeArbeitgeberkosten } from "@/lib/arbeitgeberkosten/verwaltung";
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
  const supabase = await createClient();
  const ziel = { mitarbeiterId: null };
  const [firma, standard] = await Promise.all([
    ladeFirma(supabase, firmaId),
    ladeArbeitgeberkosten(supabase, ziel),
  ]);
  return (
    <>
      <EinstellungenFormular rundungsregel={firma.rundungsregel} />
      <h2>{texte.arbeitgeberkosten.titel}</h2>
      <p>{texte.arbeitgeberkosten.hinweisStandard}</p>
      <ArbeitgeberkostenVerlauf ziel={ziel} werte={standard} />
    </>
  );
}
