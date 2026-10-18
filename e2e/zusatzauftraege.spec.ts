import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZusatzauftragAn,
} from "./testumgebung/testdaten";

// Zusatzaufträge (#17): Das Büro legt sie am Objekt an, Mitarbeiter wählen
// offene beim Start und Nachtrag, das Büro ändert die Zuordnung beim
// Prüfen, und abgerechnet wird nach Stunden oder mit Festbetrag, mit dem
// Zeitraum oder einzeln. Im März gilt in Berlin bis zum 29. die Winterzeit
// (UTC + 1 Stunde), danach die Sommerzeit (UTC + 2 Stunden).

async function gebeFrei(ids: string[]) {
  const { error } = await dienstZugang()!
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-05T08:00:00Z" })
    .in("id", ids);
  if (error) throw error;
}

async function zeiteintraege(ids: string[]) {
  const { data, error } = await dienstZugang()!
    .from("zeiteintrag")
    .select("id, zusatzauftrag_id, abgerechnet_in")
    .in("id", ids)
    .returns<{ id: string; zusatzauftrag_id: string | null; abgerechnet_in: string | null }[]>();
  if (error) throw error;
  return ids.map((id) => data.find((z) => z.id === id)!);
}

async function kundenName(kundeId: string) {
  const { data, error } = await dienstZugang()!
    .from("kunde")
    .select("name")
    .eq("id", kundeId)
    .single<{ name: string }>();
  if (error) throw error;
  return data.name;
}

function zeile(bereich: ReturnType<Page["locator"]>, ...texte: string[]) {
  return texte.reduce(
    (zeilen, text) => zeilen.filter({ hasText: text }),
    bereich.locator("tbody").getByRole("row"),
  );
}

test("Das Büro legt einen Zusatzauftrag am Objekt an, bearbeitet ihn und markiert ihn als erledigt", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const { objektId } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/objekte/${objektId}`);
  const bereich = page.getByRole("region", { name: "Zusatzaufträge" });
  await expect(
    bereich.getByText("Für dieses Objekt gibt es noch keine Zusatzaufträge."),
  ).toBeVisible();

  // Das Feld für den Festbetrag gibt es nur bei Abrechnungsart Festbetrag.
  await expect(bereich.getByLabel("Festbetrag in Euro")).toHaveCount(0);
  await bereich.getByLabel("Beschreibung").fill("Grundreinigung nach Umbau");
  await bereich.getByRole("combobox", { name: "Abrechnungsart" }).selectOption({
    label: "Festbetrag",
  });
  await bereich.getByLabel("Festbetrag in Euro").fill("1.890,5");
  await bereich.getByRole("button", { name: "Anlegen" }).click();
  await expect(bereich.getByRole("status")).toHaveText("Zusatzauftrag angelegt.");
  const angelegt = zeile(bereich, "Grundreinigung nach Umbau");
  await expect(angelegt).toContainText(/Festbetrag 1\.890,50\s€/);
  await expect(angelegt).toContainText("offen");

  await angelegt.getByRole("link", { name: "Grundreinigung nach Umbau" }).click();
  await expect(page.getByRole("heading", { name: "Grundreinigung nach Umbau" })).toBeVisible();
  await feld(page, "Beschreibung").fill("Grundreinigung nach Umbau, 2. OG");
  await feld(page, "Festbetrag in Euro").fill("2.100");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Grundreinigung nach Umbau, 2. OG" }),
  ).toBeVisible();
  await expect(page.getByText(/Festbetrag 2\.100,00\s€ · offen/)).toBeVisible();

  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByText(/^Erledigt: Mitarbeiter und Vorarbeiter/)).toBeVisible();
  await expect(page.getByText(/Festbetrag 2\.100,00\s€ · erledigt/)).toBeVisible();
  // Bis zur Abrechnung lässt sich das zurücknehmen.
  await page.getByRole("button", { name: "Wieder öffnen" }).click();
  await expect(page.getByText(/Festbetrag 2\.100,00\s€ · offen/)).toBeVisible();

  await page.getByRole("link", { name: "Zurück zum Objekt" }).click();
  await expect(zeile(bereich, "Grundreinigung nach Umbau, 2. OG")).toContainText("offen");
});

test("Beim Start und Nachtrag stehen nur offene Zusatzaufträge des gewählten Objekts zur Auswahl", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await legeKundeMitObjektAn(dienst, firmaA.id);
  const anderes = await legeKundeMitObjektAn(dienst, firmaA.id);
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id);
  const offen = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId);
  // Erledigt: steht nicht zur Wahl.
  await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId, { erledigt: true });
  const fremd = await legeZusatzauftragAn(dienst, firmaA.id, anderes.objektId);
  const optionen = page.getByRole("combobox", { name: /^Zusatzauftrag/ }).locator("option");

  await meldeAn(page, ich);
  await erwarteAngemeldet(page, ich.name);
  const waehleObjekt = async (bezeichnung: string) => {
    await feld(page, "Objekt suchen").fill(bezeichnung);
    await page.getByRole("radio", { name: new RegExp(bezeichnung) }).check();
  };

  await waehleObjekt(anderes.bezeichnung);
  await expect(optionen).toHaveText(["Kein Zusatzauftrag", fremd.beschreibung]);
  await waehleObjekt(objekt.bezeichnung);
  // Weder der erledigte noch der des anderen Objekts.
  await expect(optionen).toHaveText(["Kein Zusatzauftrag", offen.beschreibung]);
  await page.getByRole("combobox", { name: /^Tätigkeit/ }).selectOption({ label: taetigkeit.name });
  await page
    .getByRole("combobox", { name: /^Zusatzauftrag/ })
    .selectOption({ label: offen.beschreibung });
  await page.getByRole("button", { name: "Start", exact: true }).click();

  const wasUndWo = `${objekt.bezeichnung} · ${taetigkeit.name} · Zusatzauftrag: ${offen.beschreibung}`;
  await expect(page.getByRole("status").getByText(wasUndWo)).toBeVisible();
  await page.getByRole("button", { name: "Stopp" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: wasUndWo })).toHaveCount(1);

  // Ein Nachtrag von gestern (in Berlin), ebenfalls für den Zusatzauftrag.
  const [jahr, monat, tag] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" })
    .format(new Date())
    .split("-")
    .map(Number);
  const gestern = new Date(Date.UTC(jahr, monat - 1, tag - 1)).toISOString().slice(0, 10);
  await page.getByRole("link", { name: "Zeit nachtragen" }).click();
  await waehleObjekt(objekt.bezeichnung);
  await page.getByRole("combobox", { name: /^Tätigkeit/ }).selectOption({ label: taetigkeit.name });
  await expect(optionen).toHaveText(["Kein Zusatzauftrag", offen.beschreibung]);
  await page
    .getByRole("combobox", { name: /^Zusatzauftrag/ })
    .selectOption({ label: offen.beschreibung });
  await feld(page, "Datum").fill(gestern);
  await feld(page, "Von").fill("08:00");
  await feld(page, "Bis").fill("09:30");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(/\/$/);

  const { data } = await dienst
    .from("zeiteintrag")
    .select("objekt_id, zusatzauftrag_id, nachtrag")
    .eq("mitarbeiter_id", ich.id)
    .order("beginn");
  expect(data).toEqual([
    { objekt_id: objekt.objektId, zusatzauftrag_id: offen.zusatzauftragId, nachtrag: true },
    { objekt_id: objekt.objektId, zusatzauftrag_id: offen.zusatzauftragId, nachtrag: false },
  ]);
});

test("Pauschal-Objekt mit Zusatzauftrag nach Stunden: Das Büro ordnet beim Prüfen zu und rechnet ihn nach Erledigung einzeln ab", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const mitarbeiter = await legeEigenenZugangAn(firmaA.id);
  const objekt = await legeKundeMitObjektAn(dienst, firmaA.id);
  const kunde = await kundenName(objekt.kundeId);
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id, { standardStundensatzCent: 3000 });
  const sturm = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId);
  const laub = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId, { erledigt: true });
  const eintrag = (beginn: string, ende: string, zusatzauftragId?: string) =>
    legeZeiteintragAn(dienst, {
      firmaId: firmaA.id,
      mitarbeiterId: mitarbeiter.id,
      objektId: objekt.objektId,
      taetigkeitId: taetigkeit.taetigkeitId,
      zusatzauftragId,
      beginn,
      ende,
    });
  // 10.03., 08:02:13–09:09:36: 67 Minuten → 75. Der Mitarbeiter hat den
  // Zusatzauftrag vergessen.
  const maerz = await eintrag("2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z");
  // 02.04., 08:58:09–10:01:33: 63 Minuten → 75.
  const april = await eintrag(
    "2026-04-02T06:58:09Z",
    "2026-04-02T08:01:33Z",
    sturm.zusatzauftragId,
  );
  await gebeFrei([maerz, april]);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);

  // Beim Prüfen stehen auch erledigte, noch nicht abgerechnete zur Wahl.
  await page.goto(`/zeiteintraege/${maerz}`);
  const auswahl = page.getByRole("combobox", { name: /^Zusatzauftrag/ });
  await expect(auswahl.locator("option")).toHaveCount(3);
  expect(await auswahl.locator("option").allTextContents()).toEqual(
    expect.arrayContaining([
      "Kein Zusatzauftrag",
      sturm.beschreibung,
      `${laub.beschreibung} (erledigt)`,
    ]),
  );
  await auswahl.selectOption({ label: sturm.beschreibung });
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Zuordnung gespeichert." }),
  ).toBeVisible();
  await expect(page.getByText(`Zusatzauftrag: – → ${sturm.beschreibung}`)).toBeVisible();
  await expect(
    page.getByText(
      `${objekt.bezeichnung} · ${taetigkeit.name} · Zusatzauftrag: ${sturm.beschreibung}`,
    ),
  ).toBeVisible();

  // Im März: die Pauschale und, getrennt, der Zusatzauftrag nach Stunden.
  await page.goto(`/rechnungsvorbereitung?kunde=${objekt.kundeId}&monat=2026-03`);
  const maerzBereich = page.getByRole("region", { name: `${kunde}: März 2026` });
  await expect(maerzBereich.locator("tbody").getByRole("row")).toHaveCount(2);
  await expect(zeile(maerzBereich, "Pauschale", "März 2026")).toContainText("500,00 €");
  await expect(
    zeile(maerzBereich, "Zusatzauftrag nach Stunden", sturm.beschreibung, taetigkeit.name),
  ).toContainText(/1:15 Std\.\s*30,00\s€\s*37,50\s€/);
  await expect(maerzBereich.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);

  const herunterladen = page.waitForEvent("download");
  await maerzBereich.getByRole("link", { name: "Als CSV-Datei herunterladen" }).click();
  const inhalt = await readFile((await (await herunterladen).path())!);
  expect(inhalt.toString("utf8").slice(1)).toBe(
    "Position;Objekt;Zusatzauftrag;Tätigkeit;Monat;Stunden;Minuten;Stundensatz;Betrag\r\n" +
      `Pauschale;${objekt.bezeichnung};;;März 2026;;;;500,00\r\n` +
      `Zusatzauftrag nach Stunden;${objekt.bezeichnung};${sturm.beschreibung};${taetigkeit.name};;1:15;75;30,00;37,50\r\n` +
      "Summe;;;;;;;;537,50\r\n",
  );

  // Noch offen: keine Einzelabrechnung.
  const einzeln = page.getByRole("region", { name: "Erledigte Zusatzaufträge einzeln abrechnen" });
  await expect(einzeln.getByRole("region", { name: sturm.beschreibung })).toHaveCount(0);

  await page.goto(`/zusatzauftraege/${sturm.zusatzauftragId}`);
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();

  // Einzeln: all seine Zeit, egal aus welchem Monat, 150 Minuten zu 30 €.
  await page.goto(`/rechnungsvorbereitung?kunde=${objekt.kundeId}&monat=2026-03`);
  const sturmBereich = einzeln.getByRole("region", { name: sturm.beschreibung });
  await expect(sturmBereich.getByRole("heading")).toHaveText(
    `${sturm.beschreibung} (${objekt.bezeichnung})`,
  );
  await expect(zeile(sturmBereich, "Zusatzauftrag nach Stunden")).toContainText(
    /2:30 Std\.\s*30,00\s€\s*75,00\s€/,
  );
  await sturmBereich.getByRole("button", { name: "Einzeln abrechnen" }).click();

  // Danach erscheint er nicht erneut, weder einzeln noch im März.
  await expect(sturmBereich).toHaveCount(0);
  await expect(
    einzeln.getByText(
      "Für diesen Kunden wartet kein erledigter Zusatzauftrag auf seine Abrechnung.",
    ),
  ).toBeVisible();
  await expect(maerzBereich.locator("tbody").getByRole("row")).toHaveCount(1);
  await expect(maerzBereich.locator("tfoot")).toContainText(/Summe\s*500,00\s€/);
  const abrechnungen = page.locator("table").filter({ hasText: "Status" });
  await expect(
    abrechnungen.getByRole("row").filter({ hasText: `Zusatzauftrag: ${sturm.beschreibung}` }),
  ).toContainText(/75,00\s€.*gültig/);

  const [m, a] = await zeiteintraege([maerz, april]);
  expect(m.abgerechnet_in).not.toBeNull();
  expect(a.abgerechnet_in).toBe(m.abgerechnet_in);

  // Abgerechnet: gesperrt, und die Zuordnung lässt sich nicht mehr ändern.
  await page.goto(`/zusatzauftraege/${sturm.zusatzauftragId}`);
  await expect(page.getByText(/^Dieser Zusatzauftrag ist abgerechnet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);
  await page.goto(`/zeiteintraege/${maerz}`);
  await expect(page.getByRole("combobox", { name: /^Zusatzauftrag/ })).toHaveCount(0);
});

test("Stunden-Objekt mit Festbetrag: Erst wenn alle Zeit freigegeben ist, erscheint der erledigte Zusatzauftrag und wird mit dem Zeitraum abgerechnet", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const mitarbeiter = await legeEigenenZugangAn(firmaA.id);
  const pauschal = await legeKundeMitObjektAn(dienst, firmaA.id);
  const kunde = await kundenName(pauschal.kundeId);
  const { data: stunden, error } = await dienst
    .from("objekt")
    .insert({
      firma_id: firmaA.id,
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
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id, { standardStundensatzCent: 3000 });
  const grund = await legeZusatzauftragAn(dienst, firmaA.id, stunden.id, {
    festbetragCent: 89000,
  });
  const eintrag = (beginn: string, ende: string, zusatzauftragId?: string) =>
    legeZeiteintragAn(dienst, {
      firmaId: firmaA.id,
      mitarbeiterId: mitarbeiter.id,
      objektId: stunden.id,
      taetigkeitId: taetigkeit.taetigkeitId,
      zusatzauftragId,
      beginn,
      ende,
    });
  // Für den Festbetrag, schon im Februar begonnen.
  const februar = await eintrag(
    "2026-02-25T07:00:12Z",
    "2026-02-25T15:00:47Z",
    grund.zusatzauftragId,
  );
  const maerz = await eintrag(
    "2026-03-03T07:00:05Z",
    "2026-03-03T11:00:31Z",
    grund.zusatzauftragId,
  );
  // Reguläre Zeit: 67 Minuten → 75.
  const regulaer = await eintrag("2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z");
  await gebeFrei([februar, maerz, regulaer]);
  // Noch nicht freigegeben.
  const spaet = await eintrag(
    "2026-03-04T07:00:44Z",
    "2026-03-04T09:00:02Z",
    grund.zusatzauftragId,
  );

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  const adresse = `/rechnungsvorbereitung?kunde=${pauschal.kundeId}&monat=2026-03`;
  const bereich = page.getByRole("region", { name: `${kunde}: März 2026` });
  const einzeln = page.getByRole("region", { name: "Erledigte Zusatzaufträge einzeln abrechnen" });

  // Noch offen: Seine Zeit wird weder nach Stunden noch als Festbetrag berechnet.
  await page.goto(adresse);
  await expect(bereich.locator("tbody").getByRole("row")).toHaveCount(2);
  await expect(zeile(bereich, "Stunden", taetigkeit.name)).toContainText(
    /1:15 Std\.\s*30,00\s€\s*37,50\s€/,
  );
  await expect(bereich.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);

  await page.goto(`/zusatzauftraege/${grund.zusatzauftragId}`);
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();

  // Erledigt, aber ein Eintrag ist noch nicht freigegeben.
  await page.goto(adresse);
  await expect(
    bereich.getByRole("alert").filter({ hasText: `„${grund.beschreibung}“` }),
  ).toContainText("noch nicht freigegebene Zeiteinträge");
  await expect(bereich.locator("tfoot")).toContainText(/Summe\s*537,50\s€/);
  const grundBereich = einzeln.getByRole("region", { name: grund.beschreibung });
  await expect(grundBereich.getByRole("alert")).toHaveText(
    "1 Zeiteintrag dieses Zusatzauftrags ist noch nicht freigegeben. Abrechnen lässt er sich erst danach.",
  );
  await expect(grundBereich.getByRole("button", { name: "Einzeln abrechnen" })).toHaveCount(0);

  await gebeFrei([spaet]);
  await page.reload();
  await expect(bereich.getByRole("alert").filter({ hasText: grund.beschreibung })).toHaveCount(0);
  await expect(bereich.locator("tbody").getByRole("row")).toHaveCount(3);
  await expect(zeile(bereich, "Zusatzauftrag mit Festbetrag", grund.beschreibung)).toContainText(
    "890,00 €",
  );
  await expect(bereich.locator("tfoot")).toContainText(/Summe\s*1\.427,50\s€/);
  await expect(grundBereich.getByRole("button", { name: "Einzeln abrechnen" })).toBeVisible();

  // Mit dem Zeitraum abgerechnet, samt der Zeit aus dem Februar.
  await bereich.getByRole("button", { name: "Als abgerechnet markieren" }).click();
  await expect(bereich.getByText("In diesem Zeitraum gibt es nichts abzurechnen.")).toBeVisible();
  await expect(grundBereich).toHaveCount(0);
  const alle = await zeiteintraege([februar, maerz, spaet, regulaer]);
  expect(alle[0].abgerechnet_in).not.toBeNull();
  expect(alle.map((z) => z.abgerechnet_in)).toEqual(alle.map(() => alle[0].abgerechnet_in));
  const { data: abgeschlossen } = await dienst
    .from("zusatzauftrag")
    .select("abgerechnet_in")
    .eq("id", grund.zusatzauftragId)
    .single<{ abgerechnet_in: string | null }>();
  expect(abgeschlossen?.abgerechnet_in).toBe(alle[0].abgerechnet_in);

  await page.goto(`/rechnungsvorbereitung?kunde=${pauschal.kundeId}&monat=2026-02`);
  const februarBereich = page.getByRole("region", { name: `${kunde}: Februar 2026` });
  await expect(februarBereich.locator("tbody").getByRole("row")).toHaveCount(1);
  await expect(zeile(februarBereich, "Pauschale", "Februar 2026")).toContainText("500,00 €");
});
