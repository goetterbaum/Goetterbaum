"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Fehlermeldung, useErfassungsAktion } from "@/app/erfassung/erfassungs-aktion";
import styles from "@/app/erfassung/erfassung.module.css";
import {
  ObjektAuswahl,
  TaetigkeitAuswahl,
  ZusatzauftragAuswahl,
} from "@/app/erfassung/objekt-auswahl";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";
import { artAlsText, type ZeiteintragArt } from "@/lib/zeiterfassung/anzeige";
import type {
  ObjektZurAuswahl,
  TaetigkeitZurAuswahl,
  ZusatzauftragZurAuswahl,
} from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";

// Was im Formular schon steht: beim Ändern der bisherige Eintrag, beim
// Nachtragen nur das heutige Datum. Datum und Uhrzeiten in Berlin.
export type NachtragVorgabe = {
  art: ZeiteintragArt;
  objekt_id: string;
  taetigkeit_id: string;
  // Leer heißt reguläre Arbeit.
  zusatzauftrag_id: string;
  datum: string;
  von: string;
  bis: string;
};

const MELDUNGEN = {
  ohneNetz: texte.nachtrag.ohneNetz,
  nichtGespeichert: texte.nachtrag.fehlerNichtGespeichert,
};

// Nachtragen oder Ändern eines beendeten Zeiteintrags: Tätigkeit in einem
// Objekt (gegebenenfalls mit Zusatzauftrag) oder Fahrt, Datum, von–bis.
// Nach dem Speichern geht es zurück zur Erfassung, aus der man kam
// (zurueck): der eigenen oder der eines anderen.
export function NachtragFormular({
  aktion,
  zurueck,
  objekte,
  taetigkeiten,
  zusatzauftraege,
  vorgabe,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  zurueck: string;
  // Nur aktive Objekte und Tätigkeiten.
  objekte: ObjektZurAuswahl[];
  taetigkeiten: TaetigkeitZurAuswahl[];
  // Nur offene Zusatzaufträge.
  zusatzauftraege: ZusatzauftragZurAuswahl[];
  vorgabe: NachtragVorgabe;
}) {
  const t = texte.nachtrag;
  const router = useRouter();
  const [art, setArt] = useState(vorgabe.art);
  const [objektId, setObjektId] = useState(vorgabe.objekt_id);
  const [taetigkeitId, setTaetigkeitId] = useState(vorgabe.taetigkeit_id);
  const [zusatzauftragId, setZusatzauftragId] = useState(vorgabe.zusatzauftrag_id);
  // Auch Datum und Uhrzeiten hält das Formular selbst, damit sie nach einer
  // Fehlermeldung stehen bleiben.
  const [zeit, setZeit] = useState({
    datum: vorgabe.datum,
    von: vorgabe.von,
    bis: vorgabe.bis,
  });
  // Nach dem Speichern zurück zur Erfassung, und zwar direkt hier statt
  // aus einem gespeicherten Zustand: Next.js hält besuchte Seiten samt
  // Zustand vorrätig, ein "gespeichert" würde beim nächsten Öffnen sofort
  // wieder wegführen. Deshalb auch die Felder zurück auf die Vorgabe.
  const [zustand, speichern, laeuft] = useErfassungsAktion(
    async (vorher: Rueckmeldung, formData: FormData) => {
      const ergebnis = await aktion(vorher, formData);
      if (ergebnis.fehler) return ergebnis;
      setArt(vorgabe.art);
      setObjektId(vorgabe.objekt_id);
      setTaetigkeitId(vorgabe.taetigkeit_id);
      setZusatzauftragId(vorgabe.zusatzauftrag_id);
      setZeit({ datum: vorgabe.datum, von: vorgabe.von, bis: vorgabe.bis });
      router.push(zurueck);
      return START;
    },
    MELDUNGEN,
  );

  return (
    <form action={speichern} className={styles.formular}>
      <fieldset className={styles.auswahl}>
        <legend>{t.art}</legend>
        {(["taetigkeit", "fahrt"] as const).map((wert) => (
          <label key={wert} className={styles.objekt}>
            <input
              type="radio"
              name="art"
              value={wert}
              checked={art === wert}
              onChange={() => setArt(wert)}
            />
            {artAlsText(wert)}
          </label>
        ))}
      </fieldset>
      {art === "taetigkeit" && (
        <>
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
            bisheriger={
              vorgabe.zusatzauftrag_id
                ? { id: vorgabe.zusatzauftrag_id, objekt_id: vorgabe.objekt_id }
                : null
            }
            waehle={setZusatzauftragId}
          />
        </>
      )}
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
        {t.von}
        <input
          type="time"
          name="von"
          value={zeit.von}
          onChange={(e) => setZeit({ ...zeit, von: e.target.value })}
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
      <button type="submit" className={`${styles.gross} ${styles.start}`} disabled={laeuft}>
        {laeuft ? t.speichernLaeuft : t.speichern}
      </button>
      <Fehlermeldung zustand={zustand} />
      <p>
        <Link href={zurueck}>{t.zurueck}</Link>
      </p>
    </form>
  );
}
