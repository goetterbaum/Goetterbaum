import { devices, expect, test } from "@playwright/test";
import { berlinerDatum, berlinerUhrzeit } from "../src/lib/berliner-zeit";
import { erwarteAngemeldet, feld, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  type TestZugang,
} from "./testumgebung/testdaten";

const STUNDE = 60 * 60 * 1000;
// Live-Zeiten haben Sekunden.
const vorStunden = (stunden: number) =>
  Math.floor((Date.now() - stunden * STUNDE) / 1000) * 1000 - 23_000;

// Ein laufender Eintrag, der zum Zeitpunkt beginn gestartet wurde, dazu
// ein passendes Ende eine Stunde später auf die nächste volle Minute, wie
// man es ins Formular tippt.
async function laufenderEintrag(firmaId: string, mitarbeiter: TestZugang, beginn: number) {
  const dienst = dienstZugang()!;
  const objekt = await legeKundeMitObjektAn(dienst, firmaId);
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaId);
  const id = await legeZeiteintragAn(dienst, {
    firmaId,
    mitarbeiterId: mitarbeiter.id,
    objektId: objekt.objektId,
    taetigkeitId: taetigkeit.taetigkeitId,
    beginn: new Date(beginn).toISOString(),
    ende: null,
  });
  const ende = Math.ceil((beginn + STUNDE) / 60_000) * 60_000;
  return { id, objekt, ende };
}

async function gespeicherterEintrag(id: string) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("ende, nachtrag")
    .eq("id", id)
    .single<{ ende: string | null; nachtrag: boolean }>();
  return data!;
}

test.describe("am Handy", () => {
  const handy = devices["Pixel 7"];
  test.use({
    viewport: handy.viewport,
    userAgent: handy.userAgent,
    deviceScaleFactor: handy.deviceScaleFactor,
    isMobile: handy.isMobile,
    hasTouch: handy.hasTouch,
  });

  test("Ein Mitarbeiter sieht seinen unvollständigen Eintrag und trägt das richtige Ende nach", async ({
    page,
  }) => {
    const { firmaA } = testdaten();
    const ich = await legeEigenenZugangAn(firmaA.id);
    const { id, objekt, ende } = await laufenderEintrag(firmaA.id, ich, vorStunden(13));

    await meldeAn(page, ich);
    await erwarteAngemeldet(page, ich.name);
    await expect(page.getByRole("heading", { name: "Unvollständig", exact: true })).toBeVisible();
    await expect(
      page.getByText("läuft seit mehr als 12 Stunden").filter({ visible: true }),
    ).toBeVisible();
    // Ein Stopp würde "jetzt" als Ende speichern; deshalb gibt es keinen.
    await expect(page.getByRole("button", { name: "Stopp" })).toHaveCount(0);
    expect((await gespeicherterEintrag(id)).ende).toBeNull();

    // Ein Ende in der Zukunft wird abgelehnt, die Angaben bleiben stehen.
    await feld(page, "Datum").fill(berlinerDatum(Date.now() + 2 * STUNDE));
    await feld(page, "Bis").fill(berlinerUhrzeit(Date.now() + 2 * STUNDE));
    await page.getByRole("button", { name: "Ende speichern" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Zukunft" })).toHaveText(
      "Ein Nachtrag kann nicht in der Zukunft enden.",
    );
    expect((await gespeicherterEintrag(id)).ende).toBeNull();

    await feld(page, "Datum").fill(berlinerDatum(ende));
    await feld(page, "Bis").fill(berlinerUhrzeit(ende));
    await page.getByRole("button", { name: "Ende speichern" }).click();

    await expect(page.getByRole("heading", { name: "Unvollständig", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    const eintrag = page.getByRole("listitem").filter({ hasText: objekt.bezeichnung });
    await expect(eintrag).toContainText(` – ${berlinerUhrzeit(ende)}`);
    await expect(eintrag).toContainText("Nachtrag");
    const gespeichert = await gespeicherterEintrag(id);
    expect(gespeichert.nachtrag).toBe(true);
    expect(Date.parse(gespeichert.ende!)).toBe(ende);
  });

  test("Ein Eintrag, der noch keine 12 Stunden läuft, hat weiterhin den Stopp", async ({
    page,
  }) => {
    const { firmaA } = testdaten();
    const ich = await legeEigenenZugangAn(firmaA.id);
    await laufenderEintrag(firmaA.id, ich, vorStunden(11.5));

    await meldeAn(page, ich);
    await erwarteAngemeldet(page, ich.name);
    await expect(page.getByRole("button", { name: "Stopp" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unvollständig", exact: true })).toHaveCount(0);
  });

  test("Wird der Eintrag unvollständig, während die Seite offen ist, speichert der Stopp nichts", async ({
    page,
  }) => {
    const { firmaA } = testdaten();
    const ich = await legeEigenenZugangAn(firmaA.id);
    const { id } = await laufenderEintrag(firmaA.id, ich, vorStunden(11.5));

    await meldeAn(page, ich);
    await erwarteAngemeldet(page, ich.name);
    await expect(page.getByRole("button", { name: "Stopp" })).toBeVisible();
    // Während die Seite offen ist, vergehen die 12 Stunden.
    const { error } = await dienstZugang()!
      .from("zeiteintrag")
      .update({ beginn: new Date(vorStunden(13)).toISOString() })
      .eq("id", id);
    if (error) throw error;

    // Die Seite lädt neu und zeigt statt des Stopps das Formular für das
    // richtige Ende.
    await page.getByRole("button", { name: "Stopp" }).click();
    await expect(page.getByRole("heading", { name: "Unvollständig", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stopp" })).toHaveCount(0);
    expect(await gespeicherterEintrag(id)).toMatchObject({ ende: null, nachtrag: false });
  });
});

test("Das Büro sieht alle unvollständigen Einträge auf der Prüfliste und trägt das Ende nach", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const vergesslich = await legeEigenenZugangAn(firmaA.id);
  const fleissig = await legeEigenenZugangAn(firmaA.id);
  const vergesslichBeginn = vorStunden(26);
  const fleissigBeginn = vorStunden(2);
  const { id, ende } = await laufenderEintrag(firmaA.id, vergesslich, vergesslichBeginn);
  await laufenderEintrag(firmaA.id, fleissig, fleissigBeginn);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);

  // In der Übersicht steht er als unvollständig, der laufende Eintrag von
  // heute mit „läuft“, beide ohne Dauer, ...
  await page.getByRole("link", { name: "Zeiteinträge ansehen" }).click();
  const vergesslichZeile = page.getByRole("row").filter({ hasText: vergesslich.name });
  const fleissigZeile = page.getByRole("row").filter({ hasText: fleissig.name });
  await expect(vergesslichZeile.getByRole("cell", { name: /– unvollständig$/ })).toHaveText(
    `${berlinerUhrzeit(vergesslichBeginn)} – unvollständig`,
  );
  await expect(fleissigZeile.getByRole("cell", { name: /– läuft$/ })).toHaveText(
    `${berlinerUhrzeit(fleissigBeginn)} – läuft`,
  );
  await expect(vergesslichZeile).not.toContainText("Std.");
  await expect(fleissigZeile).not.toContainText("Std.");

  // ... auf der Prüfliste nur er, nicht der laufende Eintrag von heute.
  await page.getByRole("link", { name: "Unvollständige Zeiteinträge prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Unvollständige Zeiteinträge" })).toBeVisible();
  const zeile = page.getByRole("row").filter({ hasText: vergesslich.name });
  await expect(zeile).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: fleissig.name })).toHaveCount(0);

  await zeile.getByRole("link", { name: "Ende nachtragen" }).click();
  // Nur auf der sichtbaren Seite: Next.js hält besuchte Seiten unsichtbar vorrätig.
  await expect(page.getByText(`Für ${vergesslich.name}`).filter({ visible: true })).toBeVisible();
  await feld(page, "Datum").fill(berlinerDatum(ende));
  await feld(page, "Bis").fill(berlinerUhrzeit(ende));
  await page.getByRole("button", { name: "Ende speichern" }).click();

  await expect(page).toHaveURL(/\/unvollstaendige-eintraege$/);
  await expect(page.getByRole("heading", { name: "Unvollständige Zeiteinträge" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: vergesslich.name })).toHaveCount(0);
  const gespeichert = await gespeicherterEintrag(id);
  expect(gespeichert.nachtrag).toBe(true);
  expect(Date.parse(gespeichert.ende!)).toBe(ende);
});
