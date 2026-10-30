"use client";

import { useActionState } from "react";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";
import { texte } from "@/texte";

// Legt in einer Zeile der Tabelle den Stundensatz des Objekts für eine
// Tätigkeit fest. Das Feld steht schon auf dem Satz, der bisher gilt.
export function ObjektStundensatzFormular({
  aktion,
  taetigkeit,
  vorgabe,
}: {
  aktion: (vorher: Rueckmeldung, formData: FormData) => Promise<Rueckmeldung>;
  taetigkeit: { id: string; name: string };
  // Als Eingabe, z. B. "32,50".
  vorgabe: string;
}) {
  const [zustand, ausfuehren, laeuft] = useActionState(aktion, START);

  return (
    <form action={ausfuehren}>
      <input type="hidden" name="taetigkeit_id" value={taetigkeit.id} />
      <input
        name="stundensatz"
        inputMode="decimal"
        required
        defaultValue={vorgabe}
        aria-label={texte.objektStundensaetze.stundensatzFuer(taetigkeit.name)}
      />{" "}
      <button type="submit" disabled={laeuft}>
        {laeuft ? texte.stundensaetze.festlegenLaeuft : texte.stundensaetze.festlegen}
      </button>
      {zustand.fehler && <p role="alert">{zustand.fehler}</p>}
      {zustand.meldung && <p role="status">{zustand.meldung}</p>}
    </form>
  );
}
