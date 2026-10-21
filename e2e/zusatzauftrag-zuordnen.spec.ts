import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { berlinerDatum, berlinerZeitpunkt } from "../src/lib/berliner-zeit";
import { erwarteAngemeldet, meldeAn, schnittstelleAls, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZusatzauftragAn,
} from "./testumgebung/testdaten";

// Gestern in Berlin, damit der Eintrag sicher in der Vergangenheit liegt.
const GESTERN = berlinerDatum(Date.now() - 24 * 60 * 60 * 1000);
// Ein Live-Zeitpunkt gestern, mit Sekunden.
const gesternUm = (uhrzeit: string, sekunden: number) =>
  new Date(berlinerZeitpunkt(GESTERN, uhrzeit) + sekunden * 1000).toISOString();

function zusatzauftragAuswahl(page: Page) {
  return page.getByRole("combobox", { name: "Zusatzauftrag" });
}

async function gespeicherteZuordnung(zeiteintragId: string) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("zusatzauftrag_id")
    .eq("id", zeiteintragId)
    .single<{ zusatzauftrag_id: string | null }>();
  return data!.zusatzauftrag_id;
}

test("Das Büro hängt einen freigegebenen Zeiteintrag beim Prüfen an einen anderen Zusatzauftrag und entfernt ihn wieder; beides steht im Protokoll", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const mitarbeiter = await legeEigenenZugangAn(firmaA.id);
  const { kundeId, objektId, bezeichnung } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id);
  const sturmschaden = await legeZusatzauftragAn(dienst, firmaA.id, objektId, {
    beschreibung: `Sturmschaden Dach ${randomUUID().slice(0, 8)}`,
  });
  const laub = await legeZusatzauftragAn(dienst, firmaA.id, objektId, {
    beschreibung: `Laub nach Sturm ${randomUUID().slice(0, 8)}`,
  });
  const erledigt = await legeZusatzauftragAn(dienst, firmaA.id, objektId, { erledigt: true });
  const id = await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: mitarbeiter.id,
    objektId,
    taetigkeitId: taetigkeit.taetigkeitId,
    zusatzauftragId: sturmschaden.zusatzauftragId,
    beginn: gesternUm("07:04", 31),
    ende: gesternUm("09:47", 12),
  });
  await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: new Date().toISOString() })
    .eq("id", id)
    .throwOnError();

  await meldeAn(page, firmaA.buero);
  await erwarteAngemeldet(page, firmaA.buero.name);
  await page.goto(`/zeiteintraege/${id}`);
  const was = `${bezeichnung} · ${taetigkeit.name}`;
  await expect(
    page.getByText(`${was} · Zusatzauftrag: ${sturmschaden.beschreibung}`),
  ).toBeVisible();

  // Zur Wahl stehen die offenen Zusatzaufträge des Objekts.
  const auswahl = zusatzauftragAuswahl(page);
  await expect(auswahl).toHaveValue(sturmschaden.zusatzauftragId);
  await expect(auswahl.locator("option")).toHaveText([
    "Kein Zusatzauftrag",
    sturmschaden.beschreibung,
    laub.beschreibung,
  ]);
  await expect(auswahl.locator("option", { hasText: erledigt.beschreibung })).toHaveCount(0);

  // Umhängen.
  await auswahl.selectOption({ label: laub.beschreibung });
  await page.getByRole("button", { name: "Zusatzauftrag speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Zusatzauftrag gespeichert.");
  await expect(page.getByText(`${was} · Zusatzauftrag: ${laub.beschreibung}`)).toBeVisible();
  const umgehaengt = page.getByRole("row").filter({
    hasText: `Zusatzauftrag: ${sturmschaden.beschreibung} → ${laub.beschreibung}`,
  });
  await expect(umgehaengt).toContainText(firmaA.buero.name);
  expect(await gespeicherteZuordnung(id)).toBe(laub.zusatzauftragId);

  // Entfernen.
  await auswahl.selectOption({ label: "Kein Zusatzauftrag" });
  await page.getByRole("button", { name: "Zusatzauftrag speichern" }).click();
  await expect(page.getByText(was, { exact: true })).toBeVisible();
  const entfernt = page
    .getByRole("row")
    .filter({ hasText: `Zusatzauftrag: ${laub.beschreibung} → –` });
  await expect(entfernt).toContainText(firmaA.buero.name);
  await expect(auswahl).toHaveValue("");
  expect(await gespeicherteZuordnung(id)).toBeNull();

  // Abgerechnet lässt er sich nicht mehr umhängen.
  const monat = GESTERN.slice(0, 7);
  const { error } = await (
    await schnittstelleAls(firmaA.buero)
  ).rpc("als_abgerechnet_markieren", {
    fuer_kunde: kundeId,
    ab_monat: `${monat}-01`,
    eintraege: [id],
    monate: [],
    aufstellung: [{ art: "pauschale", objektId, monat }],
    summe: 50000,
  });
  expect(error).toBeNull();
  await page.reload();
  await expect(page.getByText(/^Abgerechnet\./)).toBeVisible();
  await expect(auswahl).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zusatzauftrag speichern" })).toHaveCount(0);
});
