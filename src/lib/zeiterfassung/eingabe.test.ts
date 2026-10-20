import { expect, test } from "vitest";
import { pruefeStartEingabe } from "./eingabe";

function formular(werte: Record<string, string>) {
  const formData = new FormData();
  for (const [name, wert] of Object.entries(werte)) formData.set(name, wert);
  return formData;
}

const OBJEKT = "4f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const TAETIGKEIT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ZUSATZAUFTRAG = "c3d2e1f0-7a6b-4c5d-9e8f-2b1a0c9d8e7f";

test("Ein Start mit Objekt und Tätigkeit wird übernommen", () => {
  expect(pruefeStartEingabe(formular({ objekt: OBJEKT, taetigkeit: TAETIGKEIT }))).toEqual({
    ok: true,
    daten: {
      art: "taetigkeit",
      objekt_id: OBJEKT,
      taetigkeit_id: TAETIGKEIT,
      zusatzauftrag_id: null,
    },
  });
});

test("Ohne Objekt oder ohne Tätigkeit startet nichts", () => {
  for (const objekt of ["", "  ", "kein-objekt"]) {
    expect(pruefeStartEingabe(formular({ objekt, taetigkeit: TAETIGKEIT })), objekt).toEqual({
      ok: false,
      fehler: "Bitte wähle ein Objekt.",
    });
  }
  for (const taetigkeit of ["", "unbekannt"]) {
    expect(pruefeStartEingabe(formular({ objekt: OBJEKT, taetigkeit })), taetigkeit).toEqual({
      ok: false,
      fehler: "Bitte wähle eine Tätigkeit.",
    });
  }
  expect(pruefeStartEingabe(formular({}))).toEqual({
    ok: false,
    fehler: "Bitte wähle ein Objekt.",
  });
});

test("Ein Start kann einen Zusatzauftrag mitnehmen; ohne Auswahl ist es reguläre Arbeit", () => {
  expect(
    pruefeStartEingabe(
      formular({ objekt: OBJEKT, taetigkeit: TAETIGKEIT, zusatzauftrag: ZUSATZAUFTRAG }),
    ),
  ).toEqual({
    ok: true,
    daten: {
      art: "taetigkeit",
      objekt_id: OBJEKT,
      taetigkeit_id: TAETIGKEIT,
      zusatzauftrag_id: ZUSATZAUFTRAG,
    },
  });
  const ohne = pruefeStartEingabe(
    formular({ objekt: OBJEKT, taetigkeit: TAETIGKEIT, zusatzauftrag: " " }),
  );
  expect(ohne.ok && ohne.daten.zusatzauftrag_id).toBeNull();
});

test("Ein ungültiger Zusatzauftrag startet nichts", () => {
  expect(
    pruefeStartEingabe(formular({ objekt: OBJEKT, taetigkeit: TAETIGKEIT, zusatzauftrag: "x" })),
  ).toEqual({ ok: false, fehler: "Bitte wähle einen Zusatzauftrag aus der Liste." });
});
