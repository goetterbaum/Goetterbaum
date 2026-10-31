import { expect, test } from "vitest";
import { pruefeStundensatzEingabe } from "./eingabe";

function formular(werte: Record<string, string>) {
  const formData = new FormData();
  for (const [name, wert] of Object.entries(werte)) formData.set(name, wert);
  return formData;
}

const TAETIGKEIT_ID = "3f2b8c1e-0000-4000-8000-000000000002";

test("Ein abweichender Stundensatz für eine Tätigkeit wird centgenau übernommen", () => {
  expect(
    pruefeStundensatzEingabe(formular({ taetigkeit_id: TAETIGKEIT_ID, stundensatz: "29,9" })),
  ).toEqual({
    ok: true,
    daten: { taetigkeit_id: TAETIGKEIT_ID, stundensatz_cent: 2990 },
  });
});

test("Ohne Tätigkeit oder mit ungültigem Betrag gibt es keinen abweichenden Stundensatz", () => {
  expect(pruefeStundensatzEingabe(formular({ taetigkeit_id: "", stundensatz: "29,90" }))).toEqual({
    ok: false,
    fehler: "Bitte wähle eine Tätigkeit.",
  });

  for (const stundensatz of ["", "0", "abc", "21.474.837,00"]) {
    expect(
      pruefeStundensatzEingabe(formular({ taetigkeit_id: TAETIGKEIT_ID, stundensatz })),
      stundensatz,
    ).toEqual({
      ok: false,
      fehler: "Der Stundensatz ist kein gültiger Betrag. Beispiel: 32,50",
    });
  }
});
