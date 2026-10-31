import { expect, test } from "vitest";
import { auswertungsZeitraum, monatsZeitraum, vorausgewaehlterMonat } from "./zeitraum";

test("Bis einschließlich zum 10. ist der Vormonat vorausgewählt, ab dem 11. der aktuelle Monat, nach dem Kalender in Berlin", () => {
  // 23:59:59 am 10.10. in Berlin (Sommerzeit, UTC + 2).
  expect(vorausgewaehlterMonat(Date.parse("2026-10-10T21:59:59Z"))).toBe("2026-09");
  // Mitternacht am 11.10. in Berlin, in UTC noch der 10.
  expect(vorausgewaehlterMonat(Date.parse("2026-10-10T22:00:00Z"))).toBe("2026-10");
  expect(vorausgewaehlterMonat(Date.parse("2026-10-31T09:41:07Z"))).toBe("2026-10");
});

test("Im Januar ist bis zum 10. der Dezember des Vorjahres vorausgewählt", () => {
  // 23:59:59 am 10.01. in Berlin (Winterzeit, UTC + 1).
  expect(vorausgewaehlterMonat(Date.parse("2027-01-10T22:59:59Z"))).toBe("2026-12");
  // Kurz nach Mitternacht am 1.01. in Berlin, in UTC noch der 31.12.
  expect(vorausgewaehlterMonat(Date.parse("2026-12-31T23:20:41Z"))).toBe("2026-12");
  expect(vorausgewaehlterMonat(Date.parse("2027-01-11T08:03:52Z"))).toBe("2027-01");
});

test("Ein Monat reicht vom ersten bis zum letzten Tag, auch im Februar und im Schaltjahr", () => {
  expect(monatsZeitraum("2026-02")).toEqual({ von: "2026-02-01", bis: "2026-02-28" });
  expect(monatsZeitraum("2028-02")).toEqual({ von: "2028-02-01", bis: "2028-02-29" });
  expect(monatsZeitraum("2026-04")).toEqual({ von: "2026-04-01", bis: "2026-04-30" });
  expect(monatsZeitraum("2026-12")).toEqual({ von: "2026-12-01", bis: "2026-12-31" });
});

test("Ohne Angaben gilt der vorausgewählte Monat, ganze Tage in Berlin", () => {
  // Kurz nach Mitternacht in Berlin ist schon der 1.11., in UTC noch der 31.10.
  const jetzt = Date.parse("2026-10-31T23:20:41Z");
  expect(auswertungsZeitraum({}, jetzt)).toEqual({
    von: "2026-10-01",
    bis: "2026-10-31",
    monat: "2026-10",
    // Mitternacht in Berlin: am 1.10. Sommerzeit (UTC + 2), am 1.11.
    // Winterzeit (UTC + 1).
    ab: "2026-09-30T22:00:00.000Z",
    bisVor: "2026-10-31T23:00:00.000Z",
  });
  // Ab dem 11. der aktuelle Monat.
  expect(auswertungsZeitraum({}, Date.parse("2026-11-11T07:12:33Z"))).toMatchObject({
    von: "2026-11-01",
    bis: "2026-11-30",
    monat: "2026-11",
  });
});

test("Im Januar bis zum 10. gilt ohne Angaben der Dezember des Vorjahres", () => {
  const jetzt = Date.parse("2027-01-10T10:03:52Z");
  expect(auswertungsZeitraum({}, jetzt)).toMatchObject({
    von: "2026-12-01",
    bis: "2026-12-31",
    monat: "2026-12",
  });
});

test("Ein eingegebener Zeitraum gilt mit beiden Tagen, auch vertauscht", () => {
  const jetzt = Date.parse("2026-10-23T09:14:27Z");
  expect(auswertungsZeitraum({ von: "2026-03-31", bis: "2026-03-29" }, jetzt)).toEqual({
    von: "2026-03-29",
    bis: "2026-03-31",
    // Kein ganzer Monat.
    monat: null,
    // Am 29.03.2026 beginnt die Sommerzeit.
    ab: "2026-03-28T23:00:00.000Z",
    bisVor: "2026-03-31T22:00:00.000Z",
  });
});

test("Ein eingegebener Zeitraum vom ersten bis zum letzten Tag eines Monats ist dieser Monat", () => {
  const jetzt = Date.parse("2026-10-23T09:14:27Z");
  expect(auswertungsZeitraum({ von: "2028-02-01", bis: "2028-02-29" }, jetzt).monat).toBe(
    "2028-02",
  );
  // Ein Tag zu kurz oder über zwei Monate: kein Monat.
  expect(auswertungsZeitraum({ von: "2028-02-01", bis: "2028-02-28" }, jetzt).monat).toBeNull();
  expect(auswertungsZeitraum({ von: "2026-03-01", bis: "2026-04-30" }, jetzt).monat).toBeNull();
});

test("Ungültige oder mehrfache Tage ersetzt der vorausgewählte Monat", () => {
  const jetzt = Date.parse("2026-10-23T09:14:27Z");
  expect(
    auswertungsZeitraum({ von: "2026-02-30", bis: ["2026-03-01", "2026-03-02"] }, jetzt),
  ).toMatchObject({ von: "2026-10-01", bis: "2026-10-31", monat: "2026-10" });
});
