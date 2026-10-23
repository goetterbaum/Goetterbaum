import { expect, test } from "vitest";
import {
  arbeitszeitnachweis,
  arbeitszeitnachweisCsv,
  type EintragFuerNachweis,
} from "./arbeitszeitnachweis";

const domplatz = (beginn: string, ende: string): EintragFuerNachweis => ({
  art: "taetigkeit",
  beginn,
  ende,
  objekt: "Büro Domplatz",
  taetigkeit: "Unterhaltsreinigung",
  zusatzauftrag: null,
  nachtrag: false,
});

const fahrt = (beginn: string, ende: string): EintragFuerNachweis => ({
  art: "fahrt",
  beginn,
  ende,
  objekt: null,
  taetigkeit: null,
  zusatzauftrag: null,
  nachtrag: false,
});

test("Der Arbeitszeitnachweis zeigt alle Zeiteinträge mit Fahrten je Berliner Tag und die Tagessummen", () => {
  // Bis zum 29.03.2026 gilt in Berlin die Winterzeit (UTC + 1 Stunde).
  const nachweis = arbeitszeitnachweis(
    [
      // Absichtlich nicht nach Zeit sortiert.
      domplatz("2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z"),
      fahrt("2026-03-10T06:40:00Z", "2026-03-10T07:01:10Z"),
      {
        ...domplatz("2026-03-10T08:20:05Z", "2026-03-10T08:50:00Z"),
        objekt: "Wohnanlage Ringstraße",
        taetigkeit: "Glasreinigung",
        zusatzauftrag: "Wasserschaden Keller",
        nachtrag: true,
      },
      domplatz("2026-03-12T13:00:31Z", "2026-03-12T14:15:02Z"),
    ],
    "2026-03-01",
    "2026-03-31",
  );

  expect(nachweis).toEqual({
    tage: [
      {
        datum: "2026-03-10",
        minuten: 21 + 67 + 30,
        zeilen: [
          {
            von: "07:40",
            bis: "08:01",
            art: "fahrt",
            objekt: null,
            taetigkeit: null,
            zusatzauftrag: null,
            nachtrag: false,
            minuten: 21,
          },
          {
            von: "08:02",
            bis: "09:09",
            art: "taetigkeit",
            objekt: "Büro Domplatz",
            taetigkeit: "Unterhaltsreinigung",
            zusatzauftrag: null,
            nachtrag: false,
            // 67 Minuten 23 Sekunden
            minuten: 67,
          },
          {
            von: "09:20",
            bis: "09:50",
            art: "taetigkeit",
            objekt: "Wohnanlage Ringstraße",
            taetigkeit: "Glasreinigung",
            zusatzauftrag: "Wasserschaden Keller",
            nachtrag: true,
            // 29 Minuten 55 Sekunden
            minuten: 30,
          },
        ],
      },
      {
        datum: "2026-03-12",
        minuten: 75,
        zeilen: [expect.objectContaining({ von: "14:00", bis: "15:15", minuten: 75 })],
      },
    ],
    minuten: 118 + 75,
  });
});

test("Ein Zeiteintrag über Mitternacht zählt anteilig zu beiden Tagen", () => {
  const { tage, minuten } = arbeitszeitnachweis(
    // 10.03. 23:41:12 bis 11.03. 00:12:05 in Berlin
    [domplatz("2026-03-10T22:41:12Z", "2026-03-10T23:12:05Z")],
    "2026-03-01",
    "2026-03-31",
  );
  expect(tage).toEqual([
    {
      datum: "2026-03-10",
      minuten: 19,
      zeilen: [expect.objectContaining({ von: "23:41", bis: "24:00", minuten: 19 })],
    },
    {
      datum: "2026-03-11",
      minuten: 12,
      zeilen: [expect.objectContaining({ von: "00:00", bis: "00:12", minuten: 12 })],
    },
  ]);
  expect(minuten).toBe(31);
});

test("Am Tag der Zeitumstellung zählt die tatsächlich gearbeitete Zeit", () => {
  // 29.03.2026: Um 2 Uhr springt die Uhr auf 3 Uhr. 00:30 bis 04:00 auf
  // der Uhr sind 2,5 Stunden.
  const sommer = arbeitszeitnachweis(
    [domplatz("2026-03-28T23:30:00Z", "2026-03-29T02:00:00Z")],
    "2026-03-29",
    "2026-03-29",
  );
  expect(sommer.tage).toEqual([
    {
      datum: "2026-03-29",
      minuten: 150,
      zeilen: [expect.objectContaining({ von: "00:30", bis: "04:00", minuten: 150 })],
    },
  ]);

  // 25.10.2026: Um 3 Uhr wird die Uhr auf 2 Uhr zurückgestellt. 22 Uhr am
  // Vortag bis 6 Uhr sind 9 Stunden, davon 7 am 25.10.
  const winter = arbeitszeitnachweis(
    [domplatz("2026-10-24T20:00:00Z", "2026-10-25T05:00:00Z")],
    "2026-10-24",
    "2026-10-25",
  );
  expect(winter.tage.map((t) => [t.datum, t.minuten])).toEqual([
    ["2026-10-24", 120],
    ["2026-10-25", 420],
  ]);
});

test("Nur die Zeit innerhalb des Zeitraums zählt", () => {
  const { tage, minuten } = arbeitszeitnachweis(
    [
      // Beginnt am letzten Abend vor dem Zeitraum.
      domplatz("2026-02-28T22:30:00Z", "2026-02-28T23:45:10Z"),
      // Endet nach dem Zeitraum.
      fahrt("2026-03-31T21:50:00Z", "2026-03-31T22:20:00Z"),
      // Ganz außerhalb.
      domplatz("2026-04-01T06:00:00Z", "2026-04-01T07:00:00Z"),
    ],
    "2026-03-01",
    "2026-03-31",
  );
  expect(tage).toEqual([
    {
      datum: "2026-03-01",
      minuten: 45,
      zeilen: [expect.objectContaining({ von: "00:00", bis: "00:45", minuten: 45 })],
    },
    {
      datum: "2026-03-31",
      // Am 31.03. gilt schon die Sommerzeit (UTC + 2 Stunden).
      minuten: 10,
      zeilen: [expect.objectContaining({ von: "23:50", bis: "24:00", minuten: 10 })],
    },
  ]);
  expect(minuten).toBe(55);
});

test("Ohne Zeiteinträge ist der Nachweis leer", () => {
  expect(arbeitszeitnachweis([], "2026-03-01", "2026-03-31")).toEqual({ tage: [], minuten: 0 });
});

test("Die CSV-Datei hat je Zeiteintrag eine Zeile, je Tag eine Tagessumme und am Ende die Summe", () => {
  const nachweis = arbeitszeitnachweis(
    [
      fahrt("2026-03-10T06:40:00Z", "2026-03-10T07:01:10Z"),
      {
        ...domplatz("2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z"),
        objekt: "=Haus; B",
        zusatzauftrag: "Wasserschaden Keller",
        nachtrag: true,
      },
      domplatz("2026-03-12T13:00:31Z", "2026-03-12T14:15:02Z"),
    ],
    "2026-03-01",
    "2026-03-31",
  );

  expect(arbeitszeitnachweisCsv(nachweis)).toBe(
    "﻿" +
      "Datum;Von;Bis;Art;Objekt;Tätigkeit;Zusatzauftrag;Nachtrag;Stunden;Minuten\r\n" +
      "10.03.2026;07:40;08:01;Fahrt;;;;;0:21;21\r\n" +
      `10.03.2026;08:02;09:09;Tätigkeit;"'=Haus; B";Unterhaltsreinigung;Wasserschaden Keller;Nachtrag;1:07;67\r\n` +
      "10.03.2026;;;Tagessumme;;;;;1:28;88\r\n" +
      "12.03.2026;14:00;15:15;Tätigkeit;Büro Domplatz;Unterhaltsreinigung;;;1:15;75\r\n" +
      "12.03.2026;;;Tagessumme;;;;;1:15;75\r\n" +
      "Summe;;;;;;;;2:43;163\r\n",
  );
});
