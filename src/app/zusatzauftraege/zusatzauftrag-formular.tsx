"use client";

import { useActionState, useState } from "react";
import { ZUSATZAUFTRAG_ABRECHNUNGSARTEN, type ZusatzauftragAbrechnungsart } from "@/lib/abrechnung";
import { euroAlsEingabe } from "@/lib/geld";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";
import type { ZusatzauftragDaten } from "@/lib/zusatzauftraege/eingabe";
import { texte } from "@/texte";

function felderAus(vorgabe?: ZusatzauftragDaten) {
  return {
    beschreibung: vorgabe?.beschreibung ?? "",
    abrechnungsart: vorgabe?.abrechnungsart ?? ("stunden" as ZusatzauftragAbrechnungsart),
    festbetrag: vorgabe?.festbetrag_cent ? euroAlsEingabe(vorgabe.festbetrag_cent) : "",
  };
}

// Formular für einen Zusatzauftrag, zum Anlegen wie zum Bearbeiten. Das
// Feld für den Festbetrag erscheint nur bei Abrechnungsart Festbetrag.
// Alle Felder hält das Formular selbst: React setzt Formulare nach jeder
// Aktion zurück, auch nach einer Fehlermeldung, und eine gewählte
// Abrechnungsart sprang dabei sonst unsichtbar zurück. Mit leeren werden
// die Felder nach dem Speichern geleert (beim Anlegen).
export function ZusatzauftragFormular({
  aktion,
  vorgabe,
  leeren = false,
  titel,
  knopf,
  knopfLaeuft,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  vorgabe?: ZusatzauftragDaten;
  leeren?: boolean;
  titel?: string;
  knopf: string;
  knopfLaeuft: string;
}) {
  const t = texte.zusatzauftraege;
  const [felder, setFelder] = useState(() => felderAus(vorgabe));
  const [zustand, ausfuehren, laeuft] = useActionState(
    async (vorher: Rueckmeldung, formData: FormData) => {
      const ergebnis = await aktion(vorher, formData);
      if (!ergebnis.fehler && leeren) setFelder(felderAus());
      return ergebnis;
    },
    START,
  );

  return (
    <form action={ausfuehren}>
      {titel && <h3>{titel}</h3>}
      <p>
        <label>
          {t.beschreibung}
          <br />
          <input
            name="beschreibung"
            value={felder.beschreibung}
            onChange={(e) => setFelder({ ...felder, beschreibung: e.target.value })}
            required
          />
        </label>
      </p>
      <p>
        <label>
          {t.abrechnungsart}
          <br />
          <select
            name="abrechnungsart"
            value={felder.abrechnungsart}
            onChange={(e) =>
              setFelder({
                ...felder,
                abrechnungsart: e.target.value as ZusatzauftragAbrechnungsart,
              })
            }
          >
            {ZUSATZAUFTRAG_ABRECHNUNGSARTEN.map((art) => (
              <option key={art} value={art}>
                {texte.zusatzauftragAbrechnungsarten[art]}
              </option>
            ))}
          </select>
        </label>
      </p>
      {felder.abrechnungsart === "festbetrag" && (
        <p>
          <label>
            {t.festbetrag}
            <br />
            <input
              name="festbetrag"
              inputMode="decimal"
              value={felder.festbetrag}
              onChange={(e) => setFelder({ ...felder, festbetrag: e.target.value })}
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
