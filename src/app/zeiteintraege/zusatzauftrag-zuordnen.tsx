"use client";

import { startTransition, useActionState, useState } from "react";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";
import { texte } from "@/texte";

type Wahl = { id: string; beschreibung: string; erledigt: boolean };

// Fürs Büro beim Prüfen: den Zusatzauftrag eines Zeiteintrags ändern oder
// entfernen (Feld "zusatzauftrag"; leer heißt reguläre Arbeit). Zur Wahl
// stehen wie beim Erfassen die offenen Zusatzaufträge des Objekts, dazu
// der bisherige, auch wenn er inzwischen erledigt ist. Die Auswahl hält
// das Formular selbst und schickt selbst ab, damit sie nach einer
// Fehlermeldung stehen bleibt (siehe ZusatzauftragFormular).
export function ZusatzauftragZuordnen({
  aktion,
  zusatzauftraege,
  zusatzauftragId,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  // Alle Zusatzaufträge des Objekts, offene wie erledigte.
  zusatzauftraege: Wahl[];
  // Der bisherige; leer ohne Zusatzauftrag.
  zusatzauftragId: string;
}) {
  const t = texte.zeiteintraege;
  const [gewaehlt, setGewaehlt] = useState(zusatzauftragId);
  // Hat sich die Zuordnung woanders geändert (Next.js hält die Seite samt
  // Zustand vorrätig), gilt die neue. Kein Neuaufbau über key, sonst
  // verschwände die Rückmeldung nach dem eigenen Speichern.
  const [bisher, setBisher] = useState(zusatzauftragId);
  if (bisher !== zusatzauftragId) {
    setBisher(zusatzauftragId);
    setGewaehlt(zusatzauftragId);
  }
  const [zustand, ausfuehren, laeuft] = useActionState(aktion, START);
  const wahl = zusatzauftraege.filter((z) => !z.erledigt || z.id === zusatzauftragId);

  if (wahl.length === 0) return <p>{t.keinOffenerZusatzauftrag}</p>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => ausfuehren(formData));
      }}
    >
      <label>
        {t.zusatzauftrag}{" "}
        <select name="zusatzauftrag" value={gewaehlt} onChange={(e) => setGewaehlt(e.target.value)}>
          <option value="">{texte.erfassung.keinZusatzauftrag}</option>
          {wahl.map((z) => (
            <option key={z.id} value={z.id}>
              {z.erledigt ? t.zusatzauftragErledigt(z.beschreibung) : z.beschreibung}
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="submit" disabled={laeuft}>
        {laeuft ? t.zusatzauftragSpeichernLaeuft : t.zusatzauftragSpeichern}
      </button>
      {zustand.fehler && <p role="alert">{zustand.fehler}</p>}
      {zustand.meldung && <p role="status">{zustand.meldung}</p>}
    </form>
  );
}
