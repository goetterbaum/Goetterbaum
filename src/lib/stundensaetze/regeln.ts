// Welcher Stundensatz einer Tätigkeit gilt: der speziellste Satz, also
// Objekt vor Kunde vor Standard. Der Rechenbaustein rechnet und die
// Seiten zeigen „Gilt“ nach dieser einen Regel.

export type Herkunft = "standard" | "kunde" | "objekt";

// Die Sätze einer Tätigkeit in Cent; null heißt: kein eigener Satz.
export type Stundensaetze = {
  standardCent: number;
  kundeCent: number | null;
  objektCent: number | null;
};

export function geltenderStundensatz(saetze: Stundensaetze): {
  stundensatzCent: number;
  herkunft: Herkunft;
} {
  if (saetze.objektCent !== null) {
    return { stundensatzCent: saetze.objektCent, herkunft: "objekt" };
  }
  if (saetze.kundeCent !== null) {
    return { stundensatzCent: saetze.kundeCent, herkunft: "kunde" };
  }
  return { stundensatzCent: saetze.standardCent, herkunft: "standard" };
}

// Ob sich ein eigener Objektsatz lohnt. Gleicht er dem Satz, der ohne ihn
// gälte (Kunde, sonst Standard), wird er nicht gespeichert: Sonst bliebe
// das Objekt bei einer späteren Preisänderung beim Kunden unbemerkt beim
// alten Preis.
export function objektsatzNoetig(stundensatzCent: number, saetze: Stundensaetze): boolean {
  const bisher = geltenderStundensatz({ ...saetze, objektCent: null });
  return stundensatzCent !== bisher.stundensatzCent;
}
