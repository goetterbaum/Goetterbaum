import { expect, test } from "vitest";
import { geltenderStundensatz, objektsatzNoetig } from "./regeln";

// Glasreinigung kostet standardmäßig 38,00 €.
const OHNE_ABSPRACHE = { standardCent: 3800, kundeCent: null, objektCent: null };

test("Ohne Absprache gilt für den Kunden der Standard-Stundensatz der Tätigkeit", () => {
  expect(geltenderStundensatz(OHNE_ABSPRACHE)).toEqual({
    stundensatzCent: 3800,
    herkunft: "standard",
  });
});

test("Ein abweichender Stundensatz des Kunden hat Vorrang vor dem Standard", () => {
  expect(geltenderStundensatz({ ...OHNE_ABSPRACHE, kundeCent: 3400 })).toEqual({
    stundensatzCent: 3400,
    herkunft: "kunde",
  });
});

test("Ein Stundensatz des Objekts hat Vorrang vor Kunde und Standard", () => {
  expect(geltenderStundensatz({ standardCent: 3800, kundeCent: 3400, objektCent: 3150 })).toEqual({
    stundensatzCent: 3150,
    herkunft: "objekt",
  });
  expect(geltenderStundensatz({ ...OHNE_ABSPRACHE, objektCent: 4200 })).toEqual({
    stundensatzCent: 4200,
    herkunft: "objekt",
  });
});

test("Ein Objektsatz gleich dem bisherigen Satz (Kunde, sonst Standard) ist nicht nötig", () => {
  expect(objektsatzNoetig(3400, { ...OHNE_ABSPRACHE, kundeCent: 3400 })).toBe(false);
  expect(objektsatzNoetig(3800, OHNE_ABSPRACHE)).toBe(false);
  // Der Standard zählt nicht, wenn der Kunde einen eigenen Satz hat.
  expect(objektsatzNoetig(3800, { ...OHNE_ABSPRACHE, kundeCent: 3400 })).toBe(true);
  expect(objektsatzNoetig(3150, { ...OHNE_ABSPRACHE, kundeCent: 3400 })).toBe(true);
  // Ein vorhandener Objektsatz ist nicht der bisherige: Wer den Kundensatz
  // eintippt, soll den Objektsatz entfernen statt ihn zu kopieren.
  expect(objektsatzNoetig(3150, { standardCent: 3800, kundeCent: 3400, objektCent: 3150 })).toBe(
    true,
  );
});
