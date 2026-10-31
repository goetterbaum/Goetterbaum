import { expect, test } from "@playwright/test";
import { schnittstelleAls, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZusatzauftragAn,
} from "./testumgebung/testdaten";

// Diese Tests gehen an der App vorbei direkt auf die öffentliche
// Supabase-Schnittstelle. Sie prüfen, dass die Datenbank den eigenen
// Stundensatz eines Zusatzauftrags selbst schützt (#61).

// Der gespeicherte Stand, am eigenen Zugang vorbei gelesen.
async function gespeicherterSatz(id: string) {
  const { data, error } = await dienstZugang()!
    .from("zusatzauftrag")
    .select("abrechnungsart, stundensatz_cent")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

test("Ein Stundensatz des Zusatzauftrags ist nur ein Betrag über 0 € und nur nach Stunden", async () => {
  const { firmaA } = testdaten();
  const { objektId } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);
  const supabase = await schnittstelleAls(firmaA.buero);
  const neu = {
    firma_id: firmaA.id,
    objekt_id: objektId,
    beschreibung: "Sturmschaden Hof",
    abrechnungsart: "stunden",
  };

  for (const falsch of [
    { stundensatz_cent: 0 },
    { stundensatz_cent: -100 },
    { abrechnungsart: "festbetrag", festbetrag_cent: 89000, stundensatz_cent: 5250 },
  ]) {
    const { error } = await supabase.from("zusatzauftrag").insert({ ...neu, ...falsch });
    expect(error?.code, JSON.stringify(falsch)).toBe("23514");
  }

  const { data, error } = await supabase
    .from("zusatzauftrag")
    .insert({ ...neu, stundensatz_cent: 5250 })
    .select("id")
    .single<{ id: string }>();
  expect(error).toBeNull();

  // Ändern und leeren geht, solange keine Zeit abgerechnet ist.
  for (const stundensatz_cent of [4875, null, 5250]) {
    const geaendert = await supabase
      .from("zusatzauftrag")
      .update({ stundensatz_cent })
      .eq("id", data!.id)
      .select("id");
    expect(geaendert.error, String(stundensatz_cent)).toBeNull();
    expect(geaendert.data, String(stundensatz_cent)).toHaveLength(1);
  }

  // Beim Wechsel auf Festbetrag muss der Satz entfallen.
  const mitSatz = await supabase
    .from("zusatzauftrag")
    .update({ abrechnungsart: "festbetrag", festbetrag_cent: 89000 })
    .eq("id", data!.id);
  expect(mitSatz.error?.code).toBe("23514");
  const ohneSatz = await supabase
    .from("zusatzauftrag")
    .update({ abrechnungsart: "festbetrag", festbetrag_cent: 89000, stundensatz_cent: null })
    .eq("id", data!.id);
  expect(ohneSatz.error).toBeNull();
  expect(await gespeicherterSatz(data!.id)).toEqual({
    abrechnungsart: "festbetrag",
    stundensatz_cent: null,
  });
});

for (const rolle of ["mitarbeiter", "vorarbeiter"] as const) {
  test(`Ein ${rolle === "mitarbeiter" ? "Mitarbeiter" : "Vorarbeiter"} sieht den Stundensatz eines Zusatzauftrags nicht und ändert ihn nicht`, async () => {
    const { firmaA } = testdaten();
    const dienst = dienstZugang()!;
    const { objektId } = await legeKundeMitObjektAn(dienst, firmaA.id);
    const { zusatzauftragId } = await legeZusatzauftragAn(dienst, firmaA.id, objektId, {
      stundensatzCent: 5250,
    });
    const supabase = await schnittstelleAls(firmaA[rolle]);

    // Zur Auswahl ohne Abrechnung und Satz.
    const { data: auswahl } = await supabase.rpc("zusatzauftraege_zur_auswahl");
    expect(auswahl.find((z: { id: string }) => z.id === zusatzauftragId)).toEqual({
      id: zusatzauftragId,
      objekt_id: objektId,
      beschreibung: expect.any(String),
    });
    expect(
      (await supabase.from("zusatzauftrag").select("stundensatz_cent").eq("id", zusatzauftragId))
        .data,
    ).toEqual([]);

    const geaendert = await supabase
      .from("zusatzauftrag")
      .update({ stundensatz_cent: 100 })
      .eq("id", zusatzauftragId)
      .select("id");
    expect(geaendert.error).toBeNull();
    expect(geaendert.data).toEqual([]);
    expect(await gespeicherterSatz(zusatzauftragId)).toMatchObject({ stundensatz_cent: 5250 });
  });
}

test("Das Büro einer fremden Firma sieht den Stundensatz eines Zusatzauftrags nicht und ändert ihn nicht", async () => {
  const { firmaA, firmaB } = testdaten();
  const { objektId } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);
  const { zusatzauftragId } = await legeZusatzauftragAn(dienstZugang()!, firmaA.id, objektId, {
    stundensatzCent: 5250,
  });
  const fremd = await schnittstelleAls(firmaB.buero);

  expect(
    (await fremd.from("zusatzauftrag").select("stundensatz_cent").eq("id", zusatzauftragId)).data,
  ).toEqual([]);
  const geaendert = await fremd
    .from("zusatzauftrag")
    .update({ stundensatz_cent: 100 })
    .eq("id", zusatzauftragId)
    .select("id");
  expect(geaendert.data).toEqual([]);
  expect(await gespeicherterSatz(zusatzauftragId)).toMatchObject({ stundensatz_cent: 5250 });
});

test("Ist Zeit eines Zusatzauftrags abgerechnet, bleibt sein Stundensatz, bis die Abrechnung zurückgenommen ist", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const { objektId } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaA.id);
  const mitarbeiter = await legeEigenenZugangAn(firmaA.id);
  const { zusatzauftragId } = await legeZusatzauftragAn(dienst, firmaA.id, objektId, {
    stundensatzCent: 5250,
  });
  const eintrag = await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: mitarbeiter.id,
    objektId,
    taetigkeitId,
    zusatzauftragId,
    beginn: "2026-03-11T07:00:51Z",
    ende: "2026-03-11T09:31:20Z",
  });
  await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .eq("id", eintrag)
    .throwOnError();
  await dienst
    .from("zusatzauftrag")
    .update({ erledigt: true })
    .eq("id", zusatzauftragId)
    .throwOnError();
  const alsBuero = await schnittstelleAls(firmaA.buero);

  const { data: abrechnungId, error } = await alsBuero.rpc("zusatzauftrag_einzeln_abrechnen", {
    welcher: zusatzauftragId,
    eintraege: [eintrag],
    aufstellung: [{ art: "zusatzauftrag-stunden", zusatzauftragId }],
    summe: 13125,
  });
  expect(error).toBeNull();

  // Für niemanden änderbar, auch nicht mit dem Dienstschlüssel.
  for (const stundensatz_cent of [4875, null]) {
    const geaendert = await alsBuero
      .from("zusatzauftrag")
      .update({ stundensatz_cent })
      .eq("id", zusatzauftragId);
    expect(geaendert.error?.code, String(stundensatz_cent)).toBe("23514");
  }
  const perDienst = await dienst
    .from("zusatzauftrag")
    .update({ stundensatz_cent: 4875 })
    .eq("id", zusatzauftragId);
  expect(perDienst.error?.code).toBe("23514");
  // Anderes ändert sich weiter, auch mit demselben Satz.
  const beschreibung = await alsBuero
    .from("zusatzauftrag")
    .update({ beschreibung: "Sturmschaden Hof Nordseite", stundensatz_cent: 5250 })
    .eq("id", zusatzauftragId);
  expect(beschreibung.error).toBeNull();
  expect(await gespeicherterSatz(zusatzauftragId)).toMatchObject({ stundensatz_cent: 5250 });

  expect(
    (await alsBuero.rpc("abrechnung_zuruecknehmen", { welche: abrechnungId })).error,
  ).toBeNull();
  const nachRuecknahme = await alsBuero
    .from("zusatzauftrag")
    .update({ stundensatz_cent: 4875 })
    .eq("id", zusatzauftragId);
  expect(nachRuecknahme.error).toBeNull();
  expect(await gespeicherterSatz(zusatzauftragId)).toMatchObject({ stundensatz_cent: 4875 });
});
