"use client";

import { useActionState, useState } from "react";
import { ZUSATZAUFTRAG_ABRECHNUNGSARTEN, type ZusatzauftragAbrechnungsart } from "@/lib/abrechnung";
import { euroAlsEingabe } from "@/lib/geld";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";
import type { ZusatzauftragDaten } from "@/lib/zusatzauftraege/eingabe";
import { texte } from "@/texte";

// Formular für einen Zusatzauftrag, zum Anlegen wie zum Bearbeiten. Das
// Feld für den Festbetrag erscheint nur bei Abrechnungsart Festbetrag.
export function ZusatzauftragFormular({
  aktion,
  vorgabe,
  titel,
  knopf,
  knopfLaeuft,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  vorgabe?: ZusatzauftragDaten;
  titel?: string;
  knopf: string;
  knopfLaeuft: string;
}) {
  const t = texte.zusatzauftraege;
  const [zustand, ausfuehren, laeuft] = useActionState(aktion, START);
  const [abrechnungsart, setAbrechnungsart] = useState<ZusatzauftragAbrechnungsart>(
    vorgabe?.abrechnungsart ?? "stunden",
  );

  return (
    <form action={ausfuehren}>
      {titel && <h3>{titel}</h3>}
      <p>
        <label>
          {t.beschreibung}
          <br />
          <input name="beschreibung" defaultValue={vorgabe?.beschreibung} required />
        </label>
      </p>
      <p>
        <label>
          {t.abrechnungsart}
          <br />
          <select
            name="abrechnungsart"
            value={abrechnungsart}
            onChange={(e) => setAbrechnungsart(e.target.value as ZusatzauftragAbrechnungsart)}
          >
            {ZUSATZAUFTRAG_ABRECHNUNGSARTEN.map((art) => (
              <option key={art} value={art}>
                {texte.zusatzauftragAbrechnungsarten[art]}
              </option>
            ))}
          </select>
        </label>
      </p>
      {abrechnungsart === "festbetrag" && (
        <p>
          <label>
            {t.festbetrag}
            <br />
            <input
              name="festbetrag"
              inputMode="decimal"
              defaultValue={vorgabe?.festbetrag_cent ? euroAlsEingabe(vorgabe.festbetrag_cent) : ""}
              required
            />
          </label>
        </p>
      )}
      {zustand.fehler && <p role="alert">{zustand.fehler}</p>}
      {zustand.meldung && <p role="status">{zustand.meldung}</p>}
      <button type="submit" disabled={laeuft}>
        {laeuft ? knopfLaeuft : knopf}
      </button>
    </form>
  );
}
