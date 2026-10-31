import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAn } from "./testumgebung/hilfen";
import {
  dienstZugang,
  entferneFirma,
  legeEigeneFirmaAn,
  legeEigenenZugangAn,
} from "./testumgebung/testdaten";

// Jeder Test hat eine eigene Firma, weil der Standard für die ganze Firma
// gilt und andere Tests mit Firma A rechnen.

// Eine Zeile des Verlaufs, erkannt an ihrem „gültig ab“.
function zeile(page: Page, datum: string) {
  return page.getByRole("row").filter({ hasText: datum });
}

// Die Fehlermeldung eines Formulars. Next.js hat außerhalb davon ein
// eigenes, leeres Hinweis-Element für Screenreader.
function fehler(page: Page) {
  return page.locator("form").getByRole("alert");
}

async function hinzufuegen(page: Page, gueltigAb: string, betrag: string) {
  await feld(page, "Gültig ab").fill(gueltigAb);
  await feld(page, "Betrag je Stunde in Euro").fill(betrag);
  await page.getByRole("button", { name: "Hinzufügen" }).click();
}

async function gespeicherterStandard(firmaId: string) {
  const { data } = await dienstZugang()!
    .from("arbeitgeberkosten_standard")
    .select("gueltig_ab, kosten_je_stunde_cent")
    .eq("firma_id", firmaId)
    .order("gueltig_ab");
  return data;
}

async function gespeicherteEigeneWerte(mitarbeiterId: string) {
  const { data } = await dienstZugang()!
    .from("arbeitgeberkosten_mitarbeiter")
    .select("gueltig_ab, kosten_je_stunde_cent")
    .eq("mitarbeiter_id", mitarbeiterId)
    .order("gueltig_ab");
  return data;
}

test("Büro pflegt den Standard der Arbeitgeberkosten in den Einstellungen mit Verlauf", async ({
  page,
}) => {
  const firma = await legeEigeneFirmaAn();
  try {
    await meldeAn(page, firma.buero);
    await erwarteAngemeldet(page, firma.buero.name);
    await page.getByRole("link", { name: "Einstellungen der Firma" }).click();

    await expect(page.getByRole("heading", { name: "Arbeitgeberkosten je Stunde" })).toBeVisible();
    await expect(page.getByText("Noch kein Wert eingetragen.")).toBeVisible();

    // Kein Betrag über 0 €: abgelehnt, nichts gespeichert. Neu geladen,
    // damit keine Meldung vom vorigen Versuch stehen bleibt.
    for (const betrag of ["-26,00", "0", "26.00", "abc"]) {
      await page.reload();
      await expect(fehler(page)).toHaveCount(0);
      await hinzufuegen(page, "2026-01-01", betrag);
      await expect(fehler(page)).toHaveText(
        "Die Arbeitgeberkosten sind kein gültiger Betrag über 0 €. Beispiel: 27,50",
      );
    }
    expect(await gespeicherterStandard(firma.id)).toEqual([]);

    await hinzufuegen(page, "2026-01-01", "26");
    await expect(page.getByRole("status").filter({ hasText: "Wert hinzugefügt." })).toBeVisible();
    await expect(zeile(page, "01.01.2026")).toContainText("26,00 €");

    // Ein zweiter Wert für denselben Tag wird abgelehnt.
    await hinzufuegen(page, "2026-01-01", "27");
    await expect(fehler(page)).toHaveText(
      "Für diesen Tag gibt es schon einen Wert. Ändere bitte diesen.",
    );

    // Nach der Lohnerhöhung kommt ein neuer Wert dazu, der alte bleibt
    // stehen. Der späteste steht oben.
    await hinzufuegen(page, "2026-04-01", "27,5");
    await expect(zeile(page, "01.04.2026")).toContainText("27,50 €");
    const datumsspalte = page.locator("tbody tr td:first-child").filter({ visible: true });
    await expect(datumsspalte).toHaveText(["01.04.2026", "01.01.2026"]);

    // Ändern: Betrag und „gültig ab“ eines Werts korrigieren.
    const ersterBetrag = feld(page, "Betrag je Stunde in Euro für den Wert vom 01.01.2026");
    await expect(ersterBetrag).toHaveValue("26,00");
    await ersterBetrag.fill("26,40");
    await zeile(page, "01.01.2026").getByRole("button", { name: "Ändern" }).click();
    await expect(zeile(page, "01.01.2026")).toContainText("26,40 €");
    await feld(page, "Gültig ab für den Wert vom 01.01.2026").fill("2026-01-05");
    await zeile(page, "01.01.2026").getByRole("button", { name: "Ändern" }).click();
    await expect(zeile(page, "05.01.2026")).toContainText("26,40 €");
    await expect(zeile(page, "01.01.2026")).toHaveCount(0);

    // Auch beim Ändern darf kein ungültiger Betrag gespeichert werden.
    await feld(page, "Betrag je Stunde in Euro für den Wert vom 05.01.2026").fill("-1");
    await zeile(page, "05.01.2026").getByRole("button", { name: "Ändern" }).click();
    await expect(zeile(page, "05.01.2026").getByRole("alert")).toHaveText(
      "Die Arbeitgeberkosten sind kein gültiger Betrag über 0 €. Beispiel: 27,50",
    );

    // Löschen erst nach Rückfrage.
    await zeile(page, "01.04.2026").getByRole("button", { name: "Löschen" }).click();
    await expect(page.getByText("Den Wert ab 01.04.2026 wirklich löschen?")).toBeVisible();
    await zeile(page, "01.04.2026").getByRole("button", { name: "Ja, löschen" }).click();
    await expect(zeile(page, "01.04.2026")).toHaveCount(0);

    expect(await gespeicherterStandard(firma.id)).toEqual([
      { gueltig_ab: "2026-01-05", kosten_je_stunde_cent: 2640 },
    ]);
  } finally {
    await entferneFirma(firma.id);
  }
});

test("Büro trägt beim Mitarbeiter einen eigenen Wert ein, der vor dem Standard gilt", async ({
  page,
}) => {
  const firma = await legeEigeneFirmaAn();
  try {
    const mitarbeiter = await legeEigenenZugangAn(firma.id);
    const { error } = await dienstZugang()!.from("arbeitgeberkosten_standard").insert({
      firma_id: firma.id,
      gueltig_ab: "2026-01-01",
      kosten_je_stunde_cent: 2600,
    });
    if (error) throw error;

    await meldeAn(page, firma.buero);
    await erwarteAngemeldet(page, firma.buero.name);
    await page.goto(`/mitarbeiter/${mitarbeiter.id}`);

    await expect(page.getByRole("heading", { name: "Arbeitgeberkosten je Stunde" })).toBeVisible();
    await expect(page.getByText("Noch kein Wert eingetragen.")).toBeVisible();
    await expect(page.getByText("Heute gilt: 26,00 € (Standard der Firma)")).toBeVisible();

    await hinzufuegen(page, "", "31");
    // Das Datumsfeld ist Pflicht; der Browser schickt das Formular gar
    // nicht erst ab.
    expect(await gespeicherteEigeneWerte(mitarbeiter.id)).toEqual([]);

    await hinzufuegen(page, "2026-01-01", "31");
    await expect(zeile(page, "01.01.2026")).toContainText("31,00 €");
    await expect(page.getByText("Heute gilt: 31,00 € (eigener Wert)")).toBeVisible();

    await feld(page, "Betrag je Stunde in Euro für den Wert vom 01.01.2026").fill("32,15");
    await zeile(page, "01.01.2026").getByRole("button", { name: "Ändern" }).click();
    await expect(page.getByText("Heute gilt: 32,15 € (eigener Wert)")).toBeVisible();
    expect(await gespeicherteEigeneWerte(mitarbeiter.id)).toEqual([
      { gueltig_ab: "2026-01-01", kosten_je_stunde_cent: 3215 },
    ]);

    await zeile(page, "01.01.2026").getByRole("button", { name: "Löschen" }).click();
    await zeile(page, "01.01.2026").getByRole("button", { name: "Ja, löschen" }).click();
    await expect(page.getByText("Heute gilt: 26,00 € (Standard der Firma)")).toBeVisible();
    expect(await gespeicherteEigeneWerte(mitarbeiter.id)).toEqual([]);
    // Der Standard der Firma bleibt davon unberührt.
    expect(await gespeicherterStandard(firma.id)).toEqual([
      { gueltig_ab: "2026-01-01", kosten_je_stunde_cent: 2600 },
    ]);
  } finally {
    await entferneFirma(firma.id);
  }
});

for (const rolle of ["mitarbeiter", "vorarbeiter"] as const) {
  test(`Ein ${rolle === "mitarbeiter" ? "Mitarbeiter" : "Vorarbeiter"} sieht keine Arbeitgeberkosten, auch nicht die eigenen`, async ({
    page,
  }) => {
    const firma = await legeEigeneFirmaAn();
    try {
      const person = await legeEigenenZugangAn(firma.id, rolle);
      const dienst = dienstZugang()!;
      const standard = await dienst.from("arbeitgeberkosten_standard").insert({
        firma_id: firma.id,
        gueltig_ab: "2026-01-01",
        kosten_je_stunde_cent: 2600,
      });
      if (standard.error) throw standard.error;
      const eigener = await dienst.from("arbeitgeberkosten_mitarbeiter").insert({
        firma_id: firma.id,
        mitarbeiter_id: person.id,
        gueltig_ab: "2026-01-01",
        kosten_je_stunde_cent: 3100,
      });
      if (eigener.error) throw eigener.error;

      await meldeAn(page, person);
      await erwarteAngemeldet(page, person.name);

      await page.goto("/einstellungen");
      await expect(
        page.getByText("Die Einstellungen der Firma darf nur das Büro ändern."),
      ).toBeVisible();
      await page.goto(`/mitarbeiter/${person.id}`);
      await expect(page.getByText("Mitarbeiter verwalten darf nur das Büro.")).toBeVisible();

      for (const pfad of ["/", "/einstellungen", `/mitarbeiter/${person.id}`]) {
        await page.goto(pfad);
        await expect(page.getByText("Arbeitgeberkosten", { exact: false }), pfad).toHaveCount(0);
        await expect(page.getByText(/26,00|31,00/), pfad).toHaveCount(0);
      }
    } finally {
      await entferneFirma(firma.id);
    }
  });
}
