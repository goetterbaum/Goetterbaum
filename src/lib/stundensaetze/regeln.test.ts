import { expect, test } from "vitest";
import { geltenderStundensatz, objektsatzFestlegen } from "./regeln";

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

test("Ein Objektsatz gleich dem bisherigen Satz (Kunde, sonst Standard) wird nicht gespeichert", () => {
  expect(objektsatzFestlegen(3400, { ...OHNE_ABSPRACHE, kundeCent: 3400 })).toBe("nichts");
  expect(objektsatzFestlegen(3800, OHNE_ABSPRACHE)).toBe("nichts");
  // Der Standard zählt nicht, wenn der Kunde einen eigenen Satz hat.
  expect(objektsatzFestlegen(3800, { ...OHNE_ABSPRACHE, kundeCent: 3400 })).toBe("speichern");
  expect(objektsatzFestlegen(3150, { ...OHNE_ABSPRACHE, kundeCent: 3400 })).toBe("speichern");
});

test("Ein vorhandener Objektsatz wird geändert oder, auf den bisherigen Satz gesetzt, entfernt", () => {
  const mitObjektsatz = { standardCent: 3800, kundeCent: 3400, objektCent: 3150 };
  expect(objektsatzFestlegen(3150, mitObjektsatz)).toBe("speichern");
  expect(objektsatzFestlegen(3290, mitObjektsatz)).toBe("speichern");
  // Auf den Satz des Kunden gesetzt, folgt das Objekt wieder dem Kunden.
  expect(objektsatzFestlegen(3400, mitObjektsatz)).toBe("entfernen");
  expect(objektsatzFestlegen(3800, { ...OHNE_ABSPRACHE, objektCent: 3150 })).toBe("entfernen");
});

test("Ein Stundensatz des Zusatzauftrags hat Vorrang vor Objekt, Kunde und Standard", () => {
  expect(
    geltenderStundensatz({
      standardCent: 3800,
      kundeCent: 3400,
      objektCent: 3150,
      zusatzauftragCent: 5500,
    }),
  ).toEqual({ stundensatzCent: 5500, herkunft: "zusatzauftrag" });
  expect(geltenderStundensatz({ ...OHNE_ABSPRACHE, zusatzauftragCent: 2990 })).toEqual({
    stundensatzCent: 2990,
    herkunft: "zusatzauftrag",
  });
  // Ohne eigenen Satz des Zusatzauftrags gilt Objekt → Kunde → Standard.
  expect(
    geltenderStundensatz({
      standardCent: 3800,
      kundeCent: 3400,
      objektCent: null,
      zusatzauftragCent: null,
    }),
  ).toEqual({ stundensatzCent: 3400, herkunft: "kunde" });
});
