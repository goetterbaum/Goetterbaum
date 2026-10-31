"use client";

import { useActionState } from "react";
import { FEHLER, START, type Rueckmeldung } from "@/lib/rueckmeldung";
import styles from "./erfassung.module.css";

// Die Aktion ohne Absturz, wenn sie gar nicht beim Server ankommt oder dort
// abbricht. Dann zeigt das Formular, dass nichts gespeichert wurde und ein
// Nachtrag nötig ist (ADR-0002): ohneNetz, wenn das Handy kein Internet
// hat, sonst nichtGespeichert.
export function ohneAbsturz<Angaben extends unknown[]>(
  aktion: (...angaben: Angaben) => Promise<Rueckmeldung>,
  meldungen: { ohneNetz: string; nichtGespeichert: string },
) {
  return async (...angaben: Angaben) => {
    try {
      return await aktion(...angaben);
    } catch {
      return FEHLER(navigator.onLine ? meldungen.nichtGespeichert : meldungen.ohneNetz);
    }
  };
}

// Wie useActionState, aber ohne Absturz (siehe ohneAbsturz).
export function useErfassungsAktion(
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>,
  meldungen: { ohneNetz: string; nichtGespeichert: string },
) {
  return useActionState(ohneAbsturz(aktion, meldungen), START);
}

export function Fehlermeldung({ zustand }: { zustand: Rueckmeldung }) {
  if (!zustand.fehler) return null;
  return (
    <p role="alert" className={styles.fehler}>
      {zustand.fehler}
    </p>
  );
}
