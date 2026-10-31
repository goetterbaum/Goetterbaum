import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { FEHLER, OK } from "@/lib/rueckmeldung";
import { ZusatzauftragFormular } from "./zusatzauftrag-formular";

afterEach(cleanup);

function fuelleAus(beschreibung: string, festbetrag: string) {
  fireEvent.change(screen.getByLabelText("Beschreibung"), { target: { value: beschreibung } });
  fireEvent.change(screen.getByLabelText("Abrechnung des Zusatzauftrags"), {
    target: { value: "festbetrag" },
  });
  fireEvent.change(screen.getByLabelText("Festbetrag in Euro"), { target: { value: festbetrag } });
}

test("Nach einer Fehlermeldung bleiben alle Angaben stehen, auch die Abrechnungsart", async () => {
  render(
    <ZusatzauftragFormular
      aktion={async () => FEHLER("Der Festbetrag ist kein gültiger Betrag. Beispiel: 890,00")}
      leeren
      knopf="Anlegen"
      knopfLaeuft="Wird angelegt …"
    />,
  );
  fuelleAus("Grundreinigung nach Umbau", "0");
  fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Der Festbetrag ist kein gültiger Betrag. Beispiel: 890,00",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Beschreibung").value).toBe(
    "Grundreinigung nach Umbau",
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Abrechnung des Zusatzauftrags").value).toBe(
    "festbetrag",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Festbetrag in Euro").value).toBe("0");
});

test("Nach dem Anlegen ist das Formular leer für den nächsten Zusatzauftrag", async () => {
  render(
    <ZusatzauftragFormular
      aktion={async () => OK("Zusatzauftrag angelegt.")}
      leeren
      knopf="Anlegen"
      knopfLaeuft="Wird angelegt …"
    />,
  );
  fuelleAus("Grundreinigung nach Umbau", "1.890,50");
  fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

  expect((await screen.findByRole("status")).textContent).toBe("Zusatzauftrag angelegt.");
  expect(screen.getByLabelText<HTMLInputElement>("Beschreibung").value).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("Abrechnung des Zusatzauftrags").value).toBe(
    "stunden",
  );
  expect(screen.queryByLabelText("Festbetrag in Euro")).toBeNull();
});

test("Den Stundensatz mit Hinweis gibt es nur bei Abrechnung nach Stunden", () => {
  render(
    <ZusatzauftragFormular
      aktion={async () => OK()}
      vorgabe={{
        beschreibung: "Sturmschaden Hof",
        abrechnungsart: "stunden",
        festbetrag_cent: null,
        stundensatz_cent: 5250,
      }}
      knopf="Speichern"
      knopfLaeuft="Wird gespeichert …"
    />,
  );
  const stundensatz = screen.getByLabelText<HTMLInputElement>("Stundensatz in Euro");
  expect(stundensatz.value).toBe("52,50");
  expect(stundensatz.required).toBe(false);
  expect(
    screen.getByText("Leer lassen: Es gelten die Sätze des Objekts bzw. Kunden."),
  ).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Abrechnung des Zusatzauftrags"), {
    target: { value: "festbetrag" },
  });
  expect(screen.queryByLabelText("Stundensatz in Euro")).toBeNull();
  expect(
    screen.queryByText("Leer lassen: Es gelten die Sätze des Objekts bzw. Kunden."),
  ).toBeNull();
});
