import { expect, test } from "vitest";
import { pruefeStartEingabe } from "./eingabe";

function formular(werte: Record<string, string>) {
  const formData = new FormData();
  for (const [name, wert] of Object.entries(werte)) formData.set(name, wert);
  return formData;
}

const OBJEKT = "4f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const TAETIGKEIT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ZUSATZAUFTRAG = "7c6d5e4f-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

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

test("Ein Start kann einem Zusatzauftrag zugeordnet werden", () => {
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
  // "Kein Zusatzauftrag" kommt als leerer Wert.
  expect(
    pruefeStartEingabe(formular({ objekt: OBJEKT, taetigkeit: TAETIGKEIT, zusatzauftrag: "" })),
  ).toMatchObject({ ok: true, daten: { zusatzauftrag_id: null } });
  expect(
    pruefeStartEingabe(
      formular({ objekt: OBJEKT, taetigkeit: TAETIGKEIT, zusatzauftrag: "sturmschaden" }),
    ),
  ).toEqual({
    ok: false,
    fehler:
      "Dieser Zusatzauftrag steht nicht mehr zur Auswahl oder gehört nicht zum gewählten Objekt. Bitte lade die Seite neu.",
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
