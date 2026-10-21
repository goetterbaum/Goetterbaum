import { expect, test } from "vitest";
import type { Rechnungsvorbereitung } from "@/lib/rechnungsvorbereitung";
import { abrechnungsStand, abrechnungsUmfang } from "./abrechnung";

const HAUS_A = "4f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const HAUS_B = "5f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const REINIGUNG = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const EINTRAG_1 = "1b2c3d4e-0000-4000-8000-000000000001";
const EINTRAG_2 = "1b2c3d4e-0000-4000-8000-000000000002";

// Ein Quartal mit zwei Pauschal-Monaten von Haus A (einer war schon
// abgerechnet) und Stunden in Haus B.
const ERGEBNIS: Rechnungsvorbereitung = {
  positionen: [
    { art: "pauschale", objektId: HAUS_A, monat: "2026-02", betragCent: 50000 },
    { art: "pauschale", objektId: HAUS_A, monat: "2026-03", betragCent: 50000 },
    {
      art: "stunden",
      objektId: HAUS_B,
      taetigkeitId: REINIGUNG,
      minuten: 135,
      stundensatzCent: 3000,
      betragCent: 6750,
    },
  ],
  summeCent: 106750,
  zeiteintragIds: [EINTRAG_2, EINTRAG_1],
  stundennachweis: [],
};

test("Eine Abrechnung umfasst die Zeiteinträge, die Pauschal-Monate, die Zusatzaufträge mit Festbetrag und die Summe", () => {
  expect(abrechnungsUmfang(ERGEBNIS)).toEqual({
    zeiteintragIds: [EINTRAG_2, EINTRAG_1],
    // Monate als erster Tag, wie die Datenbank sie speichert.
    pauschalMonate: [
      { objekt_id: HAUS_A, monat: "2026-02-01" },
      { objekt_id: HAUS_A, monat: "2026-03-01" },
    ],
    zusatzauftragIds: [],
    summeCent: 106750,
    positionen: ERGEBNIS.positionen,
  });
});

test("Ohne Positionen gibt es nichts abzurechnen", () => {
  const leer = { positionen: [], summeCent: 0, zeiteintragIds: [], stundennachweis: [] };
  expect(abrechnungsUmfang(leer)).toBeNull();
});

test("Der Stand bleibt gleich, solange sich nichts Abzurechnendes ändert", () => {
  const umgestellt = { ...ERGEBNIS, zeiteintragIds: [EINTRAG_1, EINTRAG_2] };
  expect(abrechnungsStand(umgestellt)).toBe(abrechnungsStand(ERGEBNIS));
  expect(abrechnungsStand(ERGEBNIS)).toMatch(/^[0-9a-f]{64}$/);
});

test("Ein anderer Zeiteintrag oder ein anderer Betrag ändert den Stand", () => {
  const ohneEintrag2 = { ...ERGEBNIS, zeiteintragIds: [EINTRAG_1] };
  expect(abrechnungsStand(ohneEintrag2)).not.toBe(abrechnungsStand(ERGEBNIS));

  const [a, b, stunden] = ERGEBNIS.positionen;
  const andererSatz = {
    ...ERGEBNIS,
    positionen: [a, b, { ...stunden, stundensatzCent: 3200, betragCent: 7200 }],
    summeCent: 107200,
  };
  expect(abrechnungsStand(andererSatz)).not.toBe(abrechnungsStand(ERGEBNIS));
});

test("Eine Abrechnung umfasst auch die Zusatzaufträge mit Festbetrag, nicht die nach Stunden", () => {
  const STURMSCHADEN = "7c6d5e4f-0000-4000-8000-000000000001";
  const KELLER = "7c6d5e4f-0000-4000-8000-000000000002";
  const ergebnis: Rechnungsvorbereitung = {
    positionen: [
      {
        art: "zusatzauftrag-stunden",
        zusatzauftragId: KELLER,
        objektId: HAUS_A,
        taetigkeitId: REINIGUNG,
        minuten: 60,
        stundensatzCent: 3000,
        betragCent: 3000,
      },
      {
        art: "zusatzauftrag-festbetrag",
        zusatzauftragId: STURMSCHADEN,
        objektId: HAUS_B,
        betragCent: 89000,
      },
    ],
    summeCent: 92000,
    zeiteintragIds: [EINTRAG_1, EINTRAG_2],
    stundennachweis: [],
  };
  expect(abrechnungsUmfang(ergebnis)).toMatchObject({
    zeiteintragIds: [EINTRAG_1, EINTRAG_2],
    pauschalMonate: [],
    zusatzauftragIds: [STURMSCHADEN],
    summeCent: 92000,
  });
});
