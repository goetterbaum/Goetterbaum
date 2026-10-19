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
// Supabase-Schnittstelle. Sie prüfen, dass nur das Büro der eigenen Firma
// Zusatzaufträge sieht und pflegt, dass ein Zeiteintrag nur einem
// passenden Zusatzauftrag zugeordnet wird, dass nur das Büro einen
// erledigten und vollständig freigegebenen Zusatzauftrag abrechnet und dass
// er danach gesperrt ist.

async function zusatzauftrag(id: string) {
  const { data, error } = await dienstZugang()!
    .from("zusatzauftrag")
    .select("beschreibung, erledigt, abgerechnet_in")
    .eq("id", id)
    .single<{ beschreibung: string; erledigt: boolean; abgerechnet_in: string | null }>();
  if (error) throw error;
  return data;
}

async function abgerechnetIn(ids: string[]) {
  const { data, error } = await dienstZugang()!
    .from("zeiteintrag")
    .select("id, abgerechnet_in")
    .in("id", ids)
    .returns<{ id: string; abgerechnet_in: string | null }[]>();
  if (error) throw error;
  return ids.map((id) => data.find((z) => z.id === id)?.abgerechnet_in);
}

async function gebeFrei(ids: string[]) {
  const { error } = await dienstZugang()!
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-05T08:00:00Z" })
    .in("id", ids);
  if (error) throw error;
}

// Ein Objekt mit Tätigkeit und einem Mitarbeiter, der dort Zeit erfasst.
async function objektMitMitarbeiter(firmaId: string) {
  const dienst = dienstZugang()!;
  const objekt = await legeKundeMitObjektAn(dienst, firmaId);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  const mitarbeiter = await legeEigenenZugangAn(firmaId);
  const eintrag = (beginn: string, ende: string, zusatzauftragId?: string) =>
    legeZeiteintragAn(dienst, {
      firmaId,
      mitarbeiterId: mitarbeiter.id,
      objektId: objekt.objektId,
      taetigkeitId,
      zusatzauftragId,
      beginn,
      ende,
    });
  return { ...objekt, taetigkeitId, mitarbeiter, eintrag };
}

test("Zusatzaufträge sieht, legt an und ändert nur das Büro der eigenen Firma", async () => {
  const { firmaA, firmaB } = testdaten();
  const { objektId } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const mitarbeiter = await legeEigenenZugangAn(firmaA.id);
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
  const neu = {
    firma_id: firmaA.id,
    objekt_id: objektId,
    beschreibung: "Sturmschaden: Äste räumen",
    abrechnungsart: "festbetrag",
    festbetrag_cent: 45000,
  };

  const alsBuero = await schnittstelleAls(buero);
  const { data: angelegt, error } = await alsBuero
    .from("zusatzauftrag")
    .insert(neu)
    .select("id, erledigt, abgerechnet_in")
    .single<{ id: string; erledigt: boolean; abgerechnet_in: string | null }>();
  expect(error).toBeNull();
  expect(angelegt).toMatchObject({ erledigt: false, abgerechnet_in: null });
  const id = angelegt!.id;

  for (const zugang of [mitarbeiter, vorarbeiter, firmaB.buero]) {
    const supabase = await schnittstelleAls(zugang);
    const gesehen = await supabase.from("zusatzauftrag").select("id").eq("id", id);
    expect(gesehen.data, zugang.name).toEqual([]);
    const anlegen = await supabase.from("zusatzauftrag").insert(neu);
    expect(anlegen.error?.code, zugang.name).toBe("42501");
    const aendern = await supabase
      .from("zusatzauftrag")
      .update({ erledigt: true })
      .eq("id", id)
      .select("id");
    expect(aendern.data ?? [], zugang.name).toEqual([]);
  }
  expect(await zusatzauftrag(id)).toMatchObject({ erledigt: false });

  // Das Objekt lässt sich nicht nachträglich wechseln.
  const umziehen = await alsBuero
    .from("zusatzauftrag")
    .update({ objekt_id: objektId })
    .eq("id", id);
  expect(umziehen.error?.code).toBe("42501");

  // Zur Auswahl bekommen alle Nutzer der Firma nur offene, ohne Festbetrag.
  const alsMitarbeiter = await schnittstelleAls(mitarbeiter);
  const auswahl = await alsMitarbeiter.rpc("zusatzauftraege_zur_auswahl");
  expect(auswahl.error).toBeNull();
  expect(auswahl.data.find((za: { id: string }) => za.id === id)).toEqual({
    id,
    objekt_id: objektId,
    beschreibung: neu.beschreibung,
    erledigt: false,
  });
  const fremd = await (await schnittstelleAls(firmaB.buero)).rpc("zusatzauftraege_zur_auswahl");
  expect(fremd.data.some((za: { id: string }) => za.id === id)).toBe(false);

  await alsBuero.from("zusatzauftrag").update({ erledigt: true }).eq("id", id);
  const ohneErledigte = await alsMitarbeiter.rpc("zusatzauftraege_zur_auswahl");
  expect(ohneErledigte.data.some((za: { id: string }) => za.id === id)).toBe(false);
  // Den bisherigen eines eigenen Eintrags bekommt er dazu, sonst nicht.
  const ohneEintrag = await alsMitarbeiter.rpc("zusatzauftraege_zur_auswahl", { dazu: id });
  expect(ohneEintrag.data.some((za: { id: string }) => za.id === id)).toBe(false);
  const { taetigkeitId } = await legeTaetigkeitAn(dienstZugang()!, firmaA.id);
  await legeZeiteintragAn(dienstZugang()!, {
    firmaId: firmaA.id,
    mitarbeiterId: mitarbeiter.id,
    objektId,
    taetigkeitId,
    zusatzauftragId: id,
    beginn: "2026-03-16T07:00:13Z",
    ende: "2026-03-16T08:00:41Z",
  });
  const mitBisherigem = await alsMitarbeiter.rpc("zusatzauftraege_zur_auswahl", { dazu: id });
  expect(mitBisherigem.data.find((za: { id: string }) => za.id === id)).toMatchObject({
    erledigt: true,
  });
  // Einem anderen Mitarbeiter nicht, auch wenn er danach fragt.
  const andererMitarbeiter = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id));
  const fremderEintrag = await andererMitarbeiter.rpc("zusatzauftraege_zur_auswahl", { dazu: id });
  expect(fremderEintrag.data.some((za: { id: string }) => za.id === id)).toBe(false);
});

test("Zusatzaufträge archivierter Objekte stehen nicht zur Auswahl", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const { objektId } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const { zusatzauftragId } = await legeZusatzauftragAn(dienst, firmaA.id, objektId);
  const alsMitarbeiter = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id));
  const zurAuswahl = async () =>
    (await alsMitarbeiter.rpc("zusatzauftraege_zur_auswahl")).data.some(
      (za: { id: string }) => za.id === zusatzauftragId,
    );

  expect(await zurAuswahl()).toBe(true);
  const { error } = await dienst.from("objekt").update({ archiviert: true }).eq("id", objektId);
  expect(error).toBeNull();
  expect(await zurAuswahl()).toBe(false);
});

test("Ist für einen Zusatzauftrag schon Zeit abgerechnet, bleibt seine Abrechnungsart", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const objekt = await objektMitMitarbeiter(firmaA.id);
  const sturm = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId);
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));
  const zuFestbetrag = () =>
    alsBuero
      .from("zusatzauftrag")
      .update({ abrechnungsart: "festbetrag", festbetrag_cent: 50000 })
      .eq("id", sturm.zusatzauftragId)
      .select("id");
  // 09.03., 07:01:17–09:14:52 in Berlin: gehört zum März.
  const eintrag = await objekt.eintrag(
    "2026-03-09T06:01:17Z",
    "2026-03-09T08:14:52Z",
    sturm.zusatzauftragId,
  );
  await gebeFrei([eintrag]);

  const { data: abrechnungId, error } = await alsBuero.rpc("als_abgerechnet_markieren", {
    fuer_kunde: objekt.kundeId,
    ab_monat: "2026-03-01",
    eintraege: [eintrag],
    monate: [],
    aufstellung: [{ art: "zusatzauftrag-stunden", zusatzauftragId: sturm.zusatzauftragId }],
    summe: 6750,
  });
  expect(error).toBeNull();
  expect((await zuFestbetrag()).error?.code).toBe("23514");
  // Die Beschreibung lässt sich weiter ändern, der Zusatzauftrag ist ja offen.
  const umbenannt = await alsBuero
    .from("zusatzauftrag")
    .update({ beschreibung: "Sturmschaden, 2. Teil" })
    .eq("id", sturm.zusatzauftragId)
    .select("id");
  expect(umbenannt.data).toHaveLength(1);

  // Nach der Rücknahme ist keine Zeit mehr abgerechnet.
  await alsBuero.rpc("abrechnung_zuruecknehmen", { welche: abrechnungId });
  const umgestellt = await zuFestbetrag();
  expect(umgestellt.error).toBeNull();
  expect(umgestellt.data).toHaveLength(1);
});

test("Ein Festbetrag gibt es nur bei Abrechnungsart Festbetrag, und dort ist er Pflicht", async () => {
  const { firmaA } = testdaten();
  const { objektId } = await legeKundeMitObjektAn(dienstZugang()!, firmaA.id);
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));
  const zusatzauftrag = (abrechnungsart: string, festbetrag_cent: number | null) =>
    alsBuero.from("zusatzauftrag").insert({
      firma_id: firmaA.id,
      objekt_id: objektId,
      beschreibung: "Grundreinigung",
      abrechnungsart,
      festbetrag_cent,
    });

  for (const [art, betrag] of [
    ["stunden", 45000],
    ["festbetrag", null],
    ["festbetrag", 0],
  ] as const) {
    expect((await zusatzauftrag(art, betrag)).error?.code, `${art} ${betrag}`).toBe("23514");
  }
  expect((await zusatzauftrag("stunden", null)).error).toBeNull();
  expect((await zusatzauftrag("festbetrag", 45000)).error).toBeNull();
});

test("Zugeordnet wird nur ein Zusatzauftrag des eigenen Objekts; Mitarbeiter wählen nur offene", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const objekt = await objektMitMitarbeiter(firmaA.id);
  const anderes = await legeKundeMitObjektAn(dienst, firmaA.id);
  const offen = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId);
  const erledigt = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId, {
    erledigt: true,
  });
  const fremd = await legeZusatzauftragAn(dienst, firmaA.id, anderes.objektId);
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const alsMitarbeiter = await schnittstelleAls(objekt.mitarbeiter);
  let minute = 0;
  const nachtrag = (zusatzauftrag_id: string | null, art = "taetigkeit") => {
    minute += 10;
    const zeit = (m: number) => new Date(Date.UTC(2026, 2, 16, 7, m, 13)).toISOString();
    return {
      firma_id: firmaA.id,
      mitarbeiter_id: objekt.mitarbeiter.id,
      art,
      objekt_id: art === "fahrt" ? null : objekt.objektId,
      taetigkeit_id: art === "fahrt" ? null : objekt.taetigkeitId,
      zusatzauftrag_id,
      beginn: zeit(minute),
      ende: zeit(minute + 5),
    };
  };

  const { data: eigener, error } = await alsMitarbeiter
    .from("zeiteintrag")
    .insert(nachtrag(offen.zusatzauftragId))
    .select("id")
    .single<{ id: string }>();
  expect(error).toBeNull();

  for (const [was, eintrag, code] of [
    ["erledigt", nachtrag(erledigt.zusatzauftragId), "23514"],
    ["fremdes Objekt", nachtrag(fremd.zusatzauftragId), "23503"],
    ["Fahrt", nachtrag(offen.zusatzauftragId, "fahrt"), "23514"],
  ] as const) {
    const { error } = await alsMitarbeiter.from("zeiteintrag").insert(eintrag);
    expect(error?.code, was).toBe(code);
  }
  for (const [zugang, code] of [
    [objekt.mitarbeiter, "23514"],
    [vorarbeiter, "23514"],
  ] as const) {
    const { error } = await (
      await schnittstelleAls(zugang)
    )
      .from("zeiteintrag")
      .update({ zusatzauftrag_id: erledigt.zusatzauftragId })
      .eq("id", eigener!.id);
    expect(error?.code, zugang.name).toBe(code);
  }

  // Das Büro darf beim Prüfen auch einen erledigten zuordnen; protokolliert.
  const alsBuero = await schnittstelleAls(buero);
  const umgeordnet = await alsBuero
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: erledigt.zusatzauftragId })
    .eq("id", eigener!.id)
    .select("zusatzauftrag_id, nachtrag");
  expect(umgeordnet.error).toBeNull();
  expect(umgeordnet.data).toEqual([{ zusatzauftrag_id: erledigt.zusatzauftragId, nachtrag: true }]);
  const { data: protokoll } = await dienst
    .from("zeiteintrag_protokoll")
    .select("geaendert_von, vorher, nachher")
    .eq("zeiteintrag_id", eigener!.id)
    .order("id", { ascending: false })
    .limit(1)
    .single<{
      geaendert_von: string;
      vorher: { zusatzauftrag_id: string };
      nachher: { zusatzauftrag_id: string };
    }>();
  expect(protokoll).toMatchObject({
    geaendert_von: buero.id,
    vorher: { zusatzauftrag_id: offen.zusatzauftragId },
    nachher: { zusatzauftrag_id: erledigt.zusatzauftragId },
  });

  // Ein schon zugeordneter, inzwischen erledigter bleibt beim Ändern stehen.
  const geaendert = await alsMitarbeiter
    .from("zeiteintrag")
    .update({ taetigkeit_id: objekt.taetigkeitId, zusatzauftrag_id: erledigt.zusatzauftragId })
    .eq("id", eigener!.id)
    .select("id");
  expect(geaendert.error).toBeNull();
  expect(geaendert.data).toHaveLength(1);

  // Entfernen geht ebenso.
  const entfernt = await alsBuero
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: null })
    .eq("id", eigener!.id)
    .select("zusatzauftrag_id");
  expect(entfernt.data).toEqual([{ zusatzauftrag_id: null }]);
});

test("Einzeln rechnet nur das Büro einen erledigten, vollständig freigegebenen Zusatzauftrag ab; danach ist er gesperrt", async () => {
  const { firmaA, firmaB } = testdaten();
  const dienst = dienstZugang()!;
  const objekt = await objektMitMitarbeiter(firmaA.id);
  const sturm = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const alsBuero = await schnittstelleAls(buero);
  const eintraege = [
    await objekt.eintrag("2026-02-20T07:00:12Z", "2026-02-20T09:13:40Z", sturm.zusatzauftragId),
    await objekt.eintrag("2026-03-09T06:01:17Z", "2026-03-09T08:14:52Z", sturm.zusatzauftragId),
  ];
  await gebeFrei(eintraege);
  const spaet = await objekt.eintrag(
    "2026-03-10T06:01:44Z",
    "2026-03-10T07:00:09Z",
    sturm.zusatzauftragId,
  );
  const abrechnen = (supabase: typeof alsBuero, ids: string[]) =>
    supabase.rpc("zusatzauftrag_abrechnen", {
      welcher: sturm.zusatzauftragId,
      eintraege: ids,
      aufstellung: [{ art: "zusatzauftrag-stunden", zusatzauftragId: sturm.zusatzauftragId }],
      summe: 12000,
    });

  for (const [zugang, code] of [
    [objekt.mitarbeiter, "42501"],
    [await legeEigenenZugangAn(firmaA.id, "vorarbeiter"), "42501"],
    // Den Zusatzauftrag einer anderen Firma gibt es für sie nicht.
    [firmaB.buero, "P0002"],
  ] as const) {
    const { error } = await abrechnen(await schnittstelleAls(zugang), [...eintraege, spaet]);
    expect(error?.code, zugang.name).toBe(code);
  }
  // Noch offen.
  expect((await abrechnen(alsBuero, eintraege)).error?.code).toBe("23514");

  await alsBuero.from("zusatzauftrag").update({ erledigt: true }).eq("id", sturm.zusatzauftragId);
  // Ein Eintrag ist noch nicht freigegeben, ob mitgeschickt oder nicht.
  expect((await abrechnen(alsBuero, eintraege)).error?.code).toBe("23514");
  expect((await abrechnen(alsBuero, [...eintraege, spaet])).error?.code).toBe("23514");
  await gebeFrei([spaet]);
  // Einer fehlt.
  expect((await abrechnen(alsBuero, eintraege)).error?.code).toBe("23514");
  expect(await abgerechnetIn([...eintraege, spaet])).toEqual([null, null, null]);

  const { data: abrechnungId, error } = await abrechnen(alsBuero, [...eintraege, spaet]);
  expect(error).toBeNull();
  expect(await abgerechnetIn([...eintraege, spaet])).toEqual([
    abrechnungId,
    abrechnungId,
    abrechnungId,
  ]);
  expect(await zusatzauftrag(sturm.zusatzauftragId)).toMatchObject({
    abgerechnet_in: abrechnungId,
  });
  const { data: abrechnung } = await dienst
    .from("abrechnung")
    .select(
      "kunde_id, zusatzauftrag_id, erster_monat, abrechnungszeitraum, summe_cent, abgerechnet_von",
    )
    .eq("id", abrechnungId)
    .single();
  expect(abrechnung).toEqual({
    kunde_id: objekt.kundeId,
    zusatzauftrag_id: sturm.zusatzauftragId,
    erster_monat: null,
    abrechnungszeitraum: null,
    summe_cent: 12000,
    abgerechnet_von: buero.id,
  });

  // Gesperrt: nicht ändern, nicht wieder öffnen, nichts mehr zuordnen,
  // nicht noch einmal abrechnen.
  for (const aenderung of [{ beschreibung: "Anders" }, { erledigt: false }]) {
    const { error } = await alsBuero
      .from("zusatzauftrag")
      .update(aenderung)
      .eq("id", sturm.zusatzauftragId);
    expect(error?.code, JSON.stringify(aenderung)).toBe("23514");
  }
  const weitere = await objekt.eintrag("2026-03-11T06:00:01Z", "2026-03-11T07:00:02Z");
  const zuordnen = await alsBuero
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: sturm.zusatzauftragId })
    .eq("id", weitere);
  expect(zuordnen.error?.code).toBe("23514");
  expect((await abrechnen(alsBuero, [])).error?.code).toBe("23514");

  // An den Funktionen vorbei geht nichts, auch nicht mit dem Dienstschlüssel.
  const direkt = await dienst
    .from("zusatzauftrag")
    .update({ abgerechnet_in: null })
    .eq("id", sturm.zusatzauftragId);
  expect(direkt.error?.code).toBe("42501");
  const alsBueroDirekt = await alsBuero
    .from("zusatzauftrag")
    .update({ abgerechnet_in: null })
    .eq("id", sturm.zusatzauftragId);
  expect(alsBueroDirekt.error?.code).toBe("42501");

  // Die Rücknahme öffnet ihn wieder.
  expect(
    (await alsBuero.rpc("abrechnung_zuruecknehmen", { welche: abrechnungId })).error,
  ).toBeNull();
  expect(await zusatzauftrag(sturm.zusatzauftragId)).toMatchObject({
    erledigt: true,
    abgerechnet_in: null,
  });
  expect(await abgerechnetIn([...eintraege, spaet])).toEqual([null, null, null]);
});

test("Mit dem Zeitraum wird ein erledigter Festbetrag samt Zeit aus früheren Monaten abgerechnet, die Zeit nie ohne ihn", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const objekt = await objektMitMitarbeiter(firmaA.id);
  const grund = await legeZusatzauftragAn(dienst, firmaA.id, objekt.objektId, {
    festbetragCent: 89000,
  });
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));
  const februar = await objekt.eintrag(
    "2026-02-25T07:00:12Z",
    "2026-02-25T15:00:47Z",
    grund.zusatzauftragId,
  );
  const maerz = await objekt.eintrag(
    "2026-03-03T07:00:05Z",
    "2026-03-03T11:00:31Z",
    grund.zusatzauftragId,
  );
  await gebeFrei([februar, maerz]);
  const markiere = (eintraege: string[], zusatzauftraege?: string[]) =>
    alsBuero.rpc("als_abgerechnet_markieren", {
      fuer_kunde: objekt.kundeId,
      ab_monat: "2026-03-01",
      eintraege,
      monate: [],
      aufstellung: [{ art: "zusatzauftrag-festbetrag", zusatzauftragId: grund.zusatzauftragId }],
      summe: 89000,
      ...(zusatzauftraege ? { zusatzauftraege } : {}),
    });

  // Die Zeit allein nie, auch nicht die aus dem Zeitraum.
  expect((await markiere([maerz])).error?.code).toBe("23514");
  // Noch nicht erledigt.
  expect((await markiere([februar, maerz], [grund.zusatzauftragId])).error?.code).toBe("23514");

  await alsBuero.from("zusatzauftrag").update({ erledigt: true }).eq("id", grund.zusatzauftragId);
  // Nur mit all seiner Zeit.
  expect((await markiere([maerz], [grund.zusatzauftragId])).error?.code).toBe("23514");
  expect(await abgerechnetIn([februar, maerz])).toEqual([null, null]);

  const { data: abrechnungId, error } = await markiere([februar, maerz], [grund.zusatzauftragId]);
  expect(error).toBeNull();
  expect(await abgerechnetIn([februar, maerz])).toEqual([abrechnungId, abrechnungId]);
  expect(await zusatzauftrag(grund.zusatzauftragId)).toMatchObject({
    abgerechnet_in: abrechnungId,
  });
});
