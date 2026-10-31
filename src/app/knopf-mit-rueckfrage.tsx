"use client";

import { useActionState, useState, type ReactNode } from "react";
import { START, type Rueckmeldung } from "@/lib/rueckmeldung";

// Ein Knopf für Aktionen, die man nicht aus Versehen auslösen soll: Der
// erste Klick fragt nach, erst "Ja" führt die Aktion aus. Die Rückfrage
// erscheint erst nach dem ersten Klick. klassen gestalten den Knopf (auch
// das "Ja"), das Abbrechen und die Fehlermeldung, z. B. groß am Handy.
export function KnopfMitRueckfrage({
  aktion,
  knopf,
  rueckfrage,
  bestaetigen,
  abbrechen,
  knopfLaeuft,
  klassen = {},
}: {
  aktion: (vorher: Rueckmeldung) => Promise<Rueckmeldung>;
  knopf: string;
  rueckfrage: ReactNode;
  bestaetigen: string;
  abbrechen: string;
  knopfLaeuft: string;
  klassen?: { knopf?: string; abbrechen?: string; fehler?: string };
}) {
  const [fragen, setFragen] = useState(false);
  const [zustand, ausfuehren, laeuft] = useActionState(aktion, START);

  return (
    <form action={ausfuehren}>
      {fragen ? (
        <>
          <p>{rueckfrage}</p>
          <button type="submit" disabled={laeuft} className={klassen.knopf}>
            {laeuft ? knopfLaeuft : bestaetigen}
          </button>{" "}
          <button
            type="button"
            disabled={laeuft}
            onClick={() => setFragen(false)}
            className={klassen.abbrechen}
          >
            {abbrechen}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setFragen(true)} className={klassen.knopf}>
          {knopf}
        </button>
      )}
      {zustand.fehler && (
        <p role="alert" className={klassen.fehler}>
          {zustand.fehler}
        </p>
      )}
      {zustand.meldung && <p role="status">{zustand.meldung}</p>}
    </form>
  );
}
