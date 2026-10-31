import { expect, test } from "vitest";
import { kostenanalyse, type Eingabe } from "@/lib/kostenanalyse";
import { kostenCsv, uebersichtsZeilen } from "./zeilen";

// Ein Kunde mit einer Villa nach Stunden (30 € die Stunde) und einem
// Zusatzauftrag; Anna hat Arbeitgeberkosten, Ben nicht.
const eingabe: Eingabe = {
  monate: ["2026-07"],
  kunden: [{ id: "k1", rundungsregel: "minutengenau", kundenStundensaetze: [] }],
  objekte: [
    { id: "o1", kundeId: "k1", abrechnungsart: "stunden", pauschaleCent: null, archiviert: false },
  ],
  taetigkeiten: [{ id: "t1", standardStundensatzCent: 3000 }],
  objektStundensaetze: [],
  zusatzauftraege: [
    {
      id: "za1",
      objektId: "o1",
      abrechnungsart: "stunden",
      festbetragCent: null,
      stundensatzCent: null,
      erledigt: false,
    },
  ],
  zeiteintraege: [
    {
      id: "z1",
      mitarbeiterId: "anna",
      art: "taetigkeit",
      objektId: "o1",
      taetigkeitId: "t1",
      zusatzauftragId: null,
      beginn: "2026-07-06T08:00:00+02:00",
      ende: "2026-07-06T10:00:00+02:00",
      freigegeben: true,
      arbeitstagEndetHier: true,
    },
    {
      id: "z2",
      mitarbeiterId: "ben",
      art: "taetigkeit",
      objektId: "o1",
      taetigkeitId: "t1",
      zusatzauftragId: "za1",
      beginn: "2026-07-07T08:00:00+02:00",
      ende: "2026-07-07T09:30:00+02:00",
      freigegeben: false,
      arbeitstagEndetHier: true,
    },
  ],
  arbeitgeberkosten: {
    standard: [],
    jeMitarbeiter: { anna: [{ gueltigAb: "2026-01-01", centJeStunde: 2600 }] },
  },
};

const namen = {
  kunden: new Map([["k1", "Hausverwaltung; Nord"]]),
  objekte: new Map([["o1", "Villa"]]),
  zusatzauftraege: new Map([["za1", "Sturmschaden"]]),
  mitarbeiter: new Map([
    ["anna", "Anna"],
    ["ben", "Ben"],
  ]),
};

test("Die CSV-Datei hat die Spalten der Seite, Zusatzaufträge eingerückt, fehlende Kosten leer", () => {
  const csv = kostenCsv(uebersichtsZeilen(kostenanalyse(eingabe), namen));
  expect(csv.split("\r\n")).toEqual([
    "﻿Kunde;Objekt;Einnahmen;Arbeitsstunden;Arbeitskosten;Fahrzeit;Fahrkosten;Deckungsbeitrag (€);Deckungsbeitrag (%);Hinweis",
    '"Hausverwaltung; Nord";Villa;60,00;2:00;52,00;0:00;0,00;8,00;13,3;',
    '"Hausverwaltung; Nord";↳ Sturmschaden;45,00;1:30;;0:00;0,00;;–;vorläufig · Kosten fehlen für: Ben',
    '"Hausverwaltung; Nord";"Summe Hausverwaltung; Nord";105,00;3:30;;0:00;0,00;;–;vorläufig · Kosten fehlen für: Ben',
    ";Gesamtsumme;105,00;3:30;;0:00;0,00;;–;vorläufig · Kosten fehlen für: Ben",
    "",
  ]);
});
