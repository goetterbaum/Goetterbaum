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
// einen Zusatzauftrag einzeln abrechnet, nur einen erledigten, mit genau
// seiner freigegebenen, noch offenen Zeit, und dass nichts davon danach
// noch einmal abgerechnet wird, bis die Abrechnung zurückgenommen ist.

// Ein Zusatzauftrag im Pauschal-Objekt eines neuen Kunden mit zwei
// freigegebenen Zeiteinträgen im Februar und März 2026 und einem noch
// nicht freigegebenen. Erledigt wird er erst danach, denn Zeit lässt sich
// nur offenen zuordnen. Dazu ein regulärer, freigegebener Eintrag im März.
async function zusatzauftragMitZeit(
  firmaId: string,
  { festbetragCent = null as number | null, erledigt = true } = {},
) {
  const dienst = dienstZugang()!;
  const { kundeId, objektId } = await legeKundeMitObjektAn(dienst, firmaId);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  const mitarbeiter = await legeEigenenZugangAn(firmaId);
  const { zusatzauftragId, beschreibung } = await legeZusatzauftragAn(dienst, firmaId, objektId, {
    festbetragCent,
  });
  const eintrag = (beginn: string, ende: string, fuerAuftrag = true) =>
    legeZeiteintragAn(dienst, {
      firmaId,
      mitarbeiterId: mitarbeiter.id,
      objektId,
      taetigkeitId,
      zusatzauftragId: fuerAuftrag ? zusatzauftragId : undefined,
      beginn,
      ende,
    });
  const februar = await eintrag("2026-02-23T07:03:41Z", "2026-02-23T11:47:12Z");
  const maerz = await eintrag("2026-03-11T07:00:51Z", "2026-03-11T09:31:20Z");
  const regulaer = await eintrag("2026-03-12T07:04:19Z", "2026-03-12T09:41:52Z", false);
  const freigabe = await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-01T08:00:00Z" })
    .in("id", [februar, maerz, regulaer]);
  if (freigabe.error) throw freigabe.error;
  const offen = await eintrag("2026-03-16T07:00:44Z", "2026-03-16T09:02:03Z");
  if (erledigt) await setzeErledigt(zusatzauftragId, true);
  return {
    kundeId,
    objektId,
    mitarbeiter,
    zusatzauftragId,
    beschreibung,
    februar,
    maerz,
    regulaer,
    offen,
  };
}

type Auftrag = Awaited<ReturnType<typeof zusatzauftragMitZeit>>;

async function setzeErledigt(zusatzauftragId: string, erledigt: boolean) {
  const { error } = await dienstZugang()!
    .from("zusatzauftrag")
    .update({ erledigt })
    .eq("id", zusatzauftragId);
  if (error) throw error;
}

function rechneEinzelnAb(
  supabase: SupabaseClient,
  auftrag: Auftrag,
  {
    welcher = auftrag.zusatzauftragId,
    eintraege = [auftrag.februar, auftrag.maerz],
  }: { welcher?: string; eintraege?: string[] } = {},
) {
  return supabase.rpc("zusatzauftrag_einzeln_abrechnen", {
    welcher,
    eintraege,
    aufstellung: [{ art: "zusatzauftrag-stunden", zusatzauftragId: welcher }],
    summe: 12345,
  });
}

async function abrechnungenVon(kundeId: string) {
  const { data, error } = await dienstZugang()!
    .from("abrechnung")
    .select("id, erster_monat, abrechnungszeitraum, zusatzauftrag_id, summe_cent, abgerechnet_von")
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

async function zusatzauftragAbgerechnetIn(id: string) {
  const { data, error } = await dienstZugang()!
    .from("zusatzauftrag")
    .select("abgerechnet_in")
    .eq("id", id)
    .single<{ abgerechnet_in: string | null }>();
  if (error) throw error;
  return data.abgerechnet_in;
}

test("Nur das Büro der eigenen Firma rechnet einen Zusatzauftrag einzeln ab, ohne Zeitraum", async () => {
  const { firmaA, firmaB } = testdaten();
  const auftrag = await zusatzauftragMitZeit(firmaA.id);
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");

  for (const [zugang, code] of [
    [auftrag.mitarbeiter, "42501"],
    [vorarbeiter, "42501"],
    // Den Zusatzauftrag einer anderen Firma gibt es für sie nicht.
    [firmaB.buero, "P0002"],
  ] as const) {
    const { error } = await rechneEinzelnAb(await schnittstelleAls(zugang), auftrag);
    expect(error?.code, zugang.name).toBe(code);
  }
  expect(await abrechnungenVon(auftrag.kundeId)).toEqual([]);

  const alsBuero = await schnittstelleAls(buero);
  const { data: id, error } = await rechneEinzelnAb(alsBuero, auftrag);
  expect(error).toBeNull();
  expect(await abrechnungenVon(auftrag.kundeId)).toEqual([
    {
      id,
      erster_monat: null,
      abrechnungszeitraum: null,
      zusatzauftrag_id: auftrag.zusatzauftragId,
      summe_cent: 12345,
      abgerechnet_von: buero.id,
    },
  ]);
  // Nur die Zeit des Zusatzauftrags, aus allen Monaten; ein Zusatzauftrag
  // nach Stunden wird nicht selbst markiert.
  expect(
    await abgerechnetIn([auftrag.februar, auftrag.maerz, auftrag.regulaer, auftrag.offen]),
  ).toEqual([id, id, null, null]);
  expect(await zusatzauftragAbgerechnetIn(auftrag.zusatzauftragId)).toBeNull();

  // Die Liste der Abrechnungen nennt den Zusatzauftrag, nur fürs Büro.
  const { data: liste } = await alsBuero.rpc("abrechnungen_des_kunden", {
    fuer_kunde: auftrag.kundeId,
  });
  expect(liste).toEqual([
    expect.objectContaining({
      id,
      erster_monat: null,
      abrechnungszeitraum: null,
      zusatzauftrag_id: auftrag.zusatzauftragId,
      zusatzauftrag_beschreibung: auftrag.beschreibung,
      abgerechnet_von_name: buero.name,
    }),
  ]);
  for (const zugang of [auftrag.mitarbeiter, firmaB.buero]) {
    const { data } = await (
      await schnittstelleAls(zugang)
    ).rpc("abrechnungen_des_kunden", { fuer_kunde: auftrag.kundeId });
    expect(data, zugang.name).toEqual([]);
  }
});

test("Einzeln abgerechnet wird nur ein erledigter Zusatzauftrag, mit genau seiner freigegebenen, offenen Zeit", async () => {
  const { firmaA } = testdaten();
  const auftrag = await zusatzauftragMitZeit(firmaA.id);
  const offenerAuftrag = await zusatzauftragMitZeit(firmaA.id, { erledigt: false });
  const fremd = await zusatzauftragMitZeit(firmaA.id);
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));

  // Was nicht passt, lehnt die Datenbank ab und speichert nichts.
  const falsch = [
    { welcher: offenerAuftrag.zusatzauftragId, eintraege: [offenerAuftrag.februar] },
    // Vergessen: der Februar-Eintrag.
    { eintraege: [auftrag.maerz] },
    { eintraege: [] },
    // Zu viel: noch nicht freigegeben, regulär, von einem anderen Auftrag.
    { eintraege: [auftrag.februar, auftrag.maerz, auftrag.offen] },
    { eintraege: [auftrag.februar, auftrag.maerz, auftrag.regulaer] },
    { eintraege: [auftrag.februar, auftrag.maerz, fremd.maerz] },
  ];
  for (const auswahl of falsch) {
    const { error } = await rechneEinzelnAb(alsBuero, auftrag, auswahl);
    expect(error?.code, JSON.stringify(auswahl)).toBe("23514");
  }
  expect(await abrechnungenVon(auftrag.kundeId)).toEqual([]);
  expect(await abrechnungenVon(offenerAuftrag.kundeId)).toEqual([]);
  expect(await abgerechnetIn([auftrag.februar, auftrag.maerz, fremd.maerz])).toEqual([
    null,
    null,
    null,
  ]);

  // Ein zweites Mal geht nicht: Es ist nichts mehr offen.
  const { data: id, error } = await rechneEinzelnAb(alsBuero, auftrag);
  expect(error).toBeNull();
  const nochmal = await rechneEinzelnAb(alsBuero, auftrag);
  expect(nochmal.error?.code).toBe("23514");
  const leer = await rechneEinzelnAb(alsBuero, auftrag, { eintraege: [] });
  expect(leer.error?.code).toBe("23514");
  expect(await abrechnungenVon(auftrag.kundeId)).toHaveLength(1);

  // Auch die reguläre Abrechnung des Kunden umfasst die Zeit nicht mehr.
  const regulaer = await alsBuero.rpc("als_abgerechnet_markieren", {
    fuer_kunde: auftrag.kundeId,
    ab_monat: "2026-03-01",
    eintraege: [auftrag.maerz],
    monate: [],
    aufstellung: [],
    summe: 0,
  });
  expect(regulaer.error?.code).toBe("23514");
  expect(await abgerechnetIn([auftrag.maerz])).toEqual([id]);
});

test("Ein einzeln abgerechneter Festbetrag ist gesperrt und nach der Rücknahme wieder abrechenbar", async () => {
  const { firmaA, firmaB } = testdaten();
  const auftrag = await zusatzauftragMitZeit(firmaA.id, { festbetragCent: 89000 });
  const alsBuero = await schnittstelleAls(await legeEigenenZugangAn(firmaA.id, "buero"));

  const { data: id, error } = await rechneEinzelnAb(alsBuero, auftrag);
  expect(error).toBeNull();
  expect(await zusatzauftragAbgerechnetIn(auftrag.zusatzauftragId)).toBe(id);
  expect(await abgerechnetIn([auftrag.februar, auftrag.maerz, auftrag.offen])).toEqual([
    id,
    id,
    null,
  ]);

  // Gesperrt: weder Betrag noch Status ändern sich, und weder einzeln noch
  // regulär wird er ein zweites Mal abgerechnet.
  const geaendert = await alsBuero
    .from("zusatzauftrag")
    .update({ festbetrag_cent: 50000 })
    .eq("id", auftrag.zusatzauftragId);
  expect(geaendert.error?.code).toBe("23514");
  const nochmal = await rechneEinzelnAb(alsBuero, auftrag, { eintraege: [] });
  expect(nochmal.error?.code).toBe("23514");
  const regulaer = await alsBuero.rpc("als_abgerechnet_markieren", {
    fuer_kunde: auftrag.kundeId,
    ab_monat: "2026-03-01",
    eintraege: [],
    monate: [],
    aufstellung: [],
    summe: 0,
    zusatzauftraege: [auftrag.zusatzauftragId],
  });
  expect(regulaer.error?.code).toBe("23514");
  expect(await abrechnungenVon(auftrag.kundeId)).toHaveLength(1);

  // Zurücknehmen darf nur das Büro der eigenen Firma.
  for (const [zugang, code] of [
    [auftrag.mitarbeiter, "42501"],
    [firmaB.buero, "P0002"],
  ] as const) {
    const { error } = await (
      await schnittstelleAls(zugang)
    ).rpc("abrechnung_zuruecknehmen", { welche: id });
    expect(error?.code, zugang.name).toBe(code);
  }
  expect((await alsBuero.rpc("abrechnung_zuruecknehmen", { welche: id })).error).toBeNull();
  expect(await zusatzauftragAbgerechnetIn(auftrag.zusatzauftragId)).toBeNull();
  expect(await abgerechnetIn([auftrag.februar, auftrag.maerz])).toEqual([null, null]);

  // Danach lässt er sich wieder einzeln abrechnen, mit der inzwischen
  // freigegebenen Zeit.
  const freigabe = await dienstZugang()!
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-04-02T08:00:00Z" })
    .eq("id", auftrag.offen);
  if (freigabe.error) throw freigabe.error;
  const neu = await rechneEinzelnAb(alsBuero, auftrag, {
    eintraege: [auftrag.februar, auftrag.maerz, auftrag.offen],
  });
  expect(neu.error).toBeNull();
  expect(await zusatzauftragAbgerechnetIn(auftrag.zusatzauftragId)).toBe(neu.data);
});
