import { expect, test } from "vitest";
import {
  angelegtVon,
  angezeigtAb,
  istUnvollstaendig,
  laeuftSeit,
  nachTagen,
  spalten,
  tagUndZeit,
  wasUndWo,
  type MeinZeiteintrag,
} from "./anzeige";

const ICH = "0b7c3a52-9d1e-4f6a-8c2b-1e5d7f9a3c41";
const VORARBEITER = "5e2f8b14-3a6c-4d9e-b7f1-2c8a4e6d0b93";

function eintrag(
  id: string,
  beginn: string,
  ende: string | null,
  ort: Partial<MeinZeiteintrag> = {},
): MeinZeiteintrag {
  return {
    id,
    art: "taetigkeit",
    beginn,
    ende,
    nachtrag: false,
    freigegeben: false,
    objekt_bezeichnung: "Haus A",
    taetigkeit_name: "Unterhaltsreinigung",
    zusatzauftrag_beschreibung: null,
    angelegt_von: ICH,
    angelegt_von_name: "Aylin Demir",
    ...ort,
  };
}

const FAHRT = { art: "fahrt", objekt_bezeichnung: null, taetigkeit_name: null } as const;

// Kurz zum Vergleichen: Kennung, von, bis, Dauer.
function kurz(tage: ReturnType<typeof nachTagen>) {
  return tage.map((tag) => ({
    titel: tag.titel,
    eintraege: tag.eintraege.map((e) => [e.id, e.von, e.bis, e.dauer]),
  }));
}

test("Beendete Einträge stehen je Kalendertag in Berlin, der neueste Tag zuerst", () => {
  // Mitte Oktober 2026 gilt Sommerzeit: Berlin ist UTC + 2 Stunden.
  const tage = nachTagen([
    eintrag("vormittag", "2026-10-16T06:00:00Z", "2026-10-16T08:30:00Z"),
    eintrag("fahrt", "2026-10-16T08:30:00Z", "2026-10-16T08:52:30Z", FAHRT),
    // In UTC noch der 15., in Berlin schon der 16. nach Mitternacht.
    eintrag("nachts", "2026-10-15T22:30:00Z", "2026-10-15T23:15:00Z"),
    eintrag("donnerstag", "2026-10-15T05:00:00Z", "2026-10-15T07:00:00Z"),
  ]);

  expect(kurz(tage)).toEqual([
    {
      titel: "Fr., 16.10.",
      eintraege: [
        ["nachts", "00:30", "01:15", "0:45 h"],
        ["vormittag", "08:00", "10:30", "2:30 h"],
        ["fahrt", "10:30", "10:52", "0:23 h"],
      ],
    },
    { titel: "Do., 15.10.", eintraege: [["donnerstag", "07:00", "09:00", "2:00 h"]] },
  ]);
});

test("Der laufende Eintrag steht nicht in der Liste der beendeten", () => {
  const tage = nachTagen([
    eintrag("laeuft", "2026-10-16T09:00:00Z", null),
    eintrag("fertig", "2026-10-16T06:00:00Z", "2026-10-16T08:00:00Z"),
  ]);
  expect(kurz(tage)).toEqual([
    { titel: "Fr., 16.10.", eintraege: [["fertig", "08:00", "10:00", "2:00 h"]] },
  ]);
});

test("Seit wann ein Eintrag läuft: heute nur die Uhrzeit, sonst mit Tag", () => {
  const jetzt = Date.parse("2026-10-16T12:00:00Z");
  expect(laeuftSeit("2026-10-16T06:15:00Z", jetzt)).toBe("08:15");
  // Kurz vor Mitternacht in Berlin, also gestern.
  expect(laeuftSeit("2026-10-15T21:45:00Z", jetzt)).toBe("Do., 15.10., 23:45");
});

test("Angezeigt werden heute und die sechs Tage davor, ab Mitternacht in Berlin", () => {
  expect(angezeigtAb(Date.parse("2026-10-16T12:00:00Z"))).toBe("2026-10-09T22:00:00.000Z");
  // Am 25.10. endet die Sommerzeit; der erste Tag liegt noch davor.
  expect(angezeigtAb(Date.parse("2026-10-27T12:00:00Z"))).toBe("2026-10-20T22:00:00.000Z");
});

test("Wer für einen Mitarbeiter erfasst hat, steht nur dabei, wenn er es nicht selbst war", () => {
  const selbst = eintrag("selbst", "2026-10-16T06:00:00Z", "2026-10-16T08:30:00Z");
  const fuerIhn = eintrag("vorarbeiter", "2026-10-16T08:30:00Z", "2026-10-16T09:00:00Z", {
    angelegt_von: VORARBEITER,
    angelegt_von_name: "Marek Nowak",
  });

  expect(angelegtVon(selbst, ICH)).toBeNull();
  expect(angelegtVon(fuerIhn, ICH)).toBe("Angelegt von Marek Nowak");
});

test("Ein Eintrag, der seit mehr als 12 Stunden läuft, ist unvollständig", () => {
  // Beginn Do., 15.10., 18:42:17 in Berlin.
  const beginn = "2026-10-15T16:42:17Z";
  expect(istUnvollstaendig({ beginn, ende: null }, Date.parse("2026-10-16T04:42:17Z"))).toBe(false);
  expect(istUnvollstaendig({ beginn, ende: null }, Date.parse("2026-10-16T04:42:18Z"))).toBe(true);
});

test("Ein beendeter Eintrag ist nie unvollständig, auch wenn er lang war", () => {
  const eintrag = { beginn: "2026-10-15T04:00:00Z", ende: "2026-10-15T18:30:00Z" };
  expect(istUnvollstaendig(eintrag, Date.parse("2026-10-16T12:00:00Z"))).toBe(false);
});

test("Die 12 Stunden gelten auch über die Zeitumstellung hinweg als echte Stunden", () => {
  // Am 25.10.2026 um 03:00 werden die Uhren in Berlin auf 02:00 zurückgestellt.
  // Beginn Sa., 24.10., 20:15 Sommerzeit; zwölf echte Stunden später ist es
  // So., 25.10., 07:15 Winterzeit.
  const beginn = "2026-10-24T18:15:00Z";
  expect(istUnvollstaendig({ beginn, ende: null }, Date.parse("2026-10-25T06:14:59Z"))).toBe(false);
  expect(istUnvollstaendig({ beginn, ende: null }, Date.parse("2026-10-25T06:15:01Z"))).toBe(true);
});

test("Was und wo: die Fahrt oder Objekt und Tätigkeit, dazu ein zugeordneter Zusatzauftrag", () => {
  const regulaer = eintrag("regulaer", "2026-10-16T06:00:00Z", "2026-10-16T08:30:00Z");
  const sturmschaden = eintrag("sturm", "2026-10-16T08:30:00Z", "2026-10-16T11:07:42Z", {
    taetigkeit_name: "Gartenpflege",
    zusatzauftrag_beschreibung: "Sturmschaden Hof",
  });
  const fahrt = eintrag("fahrt", "2026-10-16T11:07:42Z", "2026-10-16T11:31:05Z", FAHRT);

  expect(wasUndWo(regulaer)).toBe("Haus A · Unterhaltsreinigung");
  expect(wasUndWo(sturmschaden)).toBe("Haus A · Gartenpflege · Zusatzauftrag: Sturmschaden Hof");
  expect(wasUndWo(fahrt)).toBe("Fahrt");
});

test("Ein Eintrag in Spalten: Datum mit Jahr, Arbeitszeit von – bis und Dauer in Stunden", () => {
  // Mo., 12.10.2026, 07:00:14 bis 09:30:41 in Berlin (Sommerzeit).
  expect(spalten("2026-10-12T05:00:14Z", "2026-10-12T07:30:41Z", "läuft")).toEqual({
    datum: "Mo., 12.10.2026",
    arbeitszeit: "07:00 – 09:30",
    dauer: "2:30 Std.",
  });
});

test("Über Mitternacht: Datum des Beginns, Zusatz (+1 Tag) und die volle Dauer", () => {
  // Sa., 24.10.2026, 22:15:09 Sommerzeit bis So., 25.10., 06:40:52 Winterzeit:
  // In der Nacht wurde die Uhr um eine Stunde zurückgestellt, gearbeitet
  // wurden 9:26 Stunden.
  expect(spalten("2026-10-24T20:15:09Z", "2026-10-25T05:40:52Z", "läuft")).toEqual({
    datum: "Sa., 24.10.2026",
    arbeitszeit: "22:15 – 06:40 (+1 Tag)",
    dauer: "9:26 Std.",
  });
});

test("Ein Eintrag, der genau um Mitternacht endet, bekommt keinen Zusatz", () => {
  // Fr., 16.10.2026, 22:00:00 bis Sa., 17.10., 00:00:00 in Berlin: Am
  // Samstag wurde nicht gearbeitet.
  expect(spalten("2026-10-16T20:00:00Z", "2026-10-16T22:00:00Z", "läuft").arbeitszeit).toBe(
    "22:00 – 00:00",
  );
});

test("Ein Eintrag über mehrere Mitternächte nennt die Zahl der Tage", () => {
  // Fr., 16.10.2026, 18:05:33 bis So., 18.10., 07:12:08 in Berlin.
  expect(spalten("2026-10-16T16:05:33Z", "2026-10-18T05:12:08Z", "läuft")).toEqual({
    datum: "Fr., 16.10.2026",
    arbeitszeit: "18:05 – 07:12 (+2 Tage)",
    dauer: "37:07 Std.",
  });
});

test("Ein laufender Eintrag hat statt des Endes den Hinweis und keine Dauer", () => {
  // Beginn Mo., 12.10.2026, 07:00:38 in Berlin.
  expect(spalten("2026-10-12T05:00:38Z", null, "läuft")).toEqual({
    datum: "Mo., 12.10.2026",
    arbeitszeit: "07:00 – läuft",
    dauer: "",
  });
  expect(spalten("2026-10-12T05:00:38Z", null, "unvollständig").arbeitszeit).toBe(
    "07:00 – unvollständig",
  );
});

test("Tag und Zeit in einer Zeile: von – bis mit Leerzeichen um den Strich", () => {
  // Fr., 16.10.2026, 08:00:27 bis 10:30:51 in Berlin.
  expect(tagUndZeit("2026-10-16T06:00:27Z", "2026-10-16T08:30:51Z", "läuft")).toBe(
    "Fr., 16.10., 08:00 – 10:30",
  );
  expect(tagUndZeit("2026-10-16T06:00:27Z", null, "läuft")).toBe("Fr., 16.10., 08:00 – läuft");
});
