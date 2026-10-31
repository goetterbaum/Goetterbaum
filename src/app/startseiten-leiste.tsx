"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { texte } from "@/texte";
import { Logo } from "./logo";
import styles from "./startseiten-leiste.module.css";

// Die Startseite braucht keinen Weg zu sich selbst, und vor der Anmeldung
// führt die Startseite nur zurück zum Anmelden. /passwort-festlegen ist
// zwar nach dem Mail-Link angemeldet, gehört aber noch zum Anmelden.
const OHNE_LEISTE = ["/", "/anmelden", "/passwort-vergessen", "/passwort-festlegen"];

export function StartseitenLeiste() {
  if (OHNE_LEISTE.includes(usePathname())) return null;

  return (
    <>
      <nav className={styles.leiste}>
        <Logo />
        <Link href="/" className={styles.link}>
          <HausSymbol />
          {texte.leiste.startseite}
        </Link>
      </nav>
      <div className={styles.platzhalter} />
    </>
  );
}

function HausSymbol() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}
