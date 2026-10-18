import { expect, test } from "vitest";
import { protokollAnzeigen, type ProtokollZeile } from "./protokoll";

const HAUS_A = "4f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const HAUS_B = "5f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const REINIGUNG = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const STURMSCHADEN = "7c6d5e4f-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const KELLER = "8c6d5e4f-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

const NAMEN = {
  objekte: new Map([
    [HAUS_A, "Haus A"],
    [HAUS_B, "Haus B"],
  ]),
  taetigkeiten: new Map([[REINIGUNG, "Unterhaltsreinigung"]]),
  zusatzauftraege: new Map([
    [STURMSCHADEN, "Sturmschaden Dach"],
    [KELLER, "Keller entrümpeln"],
  ]),
};

// So schreibt die Datenbank einen Zeiteintrag ins Protokoll.
const LIVE = {
  id: "eintrag",
  art: "taetigkeit" as const,
  objekt_id: HAUS_A,
  taetigkeit_id: REINIGUNG,
  beginn: "2026-10-16T06:00:00+00:00",
  ende: null,
  nachtrag: false,
  angelegt_am: "2026-10-16T06:00:00+00:00",
};
const GESTOPPT = { ...LIVE, ende: "2026-10-16T08:30:00+00:00" };

test("Das Anlegen zeigt alle Angaben, das Ändern nur, was sich geändert hat", () => {
  const zeilen: ProtokollZeile[] = [
    {
      id: 1,
      aktion: "angelegt",
      geaendert_am: "2026-10-16T06:00:01+00:00",
      geaendert_von_name: "Anna Fleißig",
      vorher: null,
      nachher: LIVE,
    },
    {
      id: 2,
      aktion: "geaendert",
      geaendert_am: "2026-10-16T08:30:00+00:00",
      geaendert_von_name: "Anna Fleißig",
      vorher: LIVE,
      nachher: GESTOPPT,
    },
    {
      id: 3,
      aktion: "geaendert",
      // Winterzeit: Berlin ist UTC + 1 Stunde.
      geaendert_am: "2026-11-02T07:05:00+00:00",
      geaendert_von_name: "Anna Fleißig",
      vorher: GESTOPPT,
      nachher: {
        ...GESTOPPT,
        objekt_id: HAUS_B,
        beginn: "2026-10-16T05:45:00+00:00",
        nachtrag: true,
      },
    },
  ];

  expect(protokollAnzeigen(zeilen, NAMEN)).toEqual([
    {
      id: 1,
      wann: "16.10.2026, 08:00",
      wer: "Anna Fleißig",
      aktion: "Angelegt",
      aenderungen: [
        { feld: "Art", vorher: "–", nachher: "Tätigkeit" },
        { feld: "Objekt", vorher: "–", nachher: "Haus A" },
        { feld: "Tätigkeit", vorher: "–", nachher: "Unterhaltsreinigung" },
        // Einträge aus der Zeit vor den Zusatzaufträgen haben das Feld nicht.
        { feld: "Zusatzauftrag", vorher: "–", nachher: "–" },
        { feld: "Beginn", vorher: "–", nachher: "16.10.2026, 08:00" },
        { feld: "Ende", vorher: "–", nachher: "–" },
        { feld: "Nachtrag", vorher: "–", nachher: "nein" },
        { feld: "Freigegeben", vorher: "–", nachher: "–" },
        { feld: "Abgerechnet", vorher: "–", nachher: "nein" },
      ],
    },
    {
      id: 2,
      wann: "16.10.2026, 10:30",
      wer: "Anna Fleißig",
      aktion: "Geändert",
      aenderungen: [{ feld: "Ende", vorher: "–", nachher: "16.10.2026, 10:30" }],
    },
    {
      id: 3,
      wann: "02.11.2026, 08:05",
      wer: "Anna Fleißig",
      aktion: "Geändert",
      aenderungen: [
        { feld: "Objekt", vorher: "Haus A", nachher: "Haus B" },
        { feld: "Beginn", vorher: "16.10.2026, 08:00", nachher: "16.10.2026, 07:45" },
        { feld: "Nachtrag", vorher: "nein", nachher: "ja" },
      ],
    },
  ]);
});

test("Eine Fahrt hat kein Objekt; Änderungen ohne Benutzer stammen vom System", () => {
  const fahrt = { ...GESTOPPT, art: "fahrt" as const, objekt_id: null, taetigkeit_id: null };
  const [zeile] = protokollAnzeigen(
    [
      {
        id: 7,
        aktion: "geaendert",
        geaendert_am: "2026-10-16T09:00:00+00:00",
        geaendert_von_name: null,
        vorher: GESTOPPT,
        nachher: fahrt,
      },
    ],
    NAMEN,
  );
  expect(zeile.wer).toBe("System");
  expect(zeile.aenderungen).toEqual([
    { feld: "Art", vorher: "Tätigkeit", nachher: "Fahrt" },
    { feld: "Objekt", vorher: "Haus A", nachher: "–" },
    { feld: "Tätigkeit", vorher: "Unterhaltsreinigung", nachher: "–" },
  ]);
});

test("Zuordnen, Ändern und Entfernen eines Zusatzauftrags stehen im Protokoll", () => {
  const mitSturmschaden = { ...GESTOPPT, zusatzauftrag_id: STURMSCHADEN };
  const mitKeller = { ...GESTOPPT, zusatzauftrag_id: KELLER };
  const zeilen = protokollAnzeigen(
    [
      {
        id: 12,
        aktion: "geaendert",
        geaendert_am: "2026-10-19T07:12:43+00:00",
        geaendert_von_name: "Petra Büro",
        vorher: { ...GESTOPPT, zusatzauftrag_id: null },
        nachher: mitSturmschaden,
      },
      {
        id: 13,
        aktion: "geaendert",
        geaendert_am: "2026-10-19T07:13:02+00:00",
        geaendert_von_name: "Petra Büro",
        vorher: mitSturmschaden,
        nachher: mitKeller,
      },
      {
        id: 14,
        aktion: "geaendert",
        geaendert_am: "2026-10-19T07:14:10+00:00",
        geaendert_von_name: "Petra Büro",
        vorher: mitKeller,
        nachher: { ...GESTOPPT, zusatzauftrag_id: null },
      },
    ],
    NAMEN,
  );
  expect(zeilen.map((z) => z.aenderungen)).toEqual([
    [{ feld: "Zusatzauftrag", vorher: "–", nachher: "Sturmschaden Dach" }],
    [{ feld: "Zusatzauftrag", vorher: "Sturmschaden Dach", nachher: "Keller entrümpeln" }],
    [{ feld: "Zusatzauftrag", vorher: "Keller entrümpeln", nachher: "–" }],
  ]);
});

test("Freigabe und Rücknahme der Freigabe stehen im Protokoll", () => {
  const freigegeben = { ...GESTOPPT, freigegeben_am: "2026-10-19T07:12:43.512+00:00" };
  const zeilen = protokollAnzeigen(
    [
      {
        id: 8,
        aktion: "geaendert",
        geaendert_am: "2026-10-19T07:12:43.512+00:00",
        geaendert_von_name: "Petra Büro",
        // Einträge aus der Zeit vor der Freigabe haben das Feld noch nicht.
        vorher: GESTOPPT,
        nachher: freigegeben,
      },
      {
        id: 9,
        aktion: "geaendert",
        geaendert_am: "2026-10-20T13:00:05+00:00",
        geaendert_von_name: "Petra Büro",
        vorher: freigegeben,
        nachher: { ...GESTOPPT, freigegeben_am: null },
      },
    ],
    NAMEN,
  );
  expect(zeilen.map((z) => z.aenderungen)).toEqual([
    [{ feld: "Freigegeben", vorher: "–", nachher: "19.10.2026, 09:12" }],
    [{ feld: "Freigegeben", vorher: "19.10.2026, 09:12", nachher: "–" }],
  ]);
});

test("Abrechnung und Rücknahme der Abrechnung stehen im Protokoll", () => {
  const freigegeben = { ...GESTOPPT, freigegeben_am: "2026-10-19T07:12:43.512+00:00" };
  const abgerechnet = { ...freigegeben, abgerechnet_in: "7c6d5e4f-1a2b-4c3d-8e9f-0a1b2c3d4e5f" };
  const zeilen = protokollAnzeigen(
    [
      {
        id: 10,
        aktion: "geaendert",
        geaendert_am: "2026-11-02T08:30:12+00:00",
        geaendert_von_name: "Petra Büro",
        // Einträge aus der Zeit vor der Abrechnung haben das Feld noch nicht.
        vorher: freigegeben,
        nachher: abgerechnet,
      },
      {
        id: 11,
        aktion: "geaendert",
        geaendert_am: "2026-11-03T10:01:44+00:00",
        geaendert_von_name: "Petra Büro",
        vorher: abgerechnet,
        nachher: { ...freigegeben, abgerechnet_in: null },
      },
    ],
    NAMEN,
  );
  expect(zeilen.map((z) => z.aenderungen)).toEqual([
    [{ feld: "Abgerechnet", vorher: "nein", nachher: "ja" }],
    [{ feld: "Abgerechnet", vorher: "ja", nachher: "nein" }],
  ]);
});
