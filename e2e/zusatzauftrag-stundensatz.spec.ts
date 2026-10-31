import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
} from "./testumgebung/testdaten";

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

// Ein Pauschal-Objekt (500 € im Monat) mit zwei Tätigkeiten: Reinigung zu
// 30 € Standard, Glas zu 40 € Standard und 44 € im Objekt. Im März 2026
// gilt in Berlin die Winterzeit (UTC + 1 Stunde).
async function objektMitTaetigkeiten(firmaId: string) {
  const dienst = dienstZugang()!;
  const objekt = await legeKundeMitObjektAn(dienst, firmaId);
  const reinigung = await legeTaetigkeitAn(dienst, firmaId, { standardStundensatzCent: 3000 });
  const glas = await legeTaetigkeitAn(dienst, firmaId, { standardStundensatzCent: 4000 });
  await dienst
    .from("objekt_stundensatz")
    .insert({
      firma_id: firmaId,
      objekt_id: objekt.objektId,
      taetigkeit_id: glas.taetigkeitId,
      stundensatz_cent: 4400,
    })
    .throwOnError();
  return { ...objekt, reinigung, glas };
}

test("Ein Zusatzauftrag mit eigenem Stundensatz: Rechnungsvorbereitung, CSV und Einzel-Abrechnung rechnen mit ihm", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const mitarbeiter = await legeEigenenZugangAn(firmaA.id);
  const o = await objektMitTaetigkeiten(firmaA.id);
  const sturmschaden = `Sturmschaden Hof ${randomUUID().slice(0, 8)}`;

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/objekte/${o.objektId}`);
  const bereich = page.getByRole("region", { name: "Zusatzaufträge" });
  const stundensatz = bereich.getByLabel("Stundensatz in Euro", { exact: true });
  await bereich.getByLabel("Beschreibung", { exact: true }).fill(sturmschaden);
  await expect(stundensatz).toHaveValue("");
  await expect(stundensatz).toHaveAccessibleDescription(
    "Leer lassen: Es gelten die Sätze des Objekts bzw. Kunden.",
  );
  // Nur Beträge über 0 €.
  await stundensatz.fill("0");
  await bereich.getByRole("button", { name: "Anlegen" }).click();
  await expect(bereich.getByRole("alert")).toHaveText(
    "Der Stundensatz ist kein gültiger Betrag. Beispiel: 32,50",
  );
  await stundensatz.fill("52,50");
  await bereich.getByRole("button", { name: "Anlegen" }).click();
  await expect(bereich.getByRole("status")).toHaveText("Zusatzauftrag angelegt.");
  await expect(bereich.getByRole("row").filter({ hasText: sturmschaden })).toContainText(
    "Nach Stunden, 52,50 € je Stunde",
  );
  // Bei Festbetrag gibt es das Feld nicht.
  await bereich
    .getByRole("combobox", { name: /^Abrechnung des Zusatzauftrags/ })
    .selectOption({ label: "Festbetrag" });
  await expect(stundensatz).toHaveCount(0);

  const { data: za } = await dienst
    .from("zusatzauftrag")
    .select("id")
    .eq("beschreibung", sturmschaden)
    .single<{ id: string }>();
  const zusatzauftragId = za!.id;
  const freigegeben = async (taetigkeitId: string, beginn: string, ende: string) => {
    const id = await legeZeiteintragAn(dienst, {
      firmaId: firmaA.id,
      mitarbeiterId: mitarbeiter.id,
      objektId: o.objektId,
      taetigkeitId,
      zusatzauftragId,
      beginn,
      ende,
    });
    await dienst
      .from("zeiteintrag")
      .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
      .eq("id", id)
      .throwOnError();
  };
  // 10.03., 08:00:12–08:58:47: 58 Minuten 35 Sekunden → 60 Minuten.
  await freigegeben(o.reinigung.taetigkeitId, "2026-03-10T07:00:12Z", "2026-03-10T07:58:47Z");
  // 11.03., 08:00:51–09:28:04: 87 Minuten 13 Sekunden → 90 Minuten.
  await freigegeben(o.glas.taetigkeitId, "2026-03-11T07:00:51Z", "2026-03-11T08:28:04Z");

  // Der Satz des Zusatzauftrags gilt für beide Tätigkeiten, auch vor dem
  // Satz des Objekts.
  await page.goto(`/rechnungsvorbereitung?kunde=${o.kundeId}&monat=2026-03`);
  await expect(zeile(page)).toHaveCount(3);
  await expect(zeile(page, sturmschaden, o.reinigung.name)).toContainText(
    /1:00 Std\.\s*52,50\s€\s*52,50\s€/,
  );
  await expect(zeile(page, sturmschaden, o.glas.name)).toContainText(
    /1:30 Std\.\s*52,50\s€\s*78,75\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*631,25\s€/);
  expect(await csvVon(page)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Zeitraum;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Pauschale;${o.bezeichnung};;;März 2026;;;;500,00\r\n` +
      `Zusatzauftrag nach Stunden;${o.bezeichnung};${sturmschaden};${o.reinigung.name};März 2026;1:00;60;52,50;52,50\r\n` +
      `Zusatzauftrag nach Stunden;${o.bezeichnung};${sturmschaden};${o.glas.name};März 2026;1:30;90;52,50;78,75\r\n` +
      "Summe;;;;;;;;631,25\r\n",
  );

  // Geleert gelten wieder Objekt bzw. Standard.
  await page.goto(`/zusatzauftraege/${zusatzauftragId}`);
  await expect(feld(page, "Stundensatz in Euro")).toHaveValue("52,50");
  await feld(page, "Stundensatz in Euro").fill("");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  await page.goto(`/rechnungsvorbereitung?kunde=${o.kundeId}&monat=2026-03`);
  await expect(zeile(page, sturmschaden, o.reinigung.name)).toContainText(
    /1:00 Std\.\s*30,00\s€\s*30,00\s€/,
  );
  await expect(zeile(page, sturmschaden, o.glas.name)).toContainText(
    /1:30 Std\.\s*44,00\s€\s*66,00\s€/,
  );

  // Wieder eingetragen und einzeln abgerechnet.
  await page.goto(`/zusatzauftraege/${zusatzauftragId}`);
  await feld(page, "Stundensatz in Euro").fill("52,50");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await page.getByRole("link", { name: "Einzeln abrechnen" }).click();
  await expect(
    page.getByRole("heading", { name: "Zusatzauftrag einzeln abrechnen" }),
  ).toBeVisible();
  await expect(zeile(page)).toHaveCount(2);
  await expect(zeile(page, o.reinigung.name)).toContainText(/1:00 Std\.\s*52,50\s€\s*52,50\s€/);
  await expect(zeile(page, o.glas.name)).toContainText(/1:30 Std\.\s*52,50\s€\s*78,75\s€/);
  await expect(page.locator("tfoot")).toContainText(/Summe\s*131,25\s€/);
  expect(await csvVon(page)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Zeitraum;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Zusatzauftrag nach Stunden;${o.bezeichnung};${sturmschaden};${o.reinigung.name};März 2026;1:00;60;52,50;52,50\r\n` +
      `Zusatzauftrag nach Stunden;${o.bezeichnung};${sturmschaden};${o.glas.name};März 2026;1:30;90;52,50;78,75\r\n` +
      "Summe;;;;;;;;131,25\r\n",
  );
  await page.getByRole("button", { name: "Als abgerechnet markieren" }).click();
  await expect(
    page.getByText(
      "Für diesen Zusatzauftrag gibt es keine freigegebene, noch nicht abgerechnete Zeit.",
    ),
  ).toBeVisible();

  // Danach bleibt der Satz.
  await page.goto(`/zusatzauftraege/${zusatzauftragId}`);
  await feld(page, "Stundensatz in Euro").fill("48,00");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Für diesen" })).toHaveText(
    "Für diesen Zusatzauftrag ist schon Zeit abgerechnet. Der Stundensatz lässt sich deshalb nicht mehr ändern.",
  );
  await page.reload();
  await expect(feld(page, "Stundensatz in Euro")).toHaveValue("52,50");
});
