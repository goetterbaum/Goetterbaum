// Die Regel der Live-Erfassung: In welchem Zustand ist die Erfassung eines
// Mitarbeiters, und welche Knöpfe hat sie dann? Dieselben Bedingungen
// prüft die Datenbank zusätzlich (Migration zu Fahrt und Arbeitstag).
import { istUnvollstaendig, type MeinZeiteintrag } from "./anzeige";

// nichts: Es läuft kein Zeiteintrag. objekt: Eine Tätigkeit in einem Objekt
// läuft. fahrt: Eine Fahrt läuft. unvollstaendig: Ein Zeiteintrag läuft seit
// mehr als 12 Stunden.
export type ZustandDerErfassung = "nichts" | "objekt" | "fahrt" | "unvollstaendig";

export function zustandDerErfassung(
  laufender: Pick<MeinZeiteintrag, "art" | "beginn" | "ende"> | undefined,
  jetzt: number,
): ZustandDerErfassung {
  if (!laufender) return "nichts";
  if (istUnvollstaendig(laufender, jetzt)) return "unvollstaendig";
  return laufender.art === "fahrt" ? "fahrt" : "objekt";
}

export type Knoepfe = {
  // Objekt, Tätigkeit und Zusatzauftrag wählen und Start. Während einer
  // Fahrt beendet der Start die Fahrt und beginnt das Objekt in einem
  // Schritt.
  startFormular: boolean;
  fahrtStarten: boolean;
  // Beendet das Objekt und startet in einem Schritt eine Fahrt.
  fertigHier: boolean;
  // Beendet den laufenden Eintrag, danach startet nichts.
  arbeitstagBeenden: boolean;
  // Statt eines Knopfs das Formular für das richtige Ende.
  endeNachtragen: boolean;
};

export function knoepfe(zustand: ZustandDerErfassung): Knoepfe {
  return {
    startFormular: zustand === "nichts" || zustand === "fahrt",
    fahrtStarten: zustand === "nichts",
    fertigHier: zustand === "objekt",
    arbeitstagBeenden: zustand === "objekt" || zustand === "fahrt",
    endeNachtragen: zustand === "unvollstaendig",
  };
}

// Kürzere Fahrten speichert die Datenbank nicht, z. B. nach einem
// versehentlichen „Fertig hier“ oder einem Tätigkeitswechsel am selben Ort.
export const MINI_FAHRT_MINUTEN = 2;

// Ob eine laufende Fahrt gespeichert bleibt, wenn sie zum Zeitpunkt ende
// endet.
export function fahrtWirdGespeichert(beginn: string, ende: number): boolean {
  return ende - Date.parse(beginn) >= MINI_FAHRT_MINUTEN * 60 * 1000;
}
