import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZusatzauftragAn,
} from "./testumgebung/testdaten";

// Ein Kunde mit einem Pauschal-Objekt (500 € im Monat), einem
// Stunden-Objekt und einer Tätigkeit zu 30 € die Stunde. Im Februar und
// März 2026 gilt in Berlin die Winterzeit (UTC + 1 Stunde), im April die
// Sommerzeit (UTC + 2 Stunden).
async function kunde(firmaId: string) {
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
  const { data: k } = await dienst
    .from("kunde")
    .select("name")
    .eq("id", pauschal.kundeId)
    .single<{ name: string }>();
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaId, { standardStundensatzCent: 3000 });
  const mitarbeiter = await legeEigenenZugangAn(firmaId);

  // Freigegebene Zeiteinträge; zugeordnet wird nur einem offenen
  // Zusatzauftrag, erledigt wird er im Test.
  const freigegeben = async (
    objektId: string,
    beginn: string,
    ende: string,
    zusatzauftragId?: string,
  ) => {
    const id = await legeZeiteintragAn(dienst, {
      firmaId,
      mitarbeiterId: mitarbeiter.id,
      objektId,
      taetigkeitId: taetigkeit.taetigkeitId,
      zusatzauftragId,
      beginn,
      ende,
    });
    const { error } = await dienst
      .from("zeiteintrag")
      .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
      .eq("id", id);
    if (error) throw error;
    return id;
  };

  return {
    kundeId: pauschal.kundeId,
    kundeName: k!.name,
    pauschal: { id: pauschal.objektId, bezeichnung: pauschal.bezeichnung },
    stunden,
    taetigkeit: taetigkeit.name,
    freigegeben,
  };
}

function zeile(page: Page, ...texte: string[]) {
  return texte.reduce(
    (zeilen, text) => zeilen.filter({ hasText: text }),
    page.locator("table").filter({ hasText: "Stundensatz" }).locator("tbody").getByRole("row"),
  );
}

async function csvVon(page: Page) {
  const herunterladen = page.waitForEvent("download");
  await page.getByRole("link", { name: "Als CSV-Datei herunterladen" }).click();
  const datei = await herunterladen;
  return (await readFile((await datei.path())!)).toString("utf8").slice(1);
}

async function rechnungsvorbereitung(page: Page, kundeId: string, monat: string) {
  await page.goto(`/rechnungsvorbereitung?kunde=${kundeId}&monat=${monat}`);
}

test("Ein Zusatzauftrag nach Stunden im Pauschal-Objekt erscheint getrennt, wird abgerechnet und nach der Rücknahme wieder abrechenbar", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const k = await kunde(firmaA.id);
  const sturmschaden = await legeZusatzauftragAn(dienstZugang()!, firmaA.id, k.pauschal.id, {
    beschreibung: `Sturmschaden Dach ${randomUUID().slice(0, 8)}`,
  });
  // Die reguläre Zeit im Pauschal-Objekt ist mit der Pauschale bezahlt.
  await k.freigegeben(k.pauschal.id, "2026-03-12T08:00:17Z", "2026-03-12T10:30:44Z");
  // 10.03., 08:02:13–09:09:36: 67 Minuten 23 Sekunden → 75 Minuten.
  await k.freigegeben(
    k.pauschal.id,
    "2026-03-10T07:02:13Z",
    "2026-03-10T08:09:36Z",
    sturmschaden.zusatzauftragId,
  );
  // 02.04., 08:58:09–10:01:33: gehört in den April, 63 Minuten → 75.
  await k.freigegeben(
    k.pauschal.id,
    "2026-04-02T06:58:09Z",
    "2026-04-02T08:01:33Z",
    sturmschaden.zusatzauftragId,
  );

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await rechnungsvorbereitung(page, k.kundeId, "2026-03");
  await expect(zeile(page)).toHaveCount(2);
  await expect(zeile(page, "Pauschale", k.pauschal.bezeichnung, "März 2026")).toContainText(
    "500,00 €",
  );
  await expect(
    zeile(page, "Zusatzauftrag nach Stunden", k.pauschal.bezeichnung, sturmschaden.beschreibung),
  ).toContainText(new RegExp(`${k.taetigkeit}\\s*1:15 Std\\.\\s*30,00\\s€\\s*37,50\\s€`));
  await expect(page.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);
  expect(await csvVon(page)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Monat;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Pauschale;${k.pauschal.bezeichnung};;;März 2026;;;;500,00\r\n` +
      `Zusatzauftrag nach Stunden;${k.pauschal.bezeichnung};${sturmschaden.beschreibung};${k.taetigkeit};;1:15;75;30,00;37,50\r\n` +
      "Summe;;;;;;;;537,50\r\n",
  );

  await page.getByRole("button", { name: "Als abgerechnet markieren" }).click();
  await expect(page.getByText("In diesem Zeitraum gibt es nichts abzurechnen.")).toBeVisible();

  // Die abgerechneten Stunden würde ein Festbetrag noch einmal bezahlen:
  // Die Abrechnungsart bleibt, die Beschreibung lässt sich ändern.
  await page.goto(`/zusatzauftraege/${sturmschaden.zusatzauftragId}`);
  await page
    .getByRole("combobox", { name: /^Abrechnung des Zusatzauftrags/ })
    .selectOption({ label: "Festbetrag" });
  await page.getByLabel("Festbetrag in Euro", { exact: true }).fill("890,00");
  await page.getByRole("button", { name: "Speichern" }).click();
  // Next.js hat eine eigene, leere Ansage-Fläche mit derselben Rolle.
  await expect(page.getByRole("alert").filter({ hasText: "Für diesen" })).toHaveText(
    "Für diesen Zusatzauftrag ist schon Zeit abgerechnet. Die Abrechnungsart lässt sich deshalb nicht mehr ändern.",
  );
  await page.reload();
  await expect(page.getByText("Nach Stunden")).toBeVisible();

  // Im April kommt nur die April-Zeit für den Zusatzauftrag.
  await rechnungsvorbereitung(page, k.kundeId, "2026-04");
  await expect(zeile(page)).toHaveCount(2);
  await expect(zeile(page, "Zusatzauftrag nach Stunden", sturmschaden.beschreibung)).toContainText(
    /1:15 Std\.\s*30,00\s€\s*37,50\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);

  // Nach der Rücknahme ist der März wieder abrechenbar.
  await rechnungsvorbereitung(page, k.kundeId, "2026-03");
  const abrechnung = page
    .locator("table")
    .filter({ hasText: "Status" })
    .getByRole("row")
    .filter({ hasText: "März 2026" });
  await abrechnung.getByRole("button", { name: "Zurücknehmen" }).click();
  await page.getByRole("button", { name: "Ja, zurücknehmen" }).click();
  await expect(abrechnung).toContainText("zurückgenommen am");
  await expect(zeile(page, "Zusatzauftrag nach Stunden", sturmschaden.beschreibung)).toContainText(
    /1:15 Std\.\s*30,00\s€\s*37,50\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);
});

test("Ein Zusatzauftrag mit Festbetrag im Stunden-Objekt erscheint erst erledigt, umfasst seine Zeit, ist abgerechnet gesperrt und nach der Rücknahme wieder abrechenbar", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const k = await kunde(firmaA.id);
  const grundreinigung = await legeZusatzauftragAn(dienstZugang()!, firmaA.id, k.stunden.id, {
    beschreibung: `Grundreinigung nach Umbau ${randomUUID().slice(0, 8)}`,
    festbetragCent: 89000,
  });
  // Reguläre Zeit: 10.03., 08:02:41–08:22:59, 20 Minuten 18 Sekunden → 30.
  await k.freigegeben(k.stunden.id, "2026-03-10T07:02:41Z", "2026-03-10T07:22:59Z");
  // Zeit für den Festbetrag, auch schon im Februar.
  const februar = await k.freigegeben(
    k.stunden.id,
    "2026-02-23T07:03:41Z",
    "2026-02-23T11:47:12Z",
    grundreinigung.zusatzauftragId,
  );
  await k.freigegeben(
    k.stunden.id,
    "2026-03-11T07:00:51Z",
    "2026-03-11T09:31:20Z",
    grundreinigung.zusatzauftragId,
  );

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);

  // Noch offen: Der Festbetrag fehlt, und seine Zeit kommt nicht nach
  // Stunden in die Rechnung.
  await rechnungsvorbereitung(page, k.kundeId, "2026-03");
  await expect(zeile(page)).toHaveCount(2);
  await expect(zeile(page, "Stunden", k.stunden.bezeichnung, k.taetigkeit)).toContainText(
    /0:30 Std\.\s*30,00\s€\s*15,00\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*515,00\s€/);

  await page.goto(`/zusatzauftraege/${grundreinigung.zusatzauftragId}`);
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();

  // Erledigt: einmal mit seinem Betrag, die Zeit nicht zusätzlich.
  await rechnungsvorbereitung(page, k.kundeId, "2026-03");
  await expect(zeile(page)).toHaveCount(3);
  const festbetrag = zeile(page, "Zusatzauftrag mit Festbetrag", grundreinigung.beschreibung);
  await expect(festbetrag).toContainText(k.stunden.bezeichnung);
  await expect(festbetrag).toContainText("890,00 €");
  await expect(festbetrag).not.toContainText("Std.");
  await expect(page.locator("tfoot")).toContainText(/Summe\s*1\.405,00\s€/);
  expect(await csvVon(page)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Monat;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Pauschale;${k.pauschal.bezeichnung};;;März 2026;;;;500,00\r\n` +
      `Stunden;${k.stunden.bezeichnung};;${k.taetigkeit};;0:30;30;30,00;15,00\r\n` +
      `Zusatzauftrag mit Festbetrag;${k.stunden.bezeichnung};${grundreinigung.beschreibung};;;;;;890,00\r\n` +
      "Summe;;;;;;;;1405,00\r\n",
  );

  await page.getByRole("button", { name: "Als abgerechnet markieren" }).click();
  await expect(page.getByText("In diesem Zeitraum gibt es nichts abzurechnen.")).toBeVisible();

  // Der Februar zeigt nur seine Pauschale: Die Februar-Zeit ist mit dem
  // Festbetrag abgerechnet und gesperrt.
  await rechnungsvorbereitung(page, k.kundeId, "2026-02");
  await expect(zeile(page)).toHaveCount(1);
  await expect(zeile(page, "Pauschale", "Februar 2026")).toContainText("500,00 €");
  await page.goto(`/zeiteintraege/${februar}`);
  await expect(
    page.getByText(/^Abgerechnet\. Der Zeiteintrag ist für alle gesperrt/),
  ).toBeVisible();

  // Der Zusatzauftrag ist gesperrt.
  await page.goto(`/zusatzauftraege/${grundreinigung.zusatzauftragId}`);
  await expect(page.getByText("erledigt und abgerechnet")).toBeVisible();
  await expect(page.getByText(/^Dieser Zusatzauftrag ist abgerechnet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);

  // Nach der Rücknahme ist der Festbetrag wieder abrechenbar.
  await rechnungsvorbereitung(page, k.kundeId, "2026-03");
  const abrechnung = page
    .locator("table")
    .filter({ hasText: "Status" })
    .getByRole("row")
    .filter({ hasText: "März 2026" });
  await expect(abrechnung).toContainText(/1\.405,00\s€/);
  await abrechnung.getByRole("button", { name: "Zurücknehmen" }).click();
  await page.getByRole("button", { name: "Ja, zurücknehmen" }).click();
  await expect(abrechnung).toContainText("zurückgenommen am");
  await expect(
    zeile(page, "Zusatzauftrag mit Festbetrag", grundreinigung.beschreibung),
  ).toContainText("890,00 €");
  await expect(page.locator("tfoot")).toContainText(/Summe\s*1\.405,00\s€/);

  await page.goto(`/zusatzauftraege/${grundreinigung.zusatzauftragId}`);
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();
});
