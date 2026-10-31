import { expect, test } from "vitest";
import {
  arbeitstagOffen,
  fahrtWirdGespeichert,
  knoepfe,
  zustandDerErfassung,
} from "./live-erfassung";

// Jetzt ist Fr., 16.10.2026, 14:00:00 in Berlin (Sommerzeit, UTC + 2).
const JETZT = Date.parse("2026-10-16T12:00:00Z");

// Laufende Einträge; den Vermerk hat ein laufender nie.
const objekt = (beginn: string) =>
  ({ art: "taetigkeit", beginn, ende: null, arbeitstag_endet_hier: false }) as const;
const fahrt = (beginn: string) =>
  ({ art: "fahrt", beginn, ende: null, arbeitstag_endet_hier: false }) as const;

test("Ohne Zeiteinträge gibt es nur das Start-Formular, kein „Fahrt starten“", () => {
  expect(zustandDerErfassung([], JETZT)).toBe("nichts");
  expect(knoepfe("nichts")).toEqual({
    startFormular: true,
    fahrtStarten: false,
    fertigHier: false,
    pause: false,
    arbeitstagBeenden: false,
    endeNachtragen: false,
  });
});

// Ein beendeter Eintrag, mit oder ohne Vermerk „Arbeitstag endet hier“.
const beendet = (beginn: string, ende: string, arbeitstag_endet_hier = false) =>
  ({ art: "taetigkeit", beginn, ende, arbeitstag_endet_hier }) as const;

test("Nach einer Pause gibt es Start-Formular, „Fahrt starten“ und „Arbeitstag beenden“", () => {
  // Bis 13:30 in Berlin gearbeitet, davor ein Eintrag am Vormittag.
  const eintraege = [
    beendet("2026-10-16T09:00:00Z", "2026-10-16T11:30:00Z"),
    beendet("2026-10-16T06:00:00Z", "2026-10-16T08:45:00Z"),
  ];
  expect(zustandDerErfassung(eintraege, JETZT)).toBe("pause");
  expect(knoepfe("pause")).toEqual({
    startFormular: true,
    fahrtStarten: true,
    fertigHier: false,
    pause: false,
    arbeitstagBeenden: true,
    endeNachtragen: false,
  });
});

test("Nach „Arbeitstag beenden“ gibt es nur das Start-Formular", () => {
  const eintraege = [
    beendet("2026-10-16T06:00:00Z", "2026-10-16T08:45:00Z"),
    beendet("2026-10-16T09:00:00Z", "2026-10-16T11:30:00Z", true),
  ];
  expect(zustandDerErfassung(eintraege, JETZT)).toBe("nichts");
});

test("Genau 12 Stunden ohne Zeiteintrag ist der Arbeitstag noch offen, danach beendet", () => {
  // Ende Fr., 16.10., 02:00:00 in Berlin.
  const genau = [beendet("2026-10-15T22:00:00Z", "2026-10-16T00:00:00Z")];
  expect(arbeitstagOffen(genau, JETZT)).toBe(true);
  expect(zustandDerErfassung(genau, JETZT)).toBe("pause");
  // Eine Sekunde früher beendet.
  const laenger = [beendet("2026-10-15T22:00:00Z", "2026-10-15T23:59:59Z")];
  expect(arbeitstagOffen(laenger, JETZT)).toBe(false);
  expect(zustandDerErfassung(laenger, JETZT)).toBe("nichts");
});

test("Ein Arbeitstag über Mitternacht bleibt offen, solange keine 12 Stunden vergangen sind", () => {
  // Jetzt Sa., 17.10., 01:30 in Berlin; zuletzt bis Fr., 16.10., 23:10 gearbeitet.
  const nachMitternacht = Date.parse("2026-10-16T23:30:00Z");
  const eintraege = [
    beendet("2026-10-16T19:00:00Z", "2026-10-16T21:10:00Z"),
    beendet("2026-10-16T16:00:00Z", "2026-10-16T18:30:00Z"),
  ];
  expect(zustandDerErfassung(eintraege, nachMitternacht)).toBe("pause");
});

test("Entscheidend ist der zuletzt beendete Eintrag, auch wenn er zuerst in der Liste steht", () => {
  // Der Vermerk steht am früheren Eintrag, der spätere hat keinen.
  const eintraege = [
    beendet("2026-10-16T09:00:00Z", "2026-10-16T11:30:00Z"),
    beendet("2026-10-16T06:00:00Z", "2026-10-16T08:45:00Z", true),
  ];
  expect(arbeitstagOffen(eintraege, JETZT)).toBe(true);
  expect(arbeitstagOffen(eintraege.toReversed(), JETZT)).toBe(true);
});

test("Läuft ein Objekt, gibt es „Fertig hier“, „Pause“ und „Arbeitstag beenden“, aber keinen Start", () => {
  expect(zustandDerErfassung([objekt("2026-10-16T09:12:37Z")], JETZT)).toBe("objekt");
  expect(knoepfe("objekt")).toEqual({
    startFormular: false,
    fahrtStarten: false,
    fertigHier: true,
    pause: true,
    arbeitstagBeenden: true,
    endeNachtragen: false,
  });
});

test("Läuft eine Fahrt, gibt es das Start-Formular fürs nächste Objekt, „Pause“ und „Arbeitstag beenden“", () => {
  expect(zustandDerErfassung([fahrt("2026-10-16T11:48:05Z")], JETZT)).toBe("fahrt");
  expect(knoepfe("fahrt")).toEqual({
    startFormular: true,
    fahrtStarten: false,
    fertigHier: false,
    pause: true,
    arbeitstagBeenden: true,
    endeNachtragen: false,
  });
});

test("Ein unvollständiger Eintrag hat nur das Formular für das richtige Ende", () => {
  // Seit Do., 15.10., 23:59:59 in Berlin, also 12 Stunden und eine Sekunde.
  for (const laufender of [objekt("2026-10-15T21:59:59Z"), fahrt("2026-10-15T21:59:59Z")]) {
    expect(zustandDerErfassung([laufender], JETZT), laufender.art).toBe("unvollstaendig");
  }
  expect(knoepfe("unvollstaendig")).toEqual({
    startFormular: false,
    fahrtStarten: false,
    fertigHier: false,
    pause: false,
    arbeitstagBeenden: false,
    endeNachtragen: true,
  });
});

test("Eine Fahrt, die seit genau 12 Stunden läuft, ist noch nicht unvollständig", () => {
  expect(zustandDerErfassung([fahrt("2026-10-16T00:00:00Z")], JETZT)).toBe("fahrt");
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
