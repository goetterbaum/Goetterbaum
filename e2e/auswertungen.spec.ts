import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { erwarteAngemeldet, feld, meldeAn, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZusatzauftragAn,
} from "./testumgebung/testdaten";

// Im März 2026 gilt in Berlin bis zum 29. die Winterzeit (UTC + 1 Stunde).

function zeile(page: Page, ...texte: string[]) {
  return texte.reduce(
    (zeilen, text) => zeilen.filter({ hasText: text }),
    page.locator("tbody").getByRole("row"),
  );
}

// Der Inhalt einer heruntergeladenen CSV-Datei ohne das BOM am Anfang.
async function csvInhalt(datei: Download) {
  const inhalt = await readFile((await datei.path())!);
  expect(inhalt.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  return inhalt.toString("utf8").slice(1);
}

async function gebeFrei(ids: string[]) {
  const { error } = await dienstZugang()!
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .in("id", ids);
  if (error) throw error;
}

test("Das Büro lädt zu einer Rechnungsvorbereitung auf Nachfrage den Stundennachweis ohne Namen", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const pauschal = await legeKundeMitObjektAn(dienst, firmaA.id);
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
  const { data: kunde } = await dienst
    .from("kunde")
    .select("name")
    .eq("id", pauschal.kundeId)
    .single<{ name: string }>();
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id);
  const erster = await legeEigenenZugangAn(firmaA.id);
  const zweiter = await legeEigenenZugangAn(firmaA.id);
  const eintrag = (mitarbeiterId: string, objektId: string, beginn: string, ende: string) =>
    legeZeiteintragAn(dienst, {
      firmaId: firmaA.id,
      mitarbeiterId,
      objektId,
      taetigkeitId: taetigkeit.taetigkeitId,
      beginn,
      ende,
    });
  await gebeFrei([
    // 10.03.: 67:23 und gleichzeitig ein Kollege 20:18
    await eintrag(erster.id, stunden.id, "2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z"),
    await eintrag(zweiter.id, stunden.id, "2026-03-10T07:02:41Z", "2026-03-10T07:22:59Z"),
    // Über Mitternacht: 18:48 am 10.03., 12:05 am 11.03.
    await eintrag(erster.id, stunden.id, "2026-03-10T22:41:12Z", "2026-03-10T23:12:05Z"),
    // Mit der Pauschale bezahlt: nicht im Stundennachweis.
    await eintrag(erster.id, pauschal.objektId, "2026-03-12T08:00:17Z", "2026-03-12T10:30:44Z"),
  ]);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/rechnungsvorbereitung?kunde=${pauschal.kundeId}&monat=2026-03`);
  await expect(page.locator("tfoot")).toContainText(/Summe\s*567,50\s€/);
  await expect(page.getByText(/^Nur wenn der Kunde danach fragt/)).toBeVisible();

  const herunterladen = page.waitForEvent("download");
  await page.getByRole("link", { name: "Stundennachweis herunterladen (CSV-Datei)" }).click();
  const datei = await herunterladen;
  expect(datei.suggestedFilename()).toBe(`Stundennachweis ${kunde!.name} 2026-03.csv`);
  // Gerundet je Objekt, Tätigkeit und Tag: 106:29 → 120, 12:05 → 15.
  const inhalt = await csvInhalt(datei);
  expect(inhalt).toBe(
    "Datum;Objekt;Zusatzauftrag;Tätigkeit;Stunden;Minuten;Personen\r\n" +
      `10.03.2026;${stunden.bezeichnung};;${taetigkeit.name};2:00;120;2\r\n` +
      `11.03.2026;${stunden.bezeichnung};;${taetigkeit.name};0:15;15;1\r\n` +
      "Summe;;;;2:15;135;\r\n",
  );
  expect(inhalt).not.toContain(erster.name);
  expect(inhalt).not.toContain(zweiter.name);
});

test("Ohne berechnete Stunden gibt es keinen Stundennachweis", async ({ page }) => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  // Nur ein Pauschal-Objekt: Die Rechnungsvorbereitung hat nur die Pauschale.
  const { kundeId } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.goto(`/rechnungsvorbereitung?kunde=${kundeId}&monat=2026-03`);
  await expect(page.locator("tfoot")).toContainText(/Summe\s*500,00\s€/);
  await expect(
    page.getByRole("link", { name: "Stundennachweis herunterladen (CSV-Datei)" }),
  ).toHaveCount(0);
});

test("Das Büro sieht den Arbeitszeitnachweis eines deaktivierten Mitarbeiters mit Fahrten und Tagessummen und lädt ihn als CSV", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const ehemaliger = await legeEigenenZugangAn(firmaA.id);
  const { objektId, bezeichnung: objekt } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const taetigkeit = await legeTaetigkeitAn(dienst, firmaA.id);
  const eintrag = (beginn: string, ende: string | null, fahrt = false) =>
    legeZeiteintragAn(dienst, {
      firmaId: firmaA.id,
      mitarbeiterId: ehemaliger.id,
      ...(fahrt ? {} : { objektId, taetigkeitId: taetigkeit.taetigkeitId }),
      beginn,
      ende,
    });
  // Freigegeben oder nicht: Der Nachweis zeigt alle beendeten Einträge.
  await gebeFrei([await eintrag("2026-03-10T06:40:00Z", "2026-03-10T07:01:10Z", true)]);
  await eintrag("2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z");
  // Über Mitternacht, nachgetragen: 23:41:12 bis 00:12:05 in Berlin.
  const ueberMitternacht = await eintrag("2026-03-10T22:41:12Z", "2026-03-10T23:12:05Z");
  // Seit dem 31.03. vergessen zu stoppen: fehlt, löst die Warnung aus. Ein
  // späterer Eintrag dieses Mitarbeiters würde sich damit überschneiden;
  // die Grenze am Ende des Zeitraums prüfen die Unit-Tests.
  await eintrag("2026-03-31T05:00:12Z", null);
  const { error } = await dienst
    .from("zeiteintrag")
    .update({ nachtrag: true })
    .eq("id", ueberMitternacht);
  if (error) throw error;
  const { error: fehler } = await dienst
    .from("mitarbeiter")
    .update({ aktiv: false })
    .eq("id", ehemaliger.id);
  if (fehler) throw fehler;

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.getByRole("link", { name: "Arbeitszeitnachweis" }).click();
  await expect(page.getByRole("heading", { name: "Arbeitszeitnachweis" })).toBeVisible();
  await page
    .getByRole("combobox", { name: /^Mitarbeiter/ })
    .selectOption({ label: `${ehemaliger.name} (deaktiviert)` });
  await feld(page, "Von").fill("2026-03-01");
  await feld(page, "Bis").fill("2026-03-31");
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page).toHaveURL(
    new RegExp(`mitarbeiter=${ehemaliger.id}&von=2026-03-01&bis=2026-03-31`),
  );

  await expect(
    page.getByRole("heading", {
      name: `${ehemaliger.name} (deaktiviert): 01.03.2026 bis 31.03.2026`,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Achtung" })).toContainText(
    "1 Zeiteintrag im Zeitraum läuft noch",
  );
  await expect(page.locator("tbody").getByRole("row")).toHaveCount(6);
  await expect(zeile(page, "10.03.2026", "07:40", "08:01", "Fahrt")).toContainText("0:21 Std.");
  await expect(zeile(page, "10.03.2026", "08:02", "09:09", objekt)).toContainText("1:07 Std.");
  await expect(zeile(page, "10.03.2026", "23:41", "24:00", "Nachtrag")).toContainText("0:19 Std.");
  await expect(zeile(page, "Tagessumme 10.03.2026")).toContainText("1:47 Std.");
  await expect(zeile(page, "11.03.2026", "00:00", "00:12", "Nachtrag")).toContainText("0:12 Std.");
  await expect(zeile(page, "Tagessumme 11.03.2026")).toContainText("0:12 Std.");
  await expect(page.locator("tfoot")).toContainText(/Summe\s*1:59 Std\./);

  const herunterladen = page.waitForEvent("download");
  await page.getByRole("link", { name: "Als CSV-Datei herunterladen" }).click();
  const datei = await herunterladen;
  expect(datei.suggestedFilename()).toBe(
    `Arbeitszeitnachweis ${ehemaliger.name} 2026-03-01 bis 2026-03-31.csv`,
  );
  const was = `Tätigkeit;${objekt};${taetigkeit.name};`;
  expect(await csvInhalt(datei)).toBe(
    "Datum;Von;Bis;Art;Objekt;Tätigkeit;Zusatzauftrag;Nachtrag;Stunden;Minuten\r\n" +
      "10.03.2026;07:40;08:01;Fahrt;;;;;0:21;21\r\n" +
      `10.03.2026;08:02;09:09;${was};;1:07;67\r\n` +
      `10.03.2026;23:41;24:00;${was};Nachtrag;0:19;19\r\n` +
      "10.03.2026;;;Tagessumme;;;;;1:47;107\r\n" +
      `11.03.2026;00:00;00:12;${was};Nachtrag;0:12;12\r\n` +
      "11.03.2026;;;Tagessumme;;;;;0:12;12\r\n" +
      "Summe;;;;;;;;1:59;119\r\n",
  );
});

test("Das Büro sieht die tatsächlich erfasste Zeit eines Pauschal-Objekts je Tätigkeit", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const { kundeId, objektId, bezeichnung } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const { data: kunde } = await dienst
    .from("kunde")
    .select("name")
    .eq("id", kundeId)
    .single<{ name: string }>();
  const unterhalt = await legeTaetigkeitAn(dienst, firmaA.id);
  const glas = await legeTaetigkeitAn(dienst, firmaA.id);
  const { zusatzauftragId } = await legeZusatzauftragAn(dienst, firmaA.id, objektId);
  const erster = await legeEigenenZugangAn(firmaA.id);
  const zweiter = await legeEigenenZugangAn(firmaA.id);
  const eintrag = (
    mitarbeiterId: string,
    taetigkeitId: string,
    beginn: string,
    ende: string | null,
    mitZusatzauftrag = false,
  ) =>
    legeZeiteintragAn(dienst, {
      firmaId: firmaA.id,
      mitarbeiterId,
      objektId,
      taetigkeitId,
      ...(mitZusatzauftrag ? { zusatzauftragId } : {}),
      beginn,
      ende,
    });
  // 67:23 + 20:18 = 87:41 → 1:28
  await eintrag(erster.id, unterhalt.taetigkeitId, "2026-03-10T07:02:13Z", "2026-03-10T08:09:36Z");
  await eintrag(zweiter.id, unterhalt.taetigkeitId, "2026-03-10T07:02:41Z", "2026-03-10T07:22:59Z");
  // 44:51 → 0:45
  await eintrag(erster.id, glas.taetigkeitId, "2026-03-12T09:00:04Z", "2026-03-12T09:44:55Z");
  // Zusatzauftrag: 29:30 → 0:30, gesondert
  await eintrag(erster.id, glas.taetigkeitId, "2026-03-13T08:00:00Z", "2026-03-13T08:29:30Z", true);
  // Gehört schon in den April.
  await eintrag(erster.id, glas.taetigkeitId, "2026-04-02T06:58:09Z", "2026-04-02T08:01:33Z");
  // Seit März vergessen zu stoppen: fehlt, löst die Warnung aus.
  await eintrag(zweiter.id, glas.taetigkeitId, "2026-03-31T05:00:12Z", null);

  await meldeAn(page, buero);
  await erwarteAngemeldet(page, buero.name);
  await page.getByRole("link", { name: "Ist-Zeit der Pauschal-Objekte" }).click();
  await page
    .getByRole("combobox", { name: /^Pauschal-Objekt/ })
    .selectOption({ label: bezeichnung });
  await feld(page, "Von").fill("2026-03-01");
  await feld(page, "Bis").fill("2026-03-31");
  await page.getByRole("button", { name: "Anzeigen" }).click();

  await expect(
    page.getByRole("heading", { name: `${bezeichnung}: 01.03.2026 bis 31.03.2026` }),
  ).toBeVisible();
  await expect(
    // Zwischen Betrag und Euro-Zeichen steht ein geschütztes Leerzeichen.
    page.getByText(new RegExp(`^Kunde: ${kunde!.name} · Pauschale: 500,00\\s€ im Monat$`)),
  ).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Achtung" })).toContainText(
    "1 Zeiteintrag in diesem Objekt läuft noch",
  );
  await expect(page.locator("tbody").getByRole("row")).toHaveCount(2);
  await expect(zeile(page, unterhalt.name)).toContainText("1:28 Std.");
  await expect(zeile(page, glas.name)).toContainText("0:45 Std.");
  await expect(page.locator("tfoot")).toContainText(/Summe\s*2:13 Std\./);
  await expect(page.getByText(/^Dazu 0:30 Std\. für Zusatzaufträge/)).toBeVisible();
});

test("Mitarbeiter und Vorarbeiter sehen die Auswertungen nicht und bekommen keine Dateien", async ({
  page,
}) => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const { kundeId, objektId } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const { zusatzauftragId } = await legeZusatzauftragAn(dienst, firmaA.id, objektId);

  for (const rolle of ["mitarbeiter", "vorarbeiter"] as const) {
    const ich = await legeEigenenZugangAn(firmaA.id, rolle);
    await meldeAn(page, ich);
    await erwarteAngemeldet(page, ich.name);
    await expect(page.getByRole("link", { name: "Arbeitszeitnachweis" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ist-Zeit der Pauschal-Objekte" })).toHaveCount(0);

    await page.goto(`/auswertungen/arbeitszeitnachweis?mitarbeiter=${ich.id}`);
    await expect(page.getByText("Den Arbeitszeitnachweis darf nur das Büro sehen.")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
    await page.goto(`/auswertungen/ist-zeit?objekt=${objektId}`);
    await expect(
      page.getByText("Die Ist-Zeit der Pauschal-Objekte darf nur das Büro sehen."),
    ).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);

    for (const adresse of [
      `/auswertungen/arbeitszeitnachweis/csv?mitarbeiter=${ich.id}`,
      `/rechnungsvorbereitung/stundennachweis?kunde=${kundeId}&monat=2026-03`,
      `/rechnungsvorbereitung/zusatzauftrag/${zusatzauftragId}/stundennachweis`,
    ]) {
      expect((await page.request.get(adresse)).status(), `${rolle}: ${adresse}`).toBe(403);
    }
    await page.context().clearCookies();
  }
});

test("Das Büro einer anderen Firma bekommt keinen Arbeitszeitnachweis", async ({ page }) => {
  const { firmaA, firmaB } = testdaten();
  const fremder = await legeEigenenZugangAn(firmaA.id);
  await legeZeiteintragAn(dienstZugang()!, {
    firmaId: firmaA.id,
    mitarbeiterId: fremder.id,
    beginn: "2026-03-10T06:40:00Z",
    ende: "2026-03-10T07:01:10Z",
  });

  await meldeAn(page, firmaB.buero);
  await erwarteAngemeldet(page, firmaB.buero.name);
  await page.goto(
    `/auswertungen/arbeitszeitnachweis?mitarbeiter=${fremder.id}&von=2026-03-01&bis=2026-03-31`,
  );
  await expect(page.getByText("Diesen Mitarbeiter gibt es nicht.")).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  const antwort = await page.request.get(
    `/auswertungen/arbeitszeitnachweis/csv?mitarbeiter=${fremder.id}&von=2026-03-01&bis=2026-03-31`,
  );
  expect(antwort.status()).toBe(404);
});
