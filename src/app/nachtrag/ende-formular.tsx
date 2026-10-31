"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Fehlermeldung, useErfassungsAktion } from "@/app/erfassung/erfassungs-aktion";
import styles from "@/app/erfassung/erfassung.module.css";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";
import { texte } from "@/texte";

const MELDUNGEN = {
  ohneNetz: texte.nachtrag.ohneNetz,
  nichtGespeichert: texte.nachtrag.fehlerNichtGespeichert,
};

// Das richtige Ende eines unvollständigen Zeiteintrags: Datum (vorgegeben
// ist der Tag des Beginns) und Uhrzeit in Berlin. In der Erfassung bleibt
// man nach dem Speichern auf der Seite, die sich neu lädt; mit zurueck geht
// es danach dorthin.
export function EndeFormular({
  aktion,
  datum,
  zurueck,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  datum: string;
  zurueck?: string;
}) {
  const t = texte.nachtrag;
  const router = useRouter();
  // Hält das Formular selbst, damit die Angaben nach einer Fehlermeldung
  // stehen bleiben.
  const [zeit, setZeit] = useState({ datum, bis: "" });
  const [zustand, speichern, laeuft] = useErfassungsAktion(
    async (vorher: Rueckmeldung, formData: FormData) => {
      const ergebnis = await aktion(vorher, formData);
      if (ergebnis.fehler) return ergebnis;
      if (zurueck) router.push(zurueck);
      return START;
    },
    MELDUNGEN,
  );

  return (
    <form action={speichern} className={styles.formular}>
      <label>
        {t.datum}
        <input
          type="date"
          name="datum"
          value={zeit.datum}
          onChange={(e) => setZeit({ ...zeit, datum: e.target.value })}
          required
          className={styles.eingabe}
        />
      </label>
      <label>
        {t.bis}
        <input
          type="time"
          name="bis"
          value={zeit.bis}
          onChange={(e) => setZeit({ ...zeit, bis: e.target.value })}
          required
          className={styles.eingabe}
        />
      </label>
      <button type="submit" className={`${styles.gross} ${styles.beenden}`} disabled={laeuft}>
        {laeuft ? t.speichernLaeuft : t.endeSpeichern}
      </button>
      <Fehlermeldung zustand={zustand} />
    </form>
  );
}
