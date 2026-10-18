import { expect, test } from "vitest";
import { pruefeEndeEingabe, pruefeNachtragEingabe } from "./nachtrag";

function formular(werte: Record<string, string>) {
  const formData = new FormData();
  for (const [name, wert] of Object.entries(werte)) formData.set(name, wert);
  return formData;
}

const OBJEKT = "4f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const TAETIGKEIT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ZUSATZAUFTRAG = "7c6d5e4f-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
// Freitag, 16.10.2026, 14:00 in Berlin (Sommerzeit).
const JETZT = Date.parse("2026-10-16T12:00:00Z");

const TAETIGKEIT_AM_MORGEN = {
  art: "taetigkeit",
  objekt: OBJEKT,
  taetigkeit: TAETIGKEIT,
  datum: "2026-10-16",
  von: "07:30",
  bis: "09:45",
};

test("Eine nachgetragene Tätigkeit wird mit Berliner Uhrzeit übernommen", () => {
  expect(pruefeNachtragEingabe(formular(TAETIGKEIT_AM_MORGEN), JETZT)).toEqual({
    ok: true,
    daten: {
      art: "taetigkeit",
      objekt_id: OBJEKT,
      taetigkeit_id: TAETIGKEIT,
      zusatzauftrag_id: null,
      beginn: "2026-10-16T05:30:00.000Z",
      ende: "2026-10-16T07:45:00.000Z",
    },
  });
});

test("Ein Nachtrag kann einem Zusatzauftrag zugeordnet werden", () => {
  expect(
    pruefeNachtragEingabe(
      formular({ ...TAETIGKEIT_AM_MORGEN, zusatzauftrag: ZUSATZAUFTRAG }),
      JETZT,
    ),
  ).toMatchObject({ ok: true, daten: { zusatzauftrag_id: ZUSATZAUFTRAG } });
  expect(
    pruefeNachtragEingabe(formular({ ...TAETIGKEIT_AM_MORGEN, zusatzauftrag: "x" }), JETZT),
  ).toEqual({
    ok: false,
    fehler:
      "Dieser Zusatzauftrag steht nicht mehr zur Auswahl oder gehört nicht zum gewählten Objekt. Bitte lade die Seite neu.",
  });
});

test("Eine nachgetragene Fahrt hat kein Objekt, keine Tätigkeit und keinen Zusatzauftrag, auch wenn welche mitkommen", () => {
  const fahrt = {
    ...TAETIGKEIT_AM_MORGEN,
    art: "fahrt",
    datum: "2026-01-15",
    zusatzauftrag: ZUSATZAUFTRAG,
  };
  expect(pruefeNachtragEingabe(formular(fahrt), JETZT)).toEqual({
    ok: true,
    daten: {
      art: "fahrt",
      objekt_id: null,
      taetigkeit_id: null,
      zusatzauftrag_id: null,
      beginn: "2026-01-15T06:30:00.000Z",
      ende: "2026-01-15T08:45:00.000Z",
    },
  });
});

test("Eine Tätigkeit braucht Objekt und Tätigkeit", () => {
  expect(pruefeNachtragEingabe(formular({ ...TAETIGKEIT_AM_MORGEN, objekt: "" }), JETZT)).toEqual({
    ok: false,
    fehler: "Bitte wähle ein Objekt.",
  });
  expect(
    pruefeNachtragEingabe(formular({ ...TAETIGKEIT_AM_MORGEN, taetigkeit: "x" }), JETZT),
  ).toEqual({ ok: false, fehler: "Bitte wähle eine Tätigkeit." });
});

test("Ohne gültige Art, Datum oder Uhrzeit wird nichts nachgetragen", () => {
  const fehler = (werte: Record<string, string>) =>
    pruefeNachtragEingabe(formular({ ...TAETIGKEIT_AM_MORGEN, ...werte }), JETZT);

  expect(fehler({ art: "pause" })).toEqual({
    ok: false,
    fehler: "Bitte wähle Tätigkeit oder Fahrt.",
  });
  for (const datum of ["", "16.10.2026", "2026-02-30"]) {
    expect(fehler({ datum }), datum).toEqual({
      ok: false,
      fehler: "Bitte gib ein gültiges Datum ein.",
    });
  }
  for (const [von, bis] of [
    ["", "09:00"],
    ["07:00", "9 Uhr"],
    ["24:00", "25:00"],
  ]) {
    expect(fehler({ von, bis }), `${von}–${bis}`).toEqual({
      ok: false,
      fehler: "Bitte gib Beginn und Ende als Uhrzeit ein, z. B. 07:30.",
    });
  }
});

test("Das Ende muss nach dem Beginn liegen; über Mitternacht sind es zwei Einträge", () => {
  for (const [von, bis] of [
    ["22:00", "02:00"],
    ["08:00", "08:00"],
  ]) {
    expect(
      pruefeNachtragEingabe(formular({ ...TAETIGKEIT_AM_MORGEN, von, bis }), JETZT),
      `${von}–${bis}`,
    ).toEqual({
      ok: false,
      fehler:
        "Das Ende muss nach dem Beginn liegen. Über Mitternacht trage bitte zwei Einträge ein.",
    });
  }
});

test("Ein Nachtrag darf nicht in der Zukunft enden", () => {
  const bisJetzt = { ...TAETIGKEIT_AM_MORGEN, von: "13:00", bis: "14:00" };
  expect(pruefeNachtragEingabe(formular(bisJetzt), JETZT).ok).toBe(true);

  const fehlerZukunft = {
    ok: false,
    fehler: "Ein Nachtrag kann nicht in der Zukunft enden.",
  };
  expect(pruefeNachtragEingabe(formular({ ...bisJetzt, bis: "14:01" }), JETZT)).toEqual(
    fehlerZukunft,
  );
  expect(
    pruefeNachtragEingabe(formular({ ...TAETIGKEIT_AM_MORGEN, datum: "2026-10-17" }), JETZT),
  ).toEqual(fehlerZukunft);
});

test("Beim Ändern bleibt eine unveränderte Uhrzeit sekundengenau wie gespeichert", () => {
  // Live erfasst von 07:30:27 bis 09:45:51 (Berliner Zeit).
  const bisher = { beginn: "2026-10-16T05:30:27.000Z", ende: "2026-10-16T07:45:51.000Z" };

  expect(pruefeNachtragEingabe(formular(TAETIGKEIT_AM_MORGEN), JETZT, bisher)).toMatchObject({
    ok: true,
    daten: bisher,
  });
  expect(
    pruefeNachtragEingabe(formular({ ...TAETIGKEIT_AM_MORGEN, bis: "10:00" }), JETZT, bisher),
  ).toMatchObject({
    ok: true,
    daten: { beginn: bisher.beginn, ende: "2026-10-16T08:00:00.000Z" },
  });
  // An einem anderen Tag gilt die neue Zeit.
  expect(
    pruefeNachtragEingabe(
      formular({ ...TAETIGKEIT_AM_MORGEN, datum: "2026-10-15" }),
      JETZT,
      bisher,
    ),
  ).toMatchObject({
    ok: true,
    daten: { beginn: "2026-10-15T05:30:00.000Z", ende: "2026-10-15T07:45:00.000Z" },
  });
});

test("Ein Live-Eintrag unter einer Minute lässt sich ändern, solange die Zeiten bleiben", () => {
  const bisher = { beginn: "2026-10-16T05:30:10.000Z", ende: "2026-10-16T05:30:40.000Z" };
  const kurz = { ...TAETIGKEIT_AM_MORGEN, von: "07:30", bis: "07:30" };
  expect(pruefeNachtragEingabe(formular(kurz), JETZT, bisher)).toMatchObject({
    ok: true,
    daten: bisher,
  });
});

// Ein unvollständiger Eintrag: live gestartet am Do., 15.10., 06:58:41 in
// Berlin und nie gestoppt. Jetzt ist Fr., 16.10., 14:00.
const UNVOLLSTAENDIG_SEIT = "2026-10-15T04:58:41.000Z";

test("Das nachgetragene Ende eines unvollständigen Eintrags gilt in Berliner Zeit", () => {
  expect(
    pruefeEndeEingabe(formular({ datum: "2026-10-15", bis: "15:30" }), JETZT, UNVOLLSTAENDIG_SEIT),
  ).toEqual({ ok: true, ende: "2026-10-15T13:30:00.000Z" });
  // Auch am nächsten Tag, z. B. nach Mitternacht.
  expect(
    pruefeEndeEingabe(formular({ datum: "2026-10-16", bis: "00:15" }), JETZT, UNVOLLSTAENDIG_SEIT),
  ).toEqual({ ok: true, ende: "2026-10-15T22:15:00.000Z" });
});

test("Ohne gültiges Datum oder gültige Uhrzeit wird kein Ende nachgetragen", () => {
  const ende = (datum: string, bis: string) =>
    pruefeEndeEingabe(formular({ datum, bis }), JETZT, UNVOLLSTAENDIG_SEIT);
  for (const datum of ["", "15.10.2026", "2026-02-30"]) {
    expect(ende(datum, "15:30"), datum).toEqual({
      ok: false,
      fehler: "Bitte gib ein gültiges Datum ein.",
    });
  }
  for (const bis of ["", "15.30 Uhr", "24:00"]) {
    expect(ende("2026-10-15", bis), bis).toEqual({
      ok: false,
      fehler: "Bitte gib das Ende als Uhrzeit ein, z. B. 16:30.",
    });
  }
});

test("Das nachgetragene Ende liegt nach dem Beginn und nicht in der Zukunft", () => {
  const ende = (datum: string, bis: string) =>
    pruefeEndeEingabe(formular({ datum, bis }), JETZT, UNVOLLSTAENDIG_SEIT);
  const fehlerVorBeginn = { ok: false, fehler: "Das Ende muss nach dem Beginn liegen." };
  // Begonnen um 06:58:41: 06:58 liegt davor, 06:59 danach.
  expect(ende("2026-10-15", "06:58")).toEqual(fehlerVorBeginn);
  expect(ende("2026-10-14", "17:00")).toEqual(fehlerVorBeginn);
  expect(ende("2026-10-15", "06:59")).toEqual({ ok: true, ende: "2026-10-15T04:59:00.000Z" });

  const fehlerZukunft = { ok: false, fehler: "Ein Nachtrag kann nicht in der Zukunft enden." };
  expect(ende("2026-10-16", "14:00")).toEqual({ ok: true, ende: "2026-10-16T12:00:00.000Z" });
  expect(ende("2026-10-16", "14:01")).toEqual(fehlerZukunft);
});

test("Ein Ende über die Zeitumstellung hinweg gilt in der dann gültigen Berliner Zeit", () => {
  // Am 25.10.2026 springt die Uhr um 03:00 Sommerzeit auf 02:00 zurück.
  // Begonnen am Sa., 24.10., 20:15:09 Sommerzeit.
  const beginn = "2026-10-24T18:15:09.000Z";
  const jetzt = Date.parse("2026-10-25T12:00:00Z");
  const ende = (bis: string) =>
    pruefeEndeEingabe(formular({ datum: "2026-10-25", bis }), jetzt, beginn);
  expect(ende("01:30")).toEqual({ ok: true, ende: "2026-10-24T23:30:00.000Z" });
  expect(ende("03:30")).toEqual({ ok: true, ende: "2026-10-25T02:30:00.000Z" });
});
