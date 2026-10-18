import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  entferneFirma,
  legeEigeneFirmaAn,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
} from "./testumgebung/testdaten";

// Ein Kunde mit einem Pauschal-Objekt (500 € im Monat) und einem
// Stunden-Objekt, dazu Zeiteinträge im März 2026. Im März gilt in Berlin
// bis zum 29. die Winterzeit (UTC + 1 Stunde).
async function kundeMitZeiten(firmaId: string) {
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
  const { data: kunde } = await dienst
    .from("kunde")
    .select("name")
    .eq("id", pauschal.kundeId)
    .single<{ name: string }>();
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaId, { standardStundensatzCent: 3000 });
  const erster = await legeEigenenZugangAn(firmaId);
  const zweiter = await legeEigenenZugangAn(firmaId);

  const eintrag = (mitarbeiterId: string, objektId: string, beginn: string, ende: string) =>
    legeZeiteintragAn(dienst, {
      firmaId,
      mitarbeiterId,
      objektId,
      taetigkeitId: taetigkeit.taetigkeitId,
      beginn,
      ende,
    });
  const freigegebene = [
    // 10.03., 08:02:13–09:09:36: 67 Minuten 23 Sekunden
    await eintrag(erster.id, stunden.id, "2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z"),
    // Gleichzeitig ein Kollege, 20 Minuten 18 Sekunden
    await eintrag(zweiter.id, stunden.id, "2026-03-10T07:02:41Z", "2026-03-10T07:22:59Z"),
    // Über Mitternacht: 18:48 am 10.03., 12:05 am 11.03.
    await eintrag(erster.id, stunden.id, "2026-03-10T22:41:12Z", "2026-03-10T23:12:05Z"),
    // Die reguläre Zeit im Pauschal-Objekt ist mit der Pauschale bezahlt.
    await eintrag(erster.id, pauschal.objektId, "2026-03-12T08:00:17Z", "2026-03-12T10:30:44Z"),
    // Gehört schon in den April.
    await eintrag(erster.id, stunden.id, "2026-04-02T06:58:09Z", "2026-04-02T08:01:33Z"),
  ];
  const { error: fehler } = await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .in("id", freigegebene);
  if (fehler) throw fehler;
  // Noch nicht freigegeben: fehlt in der Abrechnung, löst die Warnung aus.
  await eintrag(zweiter.id, stunden.id, "2026-03-20T09:00:09Z", "2026-03-20T10:00:31Z");

  return {
    kundeId: pauschal.kundeId,
    kundeName: kunde!.name,
    pauschalObjekt: pauschal.bezeichnung,
    stundenObjekt: stunden.bezeichnung,
    taetigkeit: taetigkeit.name,
    // Der erste Eintrag vom 10.03. im Stunden-Objekt.
    eintragId: freigegebene[0],
  };
}

function zeile(page: Page, ...texte: string[]) {
  return texte.reduce(
    (zeilen, text) => zeilen.filter({ hasText: text }),
    page.locator("tbody").getByRole("row"),
  );
}

test("Das Büro sieht Pauschale und gerundete Stunden eines Kunden, wird vor Fehlendem gewarnt und lädt die CSV-Datei", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const kunde = await kundeMitZeiten(firmaA.id);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.getByRole("link", { name: "Rechnungsvorbereitung" }).click();
  await expect(page.getByRole("heading", { name: "Rechnungsvorbereitung" })).toBeVisible();
  await page.getByRole("combobox", { name: /^Kunde/ }).selectOption({ label: kunde.kundeName });
  await feld(page, "Monat").fill("2026-03");
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page).toHaveURL(new RegExp(`kunde=${kunde.kundeId}&monat=2026-03`));

  await expect(page.getByRole("heading", { name: `${kunde.kundeName}: März 2026` })).toBeVisible();
  await expect(page.getByText("Rundungsregel: Auf angefangene 15 Minuten")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Achtung" })).toContainText(
    "1 Zeiteintrag dieses Kunden, der noch nicht freigegeben ist",
  );

  // Gerundet wird je Objekt, Tätigkeit und Tag: am 10.03. 106:29 Minuten →
  // 120, am 11.03. 12:05 → 15. Zusammen 2:15 Stunden zu 30 €.
  await expect(page.locator("tbody").getByRole("row")).toHaveCount(2);
  await expect(zeile(page, "Pauschale", kunde.pauschalObjekt, "März 2026")).toContainText(
    "500,00 €",
  );
  await expect(zeile(page, kunde.stundenObjekt, kunde.taetigkeit)).toContainText(
    /2:15 Std\.\s*30,00\s€\s*67,50\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*567,50\s€/);

  // Die CSV-Datei hat dieselben Positionen.
  const herunterladen = page.waitForEvent("download");
  await page.getByRole("link", { name: "Als CSV-Datei herunterladen" }).click();
  const datei = await herunterladen;
  expect(datei.suggestedFilename()).toBe(`Rechnungsvorbereitung ${kunde.kundeName} 2026-03.csv`);
  const inhalt = await readFile((await datei.path())!);
  expect(inhalt.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(inhalt.toString("utf8").slice(1)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Monat;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Pauschale;${kunde.pauschalObjekt};;;März 2026;;;;500,00\r\n` +
      `Stunden;${kunde.stundenObjekt};;${kunde.taetigkeit};;2:15;135;30,00;67,50\r\n` +
      "Summe;;;;;;;;567,50\r\n",
  );

  // Im April zählt nur, was im April beginnt: am 02.04. 63:24 Minuten →
  // 75. Die März-Stunden kommen nicht noch einmal, und der nicht
  // freigegebene März-Eintrag löst keine Warnung aus.
  await page.goto(`/rechnungsvorbereitung?kunde=${kunde.kundeId}&monat=2026-04`);
  await expect(page.getByRole("heading", { name: `${kunde.kundeName}: April 2026` })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Achtung" })).toHaveCount(0);
  await expect(page.locator("tbody").getByRole("row")).toHaveCount(2);
  await expect(zeile(page, "Pauschale", kunde.pauschalObjekt, "April 2026")).toContainText(
    "500,00 €",
  );
  await expect(zeile(page, kunde.stundenObjekt, kunde.taetigkeit)).toContainText(
    /1:15 Std\.\s*30,00\s€\s*37,50\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);

  // Mit eigener Rundungsregel des Kunden: minutengenau 106 + 12 Minuten.
  await page.goto(`/kunden/${kunde.kundeId}`);
  await page
    .getByRole("combobox", { name: /^Rundungsregel/ })
    .selectOption({ label: "Minutengenau" });
  await page.getByRole("button", { name: "Speichern" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
  await page.goto(`/rechnungsvorbereitung?kunde=${kunde.kundeId}&monat=2026-03`);
  await expect(page.getByText("Rundungsregel: Minutengenau")).toBeVisible();
  await expect(zeile(page, kunde.stundenObjekt, kunde.taetigkeit)).toContainText(
    /1:58 Std\.\s*30,00\s€\s*59,00\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*559,00\s€/);
});

test("Ohne gewählten Monat wird der Vormonat vorgeschlagen", async ({ page }) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const kunde = await kundeMitZeiten(firmaA.id);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/rechnungsvorbereitung?kunde=${kunde.kundeId}`);
  // Der Vormonat nach dem Kalender in Berlin.
  const [jahr, monat] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  const vormonat = new Date(Date.UTC(jahr, monat - 2, 1));
  await expect(feld(page, "Monat")).toHaveValue(vormonat.toISOString().slice(0, 7));
  const name = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(vormonat);
  await expect(page.getByRole("heading", { name: `${kunde.kundeName}: ${name}` })).toBeVisible();
});

test("Das Büro legt die Standard-Rundungsregel der Firma fest, und Kunden zeigen sie an", async ({
  page,
}) => {
  // Eine eigene Firma, weil andere Tests mit dem Standard von Firma A rechnen.
  const firma = await legeEigeneFirmaAn();
  try {
    const { kundeId } = await legeKundeMitObjektAn(dienstZugang()!, firma.id);
    await meldeAn(page, firma.buero);
    await erwarteAngemeldet(page, firma.buero.name);
    await page.getByRole("link", { name: "Einstellungen der Firma" }).click();
    const regel = page.getByRole("combobox", { name: /^Standard-Rundungsregel/ });
    await expect(regel).toHaveValue("15-minuten");
    await regel.selectOption({ label: "Minutengenau" });
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
    await page.reload();
    await expect(regel).toHaveValue("minutengenau");

    await page.goto(`/kunden/${kundeId}`);
    const kundenRegel = page.getByRole("combobox", { name: /^Rundungsregel/ });
    await expect(kundenRegel).toHaveValue("");
    await expect(kundenRegel.locator("option:checked")).toHaveText(
      "Standard der Firma (Minutengenau)",
    );
  } finally {
    await entferneFirma(firma.id);
  }
});

test("Mitarbeiter sehen die Rechnungsvorbereitung nicht und bekommen keine CSV-Datei", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const { kundeId } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);

  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);
  await expect(page.getByRole("link", { name: "Rechnungsvorbereitung" })).toHaveCount(0);
  await page.goto(`/rechnungsvorbereitung?kunde=${kundeId}&monat=2026-03`);
  await expect(page.getByText("Die Rechnungsvorbereitung darf nur das Büro sehen.")).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);

  const antwort = await page.request.get(
    `/rechnungsvorbereitung/csv?kunde=${kundeId}&monat=2026-03`,
  );
  expect(antwort.status()).toBe(403);
});

test("Das Büro markiert eine Rechnungsvorbereitung als abgerechnet und nimmt die Abrechnung nach Rückfrage zurück", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const kunde = await kundeMitZeiten(firmaA.id);
  const positionen = page.locator("table").filter({ hasText: "Stundensatz" });
  const abrechnungen = page.locator("table").filter({ hasText: "Status" });

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/rechnungsvorbereitung?kunde=${kunde.kundeId}&monat=2026-03`);
  await expect(page.locator("tfoot")).toContainText(/Summe\s*567,50\s€/);
  await expect(page.getByText("Für diesen Kunden gibt es noch keine Abrechnungen.")).toBeVisible();

  await page.getByRole("button", { name: "Als abgerechnet markieren" }).click();
  await expect(page.getByText("In diesem Zeitraum gibt es nichts abzurechnen.")).toBeVisible();
  await expect(positionen).toHaveCount(0);
  const abrechnung = abrechnungen.getByRole("row").filter({ hasText: "März 2026" });
  await expect(abrechnung).toContainText(/567,50\s€/);
  await expect(abrechnung).toContainText(buero.name);
  await expect(abrechnung).toContainText("gültig");

  // Der April bleibt, wie er war.
  await page.goto(`/rechnungsvorbereitung?kunde=${kunde.kundeId}&monat=2026-04`);
  await expect(page.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);

  // Der abgerechnete Zeiteintrag ist gesperrt, auch die Freigabe.
  await page.goto(`/zeiteintraege/${kunde.eintragId}`);
  await expect(
    page.getByText(/^Abgerechnet\. Der Zeiteintrag ist für alle gesperrt/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Freigabe zurücknehmen" })).toHaveCount(0);
  await expect(page.getByText("Abgerechnet: nein → ja")).toBeVisible();
  await page.goto(`/nachtrag/${kunde.eintragId}`);
  await expect(page.getByText(/^Dieser Zeiteintrag ist abgerechnet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);

  // Zurückgenommen wird erst nach der Rückfrage.
  await page.goto(`/rechnungsvorbereitung?kunde=${kunde.kundeId}&monat=2026-03`);
  await abrechnung.getByRole("button", { name: "Zurücknehmen" }).click();
  await expect(page.getByText(/^Abrechnung wirklich zurücknehmen\?/)).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByText(/^Abrechnung wirklich zurücknehmen\?/)).toHaveCount(0);
  await expect(abrechnung).toContainText("gültig");

  await abrechnung.getByRole("button", { name: "Zurücknehmen" }).click();
  await page.getByRole("button", { name: "Ja, zurücknehmen" }).click();
  await expect(abrechnung).toContainText(`zurückgenommen am`);
  await expect(abrechnung).toContainText(buero.name);
  await expect(abrechnung.getByRole("button")).toHaveCount(0);
  await expect(page.locator("tfoot")).toContainText(/Summe\s*567,50\s€/);

  // Die Rücknahme steht im Protokoll, und die Freigabe ist wieder änderbar.
  await page.goto(`/zeiteintraege/${kunde.eintragId}`);
  await expect(page.getByText("Abgerechnet: ja → nein")).toBeVisible();
  await expect(page.getByRole("button", { name: "Freigabe zurücknehmen" })).toBeVisible();
});
