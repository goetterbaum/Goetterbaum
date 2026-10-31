// Welcher Stundensatz einer Tätigkeit gilt: der speziellste Satz, also
// Zusatzauftrag vor Objekt vor Kunde vor Standard. Der Rechenbaustein
// rechnet und die Seiten zeigen „Gilt“ nach dieser einen Regel.

export type Herkunft = "standard" | "kunde" | "objekt" | "zusatzauftrag";

// Die Sätze einer Tätigkeit in Cent; null heißt: kein eigener Satz.
export type Stundensaetze = {
  standardCent: number;
  kundeCent: number | null;
  objektCent: number | null;
  // Nur bei Arbeit für einen Zusatzauftrag nach Stunden; sein Satz gilt
  // für alle seine Tätigkeiten.
  zusatzauftragCent?: number | null;
};

export function geltenderStundensatz(saetze: Stundensaetze): {
  stundensatzCent: number;
  herkunft: Herkunft;
} {
  if (saetze.zusatzauftragCent != null) {
    return { stundensatzCent: saetze.zusatzauftragCent, herkunft: "zusatzauftrag" };
  }
  if (saetze.objektCent !== null) {
    return { stundensatzCent: saetze.objektCent, herkunft: "objekt" };
  }
  if (saetze.kundeCent !== null) {
    return { stundensatzCent: saetze.kundeCent, herkunft: "kunde" };
  }
  return { stundensatzCent: saetze.standardCent, herkunft: "standard" };
}

// Was mit einem eingegebenen Objektsatz geschieht. Gleicht er dem Satz,
// der ohne ihn gälte (Kunde, sonst Standard), wird er nicht gespeichert
// und ein vorhandener Objektsatz entfernt: Sonst bliebe das Objekt bei
// einer späteren Preisänderung beim Kunden unbemerkt beim alten Preis.
export function objektsatzFestlegen(
  stundensatzCent: number,
  saetze: Stundensaetze,
): "speichern" | "nichts" | "entfernen" {
  const ohneObjektsatz = geltenderStundensatz({ ...saetze, objektCent: null });
  if (stundensatzCent !== ohneObjektsatz.stundensatzCent) return "speichern";
  return saetze.objektCent === null ? "nichts" : "entfernen";
}
