import { expect, test } from "vitest";
import { fahrtWirdGespeichert, knoepfe, zustandDerErfassung } from "./live-erfassung";

// Jetzt ist Fr., 16.10.2026, 14:00:00 in Berlin (Sommerzeit, UTC + 2).
const JETZT = Date.parse("2026-10-16T12:00:00Z");

const objekt = (beginn: string) => ({ art: "taetigkeit", beginn, ende: null }) as const;
const fahrt = (beginn: string) => ({ art: "fahrt", beginn, ende: null }) as const;

test("Läuft nichts, gibt es nur das Start-Formular, dazu wie bisher „Fahrt starten“", () => {
  expect(zustandDerErfassung(undefined, JETZT)).toBe("nichts");
  expect(knoepfe("nichts")).toEqual({
    startFormular: true,
    fahrtStarten: true,
    fertigHier: false,
    arbeitstagBeenden: false,
    endeNachtragen: false,
  });
});

test("Läuft ein Objekt, gibt es „Fertig hier“ und „Arbeitstag beenden“, aber keinen Start", () => {
  expect(zustandDerErfassung(objekt("2026-10-16T09:12:37Z"), JETZT)).toBe("objekt");
  expect(knoepfe("objekt")).toEqual({
    startFormular: false,
    fahrtStarten: false,
    fertigHier: true,
    arbeitstagBeenden: true,
    endeNachtragen: false,
  });
});

test("Läuft eine Fahrt, gibt es das Start-Formular fürs nächste Objekt und „Arbeitstag beenden“", () => {
  expect(zustandDerErfassung(fahrt("2026-10-16T11:48:05Z"), JETZT)).toBe("fahrt");
  expect(knoepfe("fahrt")).toEqual({
    startFormular: true,
    fahrtStarten: false,
    fertigHier: false,
    arbeitstagBeenden: true,
    endeNachtragen: false,
  });
});

test("Ein unvollständiger Eintrag hat nur das Formular für das richtige Ende", () => {
  // Seit Do., 15.10., 23:59:59 in Berlin, also 12 Stunden und eine Sekunde.
  for (const laufender of [objekt("2026-10-15T21:59:59Z"), fahrt("2026-10-15T21:59:59Z")]) {
    expect(zustandDerErfassung(laufender, JETZT), laufender.art).toBe("unvollstaendig");
  }
  expect(knoepfe("unvollstaendig")).toEqual({
    startFormular: false,
    fahrtStarten: false,
    fertigHier: false,
    arbeitstagBeenden: false,
    endeNachtragen: true,
  });
});

test("Eine Fahrt, die seit genau 12 Stunden läuft, ist noch nicht unvollständig", () => {
  expect(zustandDerErfassung(fahrt("2026-10-16T00:00:00Z"), JETZT)).toBe("fahrt");
});

test("Eine Fahrt unter 2 Minuten wird nicht gespeichert, ab 2 Minuten schon", () => {
  const beginn = "2026-10-16T11:58:00Z";
  expect(fahrtWirdGespeichert(beginn, Date.parse("2026-10-16T11:59:59.999Z"))).toBe(false);
  expect(fahrtWirdGespeichert(beginn, Date.parse("2026-10-16T12:00:00Z"))).toBe(true);
  expect(fahrtWirdGespeichert(beginn, Date.parse("2026-10-16T12:25:41Z"))).toBe(true);
});

test("Auch über Mitternacht zählt bei der Fahrt nur die echte Dauer", () => {
  // Von Do., 15.10., 23:59:10 bis Fr., 16.10., 00:01:09 in Berlin: 1:59 Minuten.
  const beginn = "2026-10-15T21:59:10Z";
  expect(fahrtWirdGespeichert(beginn, Date.parse("2026-10-15T22:01:09Z"))).toBe(false);
  expect(fahrtWirdGespeichert(beginn, Date.parse("2026-10-15T22:01:10Z"))).toBe(true);
});
