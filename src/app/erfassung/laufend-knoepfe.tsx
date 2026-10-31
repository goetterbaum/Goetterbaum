"use client";

import { useState } from "react";
import { KnopfMitRueckfrage } from "@/app/knopf-mit-rueckfrage";
import { fahrtWirdGespeichert, MINI_FAHRT_MINUTEN } from "@/lib/zeiterfassung/live-erfassung";
import { texte } from "@/texte";
import { arbeitstagBeenden, fertigHier } from "./actions";
import styles from "./erfassung.module.css";
import { Fehlermeldung, ohneAbsturz, useErfassungsAktion } from "./erfassungs-aktion";

// Die Knöpfe beim laufenden Zeiteintrag. fuer ist jeweils der Mitarbeiter,
// dessen Zeit erfasst wird.

export function FertigHierKnopf({ fuer }: { fuer: string }) {
  const [zustand, ausfuehren, laeuft] = useErfassungsAktion(fertigHier.bind(null, fuer), {
    ohneNetz: texte.erfassung.ohneNetzFertigHier,
    nichtGespeichert: texte.erfassung.fehlerFertigHier,
  });

  return (
    <form action={ausfuehren}>
      <button type="submit" className={`${styles.gross} ${styles.start}`} disabled={laeuft}>
        {laeuft ? texte.erfassung.fertigHierLaeuft : texte.erfassung.fertigHier}
      </button>
      <Fehlermeldung zustand={zustand} />
    </form>
  );
}

// fahrtSeit: Beginn der laufenden Fahrt, leer bei einem Objekt.
export function ArbeitstagBeendenKnopf({
  fuer,
  fahrtSeit,
}: {
  fuer: string;
  fahrtSeit: string | null;
}) {
  const t = texte.erfassung;
  return (
    <KnopfMitRueckfrage
      aktion={ohneAbsturz(arbeitstagBeenden.bind(null, fuer), {
        ohneNetz: t.ohneNetzArbeitstagBeenden,
        nichtGespeichert: t.fehlerArbeitstagBeenden,
      })}
      knopf={t.arbeitstagBeenden}
      rueckfrage={<Rueckfrage fahrtSeit={fahrtSeit} />}
      bestaetigen={t.arbeitstagBeendenBestaetigen}
      abbrechen={t.arbeitstagBeendenAbbrechen}
      knopfLaeuft={t.arbeitstagBeendenLaeuft}
      klassen={{
        knopf: `${styles.gross} ${styles.beenden}`,
        abbrechen: styles.abbrechen,
        fehler: styles.fehler,
      }}
    />
  );
}

// Während einer Fahrt sagt die Rückfrage, ob die Fahrt als Rückfahrt
// gespeichert wird. Gerechnet wird beim Nachfragen, nicht beim Laden der
// Seite; die Rückfrage erscheint erst dann.
function Rueckfrage({ fahrtSeit }: { fahrtSeit: string | null }) {
  const t = texte.erfassung;
  const [jetzt] = useState(() => Date.now());
  if (fahrtSeit === null) return t.arbeitstagBeendenRueckfrage;
  return (
    <>
      {t.arbeitstagBeendenRueckfrage}{" "}
      {fahrtWirdGespeichert(fahrtSeit, jetzt)
        ? t.rueckfahrtWirdGespeichert
        : t.miniFahrtWirdNichtGespeichert(MINI_FAHRT_MINUTEN)}
    </>
  );
}
