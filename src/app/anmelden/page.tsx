import Link from "next/link";
import { Suspense } from "react";
import { texte } from "@/texte";
import { Logo } from "../logo";
import styles from "../page.module.css";
import { AnmeldeFormular } from "./anmelde-formular";

// Eine Registrierung gibt es bewusst nicht: Zugänge entstehen nur über
// eine Einladung des Büros.
export default function Anmelden({ searchParams }: PageProps<"/anmelden">) {
  return (
    <div className={styles.page}>
      <main className={`${styles.main} ${styles.schmal}`}>
        <h1>
          <span className="sr-only">{texte.appName}</span>
          <Logo gross />
        </h1>
        <h2>{texte.anmelden.titel}</h2>
        <Suspense>
          <LinkHinweis fehler={searchParams.then((p) => p.fehler)} />
        </Suspense>
        <AnmeldeFormular />
        <p>
          <Link href="/passwort-vergessen">{texte.anmelden.passwortVergessen}</Link>
        </p>
      </main>
    </div>
  );
}

// Hinweis, wenn ein Link aus einer Mail nicht (mehr) gültig war.
async function LinkHinweis({ fehler }: { fehler: Promise<string | string[] | undefined> }) {
  if ((await fehler) !== "link") return null;
  return <p role="alert">{texte.anmelden.fehlerLink}</p>;
}
