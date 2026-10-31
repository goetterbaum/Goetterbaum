import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAn } from "./testumgebung/hilfen";
import {
  dienstZugang,
  entferneFirma,
  legeEigeneFirmaAn,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
} from "./testumgebung/testdaten";

// Jeder Test hat eine eigene Firma: Die Kostenanalyse rechnet mit allen
// Zeiteinträgen und dem Standard der ganzen Firma.

// Eine Zeile der Tabelle, erkannt an ihren Texten.
function zeile(page: Page, ...texte: string[]) {
  return texte.reduce(
    (zeilen, text) => zeilen.filter({ hasText: text }),
    page.locator("tbody").getByRole("row"),
  );
}

async function hinzufuegen(page: Page, gueltigAb: string, betrag: string) {
  await feld(page, "Gültig ab").fill(gueltigAb);
  await feld(page, "Betrag je Stunde in Euro").fill(betrag);
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Wert hinzugefügt." })).toBeVisible();
}

test("Büro trägt Arbeitgeberkosten ein und sieht in der Kostenanalyse die richtigen Zahlen, auch als CSV", async ({
  page,
}) => {
  const firma = await legeEigeneFirmaAn();
  try {
    const dienst = dienstZugang()!;
    const anna = await legeEigenenZugangAn(firma.id);
    const ben = await legeEigenenZugangAn(firma.id);
    // Ein Pauschal-Objekt (500 € im Monat) und eine Villa nach Stunden
    // (30 € die Stunde) beim selben Kunden.
    const pauschal = await legeKundeMitObjektAn(dienst, firma.id);
    const { taetigkeitId } = await legeTaetigkeitAn(dienst, firma.id);
    const { data: villa, error } = await dienst
      .from("objekt")
      .insert({
        firma_id: firma.id,
        kunde_id: pauschal.kundeId,
        bezeichnung: `Villa ${randomUUID().slice(0, 8)}`,
        strasse: "Ringstraße 2",
        plz: "50667",
        ort: "Köln",
        abrechnungsart: "stunden",
      })
      .select("id, bezeichnung")
      .single<{ id: string; bezeichnung: string }>();
    if (error) throw error;
    const { data: kunde } = await dienst
      .from("kunde")
      .select("name")
      .eq("id", pauschal.kundeId)
      .single<{ name: string }>();

    // Anna am 14.09.2026: Villa, Fahrt, Pauschal-Objekt, Rückfahrt. Ben
    // am Tag danach eine Stunde in der Villa. Nichts ist freigegeben.
    const eintrag = (mitarbeiterId: string, beginn: string, ende: string, objektId?: string) =>
      legeZeiteintragAn(dienst, {
        firmaId: firma.id,
        mitarbeiterId,
        objektId,
        taetigkeitId: objektId && taetigkeitId,
        beginn,
        ende,
      });
    await eintrag(anna.id, "2026-09-14T08:00:07+02:00", "2026-09-14T10:00:07+02:00", villa.id);
    await eintrag(anna.id, "2026-09-14T10:00:07+02:00", "2026-09-14T10:30:07+02:00");
    await eintrag(
      anna.id,
      "2026-09-14T10:30:07+02:00",
      "2026-09-14T12:30:07+02:00",
      pauschal.objektId,
    );
    await eintrag(anna.id, "2026-09-14T12:30:07+02:00", "2026-09-14T13:00:07+02:00");
    await eintrag(ben.id, "2026-09-15T08:00:41+02:00", "2026-09-15T09:00:41+02:00", villa.id);

    await meldeAn(page, firma.buero);
    await erwarteAngemeldet(page, firma.buero.name);

    // Ohne Arbeitgeberkosten fehlen die Kosten, statt mit 0 € zu rechnen.
    await page.goto("/kostenanalyse?von=2026-09-01&bis=2026-09-30");
    await expect(zeile(page, villa.bezeichnung)).toContainText(
      `Kosten fehlen für: ${anna.name}, ${ben.name}`,
    );

    // Standard 26 € in den Einstellungen, für Anna ein eigener Wert 31 €.
    await page.goto("/einstellungen");
    await hinzufuegen(page, "2026-01-01", "26");
    await page.goto(`/mitarbeiter/${anna.id}`);
    await hinzufuegen(page, "2026-01-01", "31");

    await page.goto("/");
    await page.getByRole("link", { name: "Kostenanalyse" }).click();
    await expect(page.getByRole("heading", { name: "Kostenanalyse", level: 1 })).toBeVisible();
    await page.goto("/kostenanalyse?von=2026-09-01&bis=2026-09-30");
    await expect(
      page.getByRole("heading", { name: "Objektübersicht September 2026" }),
    ).toBeVisible();
    await expect(page.getByText(/^Berechnet mit den heutigen Preisen/)).toBeVisible();

    // Villa: 3 Std. für 90,00 €; Anna 2 Std. zu 31 €, Ben 1 Std. zu 26 €;
    // dazu die halbe Fahrt und die halbe Rückfahrt (2 × 15 Min. zu 31 €).
    // Pauschal-Objekt: 500,00 € minus 2 Std. und 30 Min. Fahrt zu 31 €.
    // Die schwächste Villa steht oben.
    const objekte = page.locator("tbody tr td:first-child").filter({ visible: true });
    await expect(objekte).toHaveText([villa.bezeichnung, pauschal.bezeichnung]);
    await expect(zeile(page, villa.bezeichnung)).toHaveText(
      /90,00\s€\s*3:00\sStd\.\s*88,00\s€\s*0:30\sStd\.\s*15,50\s€\s*-13,50\s€\s*-15,0\s*vorläufig/,
    );
    await expect(zeile(page, pauschal.bezeichnung)).toHaveText(
      /500,00\s€\s*2:00\sStd\.\s*62,00\s€\s*0:30\sStd\.\s*15,50\s€\s*422,50\s€\s*84,5\s*vorläufig/,
    );
    await expect(zeile(page, `Summe ${kunde!.name}`)).toHaveText(
      /590,00\s€\s*5:00\sStd\.\s*150,00\s€\s*1:00\sStd\.\s*31,00\s€\s*409,00\s€\s*69,3\s*vorläufig/,
    );
    await expect(zeile(page, "Gesamtsumme")).toContainText("409,00 €");

    // Die CSV-Datei hat dieselben Zahlen.
    const herunterladen = page.waitForEvent("download");
    await page.getByRole("link", { name: "Als CSV herunterladen" }).click();
    const datei = await herunterladen;
    expect(datei.suggestedFilename()).toBe("Kostenanalyse September 2026.csv");
    const inhalt = await readFile((await datei.path())!);
    expect(inhalt.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(inhalt.toString("utf8").slice(1)).toBe(
      "Kunde;Objekt;Einnahmen;Arbeitsstunden;Arbeitskosten;Fahrzeit;Fahrkosten;Deckungsbeitrag (€);Deckungsbeitrag (%);Hinweis\r\n" +
        `${kunde!.name};${villa.bezeichnung};90,00;3:00;88,00;0:30;15,50;-13,50;-15,0;vorläufig\r\n` +
        `${kunde!.name};${pauschal.bezeichnung};500,00;2:00;62,00;0:30;15,50;422,50;84,5;vorläufig\r\n` +
        `${kunde!.name};Summe ${kunde!.name};590,00;5:00;150,00;1:00;31,00;409,00;69,3;vorläufig\r\n` +
        ";Gesamtsumme;590,00;5:00;150,00;1:00;31,00;409,00;69,3;vorläufig\r\n",
    );

    // Details der Villa: je Tag die Einträge, mit Standard oder eigenem Wert.
    await page.getByRole("link", { name: villa.bezeichnung }).click();
    await expect(
      page.getByRole("heading", { name: `${villa.bezeichnung}: September 2026` }),
    ).toBeVisible();
    await expect(zeile(page, "14.09.2026", `${anna.name} (eigener Wert)`)).toHaveText(
      /08:00–10:00\s*2:00\sStd\.\s*0:30\sStd\.\s*77,50\s€\s*60,00\s€\s*vorläufig/,
    );
    await expect(zeile(page, "15.09.2026", `${ben.name} (Standard)`)).toHaveText(
      /08:00–09:00\s*1:00\sStd\.\s*0:00\sStd\.\s*26,00\s€\s*30,00\s€\s*vorläufig/,
    );

    // Das ganze Jahr: zwölf Pauschalen.
    await page.getByRole("link", { name: "Zurück zur Objektübersicht" }).click();
    await page.getByRole("button", { name: "Ganzes Jahr" }).click();
    await expect(page).toHaveURL(/von=2026-01-01&bis=2026-12-31/);
    await expect(page.getByRole("heading", { name: "Objektübersicht Jahr 2026" })).toBeVisible();
    await expect(zeile(page, pauschal.bezeichnung)).toContainText("6.000,00 €");
  } finally {
    await entferneFirma(firma.id);
  }
});

test("Mitarbeiter und Vorarbeiter sehen keine Kostenanalyse", async ({ page }) => {
  const firma = await legeEigeneFirmaAn();
  try {
    for (const rolle of ["mitarbeiter", "vorarbeiter"] as const) {
      const ich = await legeEigenenZugangAn(firma.id, rolle);
      await meldeAn(page, ich);
      await erwarteAngemeldet(page, ich.name);
      await expect(page.getByRole("link", { name: "Kostenanalyse" })).toHaveCount(0);

      await page.goto("/kostenanalyse");
      await expect(page.getByText("Die Kostenanalyse darf nur das Büro sehen.")).toBeVisible();
      await expect(page.locator("table")).toHaveCount(0);
      await page.goto("/kostenanalyse/details");
      await expect(page.getByText("Die Kostenanalyse darf nur das Büro sehen.")).toBeVisible();
      const antwort = await page.request.get("/kostenanalyse/csv");
      expect(antwort.status(), rolle).toBe(403);
      await page.context().clearCookies();
    }
  } finally {
    await entferneFirma(firma.id);
  }
});
