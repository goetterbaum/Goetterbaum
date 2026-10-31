// Der Zeitraum einer Auswertung des Büros, aus der Adresszeile gelesen.
// Tage gelten in Berlin.
import { berlinerDatum, berlinerMitternacht } from "@/lib/berliner-zeit";
import type { Monat } from "@/lib/rechnungsvorbereitung";
import { istDatum } from "@/lib/zeiterfassung/nachtrag";

// von und bis sind Tage ("JJJJ-MM-TT"), beide eingeschlossen; monat ist
// der Monat ("JJJJ-MM"), wenn sie genau einen ganzen Monat umfassen, sonst
// null; ab und bisVor die Zeitpunkte dazu als ISO-Text (Mitternacht am
// ersten Tag bzw. am Tag nach dem letzten).
export type AuswertungsZeitraum = {
  von: string;
  bis: string;
  monat: Monat | null;
  ab: string;
  bisVor: string;
};

export type Parameter = Record<string, string | string[] | undefined>;

// Bis einschließlich zu diesem Tag gilt noch der Vormonat als vorausgewählt:
// Die Lohnabrechnungsfirma braucht die Stunden des Vormonats bis zum 10.
const STICHTAG = 10;

// Ein Tag als "JJJJ-MM-TT"; Monat und Tag dürfen über ihre Grenzen
// hinausgehen (Tag 0 ist der letzte des Vormonats).
function datum(jahr: number, monat: number, tag: number): string {
  return new Date(Date.UTC(jahr, monat - 1, tag)).toISOString().slice(0, 10);
}

// Der Monat, den die Auswertungen und die Freigabe ohne Angabe zeigen: bis
// zum Stichtag der Vormonat, danach der aktuelle Monat, nach dem Kalender
// in Berlin.
export function vorausgewaehlterMonat(jetzt: number): Monat {
  const [jahr, monat, tag] = berlinerDatum(jetzt).split("-").map(Number);
  return datum(jahr, tag <= STICHTAG ? monat - 1 : monat, 1).slice(0, 7);
}

// Erster und letzter Tag eines Monats ("JJJJ-MM").
export function monatsZeitraum(monat: Monat): { von: string; bis: string } {
  const [jahr, nummer] = monat.split("-").map(Number);
  return { von: datum(jahr, nummer, 1), bis: datum(jahr, nummer + 1, 0) };
}

// Der Monat, den von bis bis genau umfassen, sonst null.
function ganzerMonat(von: string, bis: string): Monat | null {
  const monat = monatsZeitraum(von.slice(0, 7));
  return monat.von === von && monat.bis === bis ? von.slice(0, 7) : null;
}

// Liest von und bis aus der Adresszeile. Ohne gültige Tage gilt der
// vorausgewählte Monat.
export function auswertungsZeitraum(parameter: Parameter, jetzt: number): AuswertungsZeitraum {
  const vorgabe = monatsZeitraum(vorausgewaehlterMonat(jetzt));
  const tag = (name: string, ersatz: string) => {
    const wert = parameter[name];
    const text = typeof wert === "string" ? wert.trim() : "";
    return istDatum(text) ? text : ersatz;
  };
  // Tage als "JJJJ-MM-TT" lassen sich als Text vergleichen.
  const [von, bis] = [tag("von", vorgabe.von), tag("bis", vorgabe.bis)].sort();
  const [bJahr, bMonat, bTag] = bis.split("-").map(Number);
  return {
    von,
    bis,
    monat: ganzerMonat(von, bis),
    ab: new Date(berlinerMitternacht(von)).toISOString(),
    bisVor: new Date(berlinerMitternacht(datum(bJahr, bMonat, bTag + 1))).toISOString(),
  };
}
