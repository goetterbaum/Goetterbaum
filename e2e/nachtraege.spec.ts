import { devices, expect, test, type Page } from "@playwright/test";
import { berlinerDatum, berlinerZeitpunkt } from "../src/lib/berliner-zeit";
import { erwarteAngemeldet, feld, meldeAb, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  type TestZugang,
} from "./testumgebung/testdaten";

// Nachträge machen Mitarbeiter am Handy.
const handy = devices["Pixel 7"];
test.use({
  viewport: handy.viewport,
  userAgent: handy.userAgent,
  deviceScaleFactor: handy.deviceScaleFactor,
  isMobile: handy.isMobile,
  hasTouch: handy.hasTouch,
});

// Gestern in Berlin, damit alle Zeiten sicher in der Vergangenheit und in
// der angezeigten Liste liegen.
const GESTERN = berlinerDatum(Date.now() - 24 * 60 * 60 * 1000);
const GESTERN_ANGEZEIGT = GESTERN.split("-").reverse().join(".");
const gesternUm = (uhrzeit: string) => new Date(berlinerZeitpunkt(GESTERN, uhrzeit)).toISOString();

async function angemeldeterErfasser(page: Page) {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await legeKundeMitObjektAn(dienst, firmaA.id);
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id);
  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);
  return { firmaId: firmaA.id, ich, objekt, taetigkeit };
}

async function zeitenEintragen(page: Page, von: string, bis: string) {
  await feld(page, "Datum").fill(GESTERN);
  await feld(page, "Von").fill(von);
  await feld(page, "Bis").fill(bis);
  await page.getByRole("button", { name: "Speichern" }).click();
}

async function zeiteintraegeVon(zugang: TestZugang) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("art, objekt_id, taetigkeit_id, beginn, ende, nachtrag")
    .eq("mitarbeiter_id", zugang.id)
    .order("beginn");
  return data ?? [];
}

test("Ein Mitarbeiter trägt eine Tätigkeit nach, ändert sie, und Überschneidungen werden abgelehnt", async ({
  page,
}) => {
  const { ich, objekt, taetigkeit } = await angemeldeterErfasser(page);

  await page.getByRole("link", { name: "Zeit nachtragen" }).click();
  await expect(page.getByRole("heading", { name: "Zeit nachtragen" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Tätigkeit" })).toBeChecked();
  await feld(page, "Objekt suchen").fill(objekt.bezeichnung);
  await page.getByRole("radio", { name: new RegExp(objekt.bezeichnung) }).check();
  await page.getByRole("combobox", { name: /^Tätigkeit/ }).selectOption({ label: taetigkeit.name });
  await zeitenEintragen(page, "07:00", "09:30");

  await expect(page).toHaveURL(/\/$/);
  const eintrag = page.getByRole("listitem").filter({ hasText: objekt.bezeichnung });
  await expect(eintrag).toContainText("07:00 – 09:30 · 2:30 h");
  await expect(eintrag).toContainText("Nachtrag");
  expect(await zeiteintraegeVon(ich)).toEqual([
    expect.objectContaining({
      art: "taetigkeit",
      objekt_id: objekt.objektId,
      taetigkeit_id: taetigkeit.taetigkeitId,
      nachtrag: true,
    }),
  ]);
  const [gespeichert] = await zeiteintraegeVon(ich);
  expect(Date.parse(gespeichert.beginn)).toBe(Date.parse(gesternUm("07:00")));
  expect(Date.parse(gespeichert.ende)).toBe(Date.parse(gesternUm("09:30")));

  // Eine Fahrt, die in die Tätigkeit hineinreicht, wird abgelehnt; die
  // Angaben bleiben stehen.
  await page.getByRole("link", { name: "Zeit nachtragen" }).click();
  await page.getByRole("radio", { name: "Fahrt" }).check();
  await expect(feld(page, "Objekt suchen")).toHaveCount(0);
  await zeitenEintragen(page, "09:00", "10:00");
  await expect(page.getByRole("alert").filter({ hasText: "überschneidet" })).toHaveText(
    "Diese Zeit überschneidet sich mit einem anderen Zeiteintrag von dir. Bitte prüfe Beginn und Ende.",
  );
  await expect(feld(page, "Von")).toHaveValue("09:00");

  // Direkt im Anschluss passt sie.
  await feld(page, "Von").fill("09:30");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("listitem").filter({ hasText: "Fahrt" })).toContainText(
    "09:30 – 10:00",
  );

  // Ändern: Die Tätigkeit beginnt eine halbe Stunde früher.
  await eintrag.getByRole("link", { name: "Ändern" }).click();
  await expect(page.getByRole("heading", { name: "Zeiteintrag ändern" })).toBeVisible();
  await expect(feld(page, "Datum")).toHaveValue(GESTERN);
  await expect(feld(page, "Von")).toHaveValue("07:00");
  await expect(feld(page, "Bis")).toHaveValue("09:30");
  await expect(page.getByRole("radio", { name: new RegExp(objekt.bezeichnung) })).toBeChecked();
  await feld(page, "Von").fill("06:30");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(eintrag).toContainText("06:30 – 09:30 · 3:00 h");
  expect(await zeiteintraegeVon(ich)).toHaveLength(2);
});

test("Ein geänderter Live-Eintrag wird zum Nachtrag, und das Büro sieht das Protokoll", async ({
  page,
}) => {
  const { firmaId, ich, objekt, taetigkeit } = await angemeldeterErfasser(page);
  await legeZeiteintragAn(dienstZugang()!, {
    firmaId,
    mitarbeiterId: ich.id,
    objektId: objekt.objektId,
    taetigkeitId: taetigkeit.taetigkeitId,
    // Live erfasst, also mit Sekunden.
    beginn: new Date(Date.parse(gesternUm("08:00")) + 27_000).toISOString(),
    ende: gesternUm("10:00"),
  });
  await page.reload();

  const eintrag = page.getByRole("listitem").filter({ hasText: objekt.bezeichnung });
  await expect(eintrag).toContainText("08:00 – 10:00");
  await expect(eintrag).not.toContainText("Nachtrag");

  await eintrag.getByRole("link", { name: "Ändern" }).click();
  await feld(page, "Bis").fill("09:30");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(eintrag).toContainText("08:00 – 09:30");
  await expect(eintrag).toContainText("Nachtrag");

  // Ein normaler Mitarbeiter kommt nicht an die Übersicht des Büros.
  await page.goto("/zeiteintraege");
  await expect(
    page.getByText("Die Zeiteinträge aller Mitarbeiter sieht nur das Büro."),
  ).toBeVisible();
  await page.goto("/");
  await meldeAb(page);

  const { firmaA } = testdaten();
  await meldeAn(page, firmaA.buero);
  await erwarteAngemeldet(page, firmaA.buero.name);
  await page.getByRole("link", { name: "Zeiteinträge ansehen" }).click();
  // Statt einer Spalte „Zeit“ gibt es Datum, Arbeitszeit und Dauer.
  const zeile = page.getByRole("row").filter({ hasText: ich.name });
  await expect(zeile).toHaveCount(1);
  const kopf = page.getByRole("columnheader");
  await expect(kopf.filter({ hasText: /^Zeit$/ })).toHaveCount(0);
  const spalte = async (name: string) =>
    (await kopf.allTextContents()).findIndex((text) => text === name);
  const zellen = zeile.getByRole("cell");
  await expect(zellen.nth(await spalte("Datum"))).toHaveText(
    new RegExp(`^\\w\\w\\., ${GESTERN_ANGEZEIGT}$`),
  );
  await expect(zellen.nth(await spalte("Arbeitszeit"))).toHaveText("08:00 – 09:30");
  await expect(zellen.nth(await spalte("Dauer"))).toHaveText("1:30 Std.");
  await expect(zeile).toContainText(`${objekt.bezeichnung} · ${taetigkeit.name}`);
  await expect(zeile).toContainText("Nachtrag");

  await zeile.getByRole("link", { name: "Protokoll" }).click();
  await expect(page.getByRole("heading", { name: "Änderungsprotokoll" })).toBeVisible();
  const zeilen = page.getByRole("row");
  // Angelegt hat ihn das Test-Setup mit dem Dienstschlüssel.
  await expect(zeilen.filter({ hasText: "Angelegt" })).toContainText("System");
  const geaendert = zeilen.filter({ hasText: "Geändert" });
  await expect(geaendert).toContainText(ich.name);
  await expect(geaendert).toContainText(
    `Ende: ${GESTERN_ANGEZEIGT}, 10:00 → ${GESTERN_ANGEZEIGT}, 09:30`,
  );
  await expect(geaendert).toContainText("Nachtrag: nein → ja");
  await expect(geaendert).not.toContainText("Beginn");
});
