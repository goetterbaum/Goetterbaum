// Der Zeitraum einer Auswertung des Büros, aus der Adresszeile gelesen.
// Tage gelten in Berlin.
import { berlinerDatum, berlinerMitternacht } from "@/lib/berliner-zeit";
import { istDatum } from "@/lib/zeiterfassung/nachtrag";

// von und bis sind Tage ("JJJJ-MM-TT"), beide eingeschlossen; ab und
// bisVor die Zeitpunkte dazu als ISO-Text (Mitternacht am ersten Tag bzw.
// am Tag nach dem letzten).
export type AuswertungsZeitraum = { von: string; bis: string; ab: string; bisVor: string };

export type Parameter = Record<string, string | string[] | undefined>;

// Ein Tag als "JJJJ-MM-TT"; Monat und Tag dürfen über ihre Grenzen
// hinausgehen (Tag 0 ist der letzte des Vormonats).
function datum(jahr: number, monat: number, tag: number): string {
  return new Date(Date.UTC(jahr, monat - 1, tag)).toISOString().slice(0, 10);
}

// Liest von und bis aus der Adresszeile. Ohne gültige Tage gilt der ganze
// Vormonat: Ausgewertet wird meist der abgelaufene Monat.
export function auswertungsZeitraum(parameter: Parameter, jetzt: number): AuswertungsZeitraum {
  const [jahr, monat] = berlinerDatum(jetzt).split("-").map(Number);
  const tag = (name: string, vorgabe: string) => {
    const wert = parameter[name];
    const text = typeof wert === "string" ? wert.trim() : "";
    return istDatum(text) ? text : vorgabe;
  };
  // Tage als "JJJJ-MM-TT" lassen sich als Text vergleichen.
  const [von, bis] = [
    tag("von", datum(jahr, monat - 1, 1)),
    tag("bis", datum(jahr, monat, 0)),
  ].sort();
  const [bJahr, bMonat, bTag] = bis.split("-").map(Number);
  return {
    von,
    bis,
    ab: new Date(berlinerMitternacht(von)).toISOString(),
    bisVor: new Date(berlinerMitternacht(datum(bJahr, bMonat, bTag + 1))).toISOString(),
  };
}
