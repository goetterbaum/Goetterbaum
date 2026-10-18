import { expect, test } from "vitest";
import { pruefeZusatzauftragEingabe } from "./eingabe";

function formular(werte: Record<string, string>) {
  const formData = new FormData();
  for (const [name, wert] of Object.entries(werte)) formData.set(name, wert);
  return formData;
}

const STURMSCHADEN = {
  beschreibung: " Sturmschaden: Äste im Innenhof räumen ",
  abrechnungsart: "stunden",
  festbetrag: "",
};

const GRUNDREINIGUNG = {
  beschreibung: "Grundreinigung nach Umbau",
  abrechnungsart: "festbetrag",
  festbetrag: "1.890,5",
};

test("Ein Zusatzauftrag nach Stunden wird ohne Festbetrag übernommen", () => {
  expect(pruefeZusatzauftragEingabe(formular(STURMSCHADEN))).toEqual({
    ok: true,
    daten: {
      beschreibung: "Sturmschaden: Äste im Innenhof räumen",
      abrechnungsart: "stunden",
      festbetrag_cent: null,
    },
  });
});

test("Ein Zusatzauftrag mit Festbetrag wird mit centgenauem Betrag übernommen", () => {
  expect(pruefeZusatzauftragEingabe(formular(GRUNDREINIGUNG))).toEqual({
    ok: true,
    daten: {
      beschreibung: "Grundreinigung nach Umbau",
      abrechnungsart: "festbetrag",
      festbetrag_cent: 189050,
    },
  });
});

test("Ohne Beschreibung gibt es keinen Zusatzauftrag", () => {
  expect(pruefeZusatzauftragEingabe(formular({ ...STURMSCHADEN, beschreibung: "  " }))).toEqual({
    ok: false,
    fehler: "Bitte beschreibe den Zusatzauftrag.",
  });
});

test("Die Abrechnungsart ist Stunden oder Festbetrag", () => {
  expect(
    pruefeZusatzauftragEingabe(formular({ ...STURMSCHADEN, abrechnungsart: "pauschale" })),
  ).toEqual({ ok: false, fehler: "Bitte wähle, wie der Zusatzauftrag abgerechnet wird." });
});

test("Bei Abrechnungsart Festbetrag ist der Festbetrag Pflicht und muss ein gültiger Betrag sein", () => {
  expect(pruefeZusatzauftragEingabe(formular({ ...GRUNDREINIGUNG, festbetrag: " " }))).toEqual({
    ok: false,
    fehler: "Bitte gib den Festbetrag ein.",
  });
  for (const festbetrag of ["0", "0,00", "12,345", "zwölf", "21.474.836,48"]) {
    expect(
      pruefeZusatzauftragEingabe(formular({ ...GRUNDREINIGUNG, festbetrag })),
      festbetrag,
    ).toEqual({
      ok: false,
      fehler: "Der Festbetrag ist kein gültiger Betrag. Beispiel: 1.250,00",
    });
  }
});

test("Bei Abrechnung nach Stunden gibt es keinen Festbetrag", () => {
  expect(pruefeZusatzauftragEingabe(formular({ ...STURMSCHADEN, festbetrag: "80" }))).toEqual({
    ok: false,
    fehler: "Nach Stunden gibt es keinen Festbetrag. Bitte lass das Feld leer.",
  });
});
