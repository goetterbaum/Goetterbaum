import { expect, test } from "vitest";
import { rechnungsvorbereitung } from "@/lib/rechnungsvorbereitung";
import { rechnungsCsv } from "./csv";
import { rechnungsZeilen } from "./zeilen";

test("Die CSV-Datei hat BOM, Semikolons, deutsche Kommazahlen ohne Euro-Zeichen und eine Summe", () => {
  const csv = rechnungsCsv({
    zeilen: [
      {
        position: "Pauschale",
        objekt: "Wohnanlage Ringstraße",
        zusatzauftrag: "",
        taetigkeit: "",
        zeitraum: "März 2026",
        minuten: null,
        stundensatzCent: null,
        betragCent: 123456,
      },
      {
        position: "Stunden",
        objekt: "Büro Domplatz",
        zusatzauftrag: "",
        taetigkeit: "Unterhaltsreinigung",
        zeitraum: "März 2026",
        minuten: 75,
        stundensatzCent: 3000,
        betragCent: 3750,
      },
      {
        position: "Zusatzauftrag nach Stunden",
        objekt: "Büro Domplatz",
        zusatzauftrag: "Wasserschaden Keller",
        taetigkeit: "Unterhaltsreinigung",
        zeitraum: "März 2026",
        minuten: 30,
        stundensatzCent: 3000,
        betragCent: 1500,
      },
      {
        position: "Zusatzauftrag mit Festbetrag",
        objekt: "Büro Domplatz",
        zusatzauftrag: "Grundreinigung nach Umbau",
        taetigkeit: "",
        zeitraum: "März 2026",
        minuten: null,
        stundensatzCent: null,
        betragCent: 89000,
      },
    ],
    summeCent: 217706,
  });

  expect(csv).toBe(
    "﻿" +
      "Position;Objekt;Zusatzauftrag;Tätigkeit;Zeitraum;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      "Pauschale;Wohnanlage Ringstraße;;;März 2026;;;;1234,56\r\n" +
      "Stunden;Büro Domplatz;;Unterhaltsreinigung;März 2026;1:15;75;30,00;37,50\r\n" +
      "Zusatzauftrag nach Stunden;Büro Domplatz;Wasserschaden Keller;Unterhaltsreinigung;März 2026;0:30;30;30,00;15,00\r\n" +
      "Zusatzauftrag mit Festbetrag;Büro Domplatz;Grundreinigung nach Umbau;;März 2026;;;;890,00\r\n" +
      "Summe;;;;;;;;2177,06\r\n",
  );
});

test("Quartalsweise: Pauschalen mit ihrem Monat, Stunden mit dem ganzen Quartal als Zeitraum", () => {
  const ergebnis = rechnungsvorbereitung({
    kunde: { rundungsregel: "15-minuten", abrechnungszeitraum: "quartalsweise" },
    ersterMonat: "2026-07",
    objekte: [
      { id: "o-pauschal", abrechnungsart: "pauschale", pauschaleCent: 50000 },
      { id: "o-stunden", abrechnungsart: "stunden", pauschaleCent: null },
    ],
    taetigkeiten: [
      { id: "t-unterhalt", standardStundensatzCent: 3000, kundenStundensatzCent: null },
    ],
    objektStundensaetze: [],
    zusatzauftraege: [],
    zeiteintraege: [
      {
        id: "z1",
        mitarbeiterId: "m1",
        art: "taetigkeit",
        objektId: "o-stunden",
        taetigkeitId: "t-unterhalt",
        zusatzauftragId: null,
        // 52 Minuten → 60 Minuten
        beginn: "2026-08-03T05:30:08+00:00",
        ende: "2026-08-03T06:22:31+00:00",
      },
    ],
    abgerechnetePauschalMonate: [{ objektId: "o-pauschal", monat: "2026-07" }],
  });
  const namen = {
    objekte: new Map([
      ["o-pauschal", "Wohnanlage Ringstraße"],
      ["o-stunden", "Büro Domplatz"],
    ]),
    taetigkeiten: new Map([["t-unterhalt", "Unterhaltsreinigung"]]),
    zusatzauftraege: new Map<string, string>(),
  };

  expect(rechnungsCsv(rechnungsZeilen(ergebnis, namen, { von: "2026-07", bis: "2026-09" }))).toBe(
    "﻿" +
      "Position;Objekt;Zusatzauftrag;Tätigkeit;Zeitraum;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      "Pauschale;Wohnanlage Ringstraße;;;August 2026;;;;500,00\r\n" +
      "Pauschale;Wohnanlage Ringstraße;;;September 2026;;;;500,00\r\n" +
      "Stunden;Büro Domplatz;;Unterhaltsreinigung;Juli–Sept. 2026;1:00;60;30,00;30,00\r\n" +
      "Summe;;;;;;;;1030,00\r\n",
  );
});

test("Semikolons, Anführungszeichen und Zeilenumbrüche in Namen bleiben in ihrer Zelle", () => {
  const csv = rechnungsCsv({
    zeilen: [
      {
        position: "Zusatzauftrag mit Festbetrag",
        objekt: 'Haus "Sonne"; Eingang B\nHinterhof',
        zusatzauftrag: "Dach; Rinne",
        taetigkeit: "",
        zeitraum: "Okt.–Dez. 2026",
        minuten: null,
        stundensatzCent: null,
        betragCent: 50000,
      },
    ],
    summeCent: 50000,
  });
  expect(csv.split("\r\n")[1]).toBe(
    'Zusatzauftrag mit Festbetrag;"Haus ""Sonne""; Eingang B\nHinterhof";"Dach; Rinne";;Okt.–Dez. 2026;;;;500,00',
  );
});

test("Ein Name, der wie eine Formel beginnt, führt Excel nicht aus", () => {
  const csv = rechnungsCsv({
    zeilen: [
      {
        position: "Zusatzauftrag nach Stunden",
        objekt: '=HYPERLINK("http://example.com")',
        zusatzauftrag: "-Keller",
        taetigkeit: "+Glas",
        zeitraum: "Okt.–Dez. 2026",
        minuten: 30,
        stundensatzCent: 4000,
        betragCent: 2000,
      },
    ],
    summeCent: 2000,
  });
  expect(csv.split("\r\n")[1]).toBe(
    'Zusatzauftrag nach Stunden;"\'=HYPERLINK(""http://example.com"")";\'-Keller;\'+Glas;Okt.–Dez. 2026;0:30;30;40,00;20,00',
  );
});
