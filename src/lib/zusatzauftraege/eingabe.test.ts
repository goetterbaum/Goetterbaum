import { expect, test } from "vitest";
import { pruefeZusatzauftragEingabe } from "./eingabe";

function formular(werte: Record<string, string>) {
  const formData = new FormData();
  for (const [name, wert] of Object.entries(werte)) formData.set(name, wert);
  return formData;
}

const GRUNDREINIGUNG = {
  beschreibung: " Grundreinigung Treppenhaus nach Umbau ",
  abrechnungsart: "festbetrag",
  festbetrag: "1.890,5",
};

test("Ein Zusatzauftrag mit Festbetrag wird centgenau übernommen", () => {
  expect(pruefeZusatzauftragEingabe(formular(GRUNDREINIGUNG))).toEqual({
    ok: true,
    daten: {
      beschreibung: "Grundreinigung Treppenhaus nach Umbau",
      abrechnungsart: "festbetrag",
      festbetrag_cent: 189050,
    },
  });
});

test("Ein Zusatzauftrag nach Stunden hat keinen Festbetrag", () => {
  expect(
    pruefeZusatzauftragEingabe(
      formular({ beschreibung: "Sturmschaden Hof", abrechnungsart: "stunden", festbetrag: " " }),
    ),
  ).toEqual({
    ok: true,
    daten: { beschreibung: "Sturmschaden Hof", abrechnungsart: "stunden", festbetrag_cent: null },
  });
  expect(
    pruefeZusatzauftragEingabe(
      formular({ beschreibung: "Sturmschaden Hof", abrechnungsart: "stunden", festbetrag: "90" }),
    ),
  ).toEqual({
    ok: false,
    fehler: "Bei Abrechnung nach Stunden gibt es keinen Festbetrag. Bitte lass das Feld leer.",
  });
});

test("Bei Abrechnungsart Festbetrag ist der Festbetrag Pflicht und größer als 0 €", () => {
  expect(pruefeZusatzauftragEingabe(formular({ ...GRUNDREINIGUNG, festbetrag: "" }))).toEqual({
    ok: false,
    fehler: "Bitte gib den Festbetrag ein.",
  });
  for (const festbetrag of ["0", "0,00", "neunzig", "12.50", "21.474.837,00"]) {
    expect(
      pruefeZusatzauftragEingabe(formular({ ...GRUNDREINIGUNG, festbetrag })),
      festbetrag,
    ).toEqual({
      ok: false,
      fehler: "Der Festbetrag ist kein gültiger Betrag. Beispiel: 890,00",
    });
  }
});

test("Ohne Beschreibung oder mit unbekannter Abrechnungsart gibt es keinen Zusatzauftrag", () => {
  expect(pruefeZusatzauftragEingabe(formular({ ...GRUNDREINIGUNG, beschreibung: "  " }))).toEqual({
    ok: false,
    fehler: "Bitte gib eine Beschreibung ein.",
  });
  // Die Pauschale gehört zum Objekt, nicht zum Zusatzauftrag.
  for (const abrechnungsart of ["", "pauschale"]) {
    expect(
      pruefeZusatzauftragEingabe(formular({ ...GRUNDREINIGUNG, abrechnungsart })),
      abrechnungsart,
    ).toEqual({ ok: false, fehler: "Bitte wähle eine Abrechnungsart." });
  }
});
