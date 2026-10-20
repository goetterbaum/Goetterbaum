import { expect, test } from "@playwright/test";
import { schnittstelleAls, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZusatzauftragAn,
  oeffentlicherZugang,
} from "./testumgebung/testdaten";

// Diese Tests gehen an der App vorbei direkt auf die öffentliche
// Supabase-Schnittstelle. Sie prüfen, dass die Datenbank selbst schützt.

const STUNDE = 60 * 60 * 1000;
const vor = (stunden: number) => new Date(Date.now() - stunden * STUNDE).toISOString();

// Der gespeicherte Stand, am eigenen Zugang vorbei gelesen.
async function gespeicherterZusatzauftrag(id: string) {
  const { data } = await dienstZugang()!
    .from("zusatzauftrag")
    .select("objekt_id, beschreibung, abrechnungsart, festbetrag_cent, erledigt")
    .eq("id", id)
    .single();
  return data;
}

async function gespeicherteZuordnung(zeiteintragId: string) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("zusatzauftrag_id")
    .eq("id", zeiteintragId)
    .single<{ zusatzauftrag_id: string | null }>();
  return data!.zusatzauftrag_id;
}

for (const rolle of ["mitarbeiter", "vorarbeiter"] as const) {
  test(`Ein ${rolle === "mitarbeiter" ? "Mitarbeiter" : "Vorarbeiter"} sieht nur die offenen Zusatzaufträge der eigenen Firma und kann keine anlegen oder ändern`, async () => {
    const { firmaA, firmaB } = testdaten();
    const dienst = dienstZugang()!;
    const objekt = await legeKundeMitObjektAn(dienst, firmaA.id);
    const archiviertesObjekt = await legeKundeMitObjektAn(dienst, firmaA.id);
    const fremdesObjekt = await legeKundeMitObjektAn(dienst, firmaB.id);
    const offen = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId, {
      festbetragCent: 89000,
    });
    const erledigt = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId, {
      erledigt: true,
    });
    const amArchivierten = await legeZusatzauftragAn(
      dienst,
      firmaA.id,
      archiviertesObjekt.objektId,
    );
    await dienst
      .from("objekt")
      .update({ archiviert: true })
      .eq("id", archiviertesObjekt.objektId)
      .throwOnError();
    const fremd = await legeZusatzauftragAn(dienst, firmaB.id, fremdesObjekt.objektId);
    const supabase = await schnittstelleAls(firmaA[rolle]);

    // Zur Auswahl: nur offene an aktiven Objekten der eigenen Firma, ohne
    // Abrechnungsart und Festbetrag.
    const { data: auswahl, error } = await supabase.rpc("zusatzauftraege_zur_auswahl");
    expect(error).toBeNull();
    const ids = auswahl.map((z: { id: string }) => z.id);
    expect(ids).toContain(offen.zusatzauftragId);
    for (const nicht of [erledigt, amArchivierten, fremd]) {
      expect(ids).not.toContain(nicht.zusatzauftragId);
    }
    expect(auswahl.find((z: { id: string }) => z.id === offen.zusatzauftragId)).toEqual({
      id: offen.zusatzauftragId,
      objekt_id: objekt.objektId,
      beschreibung: offen.beschreibung,
    });

    // Die Tabelle mit den Festbeträgen bleibt verschlossen.
    expect((await supabase.from("zusatzauftrag").select("id")).data).toEqual([]);

    const anlegen = await supabase.from("zusatzauftrag").insert({
      firma_id: firmaA.id,
      objekt_id: objekt.objektId,
      beschreibung: "Eingeschleust",
      abrechnungsart: "stunden",
    });
    expect(anlegen.error?.code).toBe("42501");

    // Die Datenbank findet die Zeile für ihn gar nicht, ändert also nichts.
    for (const aenderung of [{ erledigt: true }, { festbetrag_cent: 1 }]) {
      const aendern = await supabase
        .from("zusatzauftrag")
        .update(aenderung)
        .eq("id", offen.zusatzauftragId)
        .select("id");
      expect(aendern.error, JSON.stringify(aenderung)).toBeNull();
      expect(aendern.data, JSON.stringify(aenderung)).toEqual([]);
    }
    expect(await gespeicherterZusatzauftrag(offen.zusatzauftragId)).toMatchObject({
      festbetrag_cent: 89000,
      erledigt: false,
    });
  });
}

test("Das Büro legt Zusatzaufträge nur an Objekten der eigenen Firma an und ändert nur eigene", async () => {
  const { firmaA, firmaB } = testdaten();
  const dienst = dienstZugang()!;
  const objekt = await legeKundeMitObjektAn(dienst, firmaA.id);
  const anderes = await legeKundeMitObjektAn(dienst, firmaA.id);
  const fremdesObjekt = await legeKundeMitObjektAn(dienst, firmaB.id);
  const fremd = await legeZusatzauftragAn(dienst, firmaB.id, fremdesObjekt.objektId);
  const supabase = await schnittstelleAls(firmaA.buero);
  const neu = {
    firma_id: firmaA.id,
    objekt_id: objekt.objektId,
    beschreibung: "Grundreinigung nach Umbau",
    abrechnungsart: "festbetrag",
    festbetrag_cent: 189050,
  };

  // Ein Festbetrag nur bei Abrechnungsart Festbetrag, und dann Pflicht.
  for (const falsch of [
    { abrechnungsart: "festbetrag", festbetrag_cent: null },
    { abrechnungsart: "festbetrag", festbetrag_cent: 0 },
    { abrechnungsart: "stunden", festbetrag_cent: 189050 },
  ]) {
    const { error } = await supabase.from("zusatzauftrag").insert({ ...neu, ...falsch });
    expect(error?.code, JSON.stringify(falsch)).toBe("23514");
  }

  // Neu ist immer offen.
  const mitErledigt = await supabase.from("zusatzauftrag").insert({ ...neu, erledigt: true });
  expect(mitErledigt.error?.code).toBe("42501");

  const { data, error } = await supabase
    .from("zusatzauftrag")
    .insert(neu)
    .select("id, erledigt")
    .single<{ id: string; erledigt: boolean }>();
  expect(error).toBeNull();
  expect(data!.erledigt).toBe(false);

  // Bearbeiten und als erledigt markieren.
  const geaendert = await supabase
    .from("zusatzauftrag")
    .update({ abrechnungsart: "stunden", festbetrag_cent: null, erledigt: true })
    .eq("id", data!.id)
    .select("id");
  expect(geaendert.data).toHaveLength(1);
  expect(await gespeicherterZusatzauftrag(data!.id)).toEqual({
    objekt_id: objekt.objektId,
    beschreibung: neu.beschreibung,
    abrechnungsart: "stunden",
    festbetrag_cent: null,
    erledigt: true,
  });

  // Das Objekt lässt sich nicht wechseln, gelöscht wird nie.
  const umhaengen = await supabase
    .from("zusatzauftrag")
    .update({ objekt_id: anderes.objektId })
    .eq("id", data!.id);
  expect(umhaengen.error?.code).toBe("42501");
  const loeschen = await supabase.from("zusatzauftrag").delete().eq("id", data!.id);
  expect(loeschen.error?.code).toBe("42501");
  expect(await gespeicherterZusatzauftrag(data!.id)).toMatchObject({
    objekt_id: objekt.objektId,
  });

  // Nicht an einem Objekt einer anderen Firma, weder unter der eigenen
  // noch unter der fremden Firma.
  const anFremdemObjekt = await supabase
    .from("zusatzauftrag")
    .insert({ ...neu, objekt_id: fremdesObjekt.objektId });
  expect(anFremdemObjekt.error?.code).toBe("23503");
  const alsFremdeFirma = await supabase
    .from("zusatzauftrag")
    .insert({ ...neu, firma_id: firmaB.id, objekt_id: fremdesObjekt.objektId });
  expect(alsFremdeFirma.error?.code).toBe("42501");

  // Fremde Zusatzaufträge sieht und ändert es nicht.
  expect(
    (await supabase.from("zusatzauftrag").select("id").eq("id", fremd.zusatzauftragId)).data,
  ).toEqual([]);
  const fremdAendern = await supabase
    .from("zusatzauftrag")
    .update({ erledigt: true })
    .eq("id", fremd.zusatzauftragId)
    .select("id");
  expect(fremdAendern.data).toEqual([]);
  expect((await gespeicherterZusatzauftrag(fremd.zusatzauftragId))?.erledigt).toBe(false);

  // Ohne Anmeldung gibt es keine Auswahl.
  const { error: ohneAnmeldung } = await oeffentlicherZugang().rpc("zusatzauftraege_zur_auswahl");
  expect(ohneAnmeldung).not.toBeNull();
});

test("Ein Zeiteintrag gehört nur zu einem offenen Zusatzauftrag desselben Objekts und derselben Firma", async () => {
  const { firmaA, firmaB } = testdaten();
  const dienst = dienstZugang()!;
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await legeKundeMitObjektAn(dienst, firmaA.id);
  const anderes = await legeKundeMitObjektAn(dienst, firmaA.id);
  const fremdesObjekt = await legeKundeMitObjektAn(dienst, firmaB.id);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaA.id);
  const sturmschaden = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId);
  const amAnderen = await legeZusatzauftragAn(dienst, firmaA.id, anderes.objektId);
  const erledigt = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId, {
    erledigt: true,
  });
  const fremd = await legeZusatzauftragAn(dienst, firmaB.id, fremdesObjekt.objektId);
  const supabase = await schnittstelleAls(ich);
  const nachtrag = {
    firma_id: firmaA.id,
    mitarbeiter_id: ich.id,
    art: "taetigkeit",
    objekt_id: objekt.objektId,
    taetigkeit_id: taetigkeitId,
    beginn: vor(30),
    ende: vor(29),
  };

  // Nicht zu einem anderen Objekt, einer anderen Firma oder einer Fahrt,
  // und kein erledigter.
  for (const [falsch, code] of [
    [{ zusatzauftrag_id: amAnderen.zusatzauftragId }, "23503"],
    [{ zusatzauftrag_id: fremd.zusatzauftragId }, "23503"],
    [
      {
        art: "fahrt",
        objekt_id: null,
        taetigkeit_id: null,
        zusatzauftrag_id: sturmschaden.zusatzauftragId,
      },
      "23514",
    ],
    [{ zusatzauftrag_id: erledigt.zusatzauftragId }, "23514"],
  ] as const) {
    const { error } = await supabase.from("zeiteintrag").insert({ ...nachtrag, ...falsch });
    expect(error?.code, JSON.stringify(falsch)).toBe(code);
  }

  // Ein offener Zusatzauftrag des Objekts passt, beim Nachtrag wie beim
  // Live-Start.
  const { data, error } = await supabase
    .from("zeiteintrag")
    .insert({ ...nachtrag, zusatzauftrag_id: sturmschaden.zusatzauftragId })
    .select("id")
    .single<{ id: string }>();
  expect(error).toBeNull();
  const live = await supabase
    .from("zeiteintrag")
    .insert({
      firma_id: firmaA.id,
      mitarbeiter_id: ich.id,
      art: "taetigkeit",
      objekt_id: objekt.objektId,
      taetigkeit_id: taetigkeitId,
      zusatzauftrag_id: sturmschaden.zusatzauftragId,
    })
    .select("id")
    .single<{ id: string }>();
  expect(live.error).toBeNull();
  await supabase
    .from("zeiteintrag")
    .update({ ende: new Date().toISOString() })
    .eq("id", live.data!.id)
    .throwOnError();

  // Beim Ändern gilt dasselbe: kein anderes Objekt mit diesem
  // Zusatzauftrag, kein Zusatzauftrag eines anderen Objekts, kein
  // erledigter.
  for (const [falsch, code] of [
    [{ objekt_id: anderes.objektId }, "23503"],
    [{ zusatzauftrag_id: amAnderen.zusatzauftragId }, "23503"],
    [{ zusatzauftrag_id: erledigt.zusatzauftragId }, "23514"],
  ] as const) {
    const { error: fehler } = await supabase.from("zeiteintrag").update(falsch).eq("id", data!.id);
    expect(fehler?.code, JSON.stringify(falsch)).toBe(code);
  }
  expect(await gespeicherteZuordnung(data!.id)).toBe(sturmschaden.zusatzauftragId);

  // Ist der Zusatzauftrag inzwischen erledigt, bleibt der Eintrag
  // änderbar, solange die Zuordnung bleibt; entfernen geht auch.
  await dienst
    .from("zusatzauftrag")
    .update({ erledigt: true })
    .eq("id", sturmschaden.zusatzauftragId)
    .throwOnError();
  const zeitGeaendert = await supabase
    .from("zeiteintrag")
    .update({ ende: vor(28.5), zusatzauftrag_id: sturmschaden.zusatzauftragId })
    .eq("id", data!.id)
    .select("id");
  expect(zeitGeaendert.error).toBeNull();
  expect(zeitGeaendert.data).toHaveLength(1);
  const entfernt = await supabase
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: null })
    .eq("id", data!.id)
    .select("id");
  expect(entfernt.data).toHaveLength(1);
  expect(await gespeicherteZuordnung(data!.id)).toBeNull();
  // Wieder zuordnen geht nicht, er ist ja erledigt.
  const wieder = await supabase
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: sturmschaden.zusatzauftragId })
    .eq("id", data!.id);
  expect(wieder.error?.code).toBe("23514");

  // Die Listen nennen den Zusatzauftrag, auch wenn er erledigt ist.
  const { data: meine } = await supabase.rpc("meine_zeiteintraege", { ab: vor(48) });
  expect(meine.find((e: { id: string }) => e.id === live.data!.id)).toMatchObject({
    zusatzauftrag_beschreibung: sturmschaden.beschreibung,
  });
  const buero = await schnittstelleAls(firmaA.buero);
  const { data: liste } = await buero.rpc("zeiteintraege_der_firma", { ab: vor(48) });
  expect(liste.find((e: { id: string }) => e.id === live.data!.id)).toMatchObject({
    zusatzauftrag_id: sturmschaden.zusatzauftragId,
    zusatzauftrag_beschreibung: sturmschaden.beschreibung,
  });
});
