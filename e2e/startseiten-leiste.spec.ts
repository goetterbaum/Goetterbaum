import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  entferneFirma,
  legeEigeneFirmaAn,
  legeTaetigkeitAn,
} from "./testumgebung/testdaten";

// Handy-Breite: Hier muss die Leiste schmal bleiben und darf nichts verdecken.
test.use({ viewport: { width: 375, height: 667 } });

function startseitenKnopf(page: Page) {
  return page.getByRole("link", { name: "Startseite", exact: true });
}

test("Auf einer langen Unterseite bleibt der Button „Startseite“ nach dem Scrollen sichtbar und führt zur Startseite", async ({
  page,
}) => {
  testdaten();
  const firma = await legeEigeneFirmaAn();
  try {
    // Eigene Firma, damit die Liste sicher länger ist als der Bildschirm.
    const taetigkeiten = [];
    for (let i = 0; i < 30; i++)
      taetigkeiten.push(await legeTaetigkeitAn(dienstZugang()!, firma.id));

    await meldeAn(page, firma.buero);
    await erwarteAngemeldet(page, firma.buero.name);
    // Auf der Startseite selbst gibt es keine Leiste.
    await expect(page.getByRole("navigation")).toHaveCount(0);

    await page.getByRole("link", { name: "Tätigkeiten verwalten" }).click();
    const ueberschrift = page.getByRole("heading", { level: 1, name: "Tätigkeiten" });
    await expect(ueberschrift).toBeVisible();

    // Schmal und ohne etwas zu verdecken: Die Überschrift beginnt unter der Leiste.
    const leiste = (await page.getByRole("navigation").boundingBox())!;
    // 56 px: höchstens so hoch wie eine übliche Handy-Kopfzeile.
    expect(leiste.height).toBeLessThanOrEqual(56);
    expect((await ueberschrift.boundingBox())!.y).toBeGreaterThanOrEqual(leiste.y + leiste.height);

    // Ans Ende der Liste scrollen, bis die Überschrift aus dem Blick ist.
    for (const { name } of taetigkeiten) await expect(page.getByText(name)).toBeAttached();
    const letzte = page.getByRole("row").last();
    await letzte.scrollIntoViewIfNeeded();
    await expect(letzte).toBeInViewport();
    await expect(ueberschrift).not.toBeInViewport();
    await expect(startseitenKnopf(page)).toBeInViewport();

    await startseitenKnopf(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Götterbaum" })).toBeVisible();
  } finally {
    await entferneFirma(firma.id);
  }
});

test("Vor der Anmeldung gibt es keine Leiste", async ({ page }) => {
  for (const pfad of ["/anmelden", "/passwort-vergessen"]) {
    await page.goto(pfad);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(startseitenKnopf(page)).toHaveCount(0);
  }
});
