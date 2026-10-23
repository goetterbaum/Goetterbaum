import { expect, test } from "vitest";
import { auswertungsZeitraum } from "./zeitraum";

test("Ohne Angaben gilt der ganze Vormonat nach dem Kalender in Berlin", () => {
  // Kurz nach Mitternacht in Berlin ist schon der 1.11., in UTC noch der 31.10.
  const jetzt = Date.parse("2026-10-31T23:20:41Z");
  expect(auswertungsZeitraum({}, jetzt)).toEqual({
    von: "2026-10-01",
    bis: "2026-10-31",
    // Mitternacht in Berlin: am 1.10. Sommerzeit (UTC + 2), am 1.11.
    // Winterzeit (UTC + 1).
    ab: "2026-09-30T22:00:00.000Z",
    bisVor: "2026-10-31T23:00:00.000Z",
  });
});

test("Im Januar ist der Vormonat der Dezember des Vorjahres", () => {
  const jetzt = Date.parse("2027-01-15T10:03:52Z");
  expect(auswertungsZeitraum({}, jetzt)).toMatchObject({ von: "2026-12-01", bis: "2026-12-31" });
});

test("Ein eingegebener Zeitraum gilt mit beiden Tagen, auch vertauscht", () => {
  const jetzt = Date.parse("2026-10-23T09:14:27Z");
  expect(auswertungsZeitraum({ von: "2026-03-31", bis: "2026-03-29" }, jetzt)).toEqual({
    von: "2026-03-29",
    bis: "2026-03-31",
    // Am 29.03.2026 beginnt die Sommerzeit.
    ab: "2026-03-28T23:00:00.000Z",
    bisVor: "2026-03-31T22:00:00.000Z",
  });
});

test("Ungültige oder mehrfache Tage ersetzt der Vormonat", () => {
  const jetzt = Date.parse("2026-10-23T09:14:27Z");
  expect(
    auswertungsZeitraum({ von: "2026-02-30", bis: ["2026-03-01", "2026-03-02"] }, jetzt),
  ).toMatchObject({ von: "2026-09-01", bis: "2026-09-30" });
});
