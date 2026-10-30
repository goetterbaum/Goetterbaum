import { expect, test } from "vitest";
import { gewaehlterZeitraum, monateDerZeit } from "./zeitraum";

test("Monatlich: ohne Angabe wird der Vormonat vorgeschlagen, ganze Tage in Berlin", () => {
  // Kurz nach Mitternacht in Berlin ist schon der 1.11., in UTC noch der 31.10.
  const jetzt = Date.parse("2026-10-31T23:20:41Z");
  expect(gewaehlterZeitraum(undefined, "monatlich", jetzt)).toEqual({
    ersterMonat: "2026-10",
    bezeichnung: "Oktober 2026",
    monate: { von: "2026-10", bis: "2026-10" },
    // Am 25.10. endet die Sommerzeit: Beginn UTC + 2, Ende UTC + 1.
    ab: "2026-09-30T22:00:00.000Z",
    bisVor: "2026-10-31T23:00:00.000Z",
  });
});

test("Quartalsweise: ohne Angabe wird das letzte abgeschlossene Quartal vorgeschlagen", () => {
  const jetzt = Date.parse("2027-01-04T08:12:09Z");
  expect(gewaehlterZeitraum(undefined, "quartalsweise", jetzt)).toEqual({
    ersterMonat: "2026-10",
    bezeichnung: "4. Quartal 2026",
    monate: { von: "2026-10", bis: "2026-12" },
    ab: "2026-09-30T22:00:00.000Z",
    bisVor: "2026-12-31T23:00:00.000Z",
  });
});

test("Ein gewählter Monat gilt; quartalsweise zählt das Quartal, in dem er liegt", () => {
  const jetzt = Date.parse("2026-10-17T10:00:00Z");
  expect(gewaehlterZeitraum("2026-03", "monatlich", jetzt)).toEqual({
    ersterMonat: "2026-03",
    bezeichnung: "März 2026",
    monate: { von: "2026-03", bis: "2026-03" },
    // Am 29.03. beginnt die Sommerzeit.
    ab: "2026-02-28T23:00:00.000Z",
    bisVor: "2026-03-31T22:00:00.000Z",
  });
  expect(gewaehlterZeitraum("2026-05", "quartalsweise", jetzt)).toEqual({
    ersterMonat: "2026-04",
    bezeichnung: "2. Quartal 2026",
    monate: { von: "2026-04", bis: "2026-06" },
    ab: "2026-03-31T22:00:00.000Z",
    bisVor: "2026-06-30T22:00:00.000Z",
  });
});

test("Ein ungültiger oder mehrfach angegebener Monat ersetzt der Vorschlag", () => {
  const jetzt = Date.parse("2026-10-17T10:00:00Z");
  for (const wert of ["2026-13", "2026-1", "März", ["2026-03", "2026-04"]]) {
    expect(gewaehlterZeitraum(wert, "monatlich", jetzt).ersterMonat).toBe("2026-09");
  }
});

test("Die Monate der Zeit eines Zusatzauftrags reichen vom ersten bis zum letzten Beginn in Berlin", () => {
  expect(
    monateDerZeit([
      "2026-11-12T08:04:51+00:00",
      // In Berlin schon der 1.9., in UTC noch der 31.8.
      "2026-08-31T22:30:19+00:00",
      "2026-10-02T09:41:07+00:00",
    ]),
  ).toEqual({ von: "2026-09", bis: "2026-11" });
  expect(monateDerZeit(["2026-03-31T21:59:59+00:00"])).toEqual({ von: "2026-03", bis: "2026-03" });
});

test("Ohne Zeit hat ein Zusatzauftrag keine Monate", () => {
  expect(monateDerZeit([])).toBeNull();
});
