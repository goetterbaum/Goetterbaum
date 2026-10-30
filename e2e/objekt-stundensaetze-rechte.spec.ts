import { expect, test } from "@playwright/test";
import { schnittstelleAls, testdaten } from "./testumgebung/hilfen";
import { dienstZugang, legeKundeMitObjektAn, legeTaetigkeitAn } from "./testumgebung/testdaten";

// Diese Tests gehen an der App vorbei direkt auf die öffentliche
// Supabase-Schnittstelle. Sie prüfen, dass die Datenbank selbst schützt.

// Eine Tätigkeit mit eigenem Stundensatz bei einem Objekt der Firma.
async function legeObjektSatzAn(firmaId: string) {
  const dienst = dienstZugang()!;
  const { objektId } = await legeKundeMitObjektAn(dienst, firmaId);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  const { error } = await dienst.from("objekt_stundensatz").insert({
    firma_id: firmaId,
    objekt_id: objektId,
    taetigkeit_id: taetigkeitId,
    stundensatz_cent: 2500,
  });
  if (error) throw error;
  return { objektId, taetigkeitId };
}

// Der gespeicherte Stand, am eigenen Zugang vorbei gelesen.
async function gespeicherteSaetze(objektId: string) {
  const { data } = await dienstZugang()!
    .from("objekt_stundensatz")
    .select("stundensatz_cent")
    .eq("objekt_id", objektId);
  return data;
}

for (const rolle of ["mitarbeiter", "vorarbeiter"] as const) {
  test(`Ein ${rolle === "mitarbeiter" ? "Mitarbeiter" : "Vorarbeiter"} kann Stundensätze von Objekten über die Schnittstelle weder sehen noch ändern`, async () => {
    const { firmaA } = testdaten();
    const { objektId, taetigkeitId } = await legeObjektSatzAn(firmaA.id);
    const supabase = await schnittstelleAls(firmaA[rolle]);

    expect((await supabase.from("objekt_stundensatz").select("objekt_id")).data).toEqual([]);

    const { error: anlegeFehler } = await supabase.from("objekt_stundensatz").insert({
      firma_id: firmaA.id,
      objekt_id: objektId,
      taetigkeit_id: taetigkeitId,
      stundensatz_cent: 1,
    });
    expect(anlegeFehler?.code).toBe("42501");

    // Die Datenbank findet die Zeile für ihn gar nicht, ändert also nichts.
    const geaendert = await supabase
      .from("objekt_stundensatz")
      .update({ stundensatz_cent: 1 })
      .eq("objekt_id", objektId)
      .select("objekt_id");
    expect(geaendert.error).toBeNull();
    expect(geaendert.data).toEqual([]);

    await supabase.from("objekt_stundensatz").delete().eq("objekt_id", objektId);

    expect(await gespeicherteSaetze(objektId)).toEqual([{ stundensatz_cent: 2500 }]);
  });
}

test("Das Büro kann Stundensätze von Objekten einer anderen Firma weder sehen noch ändern oder entfernen", async () => {
  const { firmaA, firmaB } = testdaten();
  const { objektId, taetigkeitId } = await legeObjektSatzAn(firmaA.id);
  const supabase = await schnittstelleAls(firmaB.buero);

  expect(
    (await supabase.from("objekt_stundensatz").select("objekt_id").eq("objekt_id", objektId)).data,
  ).toEqual([]);

  const { error: anlegeFehler } = await supabase.from("objekt_stundensatz").insert({
    firma_id: firmaA.id,
    objekt_id: objektId,
    taetigkeit_id: taetigkeitId,
    stundensatz_cent: 1,
  });
  expect(anlegeFehler?.code).toBe("42501");

  const geaendert = await supabase
    .from("objekt_stundensatz")
    .update({ stundensatz_cent: 1 })
    .eq("objekt_id", objektId)
    .select("objekt_id");
  expect(geaendert.data).toEqual([]);

  await supabase.from("objekt_stundensatz").delete().eq("objekt_id", objektId);

  expect(await gespeicherteSaetze(objektId)).toEqual([{ stundensatz_cent: 2500 }]);
});

test("Ein Stundensatz eines Objekts verbindet nur Objekt und Tätigkeit derselben Firma", async () => {
  const { firmaA, firmaB } = testdaten();
  const dienst = dienstZugang()!;
  const { objektId: fremdesObjekt } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const { taetigkeitId: fremdeTaetigkeit } = await legeTaetigkeitAn(dienst, firmaA.id);
  const { objektId: eigenesObjekt } = await legeKundeMitObjektAn(dienst, firmaB.id);
  const { taetigkeitId: eigeneTaetigkeit } = await legeTaetigkeitAn(dienst, firmaB.id);
  const supabase = await schnittstelleAls(firmaB.buero);

  for (const [objekt_id, taetigkeit_id] of [
    [eigenesObjekt, fremdeTaetigkeit],
    [fremdesObjekt, eigeneTaetigkeit],
  ]) {
    const { error } = await supabase.from("objekt_stundensatz").insert({
      firma_id: firmaB.id,
      objekt_id,
      taetigkeit_id,
      stundensatz_cent: 2000,
    });
    expect(error).not.toBeNull();
  }
  expect(await gespeicherteSaetze(eigenesObjekt)).toEqual([]);
  expect(await gespeicherteSaetze(fremdesObjekt)).toEqual([]);
});

test("Die Datenbank erlaubt je Objekt und Tätigkeit höchstens einen Satz über 0 €, nur der Betrag ist änderbar, und das Büro kann ihn entfernen", async () => {
  const { firmaA } = testdaten();
  const { objektId, taetigkeitId } = await legeObjektSatzAn(firmaA.id);
  const { objektId: anderesObjekt } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);
  const supabase = await schnittstelleAls(firmaA.buero);
  const satz = { firma_id: firmaA.id, objekt_id: objektId, taetigkeit_id: taetigkeitId };

  expect(
    (await supabase.from("objekt_stundensatz").select("stundensatz_cent").eq("objekt_id", objektId))
      .data,
  ).toEqual([{ stundensatz_cent: 2500 }]);

  const doppelt = await supabase
    .from("objekt_stundensatz")
    .insert({ ...satz, stundensatz_cent: 2000 });
  expect(doppelt.error?.code).toBe("23505");

  const nullEuro = await supabase
    .from("objekt_stundensatz")
    .update({ stundensatz_cent: 0 })
    .eq("objekt_id", objektId);
  expect(nullEuro.error?.code).toBe("23514");

  const verschoben = await supabase
    .from("objekt_stundensatz")
    .update({ objekt_id: anderesObjekt })
    .eq("objekt_id", objektId);
  expect(verschoben.error?.code).toBe("42501");

  const geaendert = await supabase
    .from("objekt_stundensatz")
    .update({ stundensatz_cent: 2350 })
    .eq("objekt_id", objektId);
  expect(geaendert.error).toBeNull();
  expect(await gespeicherteSaetze(objektId)).toEqual([{ stundensatz_cent: 2350 }]);

  const { error } = await supabase.from("objekt_stundensatz").delete().eq("objekt_id", objektId);
  expect(error).toBeNull();
  expect(await gespeicherteSaetze(objektId)).toEqual([]);
});
