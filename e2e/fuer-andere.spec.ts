import { randomUUID } from "node:crypto";
import { devices, expect, test, type Page } from "@playwright/test";
import { berlinerDatum, berlinerZeitpunkt } from "../src/lib/berliner-zeit";
import {
  beendeArbeitstag,
  erwarteAngemeldet,
  feld,
  meldeAb,
  meldeAn,
  schnittstelleAls,
  testdaten,
} from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZugangAn,
  type TestZugang,
} from "./testumgebung/testdaten";

// Vorarbeiter erfassen vor Ort am Handy für ihre Kollegen.
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
const gesternUm = (uhrzeit: string) => new Date(berlinerZeitpunkt(GESTERN, uhrzeit)).toISOString();

async function waehleAus(page: Page, bezeichnung: string, taetigkeit: string) {
  await feld(page, "Objekt suchen").fill(bezeichnung);
  await page.getByRole("radio", { name: new RegExp(bezeichnung) }).check();
  await page.getByRole("combobox", { name: /^Tätigkeit/ }).selectOption({ label: taetigkeit });
}

// Der Hinweis, für wen nachgetragen oder geändert wird, auf der gerade
// sichtbaren Seite. Next.js hält zuletzt besuchte Seiten unsichtbar
// vorrätig, deren Hinweis würde sonst mitgefunden.
function fuerHinweis(page: Page, name: string) {
  return page.getByText(`Für ${name}`, { exact: true }).filter({ visible: true });
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
    .select("art, ende, nachtrag, angelegt_von")
    .eq("mitarbeiter_id", zugang.id)
    .order("beginn");
  return data ?? [];
}

test("Ein Vorarbeiter startet, beendet, trägt nach und ändert für einen Kollegen; der Kollege sieht, wer erfasst hat", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
  const kollege = await legeEigenenZugangAn(firmaA.id);
  const ehemaliger = await legeZugangAn(dienst, firmaA.id, {
    name: `Ehemaliger ${randomUUID().slice(0, 8)}`,
    rolle: "mitarbeiter",
    aktiv: false,
  });
  const objekt = await legeKundeMitObjektAn(dienst, firmaA.id);
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id);
  const angelegtVonVorarbeiter = `Angelegt von ${vorarbeiter.name}`;

  await meldeAn(page, vorarbeiter);
  await erwarteAngemeldet(page, vorarbeiter.name);
  await page.getByRole("link", { name: "Für andere erfassen" }).click();
  await expect(page.getByRole("heading", { name: "Für andere erfassen" })).toBeVisible();
  // Nur aktive Mitarbeiter stehen zur Auswahl.
  await expect(page.getByRole("link", { name: ehemaliger.name })).toHaveCount(0);
  await page.getByRole("link", { name: kollege.name }).click();
  await expect(page.getByRole("heading", { name: `Erfassung für ${kollege.name}` })).toBeVisible();

  // Live: Start und „Arbeitstag beenden“ für den Kollegen.
  await waehleAus(page, objekt.bezeichnung, taetigkeit.name);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const laufend = page.getByRole("status").filter({ hasText: "Läuft seit" });
  await expect(laufend).toContainText(`${objekt.bezeichnung} · ${taetigkeit.name}`);
  await expect(laufend).toContainText(angelegtVonVorarbeiter);
  await beendeArbeitstag(page);
  const live = page.getByRole("listitem").filter({ hasText: objekt.bezeichnung });
  await expect(live).toContainText(angelegtVonVorarbeiter);
  await expect(live).not.toContainText("Nachtrag");

  // Nachtrag für den Kollegen, danach geht es zurück zu seiner Erfassung.
  await page.getByRole("link", { name: "Zeit nachtragen" }).click();
  await expect(page.getByRole("heading", { name: "Zeit nachtragen" })).toBeVisible();
  await expect(fuerHinweis(page, kollege.name)).toBeVisible();
  await page.getByRole("radio", { name: "Fahrt" }).check();
  await zeitenEintragen(page, "07:00", "08:00");
  await expect(page).toHaveURL(new RegExp(`/fuer-andere/${kollege.id}$`));
  const fahrt = page.getByRole("listitem").filter({ hasText: "Fahrt" });
  await expect(fahrt).toContainText("07:00 – 08:00 · 1:00 h");
  await expect(fahrt).toContainText("Nachtrag");
  await expect(fahrt).toContainText(angelegtVonVorarbeiter);

  // Ändern des Nachtrags.
  await fahrt.getByRole("link", { name: "Ändern" }).click();
  await expect(page.getByRole("heading", { name: "Zeiteintrag ändern" })).toBeVisible();
  await expect(fuerHinweis(page, kollege.name)).toBeVisible();
  await feld(page, "Bis").fill("08:30");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(new RegExp(`/fuer-andere/${kollege.id}$`));
  await expect(page.getByRole("listitem").filter({ hasText: "Fahrt" })).toContainText(
    "07:00 – 08:30 · 1:30 h",
  );

  // Gespeichert ist alles beim Kollegen, angelegt vom Vorarbeiter.
  expect(await zeiteintraegeVon(kollege)).toEqual([
    { art: "fahrt", ende: expect.any(String), nachtrag: true, angelegt_von: vorarbeiter.id },
    { art: "taetigkeit", ende: expect.any(String), nachtrag: false, angelegt_von: vorarbeiter.id },
  ]);
  expect(await zeiteintraegeVon(vorarbeiter)).toEqual([]);

  // Der Kollege sieht in seiner Erfassung, wer für ihn erfasst hat.
  await page.goto("/");
  await meldeAb(page);
  await meldeAn(page, kollege);
  await erwarteAngemeldet(page, kollege.name);
  await expect(page.getByRole("link", { name: "Für andere erfassen" })).toHaveCount(0);
  for (const was of [objekt.bezeichnung, "Fahrt"]) {
    await expect(page.getByRole("listitem").filter({ hasText: was })).toContainText(
      angelegtVonVorarbeiter,
    );
  }
});

test("Das Büro sieht bei jedem Eintrag, wer ihn angelegt hat, und ändert fremde Einträge", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
  const kollege = await legeEigenenZugangAn(firmaA.id);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const { data } = await (
    await schnittstelleAls(vorarbeiter)
  )
    .from("zeiteintrag")
    .insert({
      firma_id: firmaA.id,
      mitarbeiter_id: kollege.id,
      art: "fahrt",
      beginn: gesternUm("10:00"),
      ende: gesternUm("11:00"),
    })
    .select("id")
    .single<{ id: string }>();
  const id = data!.id;

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto("/zeiteintraege");
  await expect(page.getByRole("columnheader", { name: "Angelegt von" })).toBeVisible();
  const zeile = page.getByRole("row").filter({ hasText: kollege.name });
  await expect(zeile).toContainText(vorarbeiter.name);

  await zeile.getByRole("link", { name: "Ändern" }).click();
  await expect(page.getByRole("heading", { name: "Zeiteintrag ändern" })).toBeVisible();
  await expect(fuerHinweis(page, kollege.name)).toBeVisible();
  await feld(page, "Bis").fill("11:30");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(new RegExp(`/fuer-andere/${kollege.id}$`));

  // Im Protokoll stehen beide: wer angelegt und wer geändert hat.
  await page.goto(`/zeiteintraege/${id}`);
  const zeilen = page.getByRole("row");
  await expect(zeilen.filter({ hasText: "Angelegt" })).toContainText(vorarbeiter.name);
  await expect(zeilen.filter({ hasText: "Geändert" })).toContainText(buero.name);
  await expect(zeilen.filter({ hasText: "Geändert" })).toContainText("Ende:");
});

test("Das Büro ändert auch Einträge deaktivierter Mitarbeiter und kommt zur Übersicht zurück", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const ehemaliger = await legeZugangAn(dienst, firmaA.id, {
    name: `Ehemaliger ${randomUUID().slice(0, 8)}`,
    rolle: "mitarbeiter",
    aktiv: false,
  });
  await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: ehemaliger.id,
    beginn: gesternUm("13:00"),
    ende: gesternUm("14:00"),
  });

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto("/zeiteintraege");
  await page
    .getByRole("row")
    .filter({ hasText: ehemaliger.name })
    .getByRole("link", { name: "Ändern" })
    .click();
  await expect(fuerHinweis(page, ehemaliger.name)).toBeVisible();
  await feld(page, "Bis").fill("14:15");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(/\/zeiteintraege$/);
  const zeile = page.getByRole("row").filter({ hasText: ehemaliger.name });
  await expect(zeile).toContainText("13:00 – 14:15");
  await expect(zeile).toContainText("Nachtrag");
});

test("Ein normaler Mitarbeiter kann nicht für andere erfassen", async ({ page }) => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const kollege = await legeEigenenZugangAn(firmaA.id);
  const hinweis = "Für andere erfassen dürfen nur Vorarbeiter und das Büro.";

  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);
  await expect(page.getByRole("link", { name: "Für andere erfassen" })).toHaveCount(0);

  for (const adresse of [
    "/fuer-andere",
    `/fuer-andere/${kollege.id}`,
    `/nachtrag?fuer=${kollege.id}`,
  ]) {
    await page.goto(adresse);
    await expect(page.getByText(hinweis), adresse).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true }), adresse).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Speichern" }), adresse).toHaveCount(0);
  }
});
