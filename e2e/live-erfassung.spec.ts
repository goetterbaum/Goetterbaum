import { devices, expect, test, type Page } from "@playwright/test";
import {
  beendeArbeitstag,
  erwarteAngemeldet,
  feld,
  meldeAn,
  testdaten,
} from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  verschiebeZeiteintraege,
  type TestZugang,
} from "./testumgebung/testdaten";

// Mitarbeiter erfassen am Handy. Deshalb laufen diese Tests in Handygröße
// mit Touch-Bedienung.
const handy = devices["Pixel 7"];
test.use({
  viewport: handy.viewport,
  userAgent: handy.userAgent,
  deviceScaleFactor: handy.deviceScaleFactor,
  isMobile: handy.isMobile,
  hasTouch: handy.hasTouch,
});

const STUNDE = 60 * 60 * 1000;

// Ein frischer Mitarbeiter mit einem aktiven Objekt und einer aktiven
// Tätigkeit, schon angemeldet.
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

async function waehleAus(page: Page, bezeichnung: string, taetigkeit: string) {
  await feld(page, "Objekt suchen").fill(bezeichnung);
  await page.getByRole("radio", { name: new RegExp(bezeichnung) }).check();
  await page.getByRole("combobox", { name: /^Tätigkeit/ }).selectOption({ label: taetigkeit });
}

async function zeiteintraegeVon(zugang: TestZugang) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("art, objekt_id, taetigkeit_id, beginn, ende, arbeitstag_endet_hier")
    .eq("mitarbeiter_id", zugang.id)
    .order("beginn");
  return data ?? [];
}

function startKnopf(page: Page) {
  return page.getByRole("button", { name: "Start", exact: true });
}

test("Ein Mitarbeiter startet einen Zeiteintrag mit Objekt und Tätigkeit und beendet ihn mit „Fertig hier“", async ({
  page,
}) => {
  const { ich, objekt, taetigkeit } = await angemeldeterErfasser(page);

  // Am Handy passt alles in die Breite, ohne seitlich zu scrollen.
  const breite = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(breite[0]).toBeLessThanOrEqual(breite[1]);

  await waehleAus(page, objekt.bezeichnung, taetigkeit.name);
  await startKnopf(page).click();

  await expect(page.getByText(/^Läuft seit \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByText(`${objekt.bezeichnung} · ${taetigkeit.name}`)).toBeVisible();
  // Solange er läuft, gibt es keinen zweiten Start.
  await expect(startKnopf(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fahrt starten" })).toHaveCount(0);

  const [gestartet] = await zeiteintraegeVon(ich);
  expect(gestartet).toMatchObject({
    art: "taetigkeit",
    objekt_id: objekt.objektId,
    taetigkeit_id: taetigkeit.taetigkeitId,
    ende: null,
  });
  expect(gestartet.beginn).not.toBeNull();

  // Auch nach dem Neuladen ist der laufende Eintrag sichtbar.
  await page.reload();
  await expect(page.getByText(/^Läuft seit/)).toBeVisible();

  // „Fertig hier“ beendet ihn; jetzt läuft die Fahrt, und der Start fürs
  // nächste Objekt ist wieder da.
  await page.getByRole("button", { name: "Fertig hier" }).click();
  await expect(startKnopf(page)).toBeVisible();
  await expect(page.getByText(/^Läuft seit/)).toBeVisible();
  await expect(page.getByText("Fahrt", { exact: true })).toBeVisible();
  const liste = page.getByRole("listitem").filter({ hasText: objekt.bezeichnung });
  await expect(liste).toContainText(taetigkeit.name);
  await expect(liste).toContainText(/\d\d:\d\d – \d\d:\d\d · 0:0\d h/);

  const [beendet, fahrt] = await zeiteintraegeVon(ich);
  expect(beendet.ende).not.toBeNull();
  expect(fahrt).toMatchObject({ art: "fahrt", ende: null });
});

test("Ein Mitarbeiter startet eine Fahrt ohne Objekt und beendet sie als Rückfahrt", async ({
  page,
}) => {
  const { ich } = await angemeldeterErfasser(page);

  await page.getByRole("button", { name: "Fahrt starten" }).click();
  await expect(page.getByText(/^Läuft seit/)).toBeVisible();
  await expect(page.getByText("Fahrt", { exact: true })).toBeVisible();
  // Kürzer als 2 Minuten bliebe sie nicht gespeichert.
  await verschiebeZeiteintraege(ich.id, 5);
  await page.reload();

  await beendeArbeitstag(page);
  await expect(page.getByRole("button", { name: "Fahrt starten" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Fahrt" })).toHaveCount(1);

  expect(await zeiteintraegeVon(ich)).toEqual([
    expect.objectContaining({
      art: "fahrt",
      objekt_id: null,
      taetigkeit_id: null,
      ende: expect.any(String),
      arbeitstag_endet_hier: true,
    }),
  ]);
});

test("Zur Auswahl stehen nur aktive Objekte und Tätigkeiten, und ohne Auswahl startet nichts", async ({
  page,
}) => {
  const { firmaId, ich, taetigkeit } = await angemeldeterErfasser(page);
  const dienst = dienstZugang()!;
  const archiviertesObjekt = await legeKundeMitObjektAn(dienst, firmaId);
  const archivierteTaetigkeit = await legeTaetigkeitAn(dienst, firmaId);
  await dienst.from("objekt").update({ archiviert: true }).eq("id", archiviertesObjekt.objektId);
  await dienst
    .from("taetigkeit")
    .update({ archiviert: true })
    .eq("id", archivierteTaetigkeit.taetigkeitId);
  await page.reload();

  await feld(page, "Objekt suchen").fill(archiviertesObjekt.bezeichnung);
  await expect(page.getByText("Kein Objekt gefunden.")).toBeVisible();
  const taetigkeiten = page.getByRole("combobox", { name: /^Tätigkeit/ });
  await expect(taetigkeiten.getByRole("option", { name: taetigkeit.name })).toHaveCount(1);
  await expect(taetigkeiten.getByRole("option", { name: archivierteTaetigkeit.name })).toHaveCount(
    0,
  );

  await startKnopf(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Objekt" })).toHaveText(
    "Bitte wähle ein Objekt.",
  );
  expect(await zeiteintraegeVon(ich)).toEqual([]);
});

test("Ein Mitarbeiter sieht nur seine eigenen Einträge der letzten Tage", async ({ page }) => {
  const { firmaId, ich, objekt, taetigkeit } = await angemeldeterErfasser(page);
  const dienst = dienstZugang()!;
  const kollege = await legeEigenenZugangAn(firmaId);
  const altesObjekt = await legeKundeMitObjektAn(dienst, firmaId);
  const objektDesKollegen = await legeKundeMitObjektAn(dienst, firmaId);
  const vor = (stunden: number) => new Date(Date.now() - stunden * STUNDE).toISOString();
  const eintrag = { firmaId, taetigkeitId: taetigkeit.taetigkeitId };

  await legeZeiteintragAn(dienst, {
    ...eintrag,
    mitarbeiterId: ich.id,
    objektId: objekt.objektId,
    beginn: vor(27),
    ende: vor(25),
  });
  await legeZeiteintragAn(dienst, {
    ...eintrag,
    mitarbeiterId: ich.id,
    objektId: altesObjekt.objektId,
    beginn: vor(10 * 24),
    ende: vor(10 * 24 - 1),
  });
  await legeZeiteintragAn(dienst, {
    ...eintrag,
    mitarbeiterId: kollege.id,
    objektId: objektDesKollegen.objektId,
    beginn: vor(2),
    ende: vor(1),
  });
  await page.reload();

  const gestern = page.getByRole("listitem").filter({ hasText: objekt.bezeichnung });
  await expect(gestern).toContainText("2:00 h");
  await expect(gestern).toContainText(taetigkeit.name);
  // Nur in der Liste; zur Auswahl stehen die Objekte natürlich trotzdem.
  const eintraege = page.getByRole("listitem");
  await expect(eintraege.filter({ hasText: altesObjekt.bezeichnung })).toHaveCount(0);
  await expect(eintraege.filter({ hasText: objektDesKollegen.bezeichnung })).toHaveCount(0);
});

test("Ohne Internet meldet die App, dass Start, „Fertig hier“ oder „Arbeitstag beenden“ nicht gespeichert wurden", async ({
  page,
  context,
}) => {
  const { firmaId, ich, objekt, taetigkeit } = await angemeldeterErfasser(page);

  await waehleAus(page, objekt.bezeichnung, taetigkeit.name);
  await context.setOffline(true);
  await startKnopf(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Internet" })).toHaveText(
    "Kein Internet: Der Start wurde nicht gespeichert. Bitte trage diese Zeit später als Nachtrag ein.",
  );
  await context.setOffline(false);
  expect(await zeiteintraegeVon(ich)).toEqual([]);

  // Ein laufender Eintrag, der ohne Internet nicht beendet werden kann.
  await legeZeiteintragAn(dienstZugang()!, {
    firmaId,
    mitarbeiterId: ich.id,
    objektId: objekt.objektId,
    taetigkeitId: taetigkeit.taetigkeitId,
    beginn: new Date(Date.now() - STUNDE).toISOString(),
    ende: null,
  });
  await page.reload();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Fertig hier" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Internet" })).toHaveText(
    "Kein Internet: „Fertig hier“ wurde nicht gespeichert. Bitte trage das Ende später als Nachtrag ein.",
  );
  await page.getByRole("button", { name: "Arbeitstag beenden" }).click();
  await page.getByRole("button", { name: "Ja, beenden" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Das Beenden" })).toHaveText(
    "Kein Internet: Das Beenden wurde nicht gespeichert. Bitte trage das Ende später als Nachtrag ein.",
  );
  await context.setOffline(false);
  const eintraege = await zeiteintraegeVon(ich);
  expect(eintraege).toHaveLength(1);
  expect(eintraege[0].ende).toBeNull();
});
