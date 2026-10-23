import { expect, test } from "vitest";
import { istZeit, type EintragFuerIstZeit } from "./ist-zeit";

const eintrag = (
  taetigkeit: string,
  beginn: string,
  ende: string,
  zusatzauftragId: string | null = null,
): EintragFuerIstZeit => ({ taetigkeit, zusatzauftragId, beginn, ende });

test("Die Ist-Zeit eines Pauschal-Objekts ist die erfasste Zeit je Tätigkeit, ungerundet bis auf ganze Minuten", () => {
  // Bis zum 29.03.2026 gilt in Berlin die Winterzeit (UTC + 1 Stunde).
  const ergebnis = istZeit(
    [
      // Zwei Personen gleichzeitig: 67:23 + 20:18
      eintrag("Unterhaltsreinigung", "2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z"),
      eintrag("Unterhaltsreinigung", "2026-03-10T07:02:41Z", "2026-03-10T07:22:59Z"),
      // 44:51
      eintrag("Glasreinigung", "2026-03-12T09:00:04Z", "2026-03-12T09:44:55Z"),
      // Am Tag der Zeitumstellung, 00:30 bis 04:00 auf der Uhr: 2:30
      eintrag("Unterhaltsreinigung", "2026-03-28T23:30:00Z", "2026-03-29T02:00:00Z"),
      // Zusatzaufträge werden extra abgerechnet: 29:30 + 30:40
      eintrag("Glasreinigung", "2026-03-13T08:00:00Z", "2026-03-13T08:29:30Z", "za-keller"),
      eintrag("Unterhaltsreinigung", "2026-03-13T09:00:00Z", "2026-03-13T09:30:40Z", "za-keller"),
    ],
    "2026-03-01",
    "2026-03-31",
  );

  expect(ergebnis).toEqual({
    // 67:23 + 20:18 + 150:00 = 237:41 → 238
    jeTaetigkeit: [
      { taetigkeit: "Unterhaltsreinigung", minuten: 238 },
      { taetigkeit: "Glasreinigung", minuten: 45 },
    ],
    minuten: 283,
    // 29:30 + 30:40 = 60:10 → 60
    zusatzauftraegeMinuten: 60,
  });
});

test("Nur die Zeit innerhalb des Zeitraums zählt, auch bei Zeiteinträgen über Mitternacht", () => {
  const ergebnis = istZeit(
    [
      // 28.02. 23:30 bis 01.03. 00:45:10 in Berlin: 45:10 im März
      eintrag("Unterhaltsreinigung", "2026-02-28T22:30:00Z", "2026-02-28T23:45:10Z"),
      // 31.03. 23:50 bis 01.04. 00:20 (Sommerzeit): 10 Minuten im März
      eintrag("Unterhaltsreinigung", "2026-03-31T21:50:00Z", "2026-03-31T22:20:00Z"),
      eintrag("Glasreinigung", "2026-04-01T06:00:00Z", "2026-04-01T07:00:00Z"),
    ],
    "2026-03-01",
    "2026-03-31",
  );
  expect(ergebnis).toEqual({
    jeTaetigkeit: [{ taetigkeit: "Unterhaltsreinigung", minuten: 55 }],
    minuten: 55,
    zusatzauftraegeMinuten: 0,
  });
});

test("Ohne Zeiteinträge ist die Ist-Zeit null", () => {
  expect(istZeit([], "2026-03-01", "2026-03-31")).toEqual({
    jeTaetigkeit: [],
    minuten: 0,
    zusatzauftraegeMinuten: 0,
  });
});
