// Was eine Rechnungsvorbereitung umfasst, wenn das Büro sie als
// abgerechnet markiert: so, wie die Datenbank-Funktion
// als_abgerechnet_markieren es erwartet. Beträge kommen unverändert aus dem
// Rechenbaustein.
import { createHash } from "node:crypto";
import type { Position, Rechnungsvorbereitung } from "@/lib/rechnungsvorbereitung";
import { ersterTag } from "./zeitraum";

export type AbrechnungsUmfang = {
  zeiteintragIds: string[];
  // Monat als erster Tag ("JJJJ-MM-01").
  pauschalMonate: { objekt_id: string; monat: string }[];
  // Die Zusatzaufträge mit Festbetrag, die die Abrechnung abschließt.
  zusatzauftragIds: string[];
  summeCent: number;
  positionen: Position[];
};

// null, wenn es nichts abzurechnen gibt.
export function abrechnungsUmfang(ergebnis: Rechnungsvorbereitung): AbrechnungsUmfang | null {
  if (ergebnis.positionen.length === 0) return null;
  return {
    zeiteintragIds: ergebnis.zeiteintragIds,
    pauschalMonate: ergebnis.positionen.flatMap((p) =>
      p.art === "pauschale" ? [{ objekt_id: p.objektId, monat: ersterTag(p.monat) }] : [],
    ),
    zusatzauftragIds: ergebnis.positionen.flatMap((p) =>
      p.art === "zusatzauftrag-festbetrag" ? [p.zusatzauftragId] : [],
    ),
    summeCent: ergebnis.summeCent,
    positionen: ergebnis.positionen,
  };
}

// Ein Fingerabdruck dessen, was das Büro gesehen hat. Markiert wird nur,
// wenn die neu geladene Rechnungsvorbereitung noch genau so aussieht; ein
// inzwischen freigegebener Eintrag würde sonst ungesehen mit abgerechnet.
export function abrechnungsStand(ergebnis: Rechnungsvorbereitung): string {
  const inhalt = JSON.stringify({
    positionen: ergebnis.positionen,
    summeCent: ergebnis.summeCent,
    zeiteintragIds: [...ergebnis.zeiteintragIds].sort(),
  });
  return createHash("sha256").update(inhalt).digest("hex");
}
