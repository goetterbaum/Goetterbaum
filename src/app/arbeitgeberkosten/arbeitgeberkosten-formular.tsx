"use client";

import { useActionState, type ReactNode } from "react";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";

// Ein Wert der Arbeitgeberkosten: „gültig ab“ und Betrag in Euro. Dient
// zum Hinzufügen und, in einer Zeile des Verlaufs, zum Ändern.
export function ArbeitgeberkostenFormular({
  aktion,
  vorgabe,
  beschriftung,
  sichtbar = false,
  knopf,
  knopfLaeuft,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  // Betrag als Eingabe, z. B. "27,50".
  vorgabe?: { gueltigAb: string; betrag: string };
  beschriftung: { gueltigAb: string; betrag: string };
  // Beschriftung als sichtbarer Text statt nur für Screenreader (in der
  // Tabelle steht sie schon im Kopf).
  sichtbar?: boolean;
  knopf: string;
  knopfLaeuft: string;
}) {
  const [zustand, ausfuehren, laeuft] = useActionState(aktion, START);

  return (
    <form action={ausfuehren}>
      <Beschriftet text={beschriftung.gueltigAb} sichtbar={sichtbar}>
        <input
          type="date"
          name="gueltig_ab"
          required
          defaultValue={vorgabe?.gueltigAb}
          aria-label={sichtbar ? undefined : beschriftung.gueltigAb}
        />
      </Beschriftet>{" "}
      <Beschriftet text={beschriftung.betrag} sichtbar={sichtbar}>
        <input
          name="betrag"
          inputMode="decimal"
          required
          defaultValue={vorgabe?.betrag}
          aria-label={sichtbar ? undefined : beschriftung.betrag}
        />
      </Beschriftet>{" "}
      <button type="submit" disabled={laeuft}>
        {laeuft ? knopfLaeuft : knopf}
      </button>
      {zustand.fehler && <p role="alert">{zustand.fehler}</p>}
      {zustand.meldung && <p role="status">{zustand.meldung}</p>}
    </form>
  );
}

function Beschriftet({
  text,
  sichtbar,
  children,
}: {
  text: string;
  sichtbar: boolean;
  children: ReactNode;
}) {
  if (!sichtbar) return children;
  return (
    <label>
      {text} {children}
    </label>
  );
}
