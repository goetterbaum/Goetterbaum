import { expect, test } from "vitest";
import { kostenZeitraum } from "./zeitraum";

// 31.10.2026, 14:00 in Berlin.
const JETZT = Date.parse("2026-10-31T14:00:00+01:00");

test("Ein ganzer Monat aus der Adresszeile ist der Zeitraum", () => {
  expect(kostenZeitraum({ von: "2026-07-01", bis: "2026-07-31" }, JETZT)).toEqual({
    monate: ["2026-07"],
    ganzesJahr: false,
    von: "2026-07-01",
    bis: "2026-07-31",
    bezeichnung: "Juli 2026",
  });
});

test("Vom 1. Januar bis zum 31. Dezember ist das ganze Jahr mit zwölf Monaten", () => {
  const zeitraum = kostenZeitraum({ von: "2025-01-01", bis: "2025-12-31" }, JETZT);
  expect(zeitraum.ganzesJahr).toBe(true);
  expect(zeitraum.bezeichnung).toBe("Jahr 2025");
  expect(zeitraum.monate).toEqual([
    "2025-01",
    "2025-02",
    "2025-03",
    "2025-04",
    "2025-05",
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
  ]);
});

test("Ohne Angabe oder mit einem anderen Zeitraum gilt der vorausgewählte Monat", () => {
  for (const parameter of [{}, { von: "2026-07-03", bis: "2026-07-20" }]) {
    expect(kostenZeitraum(parameter, JETZT)).toMatchObject({
      monate: ["2026-10"],
      von: "2026-10-01",
      bis: "2026-10-31",
    });
  }
});
