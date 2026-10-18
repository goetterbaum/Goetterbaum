"use client";

import { useActionState } from "react";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";
import type { ZusatzauftragZurAuswahl } from "@/lib/zusatzauftraege/verwaltung";
import { texte } from "@/texte";

// Wählt beim Prüfen den Zusatzauftrag eines Zeiteintrags oder keinen.
export function ZuordnungFormular({
  aktion,
  zusatzauftraege,
  bisher,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  // Alle noch nicht abgerechneten Zusatzaufträge des Objekts.
  zusatzauftraege: ZusatzauftragZurAuswahl[];
  bisher: string | null;
}) {
  const t = texte.zusatzauftraege;
  const [zustand, ausfuehren, laeuft] = useActionState(aktion, START);

  return (
    <form action={ausfuehren}>
      <h3>{t.zuordnungTitel}</h3>
      <p>{t.zuordnungHinweis}</p>
      <p>
        <label>
          {t.auswahl}
          <br />
          <select name="zusatzauftrag" defaultValue={bisher ?? ""}>
            <option value="">{t.keiner}</option>
            {zusatzauftraege.map((za) => (
              <option key={za.id} value={za.id}>
                {za.erledigt ? t.erledigtMarkierung(za.beschreibung) : za.beschreibung}
              </option>
            ))}
          </select>
        </label>
      </p>
      {zustand.fehler && <p role="alert">{zustand.fehler}</p>}
      {zustand.meldung && <p role="status">{zustand.meldung}</p>}
      <button type="submit" disabled={laeuft}>
        {laeuft ? texte.stammdaten.speichernLaeuft : texte.stammdaten.speichern}
      </button>
    </form>
  );
}
