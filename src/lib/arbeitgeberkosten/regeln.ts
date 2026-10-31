// Welche Arbeitgeberkosten je Stunde an einem Tag für einen Mitarbeiter
// gelten. Die Kostenanalyse rechnet und die Seiten zeigen „gilt“ nach
// dieser einen Regel.

export type Herkunft = "standard" | "eigener-wert";

// Ein Wert aus dem Verlauf; gueltigAb ist ein Kalendertag "JJJJ-MM-TT".
export type Arbeitgeberkosten = { gueltigAb: string; centJeStunde: number };

// Der eigene Wert des Mitarbeiters mit dem spätesten „gültig ab“ bis zu
// diesem Tag, sonst der Standard nach derselben Regel, sonst keiner (null).
export function geltendeArbeitgeberkosten(
  tag: string,
  eigeneWerte: Arbeitgeberkosten[],
  standard: Arbeitgeberkosten[],
): { centJeStunde: number; herkunft: Herkunft } | null {
  const eigener = spaetesterBis(tag, eigeneWerte);
  if (eigener) return { centJeStunde: eigener.centJeStunde, herkunft: "eigener-wert" };
  const standardWert = spaetesterBis(tag, standard);
  if (standardWert) return { centJeStunde: standardWert.centJeStunde, herkunft: "standard" };
  return null;
}

// Tage im Format "JJJJ-MM-TT" lassen sich als Text vergleichen.
function spaetesterBis(tag: string, werte: Arbeitgeberkosten[]): Arbeitgeberkosten | null {
  let gefunden: Arbeitgeberkosten | null = null;
  for (const wert of werte) {
    if (wert.gueltigAb <= tag && (!gefunden || wert.gueltigAb > gefunden.gueltigAb)) {
      gefunden = wert;
    }
  }
  return gefunden;
}
