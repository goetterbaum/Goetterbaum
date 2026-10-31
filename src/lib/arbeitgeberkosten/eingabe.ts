import { euroInCent, HOECHSTER_BETRAG_CENT } from "@/lib/geld";
import { istDatum } from "@/lib/zeiterfassung/nachtrag";
import { texte } from "@/texte";

// Ein Wert der Arbeitgeberkosten, wie er in arbeitgeberkosten_standard
// bzw. arbeitgeberkosten_mitarbeiter steht (ohne Firma und Mitarbeiter,
// die kommen aus der Seite).
export type ArbeitgeberkostenDaten = {
  gueltig_ab: string;
  kosten_je_stunde_cent: number;
};

export type EingabeErgebnis =
  { ok: true; daten: ArbeitgeberkostenDaten } | { ok: false; fehler: string };

// Prüft „gültig ab“ und Betrag aus dem Formular. Ob es für den Tag schon
// einen Wert gibt, prüft die Datenbank.
export function pruefeArbeitgeberkostenEingabe(formData: FormData): EingabeErgebnis {
  const t = texte.arbeitgeberkosten;
  const gueltig_ab = String(formData.get("gueltig_ab") ?? "").trim();
  if (!istDatum(gueltig_ab)) return { ok: false, fehler: t.fehlerGueltigAb };
  const cent = euroInCent(String(formData.get("betrag") ?? ""));
  if (!cent || cent > HOECHSTER_BETRAG_CENT) return { ok: false, fehler: t.fehlerBetrag };
  return { ok: true, daten: { gueltig_ab, kosten_je_stunde_cent: cent } };
}
