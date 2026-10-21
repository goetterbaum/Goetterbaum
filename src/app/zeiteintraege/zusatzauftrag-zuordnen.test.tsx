import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { FEHLER, OK } from "@/lib/rueckmeldung";
import { ZusatzauftragZuordnen } from "./zusatzauftrag-zuordnen";

afterEach(cleanup);

const STURMSCHADEN = {
  id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  beschreibung: "Sturmschaden Dach",
  erledigt: true,
};
const LAUB = {
  id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  beschreibung: "Laub nach Sturm",
  erledigt: false,
};
const GRUNDREINIGUNG = {
  id: "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a",
  beschreibung: "Grundreinigung nach Umbau",
  erledigt: true,
};

function auswahl() {
  return screen.getByLabelText<HTMLSelectElement>("Zusatzauftrag");
}

test("Zur Wahl stehen die offenen Zusatzaufträge des Objekts und der bisherige, auch wenn er erledigt ist", () => {
  render(
    <ZusatzauftragZuordnen
      aktion={async () => OK()}
      zusatzauftraege={[LAUB, STURMSCHADEN, GRUNDREINIGUNG]}
      zusatzauftragId={STURMSCHADEN.id}
    />,
  );

  expect([...auswahl().options].map((o) => o.text)).toEqual([
    "Kein Zusatzauftrag",
    "Laub nach Sturm",
    "Sturmschaden Dach (erledigt)",
  ]);
  expect(auswahl().value).toBe(STURMSCHADEN.id);
});

test("Ohne offene Zusatzaufträge und ohne bisherigen gibt es nichts zu wählen", () => {
  render(
    <ZusatzauftragZuordnen
      aktion={async () => OK()}
      zusatzauftraege={[GRUNDREINIGUNG]}
      zusatzauftragId=""
    />,
  );

  expect(screen.queryByLabelText("Zusatzauftrag")).toBeNull();
  expect(screen.getByText("Für dieses Objekt gibt es keinen offenen Zusatzauftrag.")).toBeTruthy();
});

test("Nach dem Speichern bleibt die Rückmeldung stehen, und eine woanders geänderte Zuordnung wird übernommen", async () => {
  const aktion = async () => OK("Zusatzauftrag gespeichert.");
  const { rerender } = render(
    <ZusatzauftragZuordnen
      aktion={aktion}
      zusatzauftraege={[LAUB, STURMSCHADEN]}
      zusatzauftragId={STURMSCHADEN.id}
    />,
  );
  fireEvent.change(auswahl(), { target: { value: LAUB.id } });
  fireEvent.click(screen.getByRole("button", { name: "Zusatzauftrag speichern" }));
  expect((await screen.findByRole("status")).textContent).toBe("Zusatzauftrag gespeichert.");

  // Die Seite lädt neu, mit der gespeicherten Zuordnung.
  rerender(
    <ZusatzauftragZuordnen
      aktion={aktion}
      zusatzauftraege={[LAUB, STURMSCHADEN]}
      zusatzauftragId={LAUB.id}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("Zusatzauftrag gespeichert.");
  expect(auswahl().value).toBe(LAUB.id);

  // Woanders entfernt.
  rerender(
    <ZusatzauftragZuordnen
      aktion={aktion}
      zusatzauftraege={[LAUB, STURMSCHADEN]}
      zusatzauftragId=""
    />,
  );
  expect(auswahl().value).toBe("");
});

test("Nach einer Fehlermeldung bleibt die Auswahl stehen", async () => {
  const gesendet: (string | null)[] = [];
  render(
    <ZusatzauftragZuordnen
      aktion={async (_vorher, formData) => {
        gesendet.push(formData.get("zusatzauftrag") as string | null);
        return FEHLER("Der Zusatzauftrag wurde nicht gespeichert. Bitte versuche es noch einmal.");
      }}
      zusatzauftraege={[LAUB, STURMSCHADEN]}
      zusatzauftragId=""
    />,
  );
  fireEvent.change(auswahl(), { target: { value: LAUB.id } });
  fireEvent.click(screen.getByRole("button", { name: "Zusatzauftrag speichern" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Der Zusatzauftrag wurde nicht gespeichert. Bitte versuche es noch einmal.",
  );
  expect(gesendet).toEqual([LAUB.id]);
  expect(auswahl().value).toBe(LAUB.id);
});
