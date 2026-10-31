import { expect, test } from "vitest";
import {
  kostenanalyse,
  type Eingabe,
  type Kostenanalyse,
  type ZeiteintragFuerKosten,
} from "./kostenanalyse";

// Ein Kunde mit einem Stunden-Objekt (Villa) und einem Pauschal-Objekt
// (Bürohaus, 450 € im Monat), Reinigung zu 30 € die Stunde, minutengenau
// gerundet. Arbeitgeberkosten: Standard 26 € die Stunde seit Januar. Die
// Tests ändern davon nur, was sie brauchen.
function eingabe(aenderungen: Partial<Eingabe> = {}): Eingabe {
  return {
    monate: ["2026-07"],
    kunden: [{ id: "hausverwaltung", rundungsregel: "minutengenau", kundenStundensaetze: [] }],
    objekte: [
      {
        id: "villa",
        kundeId: "hausverwaltung",
        abrechnungsart: "stunden",
        pauschaleCent: null,
        archiviert: false,
      },
      {
        id: "buero-haus",
        kundeId: "hausverwaltung",
        abrechnungsart: "pauschale",
        pauschaleCent: 45000,
        archiviert: false,
      },
    ],
    taetigkeiten: [{ id: "reinigung", standardStundensatzCent: 3000 }],
    objektStundensaetze: [],
    zusatzauftraege: [],
    zeiteintraege: [],
    arbeitgeberkosten: {
      standard: [{ gueltigAb: "2026-01-01", centJeStunde: 2600 }],
      jeMitarbeiter: {},
    },
    ...aenderungen,
  };
}

let laufendeNummer = 0;
function eintrag(
  beginn: string,
  ende: string,
  aenderungen: Partial<ZeiteintragFuerKosten> = {},
): ZeiteintragFuerKosten {
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
    freigegeben: true,
    arbeitstagEndetHier: false,
    ...aenderungen,
  };
}

function fahrt(
  beginn: string,
  ende: string,
  aenderungen: Partial<ZeiteintragFuerKosten> = {},
): ZeiteintragFuerKosten {
  return eintrag(beginn, ende, {
    art: "fahrt",
    objektId: null,
    taetigkeitId: null,
    ...aenderungen,
  });
}

// Die Zeile eines Objekts bzw. eines seiner Zusatzaufträge.
function zeile(ergebnis: Kostenanalyse, objektId: string, zusatzauftragId: string | null = null) {
  for (const kunde of ergebnis.kunden) {
    for (const objekt of kunde.objekte) {
      if (objekt.zeile.objektId !== objektId) continue;
      if (zusatzauftragId === null) return objekt.zeile;
      const za = objekt.zusatzauftraege.find((z) => z.zusatzauftragId === zusatzauftragId);
      if (za) return za;
    }
  }
  throw new Error(`Keine Zeile für ${objektId} ${zusatzauftragId ?? ""}`);
}

test("Stundenarbeit: Einnahmen nach Stundensatz minus echte Minuten mal Arbeitgeberkosten", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00")],
    }),
  );
  expect(zeile(ergebnis, "villa")).toMatchObject({
    einnahmenCent: 6000,
    arbeitsMinuten: 120,
    arbeitskostenCent: 5200,
    fahrtMinuten: 0,
    fahrkostenCent: 0,
    deckungsbeitragCent: 800,
    vorlaeufig: false,
    kostenFehlenFuer: [],
  });
});

test("Ein Pauschal-Objekt erscheint auch ohne Einsatz, mit der Pauschale je Monat; ein Jahr sind zwölf", () => {
  expect(zeile(kostenanalyse(eingabe()), "buero-haus")).toMatchObject({
    einnahmenCent: 45000,
    arbeitsMinuten: 0,
    arbeitskostenCent: 0,
    deckungsbeitragCent: 45000,
    deckungsbeitragAnteil: 1,
  });
  const jahr = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  expect(zeile(kostenanalyse(eingabe({ monate: jahr })), "buero-haus").einnahmenCent).toBe(540000);
});

test("Eine Fahrt zwischen zwei Objekten gehört je zur Hälfte zu beiden", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [
        eintrag("2026-07-06T08:00:12+02:00", "2026-07-06T10:00:12+02:00"),
        fahrt("2026-07-06T10:00:12+02:00", "2026-07-06T10:30:12+02:00"),
        eintrag("2026-07-06T10:30:12+02:00", "2026-07-06T12:30:12+02:00", {
          objektId: "buero-haus",
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  // 15 Minuten zu 26 € die Stunde sind 6,50 €.
  expect(zeile(ergebnis, "villa")).toMatchObject({
    einnahmenCent: 6000,
    arbeitskostenCent: 5200,
    fahrtMinuten: 15,
    fahrkostenCent: 650,
    deckungsbeitragCent: 150,
  });
  expect(zeile(ergebnis, "buero-haus")).toMatchObject({
    einnahmenCent: 45000,
    arbeitskostenCent: 5200,
    fahrtMinuten: 15,
    fahrkostenCent: 650,
    deckungsbeitragCent: 39150,
  });
});

test("Pausen vor und nach einer Fahrt ändern nichts an der Verteilung", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
        // Pause 10:00–10:20, Fahrt, Pause 10:50–11:00
        fahrt("2026-07-06T10:20:00+02:00", "2026-07-06T10:50:00+02:00"),
        eintrag("2026-07-06T11:00:00+02:00", "2026-07-06T13:00:00+02:00", {
          objektId: "buero-haus",
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  expect(zeile(ergebnis, "villa").fahrtMinuten).toBe(15);
  expect(zeile(ergebnis, "buero-haus").fahrtMinuten).toBe(15);
});

test("Eine Fahrt zwischen zwei Einträgen im selben Objekt gehört ganz diesem Objekt", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
        fahrt("2026-07-06T10:00:00+02:00", "2026-07-06T10:30:00+02:00"),
        eintrag("2026-07-06T10:30:00+02:00", "2026-07-06T11:30:00+02:00", {
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  expect(zeile(ergebnis, "villa")).toMatchObject({ fahrtMinuten: 30, fahrkostenCent: 1300 });
});

test("Eine Hälfte geht an den Zusatzauftrag, an dessen Eintrag sie grenzt", () => {
  const sturm = {
    id: "sturm",
    objektId: "buero-haus",
    abrechnungsart: "stunden" as const,
    festbetragCent: null,
    stundensatzCent: null,
    erledigt: false,
  };
  const ergebnis = kostenanalyse(
    eingabe({
      zusatzauftraege: [sturm],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00", {
          objektId: "buero-haus",
        }),
        fahrt("2026-07-06T10:00:00+02:00", "2026-07-06T10:30:00+02:00"),
        eintrag("2026-07-06T10:30:00+02:00", "2026-07-06T11:30:00+02:00", {
          objektId: "buero-haus",
          zusatzauftragId: "sturm",
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  expect(zeile(ergebnis, "buero-haus")).toMatchObject({ fahrtMinuten: 15, fahrkostenCent: 650 });
  expect(zeile(ergebnis, "buero-haus", "sturm")).toMatchObject({
    einnahmenCent: 3000,
    arbeitsMinuten: 60,
    arbeitskostenCent: 2600,
    fahrtMinuten: 15,
    fahrkostenCent: 650,
    deckungsbeitragCent: -250,
  });
});

test("Die Rückfahrt wird gleichmäßig auf alle Objekte des Arbeitstags verteilt, jedes einmal gezählt", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T09:00:00+02:00"),
        fahrt("2026-07-06T09:00:00+02:00", "2026-07-06T09:30:00+02:00"),
        eintrag("2026-07-06T09:30:00+02:00", "2026-07-06T10:30:00+02:00", {
          objektId: "buero-haus",
        }),
        fahrt("2026-07-06T10:30:00+02:00", "2026-07-06T11:00:00+02:00"),
        eintrag("2026-07-06T11:00:00+02:00", "2026-07-06T12:00:00+02:00"),
        fahrt("2026-07-06T12:00:00+02:00", "2026-07-06T13:00:00+02:00", {
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  // Je 15 + 15 Minuten aus den Fahrten dazwischen, dazu die halbe Rückfahrt.
  expect(zeile(ergebnis, "villa")).toMatchObject({ fahrtMinuten: 60, fahrkostenCent: 2600 });
  expect(zeile(ergebnis, "buero-haus")).toMatchObject({ fahrtMinuten: 60, fahrkostenCent: 2600 });
});

test("Eine nachgetragene Anfahrt gehört ganz zum ersten Objekt", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [
        fahrt("2026-07-06T07:30:00+02:00", "2026-07-06T08:00:00+02:00"),
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
        fahrt("2026-07-06T10:00:00+02:00", "2026-07-06T10:20:00+02:00"),
        eintrag("2026-07-06T10:20:00+02:00", "2026-07-06T11:00:00+02:00", {
          objektId: "buero-haus",
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  expect(zeile(ergebnis, "villa").fahrtMinuten).toBe(40);
  expect(zeile(ergebnis, "buero-haus").fahrtMinuten).toBe(10);
});

test("Bei geteiltem Dienst wird zwischen den beiden Arbeitstagen nichts verteilt", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
        fahrt("2026-07-06T10:00:00+02:00", "2026-07-06T10:30:00+02:00", {
          arbeitstagEndetHier: true,
        }),
        fahrt("2026-07-06T13:40:00+02:00", "2026-07-06T14:00:00+02:00"),
        eintrag("2026-07-06T14:00:00+02:00", "2026-07-06T16:00:00+02:00", {
          objektId: "buero-haus",
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  expect(zeile(ergebnis, "villa").fahrtMinuten).toBe(30);
  expect(zeile(ergebnis, "buero-haus").fahrtMinuten).toBe(20);
});

test("Alte Daten ohne Vermerk: Der Arbeitstag endet nach mehr als 12 Stunden ohne Eintrag", () => {
  const vormittag = [
    eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
    fahrt("2026-07-06T10:00:00+02:00", "2026-07-06T10:30:00+02:00"),
  ];
  // 12 Stunden und 1 Minute später: ein neuer Arbeitstag, die Fahrt war
  // die Rückfahrt.
  const spaeter = kostenanalyse(
    eingabe({
      zeiteintraege: [
        ...vormittag,
        eintrag("2026-07-06T22:31:00+02:00", "2026-07-06T23:00:00+02:00", {
          objektId: "buero-haus",
        }),
      ],
    }),
  );
  expect(zeile(spaeter, "villa").fahrtMinuten).toBe(30);
  expect(zeile(spaeter, "buero-haus").fahrtMinuten).toBe(0);
  // Genau 12 Stunden: noch derselbe Arbeitstag.
  const gleicherTag = kostenanalyse(
    eingabe({
      zeiteintraege: [
        ...vormittag,
        eintrag("2026-07-06T22:30:00+02:00", "2026-07-06T23:00:00+02:00", {
          objektId: "buero-haus",
        }),
      ],
    }),
  );
  expect(zeile(gleicherTag, "villa").fahrtMinuten).toBe(15);
  expect(zeile(gleicherTag, "buero-haus").fahrtMinuten).toBe(15);
});

test("Zwei Mitarbeiter im selben Objekt teilen die Einnahme des Tags nach Minuten, jeder mit seinen Kosten", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      kunden: [{ id: "hausverwaltung", rundungsregel: "15-minuten", kundenStundensaetze: [] }],
      arbeitgeberkosten: {
        standard: [{ gueltigAb: "2026-01-01", centJeStunde: 2600 }],
        jeMitarbeiter: { ben: [{ gueltigAb: "2026-07-01", centJeStunde: 3100 }] },
      },
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T09:07:00+02:00"),
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T08:20:00+02:00", { mitarbeiterId: "ben" }),
      ],
    }),
  );
  // 67 + 20 = 87 Minuten, auf 90 gerundet: 45,00 €, im Verhältnis 67 : 20.
  // Kosten: 67 Minuten zu 26 € sind 29,03 €, 20 Minuten zu 31 € sind 10,33 €.
  const villa = zeile(ergebnis, "villa");
  expect(villa).toMatchObject({
    einnahmenCent: 4500,
    arbeitsMinuten: 87,
    arbeitskostenCent: 3936,
    deckungsbeitragCent: 564,
  });
  expect(
    villa.eintraege.map((e) => [e.mitarbeiterId, e.einnahmeCent, e.arbeitskostenCent, e.herkunft]),
  ).toEqual([
    ["anna", 3466, 2903, "standard"],
    ["ben", 1034, 1033, "eigener-wert"],
  ]);
});

test("Der Pauschal-Anteil der Einträge ergibt zusammen genau die Pauschale", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      objekte: [
        {
          id: "buero-haus",
          kundeId: "hausverwaltung",
          abrechnungsart: "pauschale",
          pauschaleCent: 10000,
          archiviert: false,
        },
      ],
      zeiteintraege: [1, 2, 3].map((tag) =>
        eintrag(`2026-07-0${tag}T08:00:00+02:00`, `2026-07-0${tag}T09:00:00+02:00`, {
          objektId: "buero-haus",
        }),
      ),
    }),
  );
  expect(zeile(ergebnis, "buero-haus").eintraege.map((e) => e.einnahmeCent)).toEqual([
    3334, 3333, 3333,
  ]);
});

test("Ein Zusatzauftrag mit Festbetrag erscheint als Ganzes im Monat seines letzten Eintrags, bis zur Erledigung vorläufig", () => {
  const zaun = {
    id: "zaun",
    objektId: "villa",
    abrechnungsart: "festbetrag" as const,
    festbetragCent: 50000,
    stundensatzCent: null,
    erledigt: false,
  };
  const zeiteintraege = [
    eintrag("2026-06-30T20:00:00+02:00", "2026-06-30T22:00:00+02:00", { zusatzauftragId: "zaun" }),
    // 1. Juli kurz nach Mitternacht in Berlin, in UTC noch Juni.
    eintrag("2026-06-30T22:30:00Z", "2026-06-30T23:30:00Z", { zusatzauftragId: "zaun" }),
  ];
  const juli = kostenanalyse(eingabe({ zusatzauftraege: [zaun], zeiteintraege }));
  expect(zeile(juli, "villa", "zaun")).toMatchObject({
    einnahmenCent: 50000,
    arbeitsMinuten: 180,
    arbeitskostenCent: 7800,
    deckungsbeitragCent: 42200,
    vorlaeufig: true,
  });
  const juni = kostenanalyse(
    eingabe({ monate: ["2026-06"], zusatzauftraege: [zaun], zeiteintraege }),
  );
  expect(() => zeile(juni, "villa", "zaun")).toThrow();
  const erledigt = kostenanalyse(
    eingabe({ zusatzauftraege: [{ ...zaun, erledigt: true }], zeiteintraege }),
  );
  expect(zeile(erledigt, "villa", "zaun").vorlaeufig).toBe(false);
});

test("Der eigene Wert gilt ab seinem „gültig ab“, Mitternacht in Berlin; davor der Standard", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      arbeitgeberkosten: {
        standard: [{ gueltigAb: "2026-01-01", centJeStunde: 2600 }],
        jeMitarbeiter: { anna: [{ gueltigAb: "2026-07-07", centJeStunde: 3100 }] },
      },
      zeiteintraege: [
        eintrag("2026-07-06T22:00:00+02:00", "2026-07-06T23:00:00+02:00"),
        eintrag("2026-07-07T00:30:00+02:00", "2026-07-07T01:30:00+02:00"),
      ],
    }),
  );
  expect(
    zeile(ergebnis, "villa").eintraege.map((e) => [e.datum, e.arbeitskostenCent, e.herkunft]),
  ).toEqual([
    ["2026-07-06", 2600, "standard"],
    ["2026-07-07", 3100, "eigener-wert"],
  ]);
});

test("Fehlen die Arbeitgeberkosten, bleiben Kosten und Deckungsbeitrag leer, auch in den Summen", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      arbeitgeberkosten: { standard: [], jeMitarbeiter: {} },
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
        fahrt("2026-07-06T10:00:00+02:00", "2026-07-06T10:30:00+02:00", {
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  expect(zeile(ergebnis, "villa")).toMatchObject({
    einnahmenCent: 6000,
    arbeitskostenCent: null,
    fahrtMinuten: 30,
    fahrkostenCent: null,
    deckungsbeitragCent: null,
    deckungsbeitragAnteil: null,
    kostenFehlenFuer: ["anna"],
  });
  // Das Pauschal-Objekt ohne Einsatz hat keine Kosten, ihm fehlt nichts.
  expect(zeile(ergebnis, "buero-haus").kostenFehlenFuer).toEqual([]);
  for (const summe of [ergebnis.kunden[0].summe, ergebnis.summe]) {
    expect(summe).toMatchObject({
      einnahmenCent: 51000,
      arbeitskostenCent: null,
      deckungsbeitragCent: null,
      kostenFehlenFuer: ["anna"],
    });
  }
});

test("Nicht freigegebene Einträge zählen mit, als vorläufig", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00", { freigegeben: false }),
      ],
    }),
  );
  expect(zeile(ergebnis, "villa")).toMatchObject({ einnahmenCent: 6000, vorlaeufig: true });
  expect(zeile(ergebnis, "buero-haus").vorlaeufig).toBe(false);
  expect(ergebnis.kunden[0].summe.vorlaeufig).toBe(true);
  expect(ergebnis.summe.vorlaeufig).toBe(true);
});

test("Je Kunde die schwächsten Objekte zuerst, Zusatzaufträge darunter, mit Kunden- und Gesamtsumme", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      kunden: [
        { id: "hausverwaltung", rundungsregel: "minutengenau", kundenStundensaetze: [] },
        { id: "mueller", rundungsregel: "minutengenau", kundenStundensaetze: [] },
      ],
      objekte: [
        {
          id: "buero-haus",
          kundeId: "hausverwaltung",
          abrechnungsart: "pauschale",
          pauschaleCent: 45000,
          archiviert: false,
        },
        {
          id: "villa",
          kundeId: "hausverwaltung",
          abrechnungsart: "stunden",
          pauschaleCent: null,
          archiviert: false,
        },
        {
          id: "garten",
          kundeId: "mueller",
          abrechnungsart: "stunden",
          pauschaleCent: null,
          archiviert: false,
        },
        // Archiviert und ohne Einträge: erscheint nicht.
        {
          id: "altbau",
          kundeId: "mueller",
          abrechnungsart: "pauschale",
          pauschaleCent: 30000,
          archiviert: true,
        },
      ],
      zusatzauftraege: [
        {
          id: "sturm",
          objektId: "buero-haus",
          abrechnungsart: "stunden",
          festbetragCent: null,
          stundensatzCent: 4000,
          erledigt: true,
        },
      ],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T10:00:00+02:00"),
        eintrag("2026-07-07T08:00:00+02:00", "2026-07-07T09:00:00+02:00", {
          objektId: "buero-haus",
          zusatzauftragId: "sturm",
        }),
        eintrag("2026-07-08T08:00:00+02:00", "2026-07-08T09:00:00+02:00", { objektId: "garten" }),
        fahrt("2026-07-09T08:00:00+02:00", "2026-07-09T08:30:00+02:00", {
          mitarbeiterId: "ben",
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  expect(
    ergebnis.kunden.map((k) => [
      k.kundeId,
      k.objekte.map((o) => [o.zeile.objektId, o.zusatzauftraege.map((za) => za.zusatzauftragId)]),
    ]),
  ).toEqual([
    [
      "hausverwaltung",
      [
        ["villa", []],
        ["buero-haus", ["sturm"]],
      ],
    ],
    ["mueller", [["garten", []]]],
  ]);
  // Villa 60,00 − 52,00; Bürohaus 450,00; Sturm 40,00 − 26,00.
  expect(ergebnis.kunden[0].summe).toMatchObject({
    einnahmenCent: 55000,
    arbeitsMinuten: 180,
    arbeitskostenCent: 7800,
    deckungsbeitragCent: 47200,
  });
  // Fahrten aus einem Arbeitstag ohne Objekt stehen nur in der Summe.
  expect(ergebnis.fahrtenOhneObjekt).toMatchObject({ fahrtMinuten: 30, fahrkostenCent: 1300 });
  // Dazu Garten 30,00 − 26,00 und die Fahrt ohne Objekt.
  expect(ergebnis.summe).toMatchObject({
    einnahmenCent: 58000,
    arbeitsMinuten: 240,
    arbeitskostenCent: 10400,
    fahrtMinuten: 30,
    fahrkostenCent: 1300,
    deckungsbeitragCent: 46300,
  });
});

test("Die Details zeigen je Tag die Einträge mit Tagessumme und die Einnahmen ohne Eintrag", () => {
  const ergebnis = kostenanalyse(
    eingabe({
      monate: ["2026-06", "2026-07"],
      zeiteintraege: [
        eintrag("2026-07-06T08:00:00+02:00", "2026-07-06T09:00:00+02:00", {
          objektId: "buero-haus",
        }),
        fahrt("2026-07-06T09:00:00+02:00", "2026-07-06T09:30:00+02:00"),
        eintrag("2026-07-06T09:30:00+02:00", "2026-07-06T10:30:00+02:00", {
          objektId: "buero-haus",
          arbeitstagEndetHier: true,
        }),
        eintrag("2026-07-07T08:00:00+02:00", "2026-07-07T10:00:00+02:00", {
          objektId: "buero-haus",
          freigegeben: false,
          arbeitstagEndetHier: true,
        }),
      ],
    }),
  );
  const buero = zeile(ergebnis, "buero-haus");
  // Die Juli-Pauschale nach Minuten 60 : 60 : 120, die aus dem Juni ohne
  // Einsatz steht bei keinem Eintrag.
  expect(buero.tage.map((t) => [t.datum, t.eintraege.map((e) => e.einnahmeCent), t.summe])).toEqual(
    [
      [
        "2026-07-06",
        [11250, 11250],
        expect.objectContaining({
          einnahmenCent: 22500,
          arbeitsMinuten: 120,
          fahrtMinuten: 30,
          kostenCent: 6500,
          vorlaeufig: false,
        }),
      ],
      [
        "2026-07-07",
        [22500],
        expect.objectContaining({ einnahmenCent: 22500, kostenCent: 5200, vorlaeufig: true }),
      ],
    ],
  );
  expect(buero.einnahmenOhneZeiteintragCent).toBe(45000);
});
