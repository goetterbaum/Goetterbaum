"use client";

import { useState, useSyncExternalStore } from "react";
import { monatsZeitraum } from "@/lib/auswertungen/zeitraum";
import type { Monat } from "@/lib/rechnungsvorbereitung";
import { texte } from "@/texte";
import styles from "./monatsauswahl.module.css";

// Ob die Seite im Browser schon bedienbar ist. Vorher sind die Buttons
// gesperrt, damit ein früher Klick nicht ins Leere geht.
const nichts = () => () => {};
function useBedienbar() {
  return useSyncExternalStore(
    nichts,
    () => true,
    () => false,
  );
}

// Jahr mit Pfeilen und die Buttons Januar bis Dezember in einem Formular
// mit den Feldern "von" und "bis". Ein Monat trägt seinen ersten und
// letzten Tag dort ein und schickt das Formular gleich ab, die übrigen
// Angaben darin bleiben also erhalten.
export function Monatsauswahl({
  gewaehlt,
  jahr: angezeigtesJahr,
  aktuellerMonat,
  abschickenNurMit,
}: {
  // Der Monat, den von und bis gerade umfassen, sonst null.
  gewaehlt: Monat | null;
  // Das Jahr, das zuerst zu sehen ist.
  jahr: number;
  // Der heutige Monat in Berlin; spätere sind ausgegraut.
  aktuellerMonat: Monat;
  // Abgeschickt wird nur, wenn das Feld dieses Namens ausgefüllt ist;
  // sonst trägt ein Monat nur die Daten ein.
  abschickenNurMit?: string;
}) {
  const t = texte.monatsauswahl;
  const bedienbar = useBedienbar();
  const [jahr, setJahr] = useState(angezeigtesJahr);
  const [monat, setMonat] = useState(gewaehlt);
  // Kommt die Seite mit neuer Auswahl, gilt die neue.
  const [bisher, setBisher] = useState({ gewaehlt, angezeigtesJahr });
  if (bisher.gewaehlt !== gewaehlt || bisher.angezeigtesJahr !== angezeigtesJahr) {
    setBisher({ gewaehlt, angezeigtesJahr });
    setMonat(gewaehlt);
    setJahr(angezeigtesJahr);
  }
  const aktuellesJahr = Number(aktuellerMonat.slice(0, 4));

  function waehle(knopf: HTMLButtonElement, gewaehlterMonat: Monat) {
    const formular = knopf.form;
    if (!formular) return;
    const { von, bis } = monatsZeitraum(gewaehlterMonat);
    const feld = (name: string) => formular.elements.namedItem(name) as HTMLInputElement | null;
    feld("von")!.value = von;
    feld("bis")!.value = bis;
    setMonat(gewaehlterMonat);
    if (!abschickenNurMit || feld(abschickenNurMit)?.value) formular.requestSubmit();
  }

  return (
    <div role="group" aria-label={t.beschriftung} className={styles.auswahl}>
      <div className={styles.jahr}>
        <button
          type="button"
          aria-label={t.vorjahr}
          disabled={!bedienbar}
          onClick={() => setJahr(jahr - 1)}
        >
          {t.pfeilVorjahr}
        </button>
        <span>{jahr}</span>
        <button
          type="button"
          aria-label={t.folgejahr}
          disabled={!bedienbar || jahr >= aktuellesJahr}
          onClick={() => setJahr(jahr + 1)}
        >
          {t.pfeilFolgejahr}
        </button>
      </div>
      <div className={styles.monate}>
        {t.monate.map((name, i) => {
          const wert = `${jahr}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              key={wert}
              type="button"
              aria-pressed={wert === monat}
              // Monate als "JJJJ-MM" lassen sich als Text vergleichen.
              disabled={!bedienbar || wert > aktuellerMonat}
              onClick={(e) => waehle(e.currentTarget, wert)}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
