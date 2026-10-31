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
  verschiebeZeiteintraege,
  type TestZugang,
} from "./testumgebung/testdaten";

// Ein Arbeitstag am Handy: Nach einem Objekt startet die Fahrt von selbst,
// nach einer Pause geht es mit „Fahrt starten“ weiter, und der Arbeitstag
// endet mit Rückfrage.
const handy = devices["Pixel 7"];
test.use({
  viewport: handy.viewport,
  userAgent: handy.userAgent,
  deviceScaleFactor: handy.deviceScaleFactor,
  isMobile: handy.isMobile,
  hasTouch: handy.hasTouch,
});

type GespeicherterEintrag = {
  art: "taetigkeit" | "fahrt";
  objekt_id: string | null;
  beginn: string;
  ende: string | null;
  nachtrag: boolean;
  arbeitstag_endet_hier: boolean;
  angelegt_von: string;
};

async function zeiteintraegeVon(zugang: TestZugang) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("art, objekt_id, beginn, ende, nachtrag, arbeitstag_endet_hier, angelegt_von")
    .eq("mitarbeiter_id", zugang.id)
    .order("beginn")
    .returns<GespeicherterEintrag[]>();
  return data ?? [];
}

// Jeder Eintrag endet genau dort, wo der nächste beginnt.
function erwarteLueckenlos(eintraege: GespeicherterEintrag[]) {
  for (let i = 1; i < eintraege.length; i++) {
    expect(Date.parse(eintraege[i - 1].ende!), `Eintrag ${i}`).toBe(
      Date.parse(eintraege[i].beginn),
    );
  }
}

async function waehleAus(page: Page, bezeichnung: string, taetigkeit: string) {
  await feld(page, "Objekt suchen").fill(bezeichnung);
  await page.getByRole("radio", { name: new RegExp(bezeichnung) }).check();
  await page.getByRole("combobox", { name: /^Tätigkeit/ }).selectOption({ label: taetigkeit });
}

function knopf(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

function laufend(page: Page) {
  return page.getByRole("status").filter({ hasText: "Läuft seit" });
}

// Zwei Objekte und eine Tätigkeit der Firma.
async function auswahl(firmaId: string) {
  const dienst = dienstZugang()!;
  return {
    erstes: await legeKundeMitObjektAn(dienst, firmaId),
    zweites: await legeKundeMitObjektAn(dienst, firmaId),
    taetigkeit: await legeTaetigkeitAn(dienst, firmaId),
  };
}

// Start → „Fertig hier“ → Fahrt läuft → Start am nächsten Objekt →
// „Pause“ → „Fahrt starten“ → „Arbeitstag beenden“ mit Abbrechen und
// Bestätigen, für den Mitarbeiter erfasster. Die Seite zeigt schon dessen
// Erfassung.
async function ganzerArbeitstag(page: Page, erfasster: TestZugang, firmaId: string) {
  const { erstes, zweites, taetigkeit } = await auswahl(firmaId);
  // Die Objekte gibt es erst seit eben; die Seite war schon geladen.
  await page.reload();

  await waehleAus(page, erstes.bezeichnung, taetigkeit.name);
  await knopf(page, "Start").click();
  await expect(laufend(page)).toContainText(`${erstes.bezeichnung} · ${taetigkeit.name}`);
  // Statt Stopp: „Fertig hier“, „Pause“ und „Arbeitstag beenden“, aber
  // kein Start.
  await expect(knopf(page, "Stopp")).toHaveCount(0);
  await expect(knopf(page, "Pause")).toBeVisible();
  await expect(knopf(page, "Arbeitstag beenden")).toBeVisible();
  await expect(knopf(page, "Start")).toHaveCount(0);
  await expect(knopf(page, "Fahrt starten")).toHaveCount(0);

  // „Fertig hier“ beendet das Objekt und startet die Fahrt.
  await knopf(page, "Fertig hier").click();
  await expect(laufend(page)).toContainText("Fahrt");
  await expect(knopf(page, "Fertig hier")).toHaveCount(0);
  await expect(knopf(page, "Fahrt starten")).toHaveCount(0);
  await expect(knopf(page, "Pause")).toBeVisible();
  await expect(knopf(page, "Arbeitstag beenden")).toBeVisible();
  await expect(knopf(page, "Start")).toBeVisible();
  const nachFertigHier = await zeiteintraegeVon(erfasster);
  expect(nachFertigHier).toMatchObject([
    { art: "taetigkeit", objekt_id: erstes.objektId, ende: expect.any(String) },
    { art: "fahrt", ende: null },
  ]);
  erwarteLueckenlos(nachFertigHier);

  // Die Fahrt dauert eine Weile, damit sie gespeichert bleibt.
  await verschiebeZeiteintraege(erfasster.id, 10);
  await page.reload();

  // Während der Fahrt sagt die Rückfrage, dass sie als Rückfahrt bliebe.
  // Abbrechen ändert nichts.
  await knopf(page, "Arbeitstag beenden").click();
  await expect(page.getByText("Arbeitstag wirklich beenden?")).toContainText(
    "Die Fahrt wird als Rückfahrt gespeichert.",
  );
  await knopf(page, "Abbrechen").click();
  await expect(page.getByText("Arbeitstag wirklich beenden?")).toHaveCount(0);
  await expect(laufend(page)).toContainText("Fahrt");

  // Start am nächsten Objekt beendet die Fahrt.
  await waehleAus(page, zweites.bezeichnung, taetigkeit.name);
  await knopf(page, "Start").click();
  await expect(laufend(page)).toContainText(`${zweites.bezeichnung} · ${taetigkeit.name}`);
  await expect(knopf(page, "Start")).toHaveCount(0);

  // „Pause“ beendet das Objekt, und nichts startet. Danach geht es mit
  // Start, „Fahrt starten“ oder „Arbeitstag beenden“ weiter.
  await knopf(page, "Pause").click();
  await expect(laufend(page)).toHaveCount(0);
  await expect(knopf(page, "Start")).toBeVisible();
  await expect(knopf(page, "Fahrt starten")).toBeVisible();
  await expect(knopf(page, "Arbeitstag beenden")).toBeVisible();
  await expect(knopf(page, "Pause")).toHaveCount(0);
  const nachPause = await zeiteintraegeVon(erfasster);
  expect(nachPause).toHaveLength(3);
  expect(nachPause[2]).toMatchObject({ objekt_id: zweites.objektId, ende: expect.any(String) });

  // Nach der Pause weiterfahren. Die Fahrt dauert eine Weile, damit sie
  // gespeichert bleibt.
  await knopf(page, "Fahrt starten").click();
  await expect(laufend(page)).toContainText("Fahrt");
  await verschiebeZeiteintraege(erfasster.id, 10);
  await page.reload();

  // Abbrechen der Rückfrage ändert nichts.
  await knopf(page, "Arbeitstag beenden").click();
  await expect(page.getByText("Arbeitstag wirklich beenden?")).toBeVisible();
  await knopf(page, "Abbrechen").click();
  await expect(laufend(page)).toContainText("Fahrt");
  expect((await zeiteintraegeVon(erfasster)).at(-1)?.ende).toBeNull();

  await beendeArbeitstag(page);
  // Danach läuft nichts, und eine Fahrt gibt es erst wieder nach einem
  // neuen Start an einem Objekt.
  await expect(knopf(page, "Arbeitstag beenden")).toHaveCount(0);
  await expect(knopf(page, "Fahrt starten")).toHaveCount(0);
  await expect(knopf(page, "Start")).toBeVisible();

  const eintraege = await zeiteintraegeVon(erfasster);
  expect(eintraege).toMatchObject([
    { art: "taetigkeit", objekt_id: erstes.objektId, arbeitstag_endet_hier: false },
    { art: "fahrt", objekt_id: null, arbeitstag_endet_hier: false },
    { art: "taetigkeit", objekt_id: zweites.objektId, arbeitstag_endet_hier: false },
    { art: "fahrt", objekt_id: null, arbeitstag_endet_hier: true },
  ]);
  for (const e of eintraege) {
    expect(e.ende).not.toBeNull();
    expect(e.nachtrag).toBe(false);
  }
  // Lückenlos bis zur Pause; die Pause selbst ist kein Zeiteintrag.
  erwarteLueckenlos(eintraege.slice(0, 3));
  expect(Date.parse(eintraege[3].beginn)).toBeGreaterThanOrEqual(Date.parse(eintraege[2].ende!));

  // In der Liste stehen alle vier.
  const liste = page.getByRole("listitem");
  await expect(liste.filter({ hasText: erstes.bezeichnung })).toHaveCount(1);
  await expect(liste.filter({ hasText: "Fahrt" })).toContainText([/0:1\d h/, /0:1\d h/]);
  await expect(liste.filter({ hasText: zweites.bezeichnung })).toHaveCount(1);
  return eintraege;
}

test("Ein Mitarbeiter erfasst einen Arbeitstag: Fahrt automatisch, Ende mit Rückfrage, lückenlos", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);

  const eintraege = await ganzerArbeitstag(page, ich, firmaA.id);
  expect(eintraege.map((e) => e.angelegt_von)).toEqual([ich.id, ich.id, ich.id, ich.id]);
});

test("Ein Vorarbeiter erfasst denselben Arbeitstag für einen Kollegen", async ({ page }) => {
  const { firmaA } = testdaten();
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
  const kollege = await legeEigenenZugangAn(firmaA.id);
  await meldeAn(page, vorarbeiter);
  await erwarteAngemeldet(page, vorarbeiter.name);
  await page.goto(`/fuer-andere/${kollege.id}`);
  await expect(page.getByRole("heading", { name: `Erfassung für ${kollege.name}` })).toBeVisible();

  const eintraege = await ganzerArbeitstag(page, kollege, firmaA.id);
  expect(eintraege.map((e) => e.angelegt_von)).toEqual([
    vorarbeiter.id,
    vorarbeiter.id,
    vorarbeiter.id,
    vorarbeiter.id,
  ]);
  expect(await zeiteintraegeVon(vorarbeiter)).toEqual([]);
});

test("„Arbeitstag beenden“ während der Fahrt behält sie als Rückfahrt, eine Mini-Fahrt nicht", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const { erstes, zweites, taetigkeit } = await auswahl(firmaA.id);
  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);

  // Rückfahrt: Die Fahrt läuft schon 10 Minuten.
  await waehleAus(page, erstes.bezeichnung, taetigkeit.name);
  await knopf(page, "Start").click();
  await knopf(page, "Fertig hier").click();
  await expect(laufend(page)).toContainText("Fahrt");
  await verschiebeZeiteintraege(ich.id, 10);
  await page.reload();
  await beendeArbeitstag(page);
  const mitRueckfahrt = await zeiteintraegeVon(ich);
  expect(mitRueckfahrt).toMatchObject([
    { art: "taetigkeit", arbeitstag_endet_hier: false },
    { art: "fahrt", ende: expect.any(String), arbeitstag_endet_hier: true },
  ]);
  erwarteLueckenlos(mitRueckfahrt);

  // Mini-Fahrt: gleich nach „Fertig hier“. Die Rückfrage sagt, dass sie
  // nicht gespeichert wird; der Vermerk kommt auf das Objekt.
  await verschiebeZeiteintraege(ich.id, 60);
  await page.reload();
  await waehleAus(page, zweites.bezeichnung, taetigkeit.name);
  await knopf(page, "Start").click();
  await knopf(page, "Fertig hier").click();
  await expect(laufend(page)).toContainText("Fahrt");
  await knopf(page, "Arbeitstag beenden").click();
  await expect(page.getByText("Arbeitstag wirklich beenden?")).toContainText(
    "Die Fahrt dauert noch keine 2 Minuten und wird deshalb nicht gespeichert.",
  );
  await knopf(page, "Ja, beenden").click();
  await expect(laufend(page)).toHaveCount(0);
  expect((await zeiteintraegeVon(ich)).slice(2)).toMatchObject([
    {
      art: "taetigkeit",
      objekt_id: zweites.objektId,
      ende: expect.any(String),
      arbeitstag_endet_hier: true,
    },
  ]);
  expect(await zeiteintraegeVon(ich)).toHaveLength(3);
});

test("„Pause“ während einer kurzen Fahrt entfernt sie, „Arbeitstag beenden“ nach der Pause setzt den Vermerk", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const { erstes, taetigkeit } = await auswahl(firmaA.id);
  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);

  // Gleich nach „Fertig hier“ Pause: Die Fahrt dauert keine 2 Minuten.
  await waehleAus(page, erstes.bezeichnung, taetigkeit.name);
  await knopf(page, "Start").click();
  await knopf(page, "Fertig hier").click();
  await expect(laufend(page)).toContainText("Fahrt");
  await knopf(page, "Pause").click();
  await expect(laufend(page)).toHaveCount(0);
  await expect(knopf(page, "Fahrt starten")).toBeVisible();
  expect(await zeiteintraegeVon(ich)).toMatchObject([
    { art: "taetigkeit", objekt_id: erstes.objektId, arbeitstag_endet_hier: false },
  ]);
  expect(await zeiteintraegeVon(ich)).toHaveLength(1);

  // Nach der Pause fragt „Arbeitstag beenden“ nach, ohne Fahrt in der
  // Rückfrage, und setzt den Vermerk am Objekt.
  await knopf(page, "Arbeitstag beenden").click();
  await expect(page.getByText("Arbeitstag wirklich beenden?")).toHaveText(
    "Arbeitstag wirklich beenden?",
  );
  await knopf(page, "Abbrechen").click();
  await expect(knopf(page, "Fahrt starten")).toBeVisible();
  await knopf(page, "Arbeitstag beenden").click();
  await knopf(page, "Ja, beenden").click();
  await expect(knopf(page, "Fahrt starten")).toHaveCount(0);
  await expect(knopf(page, "Arbeitstag beenden")).toHaveCount(0);
  await expect(knopf(page, "Start")).toBeVisible();
  expect(await zeiteintraegeVon(ich)).toMatchObject([
    { art: "taetigkeit", objekt_id: erstes.objektId, arbeitstag_endet_hier: true, nachtrag: false },
  ]);
});

test("Nach mehr als 12 Stunden ohne Zeiteintrag gibt es kein „Fahrt starten“ mehr, knapp davor noch", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const { erstes, taetigkeit } = await auswahl(firmaA.id);
  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);

  await waehleAus(page, erstes.bezeichnung, taetigkeit.name);
  await knopf(page, "Start").click();
  await knopf(page, "Pause").click();
  await expect(knopf(page, "Fahrt starten")).toBeVisible();

  // Knapp 12 Stunden später ist der Arbeitstag noch offen.
  await verschiebeZeiteintraege(ich.id, 12 * 60 - 5);
  await page.reload();
  await expect(knopf(page, "Fahrt starten")).toBeVisible();

  // Danach gilt er als beendet, ohne dass ein Vermerk gesetzt wird.
  await verschiebeZeiteintraege(ich.id, 10);
  await page.reload();
  await expect(knopf(page, "Start")).toBeVisible();
  await expect(knopf(page, "Fahrt starten")).toHaveCount(0);
  await expect(knopf(page, "Arbeitstag beenden")).toHaveCount(0);
  expect(await zeiteintraegeVon(ich)).toMatchObject([{ arbeitstag_endet_hier: false }]);
});
