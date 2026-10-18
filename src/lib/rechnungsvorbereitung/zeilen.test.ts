import { expect, test } from "vitest";
import { rechnungsvorbereitung } from "@/lib/rechnungsvorbereitung";
import { rechnungsZeilen, stundenAlsText } from "./zeilen";

const namen = {
  objekte: new Map([
    ["o-pauschal", "Wohnanlage Ringstraße"],
    ["o-stunden", "Büro Domplatz"],
  ]),
  taetigkeiten: new Map([
    ["t-glas", "Glasreinigung"],
    ["t-unterhalt", "Unterhaltsreinigung"],
  ]),
  zusatzauftraege: new Map([
    ["za-sturm", "Sturmschaden Dach"],
    ["za-grund", "Grundreinigung nach Umbau"],
  ]),
};

test("Pauschalen je Monat und Stunden je Objekt und Tätigkeit werden mit Namen zu Zeilen", () => {
  const ergebnis = rechnungsvorbereitung({
    kunde: { rundungsregel: "15-minuten", abrechnungszeitraum: "monatlich" },
    ersterMonat: "2026-03",
    objekte: [
      { id: "o-pauschal", abrechnungsart: "pauschale", pauschaleCent: 50000 },
      { id: "o-stunden", abrechnungsart: "stunden", pauschaleCent: null },
    ],
    taetigkeiten: [
      { id: "t-unterhalt", standardStundensatzCent: 3000, kundenStundensatzCent: null },
      { id: "t-glas", standardStundensatzCent: 4200, kundenStundensatzCent: 3850 },
    ],
    zusatzauftraege: [],
    zeiteintraege: [
      {
        id: "z1",
        mitarbeiterId: "m1",
        art: "taetigkeit",
        objektId: "o-stunden",
        taetigkeitId: "t-unterhalt",
        zusatzauftragId: null,
        // 67 Minuten → 75 Minuten
        beginn: "2026-03-10T07:02:13+00:00",
        ende: "2026-03-10T08:09:36+00:00",
      },
      {
        id: "z2",
        mitarbeiterId: "m1",
        art: "taetigkeit",
        objektId: "o-stunden",
        taetigkeitId: "t-glas",
        zusatzauftragId: null,
        // 21 Minuten → 30 Minuten
        beginn: "2026-03-10T08:12:44+00:00",
        ende: "2026-03-10T08:33:51+00:00",
      },
    ],
    abgerechnetePauschalMonate: [],
  });

  expect(rechnungsZeilen(ergebnis, namen)).toEqual({
    zeilen: [
      {
        position: "Pauschale",
        objekt: "Wohnanlage Ringstraße",
        zusatzauftrag: "",
        taetigkeit: "",
        monat: "März 2026",
        minuten: null,
        stundensatzCent: null,
        betragCent: 50000,
      },
      {
        position: "Stunden",
        objekt: "Büro Domplatz",
        zusatzauftrag: "",
        taetigkeit: "Unterhaltsreinigung",
        monat: "",
        minuten: 75,
        stundensatzCent: 3000,
        betragCent: 3750,
      },
      {
        position: "Stunden",
        objekt: "Büro Domplatz",
        zusatzauftrag: "",
        taetigkeit: "Glasreinigung",
        monat: "",
        minuten: 30,
        stundensatzCent: 3850,
        betragCent: 1925,
      },
    ],
    summeCent: 55675,
  });
});

test("Zusatzaufträge werden mit ihrer Beschreibung zu eigenen Zeilen", () => {
  const { zeilen } = rechnungsZeilen(
    {
      positionen: [
        {
          art: "zusatzauftrag-stunden",
          zusatzauftragId: "za-sturm",
          objektId: "o-pauschal",
          taetigkeitId: "t-unterhalt",
          minuten: 90,
          stundensatzCent: 3000,
          betragCent: 4500,
        },
        {
          art: "zusatzauftrag-festbetrag",
          zusatzauftragId: "za-grund",
          objektId: "o-stunden",
          betragCent: 89000,
        },
      ],
      summeCent: 93500,
      zeiteintragIds: [],
      stundennachweis: [],
    },
    namen,
  );
  expect(zeilen).toEqual([
    {
      position: "Zusatzauftrag nach Stunden",
      objekt: "Wohnanlage Ringstraße",
      zusatzauftrag: "Sturmschaden Dach",
      taetigkeit: "Unterhaltsreinigung",
      monat: "",
      minuten: 90,
      stundensatzCent: 3000,
      betragCent: 4500,
    },
    {
      position: "Zusatzauftrag mit Festbetrag",
      objekt: "Büro Domplatz",
      zusatzauftrag: "Grundreinigung nach Umbau",
      taetigkeit: "",
      monat: "",
      minuten: null,
      stundensatzCent: null,
      betragCent: 89000,
    },
  ]);
});

test("Ohne bekannten Namen steht „unbekannt“ statt einer leeren Zelle", () => {
  const zeilen = rechnungsZeilen(
    {
      positionen: [
        {
          art: "stunden",
          objektId: "o-weg",
          taetigkeitId: "t-weg",
          minuten: 15,
          stundensatzCent: 3000,
          betragCent: 750,
        },
      ],
      summeCent: 750,
      zeiteintragIds: [],
      stundennachweis: [],
    },
    namen,
  ).zeilen;
  expect(zeilen[0]).toMatchObject({ objekt: "unbekannt", taetigkeit: "unbekannt" });
});

test("Stunden werden als Stunden und Minuten gezeigt, ohne Rundung", () => {
  expect(stundenAlsText(75)).toBe("1:15");
  expect(stundenAlsText(119)).toBe("1:59");
  expect(stundenAlsText(5)).toBe("0:05");
  expect(stundenAlsText(1500)).toBe("25:00");
});
