import { expect, test } from "vitest";
import { pruefeArbeitgeberkostenEingabe } from "./eingabe";

function formular(werte: Record<string, string>) {
  const formData = new FormData();
  for (const [name, wert] of Object.entries(werte)) formData.set(name, wert);
  return formData;
}

test("Arbeitgeberkosten in Euro mit Komma werden centgenau mit ihrem „gültig ab“ übernommen", () => {
  expect(
    pruefeArbeitgeberkostenEingabe(formular({ gueltig_ab: "2026-04-01", betrag: "27,5" })),
  ).toEqual({ ok: true, daten: { gueltig_ab: "2026-04-01", kosten_je_stunde_cent: 2750 } });
  expect(
    pruefeArbeitgeberkostenEingabe(formular({ gueltig_ab: "2026-01-01", betrag: " 31 € " })),
  ).toEqual({ ok: true, daten: { gueltig_ab: "2026-01-01", kosten_je_stunde_cent: 3100 } });
});

test("Ohne gültiges „gültig ab“ gibt es keine Arbeitgeberkosten", () => {
  for (const gueltig_ab of ["", "01.04.2026", "2026-02-30"]) {
    expect(
      pruefeArbeitgeberkostenEingabe(formular({ gueltig_ab, betrag: "27,50" })),
      gueltig_ab,
    ).toEqual({ ok: false, fehler: "Bitte gib an, ab welchem Tag der Betrag gilt." });
  }
});

test("Leere, negative oder unsinnige Beträge werden abgelehnt", () => {
  for (const betrag of ["", "0", "0,00", "-27,50", "abc", "27.50", "21.474.837,00"]) {
    expect(
      pruefeArbeitgeberkostenEingabe(formular({ gueltig_ab: "2026-04-01", betrag })),
      betrag,
    ).toEqual({
      ok: false,
      fehler: "Die Arbeitgeberkosten sind kein gültiger Betrag über 0 €. Beispiel: 27,50",
    });
  }
});
