import { expect, test } from "vitest";
import { berlinerUhrzeit, berlinerZeitpunkt, tagVerschoben } from "./berliner-zeit";

test("Eine Uhrzeit in Berlin wird zum richtigen Zeitpunkt, im Sommer wie im Winter", () => {
  // Sommerzeit: UTC + 2 Stunden, Winterzeit: UTC + 1 Stunde.
  expect(new Date(berlinerZeitpunkt("2026-10-16", "08:15")).toISOString()).toBe(
    "2026-10-16T06:15:00.000Z",
  );
  expect(new Date(berlinerZeitpunkt("2026-12-01", "23:59")).toISOString()).toBe(
    "2026-12-01T22:59:00.000Z",
  );
});

test("Am Tag der Zeitumstellung gilt vor und nach der Umstellung die jeweilige Zeit", () => {
  // Am 25.10.2026 springt die Uhr um 03:00 Sommerzeit auf 02:00 zurück.
  expect(new Date(berlinerZeitpunkt("2026-10-25", "01:30")).toISOString()).toBe(
    "2026-10-24T23:30:00.000Z",
  );
  expect(new Date(berlinerZeitpunkt("2026-10-25", "12:00")).toISOString()).toBe(
    "2026-10-25T11:00:00.000Z",
  );
  // Am 29.03.2026 springt sie um 02:00 auf 03:00 vor.
  expect(new Date(berlinerZeitpunkt("2026-03-29", "01:00")).toISOString()).toBe(
    "2026-03-29T00:00:00.000Z",
  );
  expect(new Date(berlinerZeitpunkt("2026-03-29", "09:00")).toISOString()).toBe(
    "2026-03-29T07:00:00.000Z",
  );
});

test("Eine Uhrzeit, die es wegen der Zeitumstellung zweimal gibt, gilt beim zweiten Mal", () => {
  // Am 25.10.2026 gibt es 02:00 bis 03:00 zweimal: erst in Sommerzeit,
  // dann in Winterzeit. Gemeint ist das zweite Mal (UTC + 1 Stunde).
  expect(new Date(berlinerZeitpunkt("2026-10-25", "02:30")).toISOString()).toBe(
    "2026-10-25T01:30:00.000Z",
  );
});

test("Die Uhrzeit in Berlin zu einem Zeitpunkt, als Stunden und Minuten", () => {
  expect(berlinerUhrzeit(Date.parse("2026-10-16T06:15:00Z"))).toBe("08:15");
  expect(berlinerUhrzeit(Date.parse("2026-12-01T22:59:00Z"))).toBe("23:59");
  expect(berlinerUhrzeit(Date.parse("2026-10-15T22:05:00Z"))).toBe("00:05");
});

test("Mit ‹ › geht es einen Tag zurück oder vor, auch über Monats- und Jahresgrenzen", () => {
  expect(tagVerschoben("2026-03-01", -1)).toBe("2026-02-28");
  expect(tagVerschoben("2026-12-31", 1)).toBe("2027-01-01");
  // Die Zeitumstellung am 25.10.2026 ändert nichts.
  expect(tagVerschoben("2026-10-25", 1)).toBe("2026-10-26");
});
