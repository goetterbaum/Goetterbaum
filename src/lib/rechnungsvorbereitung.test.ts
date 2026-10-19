import { expect, test } from "vitest";
import {
  rechnungsvorbereitung,
  type Eingabe,
  type Objekt,
  type Zeiteintrag,
  type Zusatzauftrag,
  zusatzauftragsAbrechnung,
} from "./rechnungsvorbereitung";

// Ein Kunde mit einem Pauschal-Objekt und einem Stunden-Objekt sowie
// zwei Tätigkeiten. Die Tests ändern davon nur, was sie brauchen.
const pauschalObjekt: Objekt = {
  id: "buero-haus",
  abrechnungsart: "pauschale",
  pauschaleCent: 45000,
  archiviert: false,
};
const stundenObjekt: Objekt = {
  id: "villa",
  abrechnungsart: "stunden",
  pauschaleCent: null,
  archiviert: false,
};

function eingabe(aenderungen: Partial<Eingabe> = {}): Eingabe {
  return {
    kunde: { rundungsregel: "15-minuten", abrechnungszeitraum: "monatlich" },
    ersterMonat: "2026-07",
    objekte: [pauschalObjekt, stundenObjekt],
    taetigkeiten: [
      { id: "reinigung", standardStundensatzCent: 3000, kundenStundensatzCent: null },
      { id: "rasen", standardStundensatzCent: 4000, kundenStundensatzCent: null },
    ],
    zusatzauftraege: [],
    zeiteintraege: [],
    abgerechnetePauschalMonate: [],
    ...aenderungen,
  };
}

let laufendeNummer = 0;
function eintrag(
  beginn: string,
  ende: string,
  aenderungen: Partial<Zeiteintrag> = {},
): Zeiteintrag {
  laufendeNummer += 1;
  return {
    id: `z${laufendeNummer}`,
    mitarbeiterId: "anna",
    art: "taetigkeit",
    objektId: "villa",
    taetigkeitId: "reinigung",
    zusatzauftragId: null,
    beginn,
    ende,
    ...aenderungen,
  };
}

test("Ein Pauschal-Objekt ergibt bei monatlicher Abrechnung eine Pauschale", () => {
  const ergebnis = rechnungsvorbereitung(eingabe({ objekte: [pauschalObjekt] }));
  expect(ergebnis.positionen).toEqual([
    { art: "pauschale", objektId: "buero-haus", monat: "2026-07", betragCent: 45000 },
  ]);
  expect(ergebnis.summeCent).toBe(45000);
});

test("Quartalsweise erscheint die Pauschale je Monat, also dreimal", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      kunde: { rundungsregel: "15-minuten", abrechnungszeitraum: "quartalsweise" },
      ersterMonat: "2026-11",
      objekte: [pauschalObjekt],
    }),
  );
  expect(ergebnis.positionen.map((p) => p.art === "pauschale" && p.monat)).toEqual([
    "2026-11",
    "2026-12",
    "2027-01",
  ]);
  expect(ergebnis.summeCent).toBe(135000);
});

test("Bereits abgerechnete Pauschal-Monate erscheinen nicht erneut", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      kunde: { rundungsregel: "15-minuten", abrechnungszeitraum: "quartalsweise" },
      objekte: [pauschalObjekt],
      abgerechnetePauschalMonate: [{ objektId: "buero-haus", monat: "2026-08" }],
    }),
  );
  expect(ergebnis.positionen.map((p) => p.art === "pauschale" && p.monat)).toEqual([
    "2026-07",
    "2026-09",
  ]);
});

test("Ein Stunden-Objekt ergibt eine Position je Tätigkeit: Stunden × Stundensatz", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [stundenObjekt],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
        eintrag("2026-07-07T08:00:00+02:00", "2026-07-07T09:30:00+02:00"),
        eintrag("2026-07-07T10:00:00+02:00", "2026-07-07T11:00:00+02:00", {
          taetigkeitId: "rasen",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen).toEqual([
    {
      art: "stunden",
      objektId: "villa",
      taetigkeitId: "reinigung",
      minuten: 210,
      stundensatzCent: 3000,
      betragCent: 10500,
    },
    {
      art: "stunden",
      objektId: "villa",
      taetigkeitId: "rasen",
      minuten: 60,
      stundensatzCent: 4000,
      betragCent: 4000,
    },
  ]);
  expect(ergebnis.summeCent).toBe(14500);
});

test("Der kundenspezifische Stundensatz hat Vorrang vor dem Standard-Stundensatz", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [stundenObjekt],
      taetigkeiten: [
        { id: "reinigung", standardStundensatzCent: 3000, kundenStundensatzCent: 2650 },
      ],
      zeiteintraege: [eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00")],
    }),
  );
  expect(ergebnis.positionen).toMatchObject([{ stundensatzCent: 2650, betragCent: 5300 }]);
});

// Drei Mitarbeiter arbeiten je 1 h 07 min, entweder am selben Tag oder
// an drei verschiedenen Tagen.
function dreiMal67Minuten(tage: [string, string, string]): Zeiteintrag[] {
  return tage.map((tag, i) =>
    eintrag(`${tag}T08:00:00+02:00`, `${tag}T09:07:00+02:00`, {
      mitarbeiterId: ["anna", "bert", "cem"][i],
    }),
  );
}

function minutenDerStunden(e: Eingabe): number[] {
  return rechnungsvorbereitung(e).positionen.flatMap((p) =>
    p.art === "stunden" ? [p.minuten] : [],
  );
}

test("3 × 1 h 07 min am selben Tag ergeben bei 15-Minuten-Rundung 3,5 h", () => {
  const zeiteintraege = dreiMal67Minuten(["2026-07-06", "2026-07-06", "2026-07-06"]);
  const ergebnis = rechnungsvorbereitung(eingabe({ objekte: [stundenObjekt], zeiteintraege }));
  expect(ergebnis.positionen).toMatchObject([{ minuten: 210, betragCent: 10500 }]);
});

test("Dieselben Zeiten an verschiedenen Tagen werden je Tag gerundet", () => {
  const zeiteintraege = dreiMal67Minuten(["2026-07-06", "2026-07-07", "2026-07-08"]);
  // Je Tag 67 min → 75 min, zusammen 3 h 45 min
  expect(minutenDerStunden(eingabe({ objekte: [stundenObjekt], zeiteintraege }))).toEqual([225]);
});

test("Minutengenau wird die Summe nicht aufgerundet", () => {
  const zeiteintraege = dreiMal67Minuten(["2026-07-06", "2026-07-07", "2026-07-08"]);
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      kunde: { rundungsregel: "minutengenau", abrechnungszeitraum: "monatlich" },
      objekte: [stundenObjekt],
      zeiteintraege,
    }),
  );
  // 201 min × 30 €/h = 100,50 €
  expect(ergebnis.positionen).toMatchObject([{ minuten: 201, betragCent: 10050 }]);
});

test("Verschiedene Tätigkeiten am selben Tag werden getrennt gerundet", () => {
  const zeiteintraege = [
    eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T08:10:00+02:00"),
    eintrag("2026-07-06T08:10:00+02:00", "2026-07-06T08:20:00+02:00", { taetigkeitId: "rasen" }),
  ];
  expect(minutenDerStunden(eingabe({ objekte: [stundenObjekt], zeiteintraege }))).toEqual([15, 15]);
});

test("Verschiedene Objekte am selben Tag werden getrennt gerundet", () => {
  const zweitesObjekt: Objekt = { ...stundenObjekt, id: "garage" };
  const zeiteintraege = [
    eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T08:10:00+02:00"),
    eintrag("2026-07-06T09:00:00+02:00", "2026-07-06T09:10:00+02:00", { objektId: "garage" }),
  ];
  expect(
    minutenDerStunden(eingabe({ objekte: [stundenObjekt, zweitesObjekt], zeiteintraege })),
  ).toEqual([15, 15]);
});

test("Sekunden werden auf ganze Minuten gerundet, bevor die Rundungsregel greift", () => {
  const zeiteintraege = [
    eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T08:30:20+02:00"),
    eintrag("2026-07-06T09:00:00+02:00", "2026-07-06T09:30:05+02:00"),
  ];
  // 30:20 + 30:05 = 60:25 → 60 min, also genau eine Stunde, nicht 1 h 15 min
  expect(minutenDerStunden(eingabe({ objekte: [stundenObjekt], zeiteintraege }))).toEqual([60]);
});

test("Beträge werden auf ganze Cent gerundet", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      kunde: { rundungsregel: "minutengenau", abrechnungszeitraum: "monatlich" },
      objekte: [stundenObjekt],
      taetigkeiten: [
        { id: "reinigung", standardStundensatzCent: 2999, kundenStundensatzCent: null },
      ],
      zeiteintraege: [eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T08:07:00+02:00")],
    }),
  );
  // 7 min × 29,99 €/h = 3,4988… € → 3,50 €
  expect(ergebnis.positionen).toMatchObject([{ betragCent: 350 }]);
  expect(Number.isInteger(ergebnis.summeCent)).toBe(true);
});

test("Der Stundennachweis zeigt je Tag und Objekt Tätigkeit, gerundete Dauer und Anzahl Personen", () => {
  const zeiteintraege = [
    ...dreiMal67Minuten(["2026-07-06", "2026-07-06", "2026-07-07"]),
    // Anna arbeitet am 6. zweimal: zählt als eine Person
    eintrag("2026-07-06T13:00:00+02:00", "2026-07-06T13:30:00+02:00"),
  ];
  const { stundennachweis } = rechnungsvorbereitung(
    eingabe({ objekte: [stundenObjekt], zeiteintraege }),
  );
  expect(stundennachweis).toEqual([
    {
      datum: "2026-07-06",
      objektId: "villa",
      taetigkeitId: "reinigung",
      zusatzauftragId: null,
      minuten: 165,
      personen: 2,
    },
    {
      datum: "2026-07-07",
      objektId: "villa",
      taetigkeitId: "reinigung",
      zusatzauftragId: null,
      minuten: 75,
      personen: 1,
    },
  ]);
});

test("Die Ausgabe nennt alle umfassten Zeiteinträge", () => {
  const zeiteintraege = [
    eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T09:00:00+02:00", { id: "stunden" }),
    eintrag("2026-07-06T10:00:00+02:00", "2026-07-06T11:00:00+02:00", {
      id: "pauschal",
      objektId: "buero-haus",
    }),
  ];
  expect(rechnungsvorbereitung(eingabe({ zeiteintraege })).zeiteintragIds).toEqual([
    "stunden",
    "pauschal",
  ]);
});

test("Fahrten erscheinen nie", () => {
  const fahrt = eintrag("2026-07-06T07:30:00+02:00", "2026-07-06T08:00:00+02:00", {
    id: "fahrt",
    art: "fahrt",
    objektId: null,
    taetigkeitId: null,
  });
  const ergebnis = rechnungsvorbereitung(
    eingabe({ objekte: [stundenObjekt], zeiteintraege: [fahrt] }),
  );
  expect(ergebnis.positionen).toEqual([]);
  expect(ergebnis.stundennachweis).toEqual([]);
  expect(ergebnis.zeiteintragIds).toEqual([]);
});

test("Reguläre Zeit in Pauschal-Objekten wird nicht berechnet", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [pauschalObjekt],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T12:00:00+02:00", {
          objektId: "buero-haus",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen.map((p) => p.art)).toEqual(["pauschale"]);
  expect(ergebnis.summeCent).toBe(45000);
  expect(ergebnis.stundennachweis).toEqual([]);
});

test("Ein Zusatzauftrag nach Stunden in einem Pauschal-Objekt wird je Zusatzauftrag ausgewiesen", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [pauschalObjekt],
      zusatzauftraege: [
        {
          id: "sturmschaden",
          objektId: "buero-haus",
          abrechnungsart: "stunden",
          festbetragCent: null,
          erledigt: false,
        },
      ],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T09:50:00+02:00", {
          objektId: "buero-haus",
          taetigkeitId: "rasen",
          zusatzauftragId: "sturmschaden",
        }),
        // Reguläre Zeit am selben Tag ist durch die Pauschale abgedeckt
        eintrag("2026-07-06T10:00:00+02:00", "2026-07-06T12:00:00+02:00", {
          objektId: "buero-haus",
          taetigkeitId: "rasen",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen).toEqual([
    { art: "pauschale", objektId: "buero-haus", monat: "2026-07", betragCent: 45000 },
    {
      art: "zusatzauftrag-stunden",
      zusatzauftragId: "sturmschaden",
      objektId: "buero-haus",
      taetigkeitId: "rasen",
      minuten: 120,
      stundensatzCent: 4000,
      betragCent: 8000,
    },
  ]);
  expect(ergebnis.stundennachweis).toMatchObject([
    { datum: "2026-07-06", zusatzauftragId: "sturmschaden", minuten: 120, personen: 1 },
  ]);
});

test("Ein archiviertes Pauschal-Objekt bekommt keine Pauschale mehr, sein Zusatzauftrag nach Stunden wird aber abgerechnet", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [{ ...pauschalObjekt, archiviert: true }],
      zusatzauftraege: [
        {
          id: "sturmschaden",
          objektId: "buero-haus",
          abrechnungsart: "stunden",
          festbetragCent: null,
          erledigt: false,
        },
      ],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T08:52:31+02:00", {
          objektId: "buero-haus",
          zusatzauftragId: "sturmschaden",
        }),
        // Reguläre Zeit bleibt mit der Pauschale bezahlt
        eintrag("2026-07-06T09:00:00+02:00", "2026-07-06T10:00:00+02:00", {
          objektId: "buero-haus",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen).toEqual([
    {
      art: "zusatzauftrag-stunden",
      zusatzauftragId: "sturmschaden",
      objektId: "buero-haus",
      taetigkeitId: "reinigung",
      minuten: 60,
      stundensatzCent: 3000,
      betragCent: 3000,
    },
  ]);
});

test("Zeit für einen Zusatzauftrag wird getrennt von der regulären Zeit gerundet", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [stundenObjekt],
      zusatzauftraege: [
        {
          id: "keller",
          objektId: "villa",
          abrechnungsart: "stunden",
          festbetragCent: null,
          erledigt: false,
        },
      ],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T08:10:00+02:00"),
        eintrag("2026-07-06T09:00:00+02:00", "2026-07-06T09:10:00+02:00", {
          zusatzauftragId: "keller",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen).toMatchObject([
    { art: "stunden", minuten: 15 },
    { art: "zusatzauftrag-stunden", zusatzauftragId: "keller", minuten: 15 },
  ]);
});

test("Ein erledigter Zusatzauftrag mit Festbetrag erscheint einmal mit seinem Betrag, auch im Stunden-Objekt", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [stundenObjekt],
      zusatzauftraege: [
        {
          id: "grundreinigung",
          objektId: "villa",
          abrechnungsart: "festbetrag",
          festbetragCent: 89000,
          erledigt: true,
        },
      ],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T16:00:00+02:00", {
          id: "tag1",
          zusatzauftragId: "grundreinigung",
        }),
        eintrag("2026-07-07T08:00:00+02:00", "2026-07-07T12:00:00+02:00", {
          id: "tag2",
          zusatzauftragId: "grundreinigung",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen).toEqual([
    {
      art: "zusatzauftrag-festbetrag",
      zusatzauftragId: "grundreinigung",
      objektId: "villa",
      betragCent: 89000,
    },
  ]);
  expect(ergebnis.summeCent).toBe(89000);
  expect(ergebnis.stundennachweis).toEqual([]);
  expect(ergebnis.zeiteintragIds).toEqual(["tag1", "tag2"]);
});

test("Ein noch offener Zusatzauftrag mit Festbetrag wird noch nicht abgerechnet", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [stundenObjekt],
      zusatzauftraege: [
        {
          id: "grundreinigung",
          objektId: "villa",
          abrechnungsart: "festbetrag",
          festbetragCent: 89000,
          erledigt: false,
        },
      ],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T16:00:00+02:00", {
          zusatzauftragId: "grundreinigung",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen).toEqual([]);
  // Die Zeit bleibt offen, bis der Festbetrag abgerechnet wird
  expect(ergebnis.zeiteintragIds).toEqual([]);
});

function tageImNachweis(e: Eingabe) {
  return rechnungsvorbereitung(e).stundennachweis.map((t) => [t.datum, t.minuten]);
}

const minutengenau: Eingabe["kunde"] = {
  rundungsregel: "minutengenau",
  abrechnungszeitraum: "monatlich",
};

test("Ein Zeiteintrag über Mitternacht wird auf beide Tage verteilt und je Tag gerundet", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [stundenObjekt],
      zeiteintraege: [eintrag("2026-07-06T23:40:00+02:00", "2026-07-07T00:10:00+02:00")],
    }),
  );
  expect(ergebnis.stundennachweis.map((t) => [t.datum, t.minuten])).toEqual([
    ["2026-07-06", 30],
    ["2026-07-07", 15],
  ]);
  // Ohne Aufteilung wären es nur 30 Minuten
  expect(ergebnis.positionen).toMatchObject([{ minuten: 45 }]);
});

test("Tagesgrenzen stimmen beim Wechsel auf die Sommerzeit", () => {
  // In der Nacht zum 29. März 2026 springt die Uhr von 2 auf 3 Uhr.
  const zeiteintraege = [
    eintrag("2026-03-28T23:30:00+01:00", "2026-03-29T03:30:00+02:00"),
    eintrag("2026-03-29T22:00:00+02:00", "2026-03-30T02:00:00+02:00"),
  ];
  expect(
    tageImNachweis(
      eingabe({
        kunde: minutengenau,
        ersterMonat: "2026-03",
        objekte: [stundenObjekt],
        zeiteintraege,
      }),
    ),
  ).toEqual([
    ["2026-03-28", 30],
    ["2026-03-29", 150 + 120],
    ["2026-03-30", 120],
  ]);
});

test("Tagesgrenzen stimmen beim Wechsel auf die Winterzeit", () => {
  // In der Nacht zum 25. Oktober 2026 wird die Uhr von 3 auf 2 Uhr gestellt.
  const zeiteintraege = [
    eintrag("2026-10-24T23:00:00+02:00", "2026-10-25T01:00:00+02:00"),
    // 2:30 Sommerzeit bis 2:30 Winterzeit: eine Stunde
    eintrag("2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00+01:00"),
    eintrag("2026-10-25T22:00:00+01:00", "2026-10-26T01:00:00+01:00"),
  ];
  expect(
    tageImNachweis(
      eingabe({
        kunde: minutengenau,
        ersterMonat: "2026-10",
        objekte: [stundenObjekt],
        zeiteintraege,
      }),
    ),
  ).toEqual([
    ["2026-10-24", 60],
    ["2026-10-25", 60 + 60 + 120],
    ["2026-10-26", 60],
  ]);
});

test("Noch offene Zeiteinträge aus früheren Zeiträumen werden mit abgerechnet, spätere nicht", () => {
  const zeiteintraege = [
    // z. B. erst nach der Juni-Abrechnung freigegeben
    eintrag("2026-06-30T22:00:00+02:00", "2026-06-30T23:00:00+02:00", { id: "juni" }),
    // beginnt im Juli und zählt deshalb ganz zum Juli
    eintrag("2026-07-31T23:00:00+02:00", "2026-08-01T01:00:00+02:00", { id: "monatsende" }),
    eintrag("2026-08-01T00:30:00+02:00", "2026-08-01T01:30:00+02:00", { id: "august" }),
  ];
  const ergebnis = rechnungsvorbereitung(
    eingabe({ kunde: minutengenau, objekte: [stundenObjekt], zeiteintraege }),
  );
  expect(ergebnis.zeiteintragIds).toEqual(["juni", "monatsende"]);
  expect(ergebnis.stundennachweis.map((t) => [t.datum, t.minuten])).toEqual([
    ["2026-06-30", 60],
    ["2026-07-31", 60],
    ["2026-08-01", 60],
  ]);
});

test("Mit dem Festbetrag gilt auch die Zeit aus früheren Monaten als abgerechnet", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      ersterMonat: "2026-08",
      objekte: [stundenObjekt],
      zusatzauftraege: [
        {
          id: "grundreinigung",
          objektId: "villa",
          abrechnungsart: "festbetrag",
          festbetragCent: 89000,
          erledigt: true,
        },
      ],
      zeiteintraege: [
        eintrag("2026-07-28T08:00:00+02:00", "2026-07-28T16:00:00+02:00", {
          id: "juli",
          zusatzauftragId: "grundreinigung",
        }),
        eintrag("2026-08-03T08:00:00+02:00", "2026-08-03T12:00:00+02:00", {
          id: "august",
          zusatzauftragId: "grundreinigung",
        }),
      ],
    }),
  );
  expect(ergebnis.zeiteintragIds).toEqual(["juli", "august"]);
  expect(ergebnis.summeCent).toBe(89000);
});

test("Zeiteinträge mit unbekannter Tätigkeit werden weder berechnet noch als abgerechnet markiert", () => {
  const ergebnis = rechnungsvorbereitung(
    eingabe({
      objekte: [stundenObjekt],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T09:00:00+02:00", {
          taetigkeitId: "unbekannt",
        }),
      ],
    }),
  );
  expect(ergebnis.positionen).toEqual([]);
  expect(ergebnis.zeiteintragIds).toEqual([]);
  expect(ergebnis.stundennachweis).toEqual([]);
});

const sturmschaden: Zusatzauftrag = {
  id: "sturmschaden",
  objektId: "buero-haus",
  abrechnungsart: "stunden",
  festbetragCent: null,
  erledigt: true,
};

test("Ein Zusatzauftrag nach Stunden wird einzeln mit all seiner Zeit abgerechnet, egal in welchem Monat", () => {
  const ergebnis = zusatzauftragsAbrechnung({
    rundungsregel: "15-minuten",
    zusatzauftrag: sturmschaden,
    taetigkeiten: eingabe().taetigkeiten,
    zeiteintraege: [
      eintrag("2026-07-30T08:00:00+02:00", "2026-07-30T09:07:41+02:00", {
        id: "juli",
        objektId: "buero-haus",
        taetigkeitId: "rasen",
        zusatzauftragId: "sturmschaden",
      }),
      eintrag("2026-08-03T08:00:00+02:00", "2026-08-03T08:20:12+02:00", {
        id: "august",
        objektId: "buero-haus",
        taetigkeitId: "rasen",
        zusatzauftragId: "sturmschaden",
      }),
      // Reguläre Zeit gehört nicht zur Einzelabrechnung
      eintrag("2026-08-03T09:00:00+02:00", "2026-08-03T10:00:00+02:00", {
        id: "regulaer",
        objektId: "buero-haus",
        taetigkeitId: "rasen",
      }),
    ],
  });
  // 30.07.: 68 Minuten → 75, 03.08.: 20 Minuten → 30; 1:45 Std. zu 40 €
  expect(ergebnis.positionen).toEqual([
    {
      art: "zusatzauftrag-stunden",
      zusatzauftragId: "sturmschaden",
      objektId: "buero-haus",
      taetigkeitId: "rasen",
      minuten: 105,
      stundensatzCent: 4000,
      betragCent: 7000,
    },
  ]);
  expect(ergebnis.summeCent).toBe(7000);
  expect(ergebnis.zeiteintragIds).toEqual(["juli", "august"]);
  expect(ergebnis.stundennachweis.map((t) => [t.datum, t.minuten])).toEqual([
    ["2026-07-30", 75],
    ["2026-08-03", 30],
  ]);
});

test("Ein Zusatzauftrag mit Festbetrag wird einzeln mit seinem Betrag abgerechnet, auch ohne erfasste Zeit", () => {
  const ergebnis = zusatzauftragsAbrechnung({
    rundungsregel: "minutengenau",
    zusatzauftrag: {
      id: "grundreinigung",
      objektId: "villa",
      abrechnungsart: "festbetrag",
      festbetragCent: 89000,
      erledigt: true,
    },
    taetigkeiten: eingabe().taetigkeiten,
    zeiteintraege: [],
  });
  expect(ergebnis.positionen).toEqual([
    {
      art: "zusatzauftrag-festbetrag",
      zusatzauftragId: "grundreinigung",
      objektId: "villa",
      betragCent: 89000,
    },
  ]);
  expect(ergebnis.summeCent).toBe(89000);
  expect(ergebnis.zeiteintragIds).toEqual([]);
  expect(ergebnis.stundennachweis).toEqual([]);
});

test("Ein noch offener Zusatzauftrag wird nicht einzeln abgerechnet", () => {
  const ergebnis = zusatzauftragsAbrechnung({
    rundungsregel: "15-minuten",
    zusatzauftrag: { ...sturmschaden, erledigt: false },
    taetigkeiten: eingabe().taetigkeiten,
    zeiteintraege: [
      eintrag("2026-07-30T08:00:00+02:00", "2026-07-30T09:00:00+02:00", {
        objektId: "buero-haus",
        taetigkeitId: "rasen",
        zusatzauftragId: "sturmschaden",
      }),
    ],
  });
  expect(ergebnis).toEqual({
    positionen: [],
    summeCent: 0,
    zeiteintragIds: [],
    stundennachweis: [],
  });
});
