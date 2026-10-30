import { randomUUID } from "node:crypto";
import { devices, expect, test, type Page } from "@playwright/test";
import { berlinerDatum } from "../src/lib/berliner-zeit";
import { erwarteAngemeldet, feld, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZusatzauftragAn,
  type TestZugang,
} from "./testumgebung/testdaten";

async function zusatzauftragAusDatenbank(beschreibung: string) {
  const { data } = await dienstZugang()!
    .from("zusatzauftrag")
    .select("abrechnungsart, festbetrag_cent, erledigt")
    .eq("beschreibung", beschreibung)
    .single();
  return data;
}

test("Das Büro legt Zusatzaufträge an, bearbeitet sie und markiert sie als erledigt", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const objekt = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);
  const sturmschaden = `Sturmschaden Hof ${randomUUID().slice(0, 8)}`;
  const grundreinigung = `Grundreinigung ${randomUUID().slice(0, 8)}`;

  await meldeAn(page, firmaA.buero);
  await erwarteAngemeldet(page, firmaA.buero.name);
  await page.goto(`/objekte/${objekt.objektId}`);
  const bereich = page.getByRole("region", { name: "Zusatzaufträge" });
  await expect(bereich.getByText("Noch keine Zusatzaufträge angelegt.")).toBeVisible();
  const beschreibung = bereich.getByLabel("Beschreibung", { exact: true });
  const abrechnungsart = bereich.getByRole("combobox", { name: /^Abrechnung des Zusatzauftrags/ });
  const festbetrag = bereich.getByLabel("Festbetrag in Euro", { exact: true });
  const zeile = (text: string) => bereich.getByRole("row").filter({ hasText: text });

  // Nach Stunden: ohne Festbetrag.
  await beschreibung.fill(sturmschaden);
  await expect(abrechnungsart).toHaveValue("stunden");
  await expect(festbetrag).toHaveCount(0);
  await bereich.getByRole("button", { name: "Anlegen" }).click();
  await expect(bereich.getByRole("status")).toHaveText("Zusatzauftrag angelegt.");
  await expect(zeile(sturmschaden)).toContainText("Nach Stunden");
  await expect(zeile(sturmschaden)).toContainText("offen");

  // Mit Festbetrag: dann Pflicht und größer als 0 €.
  await beschreibung.fill(grundreinigung);
  await abrechnungsart.selectOption({ label: "Festbetrag" });
  await festbetrag.fill("0");
  await bereich.getByRole("button", { name: "Anlegen" }).click();
  await expect(bereich.getByRole("alert")).toHaveText(
    "Der Festbetrag ist kein gültiger Betrag. Beispiel: 890,00",
  );
  // Nach der Fehlermeldung bleibt alles stehen, auch die Abrechnungsart.
  await expect(beschreibung).toHaveValue(grundreinigung);
  await expect(abrechnungsart).toHaveValue("festbetrag");
  await festbetrag.fill("1.890,50");
  await bereich.getByRole("button", { name: "Anlegen" }).click();
  await expect(zeile(grundreinigung)).toContainText("Festbetrag 1.890,50 €");
  // Nach dem Anlegen ist das Formular leer für den nächsten.
  await expect(beschreibung).toHaveValue("");
  await expect(abrechnungsart).toHaveValue("stunden");
  expect(await zusatzauftragAusDatenbank(grundreinigung)).toEqual({
    abrechnungsart: "festbetrag",
    festbetrag_cent: 189050,
    erledigt: false,
  });

  // Bearbeiten: andere Beschreibung und Abrechnungsart.
  await bereich.getByRole("link", { name: `Bearbeiten: ${sturmschaden}` }).click();
  await expect(page.getByRole("heading", { name: sturmschaden })).toBeVisible();
  const geaendert = `${sturmschaden} Nordseite`;
  await feld(page, "Beschreibung").fill(geaendert);
  await page
    .getByRole("combobox", { name: /^Abrechnung des Zusatzauftrags/ })
    .selectOption({ label: "Festbetrag" });
  await feld(page, "Festbetrag in Euro").fill("450");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Gespeichert.");
  await expect(page.getByRole("heading", { name: geaendert })).toBeVisible();

  // Als erledigt markieren und wieder öffnen.
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(
    page.getByText(
      "Dieser Zusatzauftrag ist erledigt. Er steht beim Erfassen nicht mehr zur Auswahl.",
    ),
  ).toBeVisible();
  expect(await zusatzauftragAusDatenbank(geaendert)).toEqual({
    abrechnungsart: "festbetrag",
    festbetrag_cent: 45000,
    erledigt: true,
  });
  await page.getByRole("button", { name: "Wieder öffnen" }).click();
  await expect(page.getByRole("button", { name: "Als erledigt markieren" })).toBeVisible();
  expect((await zusatzauftragAusDatenbank(geaendert))?.erledigt).toBe(false);
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();

  await page.getByRole("link", { name: "Zurück zum Objekt" }).click();
  await expect(zeile(geaendert)).toContainText("Festbetrag 450,00 €");
  await expect(zeile(geaendert)).toContainText("erledigt");
  await expect(zeile(grundreinigung)).toContainText("offen");
});

test.describe("am Handy", () => {
  // Mitarbeiter und Vorarbeiter erfassen am Handy.
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

  // Ein Objekt mit einem offenen und einem erledigten Zusatzauftrag, ein
  // zweites Objekt mit einem eigenen offenen und ein drittes ohne.
  async function objekteMitZusatzauftraegen(firmaId: string) {
    const dienst = dienstZugang()!;
    const objekt = await legeKundeMitObjektAn(dienst, firmaId);
    const anderes = await legeKundeMitObjektAn(dienst, firmaId);
    const ohne = await legeKundeMitObjektAn(dienst, firmaId);
    const sturmschaden = await legeZusatzauftragAn(dienst, firmaId, objekt.objektId, {
      beschreibung: `Sturmschaden ${randomUUID().slice(0, 8)}`,
    });
    const erledigt = await legeZusatzauftragAn(dienst, firmaId, objekt.objektId, {
      erledigt: true,
    });
    const fremder = await legeZusatzauftragAn(dienst, firmaId, anderes.objektId, {
      festbetragCent: 89000,
    });
    const taetigkeit = await legeTaetigkeitAn(dienst, firmaId);
    return { objekt, anderes, ohne, sturmschaden, erledigt, fremder, taetigkeit };
  }

  async function waehleObjekt(page: Page, bezeichnung: string) {
    await feld(page, "Objekt suchen").fill(bezeichnung);
    await page.getByRole("radio", { name: new RegExp(bezeichnung) }).check();
  }

  function zusatzauftragAuswahl(page: Page) {
    return page.getByRole("combobox", { name: /^Zusatzauftrag/ }).filter({ visible: true });
  }

  async function zeiteintraegeVon(zugang: TestZugang) {
    const { data } = await dienstZugang()!
      .from("zeiteintrag")
      .select("id, objekt_id, zusatzauftrag_id, ende, angelegt_von")
      .eq("mitarbeiter_id", zugang.id)
      .order("beginn");
    return data ?? [];
  }

  test("Ein Mitarbeiter wählt beim Start einen offenen Zusatzauftrag des gewählten Objekts", async ({
    page,
  }) => {
    const { firmaA } = testdaten();
    const ich = await legeEigenenZugangAn(firmaA.id);
    const { objekt, anderes, ohne, sturmschaden, fremder, taetigkeit } =
      await objekteMitZusatzauftraegen(firmaA.id);
    await meldeAn(page, ich);
    await erwarteAngemeldet(page, ich.name);
    const auswahl = zusatzauftragAuswahl(page);

    // Ohne Objekt oder bei einem Objekt ohne Zusatzaufträge gibt es nichts
    // zu wählen.
    await expect(auswahl).toHaveCount(0);
    await waehleObjekt(page, ohne.bezeichnung);
    await expect(auswahl).toHaveCount(0);

    // Nur die offenen des gewählten Objekts, keiner ist vorgewählt.
    await waehleObjekt(page, anderes.bezeichnung);
    await expect(auswahl.locator("option")).toHaveText([
      "Kein Zusatzauftrag",
      fremder.beschreibung,
    ]);
    await auswahl.selectOption({ label: fremder.beschreibung });
    await waehleObjekt(page, objekt.bezeichnung);
    await expect(auswahl.locator("option")).toHaveText([
      "Kein Zusatzauftrag",
      sturmschaden.beschreibung,
    ]);
    // Mit dem Objekt wechselt auch die Auswahl.
    await expect(auswahl).toHaveValue("");

    await auswahl.selectOption({ label: sturmschaden.beschreibung });
    await page
      .getByRole("combobox", { name: /^Tätigkeit/ })
      .selectOption({ label: taetigkeit.name });
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const wasUndWo = `${objekt.bezeichnung} · ${taetigkeit.name} · Zusatzauftrag: ${sturmschaden.beschreibung}`;
    await expect(page.getByText(/^Läuft seit/)).toBeVisible();
    await expect(page.getByText(wasUndWo)).toBeVisible();
    expect(await zeiteintraegeVon(ich)).toEqual([
      expect.objectContaining({
        objekt_id: objekt.objektId,
        zusatzauftrag_id: sturmschaden.zusatzauftragId,
        ende: null,
      }),
    ]);

    await page.getByRole("button", { name: "Stopp" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: wasUndWo })).toHaveCount(1);

    // Ohne Auswahl ist es reguläre Arbeit.
    await waehleObjekt(page, objekt.bezeichnung);
    await page
      .getByRole("combobox", { name: /^Tätigkeit/ })
      .selectOption({ label: taetigkeit.name });
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(
      page.getByText(`${objekt.bezeichnung} · ${taetigkeit.name}`, { exact: true }),
    ).toBeVisible();
    const [, regulaer] = await zeiteintraegeVon(ich);
    expect(regulaer).toMatchObject({ objekt_id: objekt.objektId, zusatzauftrag_id: null });
    await page.getByRole("button", { name: "Stopp" }).click();
  });

  test("Ein Vorarbeiter trägt für einen Kollegen mit Zusatzauftrag nach; nach dem Erledigen bleibt die Zuordnung beim Ändern", async ({
    page,
  }) => {
    const { firmaA } = testdaten();
    const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
    const kollege = await legeEigenenZugangAn(firmaA.id);
    const { objekt, sturmschaden, erledigt, taetigkeit } = await objekteMitZusatzauftraegen(
      firmaA.id,
    );
    await meldeAn(page, vorarbeiter);
    await erwarteAngemeldet(page, vorarbeiter.name);

    await page.goto(`/nachtrag?fuer=${kollege.id}`);
    await expect(page.getByText(`Für ${kollege.name}`, { exact: true })).toBeVisible();
    await waehleObjekt(page, objekt.bezeichnung);
    await page
      .getByRole("combobox", { name: /^Tätigkeit/ })
      .selectOption({ label: taetigkeit.name });
    const auswahl = zusatzauftragAuswahl(page);
    await expect(auswahl.locator("option")).toHaveText([
      "Kein Zusatzauftrag",
      sturmschaden.beschreibung,
    ]);
    await expect(auswahl.locator("option", { hasText: erledigt.beschreibung })).toHaveCount(0);
    await auswahl.selectOption({ label: sturmschaden.beschreibung });
    await feld(page, "Datum").fill(GESTERN);
    await feld(page, "Von").fill("07:30");
    await feld(page, "Bis").fill("09:45");
    await page.getByRole("button", { name: "Speichern" }).click();

    // Zurück in der Erfassung des Kollegen steht der Zusatzauftrag dabei.
    await expect(
      page.getByRole("heading", { name: `Erfassung für ${kollege.name}` }),
    ).toBeVisible();
    const eintrag = page
      .getByRole("listitem")
      .filter({ hasText: `Zusatzauftrag: ${sturmschaden.beschreibung}` });
    await expect(eintrag).toContainText("07:30 – 09:45");
    const [nachgetragen] = await zeiteintraegeVon(kollege);
    expect(nachgetragen).toMatchObject({
      zusatzauftrag_id: sturmschaden.zusatzauftragId,
      angelegt_von: vorarbeiter.id,
    });

    // Das Büro markiert den Zusatzauftrag als erledigt. Beim Ändern der
    // Zeit bleibt die Zuordnung trotzdem erhalten.
    const { error } = await dienstZugang()!
      .from("zusatzauftrag")
      .update({ erledigt: true })
      .eq("id", sturmschaden.zusatzauftragId);
    expect(error).toBeNull();
    await page.goto(`/nachtrag/${nachgetragen.id}`);
    await expect(zusatzauftragAuswahl(page)).toHaveValue(sturmschaden.zusatzauftragId);
    await expect(zusatzauftragAuswahl(page).locator("option:checked")).toHaveText(
      "Bisheriger Zusatzauftrag (schon erledigt)",
    );
    await feld(page, "Bis").fill("10:00");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(
      page.getByRole("heading", { name: `Erfassung für ${kollege.name}` }),
    ).toBeVisible();
    await expect(eintrag).toContainText("07:30 – 10:00");
    expect((await zeiteintraegeVon(kollege))[0].zusatzauftrag_id).toBe(
      sturmschaden.zusatzauftragId,
    );
  });
});
