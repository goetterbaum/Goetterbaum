// Die Positionen aus dem Rechenbaustein als Zeilen mit Namen statt
// Kennungen, in seiner Reihenfolge. Anzeige und CSV-Export zeigen genau
// diese Zeilen; Mengen und Beträge kommen unverändert aus dem Baustein.
import type { Rechnungsvorbereitung } from "@/lib/rechnungsvorbereitung";
import { texte } from "@/texte";
import { monatAlsText, monateAlsText, type Monate } from "./zeitraum";

export type Zeile = {
  position: string;
  objekt: string;
  // Die Beschreibung, nur bei Zusatzaufträgen.
  zusatzauftrag: string;
  // Leer bei Pauschalen und Festbeträgen.
  taetigkeit: string;
  // Bei Pauschalen ihr Monat, sonst die Monate der Rechnungsvorbereitung.
  zeitraum: string;
  // Gerundete Minuten und Stundensatz nur bei Stunden.
  minuten: number | null;
  stundensatzCent: number | null;
  betragCent: number;
};

// Alle Zeilen und die Summe aus dem Rechenbaustein.
export type Zeilen = { zeilen: Zeile[]; summeCent: number };

export type Namen = {
  objekte: Map<string, string>;
  taetigkeiten: Map<string, string>;
  zusatzauftraege: Map<string, string>;
};

// monate: die Monate der Rechnungsvorbereitung; beim einzeln abgerechneten
// Zusatzauftrag die Monate seiner Zeit, null, wenn er keine hat.
export function rechnungsZeilen(
  ergebnis: Rechnungsvorbereitung,
  namen: Namen,
  monate: Monate | null,
): Zeilen {
  const t = texte.rechnungsvorbereitung;
  const name = (liste: Map<string, string>, id: string) => liste.get(id) ?? t.unbekannt;
  const zeitraum = monate === null ? "" : monateAlsText(monate);

  const zeilen = ergebnis.positionen.map((p): Zeile => {
    const gemeinsam = {
      position: t.positionen[p.art],
      objekt: name(namen.objekte, p.objektId),
      zusatzauftrag: "zusatzauftragId" in p ? name(namen.zusatzauftraege, p.zusatzauftragId) : "",
      betragCent: p.betragCent,
    };
    switch (p.art) {
      case "pauschale":
        return {
          ...gemeinsam,
          taetigkeit: "",
          zeitraum: monatAlsText(p.monat),
          minuten: null,
          stundensatzCent: null,
        };
      case "zusatzauftrag-festbetrag":
        return { ...gemeinsam, taetigkeit: "", zeitraum, minuten: null, stundensatzCent: null };
      case "stunden":
      case "zusatzauftrag-stunden":
        return {
          ...gemeinsam,
          taetigkeit: name(namen.taetigkeiten, p.taetigkeitId),
          zeitraum,
          minuten: p.minuten,
          stundensatzCent: p.stundensatzCent,
        };
    }
  });
  return { zeilen, summeCent: ergebnis.summeCent };
}

// Minuten als Stunden und Minuten, z. B. „1:15“. So bleibt auch eine
// minutengenaue Dauer exakt, die als Kommazahl nicht aufginge.
export function stundenAlsText(minuten: number): string {
  return `${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, "0")}`;
}
