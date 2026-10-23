import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { darfFuerAndereErfassen } from "@/lib/rollen";
import { texte } from "@/texte";
import { abmelden } from "./actions";
import { Erfassung } from "./erfassung/erfassung";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{texte.appName}</h1>
        <Suspense fallback={<p>{texte.start.laedt}</p>}>
          <Begruessung />
        </Suspense>
      </main>
    </div>
  );
}

async function Begruessung() {
  const mitarbeiter = await angemeldeterMitarbeiter();
  if (!mitarbeiter) redirect("/anmelden");

  return (
    <>
      <p>
        {texte.start.angemeldetAls} <strong>{mitarbeiter.name}</strong>
      </p>
      <p>
        {texte.start.rolle}: <strong>{texte.rollen[mitarbeiter.rolle]}</strong>
      </p>
      <Erfassung mitarbeiterId={mitarbeiter.id} eigene />
      {darfFuerAndereErfassen(mitarbeiter.rolle) && (
        <p>
          <Link href="/fuer-andere">{texte.start.fuerAndereErfassen}</Link>
        </p>
      )}
      {mitarbeiter.rolle === "buero" && (
        <>
          <p>
            <Link href="/mitarbeiter">{texte.start.mitarbeiterVerwalten}</Link>
          </p>
          <p>
            <Link href="/kunden">{texte.start.kundenVerwalten}</Link>
          </p>
          <p>
            <Link href="/objekte">{texte.start.objekteVerwalten}</Link>
          </p>
          <p>
            <Link href="/taetigkeiten">{texte.start.taetigkeitenVerwalten}</Link>
          </p>
          <p>
            <Link href="/zeiteintraege">{texte.start.zeiteintraegeAnsehen}</Link>
          </p>
          <p>
            <Link href="/unvollstaendige-eintraege">{texte.start.unvollstaendigePruefen}</Link>
          </p>
          <p>
            <Link href="/freigabe">{texte.start.zeiteintraegeFreigeben}</Link>
          </p>
          <p>
            <Link href="/rechnungsvorbereitung">{texte.start.rechnungsvorbereitung}</Link>
          </p>
          <p>
            <Link href="/auswertungen/arbeitszeitnachweis">{texte.start.arbeitszeitnachweis}</Link>
          </p>
          <p>
            <Link href="/auswertungen/ist-zeit">{texte.start.istZeit}</Link>
          </p>
          <p>
            <Link href="/einstellungen">{texte.start.einstellungen}</Link>
          </p>
        </>
      )}
      <form action={abmelden}>
        <button type="submit">{texte.start.abmelden}</button>
      </form>
    </>
  );
}
