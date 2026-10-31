// Die Regel der Live-Erfassung: In welchem Zustand ist die Erfassung eines
// Mitarbeiters, und welche Knöpfe hat sie dann? Dieselben Bedingungen
// prüft die Datenbank zusätzlich (Migration zu Fahrt und Arbeitstag).
import { istUnvollstaendig, type MeinZeiteintrag } from "./anzeige";

// nichts: Es läuft kein Zeiteintrag, und es ist kein Arbeitstag offen.
// pause: Es läuft kein Zeiteintrag, aber der Arbeitstag ist offen. objekt:
// Eine Tätigkeit in einem Objekt läuft. fahrt: Eine Fahrt läuft.
// unvollstaendig: Ein Zeiteintrag läuft seit mehr als 12 Stunden.
export type ZustandDerErfassung = "nichts" | "pause" | "objekt" | "fahrt" | "unvollstaendig";

type Eintrag = Pick<MeinZeiteintrag, "art" | "beginn" | "ende" | "arbeitstag_endet_hier">;

// Nach so vielen Stunden ohne Zeiteintrag gilt ein Arbeitstag als beendet.
// Dieselbe Grenze steht in der Datenbank (privat.offener_arbeitstag_endet_mit).
export const ARBEITSTAG_ENDET_NACH_STUNDEN = 12;

// Ob der Arbeitstag offen ist: Es läuft etwas, oder der zuletzt beendete
// Eintrag hat keinen Vermerk „Arbeitstag endet hier“ und endete vor
// höchstens 12 Stunden.
export function arbeitstagOffen(eintraege: Eintrag[], jetzt: number): boolean {
  if (eintraege.some((e) => e.ende === null)) return true;
  const letzter = eintraege.reduce<Eintrag | undefined>(
    (bisher, e) => (!bisher || Date.parse(e.ende!) > Date.parse(bisher.ende!) ? e : bisher),
    undefined,
  );
  if (!letzter || letzter.arbeitstag_endet_hier) return false;
  return jetzt - Date.parse(letzter.ende!) <= ARBEITSTAG_ENDET_NACH_STUNDEN * 60 * 60 * 1000;
}

// eintraege: die Zeiteinträge des Mitarbeiters, mindestens die der letzten
// 12 Stunden und ein laufender, in beliebiger Reihenfolge.
export function zustandDerErfassung(eintraege: Eintrag[], jetzt: number): ZustandDerErfassung {
  const laufender = eintraege.find((e) => e.ende === null);
  if (!laufender) return arbeitstagOffen(eintraege, jetzt) ? "pause" : "nichts";
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
  pause: boolean;
  // Wie Pause, beendet aber auch den Arbeitstag. Nach einer Pause beendet
  // er nur den Arbeitstag.
  arbeitstagBeenden: boolean;
  // Statt eines Knopfs das Formular für das richtige Ende.
  endeNachtragen: boolean;
};

export function knoepfe(zustand: ZustandDerErfassung): Knoepfe {
  return {
    startFormular: zustand === "nichts" || zustand === "pause" || zustand === "fahrt",
    fahrtStarten: zustand === "pause",
    fertigHier: zustand === "objekt",
    pause: zustand === "objekt" || zustand === "fahrt",
    arbeitstagBeenden: zustand === "pause" || zustand === "objekt" || zustand === "fahrt",
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
