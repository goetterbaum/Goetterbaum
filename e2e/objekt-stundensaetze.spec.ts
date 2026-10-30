import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
} from "./testumgebung/testdaten";

// Ein Kunde mit einem Pauschal- und einem Stunden-Objekt, eine Tätigkeit
// (Standard 30,00 €, beim Kunden 28,00 €) und im Stunden-Objekt am
// 10.03.2026 freigegebene 2 Stunden (bei 15-Minuten-Rundung genau 2 h).
async function kundeMitStundenObjekt(firmaId: string) {
  const dienst = dienstZugang()!;
  const pauschal = await legeKundeMitObjektAn(dienst, firmaId);
  const { data: stunden, error } = await dienst
    .from("objekt")
    .insert({
      firma_id: firmaId,
      kunde_id: pauschal.kundeId,
      bezeichnung: `Stunden-Objekt ${pauschal.bezeichnung}`,
      strasse: "Domplatz 3",
      plz: "50667",
      ort: "Köln",
      abrechnungsart: "stunden",
    })
    .select("id, bezeichnung")
    .single<{ id: string; bezeichnung: string }>();
  if (error) throw error;
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaId, { standardStundensatzCent: 3000 });
  const { error: satzFehler } = await dienst.from("kunden_stundensatz").insert({
    firma_id: firmaId,
    kunde_id: pauschal.kundeId,
    taetigkeit_id: taetigkeit.taetigkeitId,
    stundensatz_cent: 2800,
  });
  if (satzFehler) throw satzFehler;

  const mitarbeiter = await legeEigenenZugangAn(firmaId);
  // 10.03., 08:00:12–09:59:47 in Berlin (Winterzeit, UTC + 1 Stunde)
  const eintragId = await legeZeiteintragAn(dienst, {
    firmaId,
    mitarbeiterId: mitarbeiter.id,
    objektId: stunden.id,
    taetigkeitId: taetigkeit.taetigkeitId,
    beginn: "2026-03-10T07:00:12Z",
    ende: "2026-03-10T08:59:47Z",
  });
  const { error: freigabeFehler } = await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .eq("id", eintragId);
  if (freigabeFehler) throw freigabeFehler;

  return {
    kundeId: pauschal.kundeId,
    pauschalObjektId: pauschal.objektId,
    stundenObjektId: stunden.id,
    stundenObjekt: stunden.bezeichnung,
    taetigkeitId: taetigkeit.taetigkeitId,
    taetigkeit: taetigkeit.name,
  };
}

// Die Position des Stunden-Objekts in der Rechnungsvorbereitung (nicht die
// Tagesliste darunter).
function position(page: Page, objekt: string, taetigkeit: string) {
  return page
    .locator("table")
    .filter({ hasText: "Stundensatz" })
    .locator("tbody")
    .getByRole("row")
    .filter({ hasText: objekt })
    .filter({ hasText: taetigkeit });
}

async function gespeicherteObjektSaetze(objektId: string) {
  const { data } = await dienstZugang()!
    .from("objekt_stundensatz")
    .select("stundensatz_cent")
    .eq("objekt_id", objektId);
  return data;
}

test("Büro legt beim Objekt einen Stundensatz fest, die Rechnungsvorbereitung rechnet damit, und nach dem Entfernen gilt wieder der des Kunden", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const kunde = await kundeMitStundenObjekt(firmaA.id);
  const rechnungsvorbereitung = `/rechnungsvorbereitung?kunde=${kunde.kundeId}&monat=2026-03`;

  await meldeAn(page, firmaA.buero);
  await erwarteAngemeldet(page, firmaA.buero.name);

  // Ohne Objektsatz gilt der des Kunden.
  await page.goto(rechnungsvorbereitung);
  await expect(position(page, kunde.stundenObjekt, kunde.taetigkeit)).toContainText(
    /2:00 Std\.\s*28,00\s€\s*56,00\s€/,
  );

  await page.goto(`/objekte/${kunde.stundenObjektId}`);
  await expect(page.getByRole("heading", { name: "Stundensätze" })).toBeVisible();
  await expect(page.getByText("Bei Pauschale nur für Zusatzaufträge nach Stunden.")).toHaveCount(0);
  const zeile = page.getByRole("row").filter({ hasText: kunde.taetigkeit });
  await expect(zeile).toContainText("30,00 €");
  await expect(zeile).toContainText("28,00 € (Kunde)");
  await expect(zeile.getByRole("button", { name: "Entfernen" })).toHaveCount(0);

  // Das Feld steht auf dem bisherigen Satz. Unverändert gespeichert wird
  // nichts.
  const satzFeld = feld(page, `Stundensatz des Objekts für ${kunde.taetigkeit} in Euro`);
  await expect(satzFeld).toHaveValue("28,00");
  await zeile.getByRole("button", { name: "Festlegen" }).click();
  await expect(zeile.getByRole("status")).toHaveText(
    "Entspricht dem bisherigen Satz, kein eigener Objektsatz nötig.",
  );
  expect(await gespeicherteObjektSaetze(kunde.stundenObjektId)).toEqual([]);

  // Ungültige Beträge lehnt die App ab wie beim Kunden.
  await satzFeld.fill("0");
  await zeile.getByRole("button", { name: "Festlegen" }).click();
  await expect(zeile.getByRole("alert")).toHaveText(
    "Der Stundensatz ist kein gültiger Betrag. Beispiel: 32,50",
  );
  expect(await gespeicherteObjektSaetze(kunde.stundenObjektId)).toEqual([]);

  await satzFeld.fill("24,5");
  await zeile.getByRole("button", { name: "Festlegen" }).click();
  await expect(zeile.getByRole("status")).toHaveText("Stundensatz festgelegt.");
  await expect(zeile).toContainText("24,50 € (Objekt)");
  await expect(satzFeld).toHaveValue("24,50");

  // Ändern ersetzt den Satz.
  await satzFeld.fill("26");
  await zeile.getByRole("button", { name: "Festlegen" }).click();
  await expect(zeile).toContainText("26,00 € (Objekt)");
  expect(await gespeicherteObjektSaetze(kunde.stundenObjektId)).toEqual([
    { stundensatz_cent: 2600 },
  ]);

  await page.goto(rechnungsvorbereitung);
  await expect(position(page, kunde.stundenObjekt, kunde.taetigkeit)).toContainText(
    /2:00 Std\.\s*26,00\s€\s*52,00\s€/,
  );

  // Der Kunde nennt das Objekt mit eigenen Sätzen.
  await page.goto(`/kunden/${kunde.kundeId}`);
  await expect(page.getByText(`Abweichende Sätze in: ${kunde.stundenObjekt}`)).toBeVisible();

  await page.goto(`/objekte/${kunde.stundenObjektId}`);
  await zeile.getByRole("button", { name: "Entfernen" }).click();
  await expect(zeile).toContainText("28,00 € (Kunde)");
  expect(await gespeicherteObjektSaetze(kunde.stundenObjektId)).toEqual([]);

  await page.goto(rechnungsvorbereitung);
  await expect(position(page, kunde.stundenObjekt, kunde.taetigkeit)).toContainText(
    /2:00 Std\.\s*28,00\s€\s*56,00\s€/,
  );
  await page.goto(`/kunden/${kunde.kundeId}`);
  await expect(page.getByText("Abweichende Sätze in:", { exact: false })).toHaveCount(0);

  // Wer einen vorhandenen Objektsatz auf den Satz des Kunden setzt,
  // entfernt ihn damit.
  await page.goto(`/objekte/${kunde.stundenObjektId}`);
  await satzFeld.fill("31");
  await zeile.getByRole("button", { name: "Festlegen" }).click();
  await expect(zeile).toContainText("31,00 € (Objekt)");
  await satzFeld.fill("28");
  await zeile.getByRole("button", { name: "Festlegen" }).click();
  await expect(zeile.getByRole("status")).toHaveText(
    "Entspricht dem Satz des Kunden bzw. dem Standard. Der eigene Objektsatz wurde entfernt.",
  );
  await expect(zeile).toContainText("28,00 € (Kunde)");
  expect(await gespeicherteObjektSaetze(kunde.stundenObjektId)).toEqual([]);
});

test("Auch ein Pauschal-Objekt hat Stundensätze, mit Hinweis auf die Zusatzaufträge nach Stunden", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const kunde = await kundeMitStundenObjekt(firmaA.id);

  await meldeAn(page, firmaA.buero);
  await erwarteAngemeldet(page, firmaA.buero.name);
  await page.goto(`/objekte/${kunde.pauschalObjektId}`);

  await expect(page.getByRole("heading", { name: "Stundensätze" })).toBeVisible();
  await expect(page.getByText("Bei Pauschale nur für Zusatzaufträge nach Stunden.")).toBeVisible();
  const zeile = page.getByRole("row").filter({ hasText: kunde.taetigkeit });
  await feld(page, `Stundensatz des Objekts für ${kunde.taetigkeit} in Euro`).fill("41");
  await zeile.getByRole("button", { name: "Festlegen" }).click();
  await expect(zeile).toContainText("41,00 € (Objekt)");
  expect(await gespeicherteObjektSaetze(kunde.pauschalObjektId)).toEqual([
    { stundensatz_cent: 4100 },
  ]);
});
