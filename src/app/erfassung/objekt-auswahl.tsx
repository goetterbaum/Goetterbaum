"use client";

import { useState } from "react";
import type { ObjektZurAuswahl } from "@/lib/zeiterfassung/verwaltung";
import type { ZusatzauftragZurAuswahl } from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";
import styles from "./erfassung.module.css";

// So viele Treffer zeigt die Objektsuche höchstens, damit die Liste am
// Handy überschaubar bleibt.
const HOECHSTENS_TREFFER = 10;

function passt(objekt: ObjektZurAuswahl, suche: string) {
  const text = [objekt.bezeichnung, objekt.strasse, objekt.plz, objekt.ort].join(" ");
  return text.toLocaleLowerCase("de").includes(suche.trim().toLocaleLowerCase("de"));
}

// Objekt über ein Suchfeld wählen (Feld "objekt"). Die Auswahl hält das
// Formular selbst, damit sie erhalten bleibt, auch wenn die Suche das
// Objekt ausblendet oder das Speichern fehlschlägt (React leert Formulare
// nach jeder Aktion).
export function ObjektAuswahl({
  objekte,
  objektId,
  waehle,
}: {
  // Nur aktive Objekte.
  objekte: ObjektZurAuswahl[];
  objektId: string;
  waehle: (id: string) => void;
}) {
  const [suche, setSuche] = useState("");

  if (objekte.length === 0) return <p>{texte.erfassung.keineObjekte}</p>;

  const treffer = objekte.filter((o) => passt(o, suche));
  const gezeigt = treffer.slice(0, HOECHSTENS_TREFFER);
  const gewaehlt = objekte.find((o) => o.id === objektId);
  if (gewaehlt && !gezeigt.includes(gewaehlt)) gezeigt.unshift(gewaehlt);

  return (
    <fieldset className={styles.auswahl}>
      <label>
        {texte.erfassung.objektSuchen}
        <input
          type="search"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          className={styles.eingabe}
          autoComplete="off"
        />
      </label>
      {gezeigt.map((o) => (
        <label key={o.id} className={styles.objekt}>
          <input
            type="radio"
            name="objekt"
            value={o.id}
            checked={o.id === objektId}
            onChange={() => waehle(o.id)}
          />
          <span>
            <strong>{o.bezeichnung}</strong>
            <br />
            {o.strasse}, {o.plz} {o.ort}
          </span>
        </label>
      ))}
      {treffer.length === 0 && <p>{texte.erfassung.keineTreffer}</p>}
      {treffer.length > HOECHSTENS_TREFFER && <p>{texte.erfassung.weitereTreffer}</p>}
    </fieldset>
  );
}

// Tätigkeit aus der festen Liste wählen (Feld "taetigkeit").
export function TaetigkeitAuswahl({
  taetigkeiten,
  taetigkeitId,
  waehle,
}: {
  // Nur aktive Tätigkeiten.
  taetigkeiten: { id: string; name: string }[];
  taetigkeitId: string;
  waehle: (id: string) => void;
}) {
  if (taetigkeiten.length === 0) return <p>{texte.erfassung.keineTaetigkeiten}</p>;

  return (
    <label>
      {texte.erfassung.taetigkeit}
      <select
        name="taetigkeit"
        value={taetigkeitId}
        onChange={(e) => waehle(e.target.value)}
        className={styles.eingabe}
      >
        <option value="" disabled>
          {texte.erfassung.taetigkeitWaehlen}
        </option>
        {taetigkeiten.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// Zusatzauftrag des gewählten Objekts wählen (Feld "zusatzauftrag"; leer
// heißt: reguläre Arbeit). Erscheint nur, wenn das Objekt welche hat.
export function ZusatzauftragAuswahl({
  zusatzauftraege,
  objektId,
  zusatzauftragId,
  waehle,
}: {
  // Offene Zusatzaufträge aller Objekte, beim Ändern auch der bisherige.
  zusatzauftraege: ZusatzauftragZurAuswahl[];
  objektId: string;
  zusatzauftragId: string;
  waehle: (id: string) => void;
}) {
  const t = texte.zusatzauftraege;
  const zumObjekt = zusatzauftraege.filter((za) => za.objekt_id === objektId);
  if (zumObjekt.length === 0) return null;

  return (
    <label>
      {t.auswahl}
      <select
        name="zusatzauftrag"
        value={zusatzauftragId}
        onChange={(e) => waehle(e.target.value)}
        className={styles.eingabe}
      >
        <option value="">{t.keiner}</option>
        {zumObjekt.map((za) => (
          <option key={za.id} value={za.id}>
            {za.erledigt ? t.erledigtMarkierung(za.beschreibung) : za.beschreibung}
          </option>
        ))}
      </select>
    </label>
  );
}
