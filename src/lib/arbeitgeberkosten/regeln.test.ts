import { expect, test } from "vitest";
import { geltendeArbeitgeberkosten } from "./regeln";

// Standard der Firma: 26,00 € ab 01.01.2026, nach der Lohnerhöhung
// 27,50 € ab 01.04.2026.
const STANDARD = [
  { gueltigAb: "2026-01-01", centJeStunde: 2600 },
  { gueltigAb: "2026-04-01", centJeStunde: 2750 },
];

test("Ohne eigenen Wert gilt der Standard mit dem spätesten „gültig ab“ bis zu diesem Tag", () => {
  expect(geltendeArbeitgeberkosten("2026-03-15", [], STANDARD)).toEqual({
    centJeStunde: 2600,
    herkunft: "standard",
  });
  expect(geltendeArbeitgeberkosten("2026-10-31", [], STANDARD)).toEqual({
    centJeStunde: 2750,
    herkunft: "standard",
  });
});

test("Ein eigener Wert des Mitarbeiters geht vor dem Standard", () => {
  const eigene = [{ gueltigAb: "2026-02-01", centJeStunde: 3100 }];
  expect(geltendeArbeitgeberkosten("2026-10-31", eigene, STANDARD)).toEqual({
    centJeStunde: 3100,
    herkunft: "eigener-wert",
  });
  // Auch ohne Standard.
  expect(geltendeArbeitgeberkosten("2026-10-31", eigene, [])).toEqual({
    centJeStunde: 3100,
    herkunft: "eigener-wert",
  });
});

test("Ein eigener Wert gilt erst ab seinem „gültig ab“, davor gilt der Standard", () => {
  const eigene = [{ gueltigAb: "2026-05-01", centJeStunde: 3100 }];
  expect(geltendeArbeitgeberkosten("2026-04-30", eigene, STANDARD)).toEqual({
    centJeStunde: 2750,
    herkunft: "standard",
  });
  expect(geltendeArbeitgeberkosten("2026-05-01", eigene, STANDARD)).toEqual({
    centJeStunde: 3100,
    herkunft: "eigener-wert",
  });
});

test("Ein neuer Wert gilt genau ab seinem „gültig ab“, am Tag davor noch der alte", () => {
  expect(geltendeArbeitgeberkosten("2026-03-31", [], STANDARD)?.centJeStunde).toBe(2600);
  expect(geltendeArbeitgeberkosten("2026-04-01", [], STANDARD)?.centJeStunde).toBe(2750);
});

test("Vor dem ersten Wert gilt keiner, auch nicht der spätere Standard", () => {
  expect(geltendeArbeitgeberkosten("2025-12-31", [], STANDARD)).toBeNull();
  expect(geltendeArbeitgeberkosten("2026-10-31", [], [])).toBeNull();
  expect(
    geltendeArbeitgeberkosten("2025-12-31", [{ gueltigAb: "2026-01-01", centJeStunde: 3100 }], []),
  ).toBeNull();
});

test("Die Reihenfolge des Verlaufs spielt keine Rolle", () => {
  const umgekehrt = [...STANDARD].reverse();
  expect(geltendeArbeitgeberkosten("2026-10-31", [], umgekehrt)?.centJeStunde).toBe(2750);
});
