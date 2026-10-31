import { expect, test } from "vitest";
import { rechnungsvorbereitung } from "@/lib/rechnungsvorbereitung";
import { stundennachweisCsv } from "./stundennachweis";
import type { Namen } from "./zeilen";

const namen: Namen = {
  objekte: new Map([
    ["o-domplatz", "Büro Domplatz"],
    ["o-ring", "Wohnanlage Ringstraße"],
  ]),
  taetigkeiten: new Map([
    ["t-unterhalt", "Unterhaltsreinigung"],
    ["t-glas", "Glasreinigung"],
  ]),
  zusatzauftraege: new Map([["za-keller", "Wasserschaden Keller"]]),
};

// Ein Kunde im März 2026 mit einem Stunden- und einem Pauschal-Objekt.
// Bis zum 29.03. gilt in Berlin die Winterzeit (UTC + 1 Stunde).
function ergebnis() {
  const eintrag = (
    id: string,
    mitarbeiterId: string,
    objektId: string | null,
    taetigkeitId: string | null,
    beginn: string,
    ende: string,
    zusatzauftragId: string | null = null,
  ) => ({
    id,
    mitarbeiterId,
    art: objektId === null ? ("fahrt" as const) : ("taetigkeit" as const),
    objektId,
    taetigkeitId,
    zusatzauftragId,
    beginn,
    ende,
  });
  return rechnungsvorbereitung({
    kunde: { rundungsregel: "15-minuten", abrechnungszeitraum: "monatlich" },
    ersterMonat: "2026-03",
    objekte: [
      { id: "o-domplatz", abrechnungsart: "stunden", pauschaleCent: null },
      { id: "o-ring", abrechnungsart: "pauschale", pauschaleCent: 50000 },
    ],
    taetigkeiten: [
      { id: "t-unterhalt", standardStundensatzCent: 3000, kundenStundensatzCent: null },
      { id: "t-glas", standardStundensatzCent: 4000, kundenStundensatzCent: null },
    ],
    objektStundensaetze: [],
    zusatzauftraege: [
      {
        id: "za-keller",
        objektId: "o-ring",
        abrechnungsart: "stunden",
        festbetragCent: null,
        stundensatzCent: null,
        erledigt: false,
      },
    ],
    zeiteintraege: [
      // 10.03., zwei Personen gleichzeitig: 67:23 + 20:18 Minuten → 90
      eintrag(
        "z1",
        "m-anna",
        "o-domplatz",
        "t-unterhalt",
        "2026-03-10T07:02:13Z",
        "2026-03-10T08:09:36Z",
      ),
      eintrag(
        "z2",
        "m-ben",
        "o-domplatz",
        "t-unterhalt",
        "2026-03-10T07:02:41Z",
        "2026-03-10T07:22:59Z",
      ),
      // Über Mitternacht: 18:48 am 10.03. (→ zählt zum 10.03.: zusammen
      // 106:29 → 120), 12:05 am 11.03. → 15
      eintrag(
        "z3",
        "m-anna",
        "o-domplatz",
        "t-unterhalt",
        "2026-03-10T22:41:12Z",
        "2026-03-10T23:12:05Z",
      ),
      // Glasreinigung am 10.03.: 44:51 → 45
      eintrag(
        "z4",
        "m-ben",
        "o-domplatz",
        "t-glas",
        "2026-03-10T09:00:04Z",
        "2026-03-10T09:44:55Z",
      ),
      // Pauschal-Objekt: mit der Pauschale bezahlt, nicht im Nachweis
      eintrag(
        "z5",
        "m-anna",
        "o-ring",
        "t-unterhalt",
        "2026-03-12T08:00:17Z",
        "2026-03-12T10:30:44Z",
      ),
      // Zusatzauftrag nach Stunden im Pauschal-Objekt: 29:30 → 30
      eintrag(
        "z6",
        "m-ben",
        "o-ring",
        "t-glas",
        "2026-03-13T08:00:00Z",
        "2026-03-13T08:29:30Z",
        "za-keller",
      ),
      // Fahrt: nie im Nachweis
      eintrag("z7", "m-anna", null, null, "2026-03-10T06:40:00Z", "2026-03-10T07:01:10Z"),
    ],
    abgerechnetePauschalMonate: [],
  });
}

test("Der Stundennachweis zeigt je Tag, Objekt und Tätigkeit die gerundete Dauer und die Zahl der Personen, ohne Namen", () => {
  const csv = stundennachweisCsv(ergebnis().stundennachweis, namen);

  expect(csv).toBe(
    "﻿" +
      "Datum;Objekt;Zusatzauftrag;Tätigkeit;Stunden;Minuten;Personen\r\n" +
      "10.03.2026;Büro Domplatz;;Unterhaltsreinigung;2:00;120;2\r\n" +
      "10.03.2026;Büro Domplatz;;Glasreinigung;0:45;45;1\r\n" +
      "11.03.2026;Büro Domplatz;;Unterhaltsreinigung;0:15;15;1\r\n" +
      "13.03.2026;Wohnanlage Ringstraße;Wasserschaden Keller;Glasreinigung;0:30;30;1\r\n" +
      "Summe;;;;3:30;210;\r\n",
  );
  expect(csv).not.toMatch(/m-anna|m-ben/);
});

test("Ein leerer Stundennachweis hat nur Kopf und Summe", () => {
  expect(stundennachweisCsv([], namen)).toBe(
    "﻿" +
      "Datum;Objekt;Zusatzauftrag;Tätigkeit;Stunden;Minuten;Personen\r\n" +
      "Summe;;;;0:00;0;\r\n",
  );
});

test("Namen, die Excel für eine Formel hielte, bleiben Text", () => {
  const csv = stundennachweisCsv(
    [
      {
        datum: "2026-03-10",
        objektId: "o-formel",
        taetigkeitId: "t-unterhalt",
        zusatzauftragId: null,
        minuten: 15,
        personen: 1,
      },
    ],
    { ...namen, objekte: new Map([["o-formel", "=SUMME(A1); Haus B"]]) },
  );
  expect(csv.split("\r\n")[1]).toBe(
    `10.03.2026;"'=SUMME(A1); Haus B";;Unterhaltsreinigung;0:15;15;1`,
  );
});
