"use client";

import { useState } from "react";
import type {
  ObjektZurAuswahl,
  TaetigkeitZurAuswahl,
  ZusatzauftragZurAuswahl,
} from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";
import { fahrtStarten, zeiteintragStarten } from "./actions";
import styles from "./erfassung.module.css";
import { Fehlermeldung, useErfassungsAktion } from "./erfassungs-aktion";
import { ObjektAuswahl, TaetigkeitAuswahl, ZusatzauftragAuswahl } from "./objekt-auswahl";

const MELDUNGEN = {
  ohneNetz: texte.erfassung.ohneNetzStart,
  nichtGespeichert: texte.erfassung.fehlerStart,
};

// Start eines Zeiteintrags: Objekt suchen, Tätigkeit und gegebenenfalls
// einen Zusatzauftrag wählen, Start. Oder eine Fahrt ohne Objekt starten.
export function StartFormular({
  fuer,
  objekte,
  taetigkeiten,
  zusatzauftraege,
}: {
  // Der Mitarbeiter, dessen Zeit erfasst wird.
  fuer: string;
  // Nur aktive Objekte und Tätigkeiten.
  objekte: ObjektZurAuswahl[];
  taetigkeiten: TaetigkeitZurAuswahl[];
  // Nur offene Zusatzaufträge.
  zusatzauftraege: ZusatzauftragZurAuswahl[];
}) {
  const [objektId, setObjektId] = useState("");
  const [taetigkeitId, setTaetigkeitId] = useState("");
  const [zusatzauftragId, setZusatzauftragId] = useState("");
  const [start, starten, startLaeuft] = useErfassungsAktion(
    zeiteintragStarten.bind(null, fuer),
    MELDUNGEN,
  );
  const [fahrt, fahrtStartenLassen, fahrtLaeuft] = useErfassungsAktion(
    fahrtStarten.bind(null, fuer),
    MELDUNGEN,
  );
  const laeuft = startLaeuft || fahrtLaeuft;

  return (
    <>
      <form action={starten} className={styles.formular}>
        <ObjektAuswahl
          objekte={objekte}
          objektId={objektId}
          waehle={(id) => {
            // Zusatzaufträge gehören zu genau einem Objekt.
            setObjektId(id);
            setZusatzauftragId("");
          }}
        />
        <TaetigkeitAuswahl
          taetigkeiten={taetigkeiten}
          taetigkeitId={taetigkeitId}
          waehle={setTaetigkeitId}
        />
        <ZusatzauftragAuswahl
          zusatzauftraege={zusatzauftraege}
          objektId={objektId}
          zusatzauftragId={zusatzauftragId}
          waehle={setZusatzauftragId}
        />
        <button type="submit" className={`${styles.gross} ${styles.start}`} disabled={laeuft}>
          {startLaeuft ? texte.erfassung.startLaeuft : texte.erfassung.start}
        </button>
        <Fehlermeldung zustand={start} />
      </form>
      <form action={fahrtStartenLassen} className={styles.formular}>
        <button type="submit" className={`${styles.gross} ${styles.fahrt}`} disabled={laeuft}>
          {fahrtLaeuft ? texte.erfassung.startLaeuft : texte.erfassung.fahrtStarten}
        </button>
        <Fehlermeldung zustand={fahrt} />
      </form>
    </>
  );
}
