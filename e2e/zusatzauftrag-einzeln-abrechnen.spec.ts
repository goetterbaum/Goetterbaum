import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZusatzauftragAn,
} from "./testumgebung/testdaten";

// Ein Kunde mit einem Pauschal-Objekt (500 € im Monat), einem
// Stunden-Objekt und einer Tätigkeit zu 30 € die Stunde. Im Februar und
// März 2026 gilt in Berlin bis zum 29.03. die Winterzeit (UTC + 1 Stunde).
async function kunde(firmaId: string) {
  const dienst = dienstZugang()!;
  const pauschal = await legeKundeMitObjektAn(dienst, firmaId);
  const { data: stunden, error } = await dienst
    .from("objekt")
    .insert({
      firma_id: firmaId,
      kunde_id: pauschal.kundeId,
      bezeichnung: `Stunden-Objekt ${pauschal.bezeichnung}`,
      strasse: "Domplatz 3",
      plz: "50667",
      ort: "Köln",
      abrechnungsart: "stunden",
    })
    .select("id, bezeichnung")
    .single<{ id: string; bezeichnung: string }>();
  if (error) throw error;
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaId, { standardStundensatzCent: 3000 });
  const mitarbeiter = await legeEigenenZugangAn(firmaId);

  // Zugeordnet wird nur einem offenen Zusatzauftrag, erledigt wird er im
  // Test.
  const eintrag = async (
    objektId: string,
    beginn: string,
    ende: string,
    { zusatzauftragId, freigegeben = true }: { zusatzauftragId?: string; freigegeben?: boolean },
  ) => {
    const id = await legeZeiteintragAn(dienst, {
      firmaId,
      mitarbeiterId: mitarbeiter.id,
      objektId,
      taetigkeitId: taetigkeit.taetigkeitId,
      zusatzauftragId,
      beginn,
      ende,
    });
    if (freigegeben) {
      const { error } = await dienst
        .from("zeiteintrag")
        .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
        .eq("id", id);
      if (error) throw error;
    }
    return id;
  };

  return {
    kundeId: pauschal.kundeId,
    pauschal: { id: pauschal.objektId, bezeichnung: pauschal.bezeichnung },
    stunden,
    taetigkeit: taetigkeit.name,
    eintrag,
  };
}

function zeile(page: Page, ...texte: string[]) {
  return texte.reduce(
    (zeilen, text) => zeilen.filter({ hasText: text }),
    page.locator("table").filter({ hasText: "Stundensatz" }).locator("tbody").getByRole("row"),
  );
}

function abrechnung(page: Page, text: string) {
  return page.locator("table").filter({ hasText: "Status" }).getByRole("row").filter({
    hasText: text,
  });
}

async function csvVon(page: Page) {
  const herunterladen = page.waitForEvent("download");
  await page.getByRole("link", { name: "Als CSV-Datei herunterladen" }).click();
  const datei = await herunterladen;
  return (await readFile((await datei.path())!)).toString("utf8").slice(1);
}

async function erledigeUndOeffneEinzelAbrechnung(page: Page, zusatzauftragId: string) {
  await page.goto(`/zusatzauftraege/${zusatzauftragId}`);
  await expect(page.getByRole("link", { name: "Einzeln abrechnen" })).toHaveCount(0);
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();
  await page.getByRole("link", { name: "Einzeln abrechnen" }).click();
  await expect(
    page.getByRole("heading", { name: "Zusatzauftrag einzeln abrechnen" }),
  ).toBeVisible();
}

test("Ein erledigter Zusatzauftrag nach Stunden wird mit seiner Zeit aus allen Monaten einzeln abgerechnet und lässt sich zurücknehmen", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const k = await kunde(firmaA.id);
  const sturmschaden = await legeZusatzauftragAn(dienstZugang()!, firmaA.id, k.pauschal.id, {
    beschreibung: `Sturmschaden Dach ${randomUUID().slice(0, 8)}`,
  });
  const fuerSturmschaden = { zusatzauftragId: sturmschaden.zusatzauftragId };
  // 23.02., 08:03:41–09:10:57: 67 Minuten 16 Sekunden → 75 Minuten.
  await k.eintrag(k.pauschal.id, "2026-02-23T07:03:41Z", "2026-02-23T08:10:57Z", fuerSturmschaden);
  // 10.03., 08:02:13–09:09:36: 67 Minuten 23 Sekunden → 75 Minuten.
  await k.eintrag(k.pauschal.id, "2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z", fuerSturmschaden);
  // 16.03., 08:00:44–10:02:03: 121 Minuten 19 Sekunden → 135 Minuten.
  // Noch nicht freigegeben: Bis dahin lässt er sich nicht einzeln abrechnen.
  const spaet = await k.eintrag(k.pauschal.id, "2026-03-16T07:00:44Z", "2026-03-16T09:02:03Z", {
    ...fuerSturmschaden,
    freigegeben: false,
  });

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await erledigeUndOeffneEinzelAbrechnung(page, sturmschaden.zusatzauftragId);

  const wartet = page.getByRole("alert").filter({ hasText: "noch nicht freigegeben" });
  await expect(wartet).toHaveText(
    "1 Zeiteintrag dieses Zusatzauftrags ist noch nicht freigegeben. Einzeln abrechnen lässt sich ein Zusatzauftrag nach Stunden erst, wenn alle seine Zeiteinträge freigegeben sind.",
  );
  await expect(zeile(page, "Zusatzauftrag nach Stunden", sturmschaden.beschreibung)).toContainText(
    /2:30 Std\.\s*30,00\s€\s*75,00\s€/,
  );
  await expect(page.getByRole("button", { name: "Als abgerechnet markieren" })).toHaveCount(0);

  // Freigegeben gehört auch diese Zeit dazu.
  const freigabe = await dienstZugang()!
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-02T08:00:00Z" })
    .eq("id", spaet);
  if (freigabe.error) throw freigabe.error;
  await page.reload();
  await expect(zeile(page)).toHaveCount(1);
  await expect(wartet).toHaveCount(0);
  await expect(
    zeile(page, "Zusatzauftrag nach Stunden", k.pauschal.bezeichnung, sturmschaden.beschreibung),
  ).toContainText(new RegExp(`${k.taetigkeit}\\s*4:45 Std\\.\\s*30,00\\s€\\s*142,50\\s€`));
  await expect(page.locator("tfoot")).toContainText(/Summe\s*142,50\s€/);
  expect(await csvVon(page)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Monat;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Zusatzauftrag nach Stunden;${k.pauschal.bezeichnung};${sturmschaden.beschreibung};${k.taetigkeit};;4:45;285;30,00;142,50\r\n` +
      "Summe;;;;;;;;142,50\r\n",
  );

  await page.getByRole("button", { name: "Als abgerechnet markieren" }).click();
  await expect(
    page.getByText(
      "Für diesen Zusatzauftrag gibt es keine freigegebene, noch nicht abgerechnete Zeit.",
    ),
  ).toBeVisible();
  const einzeln = abrechnung(page, `Zusatzauftrag einzeln: ${sturmschaden.beschreibung}`);
  await expect(einzeln).toContainText(/142,50\s€/);
  await expect(einzeln).toContainText("gültig");

  // Auch die reguläre Rechnungsvorbereitung des Kunden zeigt nur noch die
  // Pauschale.
  await page.goto(`/rechnungsvorbereitung?kunde=${k.kundeId}&monat=2026-03`);
  await expect(zeile(page)).toHaveCount(1);
  await expect(zeile(page, "Pauschale", "März 2026")).toContainText("500,00 €");
  await expect(
    abrechnung(page, `Zusatzauftrag einzeln: ${sturmschaden.beschreibung}`),
  ).toBeVisible();

  // Nach der Rücknahme ist die Zeit wieder abrechenbar, einzeln wie regulär.
  await page.goto(`/rechnungsvorbereitung/zusatzauftrag/${sturmschaden.zusatzauftragId}`);
  await einzeln.getByRole("button", { name: "Zurücknehmen" }).click();
  await page.getByRole("button", { name: "Ja, zurücknehmen" }).click();
  await expect(einzeln).toContainText("zurückgenommen am");
  await expect(zeile(page, "Zusatzauftrag nach Stunden", sturmschaden.beschreibung)).toContainText(
    /4:45 Std\.\s*30,00\s€\s*142,50\s€/,
  );
  // Regulär nur die März-Zeit: 75 + 135 Minuten.
  await page.goto(`/rechnungsvorbereitung?kunde=${k.kundeId}&monat=2026-03`);
  await expect(zeile(page, "Zusatzauftrag nach Stunden", sturmschaden.beschreibung)).toContainText(
    /3:30 Std\.\s*30,00\s€\s*105,00\s€/,
  );
});

test("Ein erledigter Zusatzauftrag mit Festbetrag wird einzeln abgerechnet, ist dann gesperrt und lässt sich zurücknehmen", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const k = await kunde(firmaA.id);
  const grundreinigung = await legeZusatzauftragAn(dienstZugang()!, firmaA.id, k.stunden.id, {
    beschreibung: `Grundreinigung nach Umbau ${randomUUID().slice(0, 8)}`,
    festbetragCent: 89000,
  });
  const fuerGrundreinigung = { zusatzauftragId: grundreinigung.zusatzauftragId };
  // Reguläre Zeit: 10.03., 08:02:41–08:22:59, 20 Minuten 18 Sekunden → 30.
  await k.eintrag(k.stunden.id, "2026-03-10T07:02:41Z", "2026-03-10T07:22:59Z", {});
  // Zeit für den Festbetrag, auch schon im Februar.
  const februar = await k.eintrag(
    k.stunden.id,
    "2026-02-23T07:03:41Z",
    "2026-02-23T11:47:12Z",
    fuerGrundreinigung,
  );
  await k.eintrag(k.stunden.id, "2026-03-11T07:00:51Z", "2026-03-11T09:31:20Z", fuerGrundreinigung);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);

  // Noch offen lässt er sich nicht einzeln abrechnen.
  await page.goto(`/rechnungsvorbereitung/zusatzauftrag/${grundreinigung.zusatzauftragId}`);
  await expect(
    page.getByText(/^Dieser Zusatzauftrag ist noch offen\. Einzeln abrechnen/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Als abgerechnet markieren" })).toHaveCount(0);

  await erledigeUndOeffneEinzelAbrechnung(page, grundreinigung.zusatzauftragId);
  await expect(zeile(page)).toHaveCount(1);
  const festbetrag = zeile(page, "Zusatzauftrag mit Festbetrag", grundreinigung.beschreibung);
  await expect(festbetrag).toContainText(k.stunden.bezeichnung);
  await expect(festbetrag).toContainText("890,00 €");
  await expect(festbetrag).not.toContainText("Std.");
  await expect(page.locator("tfoot")).toContainText(/Summe\s*890,00\s€/);
  expect(await csvVon(page)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Monat;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Zusatzauftrag mit Festbetrag;${k.stunden.bezeichnung};${grundreinigung.beschreibung};;;;;;890,00\r\n` +
      "Summe;;;;;;;;890,00\r\n",
  );

  await page.getByRole("button", { name: "Als abgerechnet markieren" }).click();
  await expect(page.getByText("Dieser Zusatzauftrag ist schon abgerechnet.")).toBeVisible();

  // Die reguläre Rechnungsvorbereitung zeigt nur Pauschale und reguläre
  // Stunden; die Zeit für den Festbetrag ist gesperrt.
  await page.goto(`/rechnungsvorbereitung?kunde=${k.kundeId}&monat=2026-03`);
  await expect(zeile(page)).toHaveCount(2);
  await expect(zeile(page, "Stunden", k.stunden.bezeichnung, k.taetigkeit)).toContainText(
    /0:30 Std\.\s*30,00\s€\s*15,00\s€/,
  );
  await expect(page.locator("tfoot")).toContainText(/Summe\s*515,00\s€/);
  await page.goto(`/zeiteintraege/${februar}`);
  await expect(
    page.getByText(/^Abgerechnet\. Der Zeiteintrag ist für alle gesperrt/),
  ).toBeVisible();

  await page.goto(`/zusatzauftraege/${grundreinigung.zusatzauftragId}`);
  await expect(page.getByText("erledigt und abgerechnet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Einzeln abrechnen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toHaveCount(0);

  // Nach der Rücknahme ist der Festbetrag wieder abrechenbar.
  await page.goto(`/rechnungsvorbereitung/zusatzauftrag/${grundreinigung.zusatzauftragId}`);
  const einzeln = abrechnung(page, `Zusatzauftrag einzeln: ${grundreinigung.beschreibung}`);
  await expect(einzeln).toContainText(/890,00\s€/);
  await einzeln.getByRole("button", { name: "Zurücknehmen" }).click();
  await page.getByRole("button", { name: "Ja, zurücknehmen" }).click();
  await expect(einzeln).toContainText("zurückgenommen am");
  await expect(
    zeile(page, "Zusatzauftrag mit Festbetrag", grundreinigung.beschreibung),
  ).toContainText("890,00 €");
  await expect(page.getByRole("button", { name: "Als abgerechnet markieren" })).toBeVisible();

  await page.goto(`/zusatzauftraege/${grundreinigung.zusatzauftragId}`);
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Einzeln abrechnen" })).toBeVisible();
});
