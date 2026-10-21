import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
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
// abrechnet und Abrechnungen zurücknimmt, dass die Datenbank Zeitpunkt und
// Nutzer selbst setzt, dass abgerechnete Zeiteinträge für alle gesperrt
// sind und dass nichts doppelt abgerechnet wird, auch kein Festbetrag eines
// Zusatzauftrags.

// Spielraum für Uhren, die zwischen Testrechner und Datenbank abweichen.
const UHR_SPIELRAUM_MS = 2 * 60 * 1000;

// Ein monatlich abgerechneter Kunde mit einem Pauschal-Objekt und zwei
// freigegebenen Zeiteinträgen, die im März 2026 beginnen, dazu einer, der
// noch nicht freigegeben ist, und einer, der in Berlin schon im April
// beginnt. Seit dem 29.03. gilt die Sommerzeit (UTC + 2 Stunden).
async function abrechenbarerKunde(firmaId: string) {
  const dienst = dienstZugang()!;
  const { kundeId, objektId } = await legeKundeMitObjektAn(dienst, firmaId);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  const mitarbeiter = await legeEigenenZugangAn(firmaId);
  const eintrag = (beginn: string, ende: string) =>
    legeZeiteintragAn(dienst, {
      firmaId,
      mitarbeiterId: mitarbeiter.id,
      objektId,
      taetigkeitId,
      beginn,
      ende,
    });
  const freigegebene = [
    await eintrag("2026-03-09T06:01:17Z", "2026-03-09T08:14:52Z"),
    // 31.03., 23:52:08 bis 00:31:39 am 01.04. in Berlin: gehört zum März.
    await eintrag("2026-03-31T21:52:08Z", "2026-03-31T22:31:39Z"),
  ];
  // 01.04., 00:40:51 in Berlin, in UTC noch der 31.03.
  const april = await eintrag("2026-03-31T22:40:51Z", "2026-03-31T23:10:02Z");
  const { error } = await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .in("id", [...freigegebene, april]);
  if (error) throw error;
  const offen = await eintrag("2026-03-16T07:00:44Z", "2026-03-16T09:02:03Z");
  return { kundeId, objektId, mitarbeiter, freigegebene, offen, april };
}

type Kunde = Awaited<ReturnType<typeof abrechenbarerKunde>>;

function markiere(
  supabase: SupabaseClient,
  kunde: Kunde,
  {
    eintraege = kunde.freigegebene,
    monate = [{ objekt_id: kunde.objektId, monat: "2026-03-01" }],
    abMonat = "2026-03-01",
    zusatzauftraege = [],
  }: {
    eintraege?: string[];
    monate?: { objekt_id: string; monat: string }[];
    abMonat?: string;
    zusatzauftraege?: string[];
  } = {},
) {
  return supabase.rpc("als_abgerechnet_markieren", {
    fuer_kunde: kunde.kundeId,
    ab_monat: abMonat,
    eintraege,
    monate,
    aufstellung: [{ art: "pauschale", objektId: kunde.objektId, monat: "2026-03" }],
    summe: 50000,
    zusatzauftraege,
  });
}

async function abrechnungenVon(kundeId: string) {
  const { data, error } = await dienstZugang()!
    .from("abrechnung")
    .select(
      "id, erster_monat, summe_cent, abgerechnet_am, abgerechnet_von, zurueckgenommen_am, zurueckgenommen_von",
    )
    .eq("kunde_id", kundeId)
    .order("abgerechnet_am");
  if (error) throw error;
  return data;
}

// Die Abrechnung je Zeiteintrag, in der Reihenfolge der Kennungen.
async function abgerechnetIn(ids: string[]) {
  const { data, error } = await dienstZugang()!
    .from("zeiteintrag")
    .select("id, abgerechnet_in")
    .in("id", ids)
    .returns<{ id: string; abgerechnet_in: string | null }[]>();
  if (error) throw error;
  return ids.map((id) => data.find((z) => z.id === id)?.abgerechnet_in);
}

async function letztesProtokoll(id: string) {
  const { data, error } = await dienstZugang()!
    .from("zeiteintrag_protokoll")
    .select("geaendert_von, vorher, nachher")
    .eq("zeiteintrag_id", id)
    .order("id", { ascending: false })
    .limit(1)
    .single<{
      geaendert_von: string | null;
      vorher: Record<string, unknown> | null;
      nachher: Record<string, unknown>;
    }>();
  if (error) throw error;
  return data;
}

test("Nur das Büro der eigenen Firma rechnet ab; wann und von wem setzt die Datenbank", async () => {
  const { firmaA, firmaB } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");

  for (const [zugang, code] of [
    [kunde.mitarbeiter, "42501"],
    [vorarbeiter, "42501"],
    // Den Kunden einer anderen Firma gibt es für sie nicht.
    [firmaB.buero, "P0002"],
  ] as const) {
    const { error } = await markiere(await schnittstelleAls(zugang), kunde);
    expect(error?.code, zugang.name).toBe(code);
  }
  expect(await abrechnungenVon(kunde.kundeId)).toEqual([]);

  // An den Funktionen vorbei geht nichts.
  const alsBuero = await schnittstelleAls(buero);
  const direkt = await alsBuero.from("abrechnung").insert({
    firma_id: firmaA.id,
    kunde_id: kunde.kundeId,
    erster_monat: "2026-03-01",
    abrechnungszeitraum: "monatlich",
    positionen: [],
    summe_cent: 0,
    abgerechnet_von: buero.id,
  });
  expect(direkt.error?.code).toBe("42501");
  const verweis = await alsBuero
    .from("zeiteintrag")
    .update({ abgerechnet_in: null })
    .eq("id", kunde.freigegebene[0]);
  expect(verweis.error?.code).toBe("42501");

  const { data: id, error } = await markiere(alsBuero, kunde);
  expect(error).toBeNull();
  const [abrechnung] = await abrechnungenVon(kunde.kundeId);
  expect(abrechnung).toMatchObject({
    id,
    erster_monat: "2026-03-01",
    summe_cent: 50000,
    abgerechnet_von: buero.id,
    zurueckgenommen_am: null,
    zurueckgenommen_von: null,
  });
  expect(Math.abs(Date.parse(abrechnung.abgerechnet_am) - Date.now())).toBeLessThan(
    UHR_SPIELRAUM_MS,
  );
  expect(await abgerechnetIn([...kunde.freigegebene, kunde.offen])).toEqual([id, id, null]);

  // Auch der Dienstschlüssel leert oder setzt den Verweis nicht selbst,
  // an den Funktionen vorbei.
  for (const [wert, eintrag] of [
    [null, kunde.freigegebene[0]],
    [id, kunde.offen],
  ] as const) {
    const { error } = await dienstZugang()!
      .from("zeiteintrag")
      .update({ abgerechnet_in: wert })
      .eq("id", eintrag);
    expect(error?.code, eintrag).toBe("42501");
  }
  expect(await abgerechnetIn([...kunde.freigegebene, kunde.offen])).toEqual([id, id, null]);

  const { data: monate } = await dienstZugang()!
    .from("abrechnung_pauschal_monat")
    .select("objekt_id, monat, gueltig")
    .eq("abrechnung_id", id);
  expect(monate).toEqual([{ objekt_id: kunde.objektId, monat: "2026-03-01", gueltig: true }]);

  // Jeder Zeiteintrag zeigt die Abrechnung in seinem Änderungsprotokoll.
  const protokoll = await letztesProtokoll(kunde.freigegebene[0]);
  expect(protokoll.geaendert_von).toBe(buero.id);
  expect(protokoll.vorher?.abgerechnet_in).toBeNull();
  expect(protokoll.nachher.abgerechnet_in).toBe(id);
});

test("Abgerechnete Zeiteinträge sind für alle gesperrt, auch fürs Büro", async () => {
  const { firmaA } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
  const alsBuero = await schnittstelleAls(buero);
  expect((await markiere(alsBuero, kunde)).error).toBeNull();
  const [id] = kunde.freigegebene;
  const vorher = await dienstZugang()!.from("zeiteintrag").select("*").eq("id", id).single();

  // Mitarbeiter und Vorarbeiter finden ihn gar nicht erst zum Ändern.
  for (const zugang of [kunde.mitarbeiter, vorarbeiter]) {
    const { data, error } = await (
      await schnittstelleAls(zugang)
    )
      .from("zeiteintrag")
      .update({ beginn: "2026-03-09T06:00:00Z" })
      .eq("id", id)
      .select("id");
    expect(error, zugang.name).toBeNull();
    expect(data, zugang.name).toEqual([]);
  }

  // Das Büro und der Dienstschlüssel bekommen einen Fehler: weder Zeiten
  // noch Freigabe lassen sich ändern.
  for (const [supabase, wer] of [
    [alsBuero, "Büro"],
    [dienstZugang()!, "Dienstschlüssel"],
  ] as const) {
    const ende = await supabase
      .from("zeiteintrag")
      .update({ ende: "2026-03-09T08:00:00Z" })
      .eq("id", id);
    expect(ende.error?.code, wer).toBe("23514");
    const freigabe = await supabase
      .from("zeiteintrag")
      .update({ freigegeben_am: null })
      .eq("id", id);
    expect(freigabe.error?.code, wer).toBe("23514");
  }

  const nachher = await dienstZugang()!.from("zeiteintrag").select("*").eq("id", id).single();
  expect(nachher.data).toEqual(vorher.data);
});

test("Nichts wird doppelt abgerechnet, und nur Freigegebenes des Kunden im Zeitraum", async () => {
  const { firmaA } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const andererKunde = await abrechenbarerKunde(firmaA.id);
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));

  // Was nicht passt, lehnt die Datenbank ab und speichert nichts.
  const falsch = [
    { eintraege: [kunde.offen], monate: [] },
    { eintraege: [andererKunde.freigegebene[0]], monate: [] },
    { eintraege: [], monate: [{ objekt_id: andererKunde.objektId, monat: "2026-03-01" }] },
    { eintraege: [], monate: [{ objekt_id: kunde.objektId, monat: "2026-04-01" }] },
    // Der Eintrag vom 31.03. gehört nicht in den Februar, die März-Einträge
    // nicht in den April und der Eintrag kurz nach Mitternacht am 01.04.
    // nicht in den März.
    { eintraege: kunde.freigegebene, monate: [], abMonat: "2026-02-01" },
    { eintraege: kunde.freigegebene, monate: [], abMonat: "2026-04-01" },
    { eintraege: [kunde.april], monate: [] },
    { eintraege: [], monate: [] },
  ];
  for (const auswahl of falsch) {
    const { error } = await markiere(alsBuero, kunde, auswahl);
    expect(error?.code, JSON.stringify(auswahl)).toBe("23514");
  }
  expect(await abrechnungenVon(kunde.kundeId)).toEqual([]);
  expect(await abgerechnetIn(kunde.freigegebene)).toEqual([null, null]);

  const { data: id } = await markiere(alsBuero, kunde);
  expect(id).toBeTruthy();
  const { error: imApril } = await markiere(alsBuero, kunde, {
    eintraege: [kunde.april],
    monate: [],
    abMonat: "2026-04-01",
  });
  expect(imApril).toBeNull();

  // Ein zweites Mal geht weder ein Zeiteintrag noch der Pauschal-Monat.
  const eintragNochmal = await markiere(alsBuero, kunde, { monate: [] });
  expect(eintragNochmal.error?.code).toBe("23514");
  const monatNochmal = await markiere(alsBuero, kunde, { eintraege: [] });
  expect(monatNochmal.error?.code).toBe("23505");
  expect(await abrechnungenVon(kunde.kundeId)).toHaveLength(2);

  // Quartalsweise beginnt ein Zeitraum nur mit dem ersten Monat eines
  // Quartals.
  const { error } = await dienstZugang()!
    .from("kunde")
    .update({ abrechnungszeitraum: "quartalsweise" })
    .eq("id", andererKunde.kundeId);
  if (error) throw error;
  const quartalsmitte = await markiere(alsBuero, andererKunde, { monate: [] });
  expect(quartalsmitte.error?.code).toBe("23514");
  const quartal = await markiere(alsBuero, andererKunde, { monate: [], abMonat: "2026-01-01" });
  expect(quartal.error).toBeNull();
});

test("Die Rücknahme macht wieder abrechenbar und steht im Protokoll", async () => {
  const { firmaA, firmaB } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const kollege = await legeEigenenZugangAn(firmaA.id, "buero");
  const alsBuero = await schnittstelleAls(buero);
  const { data: id } = await markiere(alsBuero, kunde);

  for (const [zugang, code] of [
    [kunde.mitarbeiter, "42501"],
    [firmaB.buero, "P0002"],
  ] as const) {
    const { error } = await (
      await schnittstelleAls(zugang)
    ).rpc("abrechnung_zuruecknehmen", { welche: id });
    expect(error?.code, zugang.name).toBe(code);
  }
  expect(await abgerechnetIn(kunde.freigegebene)).toEqual([id, id]);

  const alsKollege = await schnittstelleAls(kollege);
  const { error } = await alsKollege.rpc("abrechnung_zuruecknehmen", { welche: id });
  expect(error).toBeNull();
  const [abrechnung] = await abrechnungenVon(kunde.kundeId);
  expect(abrechnung.zurueckgenommen_von).toBe(kollege.id);
  expect(Math.abs(Date.parse(abrechnung.zurueckgenommen_am!) - Date.now())).toBeLessThan(
    UHR_SPIELRAUM_MS,
  );
  expect(await abgerechnetIn(kunde.freigegebene)).toEqual([null, null]);

  const protokoll = await letztesProtokoll(kunde.freigegebene[1]);
  expect(protokoll.geaendert_von).toBe(kollege.id);
  expect(protokoll.vorher?.abgerechnet_in).toBe(id);
  expect(protokoll.nachher.abgerechnet_in).toBeNull();

  // Ein zweites Mal geht nicht.
  const nochmal = await alsKollege.rpc("abrechnung_zuruecknehmen", { welche: id });
  expect(nochmal.error?.code).toBe("P0002");

  // Das Büro ändert die Einträge wieder, und sie lassen sich samt
  // Pauschal-Monat erneut abrechnen.
  const geaendert = await alsBuero
    .from("zeiteintrag")
    .update({ ende: "2026-03-09T08:10:00Z" })
    .eq("id", kunde.freigegebene[0])
    .select("id");
  expect(geaendert.error).toBeNull();
  expect(geaendert.data).toHaveLength(1);
  const neu = await markiere(alsBuero, kunde);
  expect(neu.error).toBeNull();
  expect(await abgerechnetIn(kunde.freigegebene)).toEqual([neu.data, neu.data]);
});

test("Abrechnungen sieht nur das Büro der eigenen Firma", async () => {
  const { firmaA, firmaB } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const alsBuero = await schnittstelleAls(buero);
  const { data: id } = await markiere(alsBuero, kunde);

  for (const zugang of [kunde.mitarbeiter, firmaB.buero]) {
    const supabase = await schnittstelleAls(zugang);
    const tabelle = await supabase.from("abrechnung").select("id").eq("kunde_id", kunde.kundeId);
    expect(tabelle.data, zugang.name).toEqual([]);
    const monate = await supabase
      .from("abrechnung_pauschal_monat")
      .select("monat")
      .eq("objekt_id", kunde.objektId);
    expect(monate.data, zugang.name).toEqual([]);
    const liste = await supabase.rpc("abrechnungen_des_kunden", { fuer_kunde: kunde.kundeId });
    expect(liste.data, zugang.name).toEqual([]);
  }

  const { data } = await alsBuero.rpc("abrechnungen_des_kunden", { fuer_kunde: kunde.kundeId });
  expect(data).toEqual([
    expect.objectContaining({
      id,
      erster_monat: "2026-03-01",
      abrechnungszeitraum: "monatlich",
      summe_cent: 50000,
      abgerechnet_von_name: buero.name,
      zurueckgenommen_am: null,
      zurueckgenommen_von_name: null,
    }),
  ]);
});

// Ein Zusatzauftrag mit Festbetrag (890 €) im Objekt des Kunden mit je
// einem freigegebenen Zeiteintrag im Februar und im März 2026. Erledigt
// wird er erst danach, denn Zeit lässt sich nur offenen zuordnen.
async function festbetragMitZeit(firmaId: string, kunde: Kunde, { erledigt = true } = {}) {
  const dienst = dienstZugang()!;
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  const { zusatzauftragId } = await legeZusatzauftragAn(dienst, firmaId, kunde.objektId, {
    festbetragCent: 89000,
  });
  const eintrag = (beginn: string, ende: string) =>
    legeZeiteintragAn(dienst, {
      firmaId,
      mitarbeiterId: kunde.mitarbeiter.id,
      objektId: kunde.objektId,
      taetigkeitId,
      zusatzauftragId,
      beginn,
      ende,
    });
  const februar = await eintrag("2026-02-23T07:03:41Z", "2026-02-23T11:47:12Z");
  const maerz = await eintrag("2026-03-11T07:00:51Z", "2026-03-11T09:31:20Z");
  const freigabe = await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .in("id", [februar, maerz]);
  if (freigabe.error) throw freigabe.error;
  if (erledigt) {
    const { error } = await dienst
      .from("zusatzauftrag")
      .update({ erledigt: true })
      .eq("id", zusatzauftragId);
    if (error) throw error;
  }
  return { zusatzauftragId, februar, maerz };
}

async function zusatzauftragAbgerechnetIn(id: string) {
  const { data, error } = await dienstZugang()!
    .from("zusatzauftrag")
    .select("abgerechnet_in")
    .eq("id", id)
    .single<{ abgerechnet_in: string | null }>();
  if (error) throw error;
  return data.abgerechnet_in;
}

test("Ein erledigter Festbetrag wird mit seiner Zeit aus allen Monaten abgerechnet und ist danach für alle gesperrt", async () => {
  const { firmaA } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const festbetrag = await festbetragMitZeit(firmaA.id, kunde);
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));
  const dienst = dienstZugang()!;

  // An den Funktionen vorbei setzt niemand den Verweis, auch nicht der
  // Dienstschlüssel, weder beim Ändern noch beim Anlegen.
  const { data: andere } = await markiere(alsBuero, await abrechenbarerKunde(firmaA.id));
  for (const [supabase, wer] of [
    [alsBuero, "Büro"],
    [dienst, "Dienstschlüssel"],
  ] as const) {
    const { error } = await supabase
      .from("zusatzauftrag")
      .update({ abgerechnet_in: andere })
      .eq("id", festbetrag.zusatzauftragId);
    expect(error?.code, wer).toBe("42501");
  }
  const angelegt = await dienst.from("zusatzauftrag").insert({
    firma_id: firmaA.id,
    objekt_id: kunde.objektId,
    beschreibung: "Schon abgerechnet",
    abrechnungsart: "festbetrag",
    festbetrag_cent: 1000,
    erledigt: true,
    abgerechnet_in: andere,
  });
  expect(angelegt.error?.code).toBe("42501");
  expect(await zusatzauftragAbgerechnetIn(festbetrag.zusatzauftragId)).toBeNull();

  // Der Februar-Eintrag gehört zum Festbetrag und wird mit ihm abgerechnet,
  // obwohl er vor dem Zeitraum liegt.
  const { data: id, error } = await markiere(alsBuero, kunde, {
    eintraege: [...kunde.freigegebene, festbetrag.februar, festbetrag.maerz],
    zusatzauftraege: [festbetrag.zusatzauftragId],
  });
  expect(error).toBeNull();
  expect(await zusatzauftragAbgerechnetIn(festbetrag.zusatzauftragId)).toBe(id);
  expect(await abgerechnetIn([festbetrag.februar, festbetrag.maerz])).toEqual([id, id]);

  // Gesperrt für Büro und Dienstschlüssel: weder Betrag noch Status.
  for (const [supabase, wer] of [
    [alsBuero, "Büro"],
    [dienst, "Dienstschlüssel"],
  ] as const) {
    for (const aenderung of [{ festbetrag_cent: 50000 }, { erledigt: false }]) {
      const { error } = await supabase
        .from("zusatzauftrag")
        .update(aenderung)
        .eq("id", festbetrag.zusatzauftragId);
      expect(error?.code, `${wer} ${JSON.stringify(aenderung)}`).toBe("23514");
    }
  }

  // Nach der Rücknahme wieder änderbar und abrechenbar.
  expect((await alsBuero.rpc("abrechnung_zuruecknehmen", { welche: id })).error).toBeNull();
  expect(await zusatzauftragAbgerechnetIn(festbetrag.zusatzauftragId)).toBeNull();
  expect(await abgerechnetIn([festbetrag.februar, festbetrag.maerz])).toEqual([null, null]);
  const geaendert = await alsBuero
    .from("zusatzauftrag")
    .update({ beschreibung: "Grundreinigung nach Umbau" })
    .eq("id", festbetrag.zusatzauftragId)
    .select("id");
  expect(geaendert.error).toBeNull();
  expect(geaendert.data).toHaveLength(1);
  const neu = await markiere(alsBuero, kunde, {
    eintraege: [festbetrag.februar],
    monate: [],
    zusatzauftraege: [festbetrag.zusatzauftragId],
  });
  expect(neu.error).toBeNull();
  expect(await zusatzauftragAbgerechnetIn(festbetrag.zusatzauftragId)).toBe(neu.data);
});

test("Abgerechnet wird nur ein erledigter Festbetrag des Kunden, einmal, und seine Zeit nie ohne ihn", async () => {
  const { firmaA } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const andererKunde = await abrechenbarerKunde(firmaA.id);
  const festbetrag = await festbetragMitZeit(firmaA.id, kunde);
  const offen = await festbetragMitZeit(firmaA.id, kunde, { erledigt: false });
  const fremd = await festbetragMitZeit(firmaA.id, andererKunde);
  const nachStunden = await legeZusatzauftragAn(dienstZugang()!, firmaA.id, kunde.objektId, {
    erledigt: true,
  });
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));

  // Was nicht passt, lehnt die Datenbank ab und speichert nichts.
  const falsch = [
    { eintraege: [], zusatzauftraege: [offen.zusatzauftragId] },
    { eintraege: [], zusatzauftraege: [nachStunden.zusatzauftragId] },
    { eintraege: [], zusatzauftraege: [fremd.zusatzauftragId] },
    // Die Zeit für den Festbetrag gehört zu ihm, auch die im Zeitraum.
    { eintraege: [festbetrag.februar], zusatzauftraege: [] },
    { eintraege: [festbetrag.maerz], zusatzauftraege: [] },
    { eintraege: [offen.maerz], zusatzauftraege: [festbetrag.zusatzauftragId] },
  ];
  for (const auswahl of falsch) {
    const { error } = await markiere(alsBuero, kunde, { monate: [], ...auswahl });
    expect(error?.code, JSON.stringify(auswahl)).toBe("23514");
  }
  expect(await abrechnungenVon(kunde.kundeId)).toEqual([]);
  expect(await zusatzauftragAbgerechnetIn(festbetrag.zusatzauftragId)).toBeNull();

  // Ein Festbetrag allein genügt für eine Abrechnung, aber nur einmal.
  const { data: id, error } = await markiere(alsBuero, kunde, {
    eintraege: [],
    monate: [],
    zusatzauftraege: [festbetrag.zusatzauftragId],
  });
  expect(error).toBeNull();
  expect(await zusatzauftragAbgerechnetIn(festbetrag.zusatzauftragId)).toBe(id);
  const nochmal = await markiere(alsBuero, kunde, {
    eintraege: [],
    monate: [],
    zusatzauftraege: [festbetrag.zusatzauftragId],
  });
  expect(nochmal.error?.code).toBe("23514");
  expect(await abrechnungenVon(kunde.kundeId)).toHaveLength(1);
});

test("Ist schon Zeit eines Zusatzauftrags abgerechnet, bleibt seine Abrechnungsart fest", async () => {
  const { firmaA } = testdaten();
  const kunde = await abrechenbarerKunde(firmaA.id);
  const dienst = dienstZugang()!;
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaA.id);
  const { zusatzauftragId } = await legeZusatzauftragAn(dienst, firmaA.id, kunde.objektId);
  const maerz = await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: kunde.mitarbeiter.id,
    objektId: kunde.objektId,
    taetigkeitId,
    zusatzauftragId,
    beginn: "2026-03-12T07:04:19Z",
    ende: "2026-03-12T09:41:52Z",
  });
  const freigabe = await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .eq("id", maerz);
  if (freigabe.error) throw freigabe.error;

  // Vor der Abrechnung lässt sich die Abrechnungsart noch ändern.
  const zuFestbetrag = { abrechnungsart: "festbetrag", festbetrag_cent: 89000 };
  const zuStunden = { abrechnungsart: "stunden", festbetrag_cent: null };
  for (const aenderung of [zuFestbetrag, zuStunden]) {
    const { error } = await alsBuero
      .from("zusatzauftrag")
      .update(aenderung)
      .eq("id", zusatzauftragId);
    expect(error, JSON.stringify(aenderung)).toBeNull();
  }

  const { data: id } = await markiere(alsBuero, kunde, {
    eintraege: [...kunde.freigegebene, maerz],
  });
  expect(await abgerechnetIn([maerz])).toEqual([id]);

  // Danach würde ein Festbetrag die schon berechneten Stunden noch einmal
  // bezahlen. Auch der Dienstschlüssel stellt nicht um.
  for (const [supabase, wer] of [
    [alsBuero, "Büro"],
    [dienst, "Dienstschlüssel"],
  ] as const) {
    const { error } = await supabase
      .from("zusatzauftrag")
      .update(zuFestbetrag)
      .eq("id", zusatzauftragId);
    expect(error?.code, wer).toBe("23514");
  }
  // Beschreibung und Status bleiben änderbar.
  const geaendert = await alsBuero
    .from("zusatzauftrag")
    .update({ beschreibung: "Sturmschaden Dach", erledigt: true })
    .eq("id", zusatzauftragId)
    .select("abrechnungsart");
  expect(geaendert.error).toBeNull();
  expect(geaendert.data).toEqual([{ abrechnungsart: "stunden" }]);

  // Nach der Rücknahme ist nichts mehr abgerechnet, und es geht wieder.
  expect((await alsBuero.rpc("abrechnung_zuruecknehmen", { welche: id })).error).toBeNull();
  const umgestellt = await alsBuero
    .from("zusatzauftrag")
    .update(zuFestbetrag)
    .eq("id", zusatzauftragId)
    .select("abrechnungsart");
  expect(umgestellt.error).toBeNull();
  expect(umgestellt.data).toEqual([{ abrechnungsart: "festbetrag" }]);
});
