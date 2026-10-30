import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { darfFuerAndereErfassen } from "@/lib/rollen";
import { createClient } from "@/lib/supabase/server";
import { ladeAndereMitarbeiter } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import styles from "../page.module.css";
import { KeineBerechtigung } from "./erfasster-mitarbeiter";

export default function FuerAndereErfassen() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.fuerAndere.titel}</h1>
        <Suspense fallback={<p>{texte.fuerAndere.laedt}</p>}>
          <Auswahl />
        </Suspense>
      </main>
    </div>
  );
}

// Alle anderen aktiven Mitarbeiter der Firma, ohne feste Gruppen.
async function Auswahl() {
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich) redirect("/anmelden");
  if (!darfFuerAndereErfassen(ich.rolle)) return <KeineBerechtigung />;

  const mitarbeiter = await ladeAndereMitarbeiter(supabase, ich.id);
  return (
    <>
      {mitarbeiter.length === 0 ? (
        <p>{texte.fuerAndere.keineMitarbeiter}</p>
      ) : (
        <>
          <p>{texte.fuerAndere.hinweis}</p>
          <ul>
            {mitarbeiter.map((m) => (
              <li key={m.id}>
                <Link href={`/fuer-andere/${m.id}`}>{m.name}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
