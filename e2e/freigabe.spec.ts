import { expect, test } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAb, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
} from "./testumgebung/testdaten";

const STUNDE = 60 * 60 * 1000;
// Live-Zeiten haben Sekunden.
const vor = (stunden: number) =>
  new Date(Math.floor((Date.now() - stunden * STUNDE) / 1000) * 1000 - 37_000).toISOString();

// Ein Zeiteintrag in einem eigenen Objekt, damit sich seine Zeile über die
// Objekt-Bezeichnung finden lässt.
async function eintrag(
  firmaId: string,
  mitarbeiterId: string,
  beginn: string,
  ende: string | null,
) {
  const dienst = dienstZugang()!;
  const objekt = await legeKundeMitObjektAn(dienst, firmaId);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  const id = await legeZeiteintragAn(dienst, {
    firmaId,
    mitarbeiterId,
    objektId: objekt.objektId,
    taetigkeitId,
    beginn,
    ende,
  });
  return { id, bezeichnung: objekt.bezeichnung, kundeId: objekt.kundeId };
}

// Ein Tag in Berlin als "JJJJ-MM-TT".
const berlinerTag = (zeitpunkt: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(zeitpunkt);

// Die letzten zwei Tage: Ohne Angabe zeigt die Freigabe bis zum 10. den
// ganzen Vormonat, ein Eintrag von gestern fehlte dann.
const letzteTage = () => ({
  von: berlinerTag(Date.now() - 48 * STUNDE),
  bis: berlinerTag(Date.now()),
});

async function freigegebenVon(id: string) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("freigegeben_von")
    .eq("id", id)
    .single<{ freigegeben_von: string | null }>();
  return data!.freigegeben_von;
}

test("Das Büro gibt Einträge einzeln und gesammelt frei, der Mitarbeiter sieht das, und das Büro nimmt eine Freigabe zurück", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const ich = await legeEigenenZugangAn(firmaA.id);
  const kollege = await legeEigenenZugangAn(firmaA.id);
  const erster = await eintrag(firmaA.id, ich.id, vor(30), vor(28));
  const nachgetragen = await eintrag(firmaA.id, ich.id, vor(27), vor(26));
  const { error } = await dienstZugang()!
    .from("zeiteintrag")
    .update({ nachtrag: true })
    .eq("id", nachgetragen.id);
  if (error) throw error;
  const unvollstaendig = await eintrag(firmaA.id, ich.id, vor(20), null);
  const vomKollegen = await eintrag(firmaA.id, kollege.id, vor(30), vor(29));

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.getByRole("link", { name: "Zeiteinträge freigeben" }).click();
  await expect(page.getByRole("heading", { name: "Zeiteinträge freigeben" })).toBeVisible();

  // Nur die Einträge des gewählten Mitarbeiters.
  // Der Name einer Auswahlliste endet mit dem gewählten Eintrag.
  const zeitraum = letzteTage();
  await feld(page, "Von").fill(zeitraum.von);
  await feld(page, "Bis").fill(zeitraum.bis);
  await page.getByRole("combobox", { name: /^Mitarbeiter/ }).selectOption({ label: ich.name });
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page).toHaveURL(new RegExp(`mitarbeiter=${ich.id}`));
  const zeile = (bezeichnung: string) => page.getByRole("row").filter({ hasText: bezeichnung });
  await expect(zeile(erster.bezeichnung)).toHaveCount(1);
  await expect(zeile(vomKollegen.bezeichnung)).toHaveCount(0);
  await expect(zeile(nachgetragen.bezeichnung)).toContainText("Nachtrag");
  await expect(zeile(erster.bezeichnung)).not.toContainText("Nachtrag");

  // Der unvollständige Eintrag lässt sich nicht freigeben.
  await expect(zeile(unvollstaendig.bezeichnung)).toContainText("unvollständig");
  await expect(zeile(unvollstaendig.bezeichnung)).toContainText("erst nach dem Beenden");
  await expect(zeile(unvollstaendig.bezeichnung).getByRole("checkbox")).toHaveCount(0);

  // Einzeln ...
  await zeile(erster.bezeichnung).getByRole("button", { name: "Freigeben" }).click();
  await expect(page.getByRole("status").filter({ hasText: "freigegeben" })).toHaveText(
    "1 Zeiteintrag freigegeben.",
  );
  await expect(zeile(erster.bezeichnung)).toHaveCount(0);

  // ... und gesammelt: Alle auswählen trifft nur, was sich freigeben lässt.
  await page.getByRole("checkbox", { name: "Alle auswählen" }).check();
  await page.getByRole("button", { name: "Ausgewählte freigeben" }).click();
  await expect(zeile(nachgetragen.bezeichnung)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "freigegeben" })).toHaveText(
    "1 Zeiteintrag freigegeben.",
  );
  await expect(zeile(unvollstaendig.bezeichnung)).toHaveCount(1);
  expect(await freigegebenVon(erster.id)).toBe(buero.id);
  expect(await freigegebenVon(nachgetragen.id)).toBe(buero.id);
  expect(await freigegebenVon(unvollstaendig.id)).toBeNull();
  expect(await freigegebenVon(vomKollegen.id)).toBeNull();

  // Der Mitarbeiter sieht die Freigabe und kann diese Einträge nicht mehr
  // ändern.
  await page.goto("/");
  await meldeAb(page);
  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);
  for (const { bezeichnung } of [erster, nachgetragen]) {
    const listeneintrag = page.getByRole("listitem").filter({ hasText: bezeichnung });
    await expect(listeneintrag).toContainText("Freigegeben");
    await expect(listeneintrag.getByRole("link", { name: "Ändern" })).toHaveCount(0);
  }
  await page.goto(`/nachtrag/${erster.id}`);
  await expect(
    page.getByText("Dieser Zeiteintrag ist vom Büro freigegeben", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);

  // Das Büro findet den Eintrag unter den freigegebenen, nimmt die Freigabe
  // zurück, und das Protokoll zeigt es.
  await page.goto("/");
  await meldeAb(page);
  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/freigabe?von=${zeitraum.von}&bis=${zeitraum.bis}`);
  await page.getByRole("combobox", { name: /^Mitarbeiter/ }).selectOption({ label: ich.name });
  await page.getByRole("checkbox", { name: "Freigegebene zeigen" }).check();
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page).toHaveURL(/freigegebene=ja/);
  await expect(zeile(unvollstaendig.bezeichnung)).toHaveCount(0);
  await expect(zeile(erster.bezeichnung)).toContainText(`von ${buero.name}`);
  await zeile(erster.bezeichnung).getByRole("link", { name: "Protokoll" }).click();
  // Erst wenn das Protokoll da ist: Die Liste zeigt denselben Text.
  await expect(page).toHaveURL(new RegExp(`/zeiteintraege/${erster.id}$`));
  await expect(page.getByRole("heading", { name: "Änderungsprotokoll" })).toBeVisible();
  await expect(
    page
      .getByRole("paragraph")
      .filter({ hasText: `von ${buero.name}` })
      .filter({ visible: true }),
  ).toContainText("Freigegeben am");
  await page.getByRole("button", { name: "Freigabe zurücknehmen" }).click();
  await expect(page.getByRole("button", { name: "Freigabe zurücknehmen" })).toHaveCount(0);
  await expect(
    page.getByText(/^Freigegeben: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} → –$/).filter({ visible: true }),
  ).toBeVisible();
  expect(await freigegebenVon(erster.id)).toBeNull();
});

test("Das Büro wählt in der Freigabe einen Monat, die übrigen Filter bleiben, und geht mit Kunde und Monat zur Rechnungsvorbereitung", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const ich = await legeEigenenZugangAn(firmaA.id);
  const kollege = await legeEigenenZugangAn(firmaA.id);
  // 2024 ist ein Schaltjahr; im Februar gilt in Berlin die Winterzeit (UTC + 1).
  const amLetzten = await eintrag(
    firmaA.id,
    ich.id,
    "2024-02-29T15:02:13Z",
    "2024-02-29T16:09:36Z",
  );
  const vomKollegen = await eintrag(
    firmaA.id,
    kollege.id,
    "2024-02-12T07:00:41Z",
    "2024-02-12T08:30:17Z",
  );
  // 00:10 am 1.03. in Berlin: schon März.
  const imMaerz = await eintrag(firmaA.id, ich.id, "2024-02-29T23:10:07Z", "2024-03-01T01:00:52Z");

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/freigabe?von=2024-03-01&bis=2024-03-31&mitarbeiter=${ich.id}`);
  const auswahl = page.getByRole("group", { name: "Monat wählen" });
  const monat = (name: string) => auswahl.getByRole("button", { name, exact: true });
  const zeile = (bezeichnung: string) => page.getByRole("row").filter({ hasText: bezeichnung });
  await expect(auswahl.getByText(/^\d{4}$/)).toHaveText("2024");
  await expect(monat("März")).toHaveAttribute("aria-pressed", "true");
  await expect(zeile(imMaerz.bezeichnung)).toHaveCount(1);

  // Ein Klick zeigt sofort den ganzen Februar, der Mitarbeiter bleibt gewählt.
  await monat("Februar").click();
  await expect(page).toHaveURL(/von=2024-02-01&bis=2024-02-29&/);
  await expect(page).toHaveURL(new RegExp(`mitarbeiter=${ich.id}`));
  await expect(monat("Februar")).toHaveAttribute("aria-pressed", "true");
  await expect(monat("März")).toHaveAttribute("aria-pressed", "false");
  await expect(zeile(amLetzten.bezeichnung)).toHaveCount(1);
  await expect(zeile(imMaerz.bezeichnung)).toHaveCount(0);
  await expect(zeile(vomKollegen.bezeichnung)).toHaveCount(0);

  // Ohne Kunde übernimmt der Button nur den Monat des Von-Datums.
  const zurRechnungsvorbereitung = page.getByRole("link", { name: "Zur Rechnungsvorbereitung" });
  await expect(zurRechnungsvorbereitung).toHaveAttribute(
    "href",
    "/rechnungsvorbereitung?monat=2024-02",
  );

  // Mit Kunde übernimmt er beides; die Rechnungsvorbereitung zeigt den Monat.
  await page.getByRole("combobox", { name: /^Kunde/ }).selectOption(amLetzten.kundeId);
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page).toHaveURL(new RegExp(`kunde=${amLetzten.kundeId}`));
  await zurRechnungsvorbereitung.click();
  await expect(page).toHaveURL(
    (adresse) =>
      adresse.pathname === "/rechnungsvorbereitung" &&
      adresse.search === `?kunde=${amLetzten.kundeId}&monat=2024-02`,
  );
  await expect(page.getByRole("combobox", { name: /^Kunde/ })).toHaveValue(amLetzten.kundeId);
  await expect(feld(page, "Monat")).toHaveValue("2024-02");
});
