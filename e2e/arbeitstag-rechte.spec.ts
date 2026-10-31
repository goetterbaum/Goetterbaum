import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { schnittstelleAls, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  oeffentlicherZugang,
} from "./testumgebung/testdaten";

// Diese Tests gehen an der App vorbei direkt auf die öffentliche
// Supabase-Schnittstelle. Sie prüfen die Schritte „Fertig hier“, Start
// während einer Fahrt, „Pause“, „Fahrt starten“ und „Arbeitstag beenden“
// in der Datenbank selbst.

// Spielraum für Uhren, die zwischen Testrechner und Datenbank abweichen.
const UHR_SPIELRAUM_MS = 2 * 60 * 1000;
const MINUTE = 60 * 1000;
// Live-Zeiten haben Sekunden.
const vorMinuten = (minuten: number) =>
  new Date(Math.floor((Date.now() - minuten * MINUTE) / 1000) * 1000 - 13_000).toISOString();

type Gespeichert = {
  id: string;
  art: "taetigkeit" | "fahrt";
  objekt_id: string | null;
  beginn: string;
  ende: string | null;
  nachtrag: boolean;
  arbeitstag_endet_hier: boolean;
  angelegt_von: string;
};

// Alle Einträge eines Mitarbeiters, am eigenen Zugang vorbei gelesen.
async function eintraegeVon(mitarbeiterId: string) {
  const { data, error } = await dienstZugang()!
    .from("zeiteintrag")
    .select("id, art, objekt_id, beginn, ende, nachtrag, arbeitstag_endet_hier, angelegt_von")
    .eq("mitarbeiter_id", mitarbeiterId)
    .order("beginn")
    .returns<Gespeichert[]>();
  if (error) throw error;
  return data;
}

function erwarteJetzt(zeitpunkt: string | null) {
  expect(zeitpunkt).not.toBeNull();
  expect(Math.abs(Date.parse(zeitpunkt!) - Date.now())).toBeLessThan(UHR_SPIELRAUM_MS);
}

// Ein aktives Objekt und eine aktive Tätigkeit einer Firma.
async function auswahl(firmaId: string) {
  const dienst = dienstZugang()!;
  const { objektId } = await legeKundeMitObjektAn(dienst, firmaId);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  return { objektId, taetigkeitId };
}

function starten(
  supabase: SupabaseClient,
  wer: string,
  { objektId, taetigkeitId }: { objektId: string; taetigkeitId: string },
) {
  return supabase.rpc("zeiteintrag_starten", { wer, objekt: objektId, taetigkeit: taetigkeitId });
}

test("„Fertig hier“ beendet das Objekt und startet die Fahrt in einem Schritt; doppelt geht nicht", async () => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);
  const supabase = await schnittstelleAls(ich);

  // Läuft nichts, beginnt der Start einfach das Objekt.
  const start = await starten(supabase, ich.id, objekt);
  expect(start.error).toBeNull();
  const [gestartet] = await eintraegeVon(ich.id);
  expect(gestartet).toMatchObject({
    id: start.data,
    art: "taetigkeit",
    ende: null,
    angelegt_von: ich.id,
    nachtrag: false,
  });
  erwarteJetzt(gestartet.beginn);

  const fertig = await supabase.rpc("fertig_hier", { wer: ich.id });
  expect(fertig.error).toBeNull();
  const [beendet, fahrt] = await eintraegeVon(ich.id);
  expect(beendet).toMatchObject({
    id: gestartet.id,
    nachtrag: false,
    arbeitstag_endet_hier: false,
  });
  expect(fahrt).toMatchObject({
    id: fertig.data,
    art: "fahrt",
    objekt_id: null,
    ende: null,
    nachtrag: false,
    angelegt_von: ich.id,
  });
  erwarteJetzt(beendet.ende);
  // Ohne Lücke und ohne Überschneidung.
  expect(beendet.ende).toBe(fahrt.beginn);

  // Ein zweiter Druck (oder ein zweites Gerät) findet kein laufendes Objekt
  // mehr und ändert nichts.
  const nochmal = await supabase.rpc("fertig_hier", { wer: ich.id });
  expect(nochmal.error?.code).toBe("P0002");
  expect(await eintraegeVon(ich.id)).toEqual([beendet, fahrt]);
});

test("Ein Start während der Fahrt beendet sie ohne Lücke; eine Mini-Fahrt wird entfernt", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const ich = await legeEigenenZugangAn(firmaA.id);
  const erstes = await auswahl(firmaA.id);
  const zweites = await auswahl(firmaA.id);
  const supabase = await schnittstelleAls(ich);

  // Eine Fahrt, die seit 10 Minuten läuft, bleibt gespeichert.
  const objektVorher = await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: ich.id,
    ...erstes,
    beginn: vorMinuten(70),
    ende: vorMinuten(10),
  });
  const fahrtId = await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: ich.id,
    beginn: vorMinuten(10),
    ende: null,
  });

  // Läuft schon ein Objekt, wird nichts beendet: Erst ein archiviertes
  // Objekt, dann ein laufendes. Beides scheitert ganz.
  const archiviert = await auswahl(firmaA.id);
  await dienst.from("objekt").update({ archiviert: true }).eq("id", archiviert.objektId);
  const mitArchiviertem = await starten(supabase, ich.id, archiviert);
  expect(mitArchiviertem.error?.code).toBe("23514");
  expect((await eintraegeVon(ich.id)).map((e) => [e.id, e.ende === null])).toEqual([
    [objektVorher, false],
    [fahrtId, true],
  ]);

  const start = await starten(supabase, ich.id, zweites);
  expect(start.error).toBeNull();
  const [, fahrt, objekt] = await eintraegeVon(ich.id);
  expect(fahrt).toMatchObject({ id: fahrtId, nachtrag: false, arbeitstag_endet_hier: false });
  expect(objekt).toMatchObject({ id: start.data, objekt_id: zweites.objektId, ende: null });
  erwarteJetzt(fahrt.ende);
  expect(fahrt.ende).toBe(objekt.beginn);

  // Während ein Objekt läuft, startet kein zweites (doppelter Druck).
  const doppelt = await starten(supabase, ich.id, zweites);
  expect(doppelt.error?.code).toBe("23505");
  expect(await eintraegeVon(ich.id)).toHaveLength(3);

  // Mini-Fahrt: gleich nach „Fertig hier“ das nächste Objekt.
  const fertig = await supabase.rpc("fertig_hier", { wer: ich.id });
  expect(fertig.error).toBeNull();
  const naechster = await starten(supabase, ich.id, erstes);
  expect(naechster.error).toBeNull();
  const danach = await eintraegeVon(ich.id);
  expect(danach.map((e) => e.id)).toEqual([objektVorher, fahrtId, start.data, naechster.data]);
  // Mit ihr verschwindet auch ihr Protokoll.
  const { data: protokoll } = await dienst
    .from("zeiteintrag_protokoll")
    .select("id")
    .eq("zeiteintrag_id", fertig.data);
  expect(protokoll).toEqual([]);
});

test("„Arbeitstag beenden“ setzt den Vermerk; eine Fahrt bleibt als Rückfahrt, eine Mini-Fahrt nicht", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);
  const supabase = await schnittstelleAls(ich);

  // Läuft nichts, gibt es nichts zu beenden.
  const ohneLaufenden = await supabase.rpc("arbeitstag_beenden", { wer: ich.id });
  expect(ohneLaufenden.error?.code).toBe("P0002");

  // Während eines Objekts: Es endet, und keine Fahrt startet.
  expect((await starten(supabase, ich.id, objekt)).error).toBeNull();
  expect((await supabase.rpc("arbeitstag_beenden", { wer: ich.id })).error).toBeNull();
  const [amObjekt] = await eintraegeVon(ich.id);
  expect(amObjekt).toMatchObject({ arbeitstag_endet_hier: true, nachtrag: false });
  erwarteJetzt(amObjekt.ende);
  expect(await eintraegeVon(ich.id)).toHaveLength(1);

  // Während einer Fahrt ab 2 Minuten: Sie bleibt als Rückfahrt.
  await dienst
    .from("zeiteintrag")
    .update({ beginn: vorMinuten(90), ende: vorMinuten(60) })
    .eq("id", amObjekt.id);
  const rueckfahrt = await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: ich.id,
    beginn: vorMinuten(5),
    ende: null,
  });
  expect((await supabase.rpc("arbeitstag_beenden", { wer: ich.id })).error).toBeNull();
  const [, gespeichert] = await eintraegeVon(ich.id);
  expect(gespeichert).toMatchObject({
    id: rueckfahrt,
    art: "fahrt",
    arbeitstag_endet_hier: true,
    nachtrag: false,
  });
  erwarteJetzt(gespeichert.ende);

  // Mini-Fahrt: Sie wird entfernt, der Vermerk kommt auf den Eintrag davor.
  expect((await starten(supabase, ich.id, objekt)).error).toBeNull();
  expect((await supabase.rpc("fertig_hier", { wer: ich.id })).error).toBeNull();
  const mitMini = await eintraegeVon(ich.id);
  expect(mitMini).toHaveLength(4);
  expect((await supabase.rpc("arbeitstag_beenden", { wer: ich.id })).error).toBeNull();
  const ohneMini = await eintraegeVon(ich.id);
  expect(ohneMini.map((e) => e.id)).toEqual(mitMini.slice(0, 3).map((e) => e.id));
  expect(ohneMini[2]).toMatchObject({
    art: "taetigkeit",
    arbeitstag_endet_hier: true,
    // Der Vermerk ändert weder Beginn noch Ende.
    beginn: mitMini[2].beginn,
    ende: mitMini[2].ende,
    nachtrag: false,
  });
});

test("Ein unvollständiger Eintrag wird von keinem Schritt beendet", async () => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);
  const supabase = await schnittstelleAls(ich);
  await legeZeiteintragAn(dienstZugang()!, {
    firmaId: firmaA.id,
    mitarbeiterId: ich.id,
    ...objekt,
    beginn: vorMinuten(13 * 60),
    ende: null,
  });
  const vorher = await eintraegeVon(ich.id);

  for (const schritt of ["fertig_hier", "pause_machen", "arbeitstag_beenden"] as const) {
    const { error } = await supabase.rpc(schritt, { wer: ich.id });
    expect(error?.code, schritt).toBe("P0002");
  }
  expect((await starten(supabase, ich.id, objekt)).error?.code).toBe("23505");
  expect(await eintraegeVon(ich.id)).toEqual(vorher);
});

test("Den Vermerk „Arbeitstag endet hier“ setzt niemand direkt", async () => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);
  const id = await legeZeiteintragAn(dienstZugang()!, {
    firmaId: firmaA.id,
    mitarbeiterId: ich.id,
    ...objekt,
    beginn: vorMinuten(120),
    ende: vorMinuten(60),
  });

  for (const zugang of [ich, firmaA.buero]) {
    const supabase = await schnittstelleAls(zugang);
    const aendern = await supabase
      .from("zeiteintrag")
      .update({ arbeitstag_endet_hier: true })
      .eq("id", id);
    expect(aendern.error?.code, zugang.name).toBe("42501");
  }
  const anlegen = await (await schnittstelleAls(ich)).from("zeiteintrag").insert({
    firma_id: firmaA.id,
    mitarbeiter_id: ich.id,
    art: "fahrt",
    arbeitstag_endet_hier: true,
  });
  expect(anlegen.error?.code).toBe("42501");
  expect((await eintraegeVon(ich.id)).map((e) => e.arbeitstag_endet_hier)).toEqual([false]);
});

test("Die Schritte gibt es für sich selbst, als Vorarbeiter und Büro für Kollegen, nie für fremde Firmen", async () => {
  const { firmaA, firmaB } = testdaten();
  const kollege = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);

  // Ein normaler Mitarbeiter und das Büro einer anderen Firma können für
  // den Kollegen nichts starten, beenden oder wechseln.
  await legeZeiteintragAn(dienstZugang()!, {
    firmaId: firmaA.id,
    mitarbeiterId: kollege.id,
    ...objekt,
    beginn: vorMinuten(30),
    ende: null,
  });
  const vorher = await eintraegeVon(kollege.id);
  for (const zugang of [firmaA.mitarbeiter, firmaB.buero]) {
    const supabase = await schnittstelleAls(zugang);
    for (const schritt of ["fertig_hier", "pause_machen", "arbeitstag_beenden"] as const) {
      const { error } = await supabase.rpc(schritt, { wer: kollege.id });
      expect(error, `${zugang.name}: ${schritt}`).not.toBeNull();
    }
    expect((await starten(supabase, kollege.id, objekt)).error, zugang.name).not.toBeNull();
  }
  expect(await eintraegeVon(kollege.id)).toEqual(vorher);

  // Vorarbeiter und Büro der eigenen Firma schon; angelegt hat dann er.
  for (const zugang of [firmaA.vorarbeiter, firmaA.buero]) {
    const supabase = await schnittstelleAls(zugang);
    const fertig = await supabase.rpc("fertig_hier", { wer: kollege.id });
    expect(fertig.error, zugang.name).toBeNull();
    const start = await starten(supabase, kollege.id, objekt);
    expect(start.error, zugang.name).toBeNull();
    const ende = await supabase.rpc("arbeitstag_beenden", { wer: kollege.id });
    expect(ende.error, zugang.name).toBeNull();
    const zuletzt = (await eintraegeVon(kollege.id)).at(-1)!;
    expect(zuletzt, zugang.name).toMatchObject({
      id: start.data,
      angelegt_von: zugang.id,
      arbeitstag_endet_hier: true,
    });
    // Für die nächste Runde läuft wieder ein Objekt.
    expect((await starten(supabase, kollege.id, objekt)).error, zugang.name).toBeNull();
  }

  // Ohne Anmeldung gibt es keinen der Schritte.
  const ohneAnmeldung = oeffentlicherZugang();
  for (const schritt of ["fertig_hier", "pause_machen", "arbeitstag_beenden"] as const) {
    const { error } = await ohneAnmeldung.rpc(schritt, { wer: kollege.id });
    expect(error, schritt).not.toBeNull();
  }
  expect((await starten(ohneAnmeldung, kollege.id, objekt)).error).not.toBeNull();
});

// Startet live eine Fahrt für wer, wie „Fahrt starten“ in der App.
function fahrtStarten(supabase: SupabaseClient, firmaId: string, wer: string) {
  return supabase
    .from("zeiteintrag")
    .insert({ firma_id: firmaId, mitarbeiter_id: wer, art: "fahrt" })
    .select("id")
    .single<{ id: string }>();
}

test("Ohne offenen Arbeitstag lehnt die Datenbank „Fahrt starten“ ab, als Nachtrag nicht", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const objekt = await auswahl(firmaA.id);
  // Ein Mitarbeiter, dessen letzter Eintrag vor minuten Minuten endete.
  async function zuletztVor(minuten: number, arbeitstag_endet_hier = false) {
    const zugang = await legeEigenenZugangAn(firmaA.id);
    const id = await legeZeiteintragAn(dienst, {
      firmaId: firmaA.id,
      mitarbeiterId: zugang.id,
      ...objekt,
      beginn: vorMinuten(minuten + 60),
      ende: vorMinuten(minuten),
    });
    if (arbeitstag_endet_hier) {
      await dienst.from("zeiteintrag").update({ arbeitstag_endet_hier }).eq("id", id);
    }
    return { zugang, supabase: await schnittstelleAls(zugang) };
  }

  // Noch nichts erfasst: Der Arbeitstag beginnt nie mit einer Fahrt.
  const neu = await legeEigenenZugangAn(firmaA.id);
  const alsNeu = await schnittstelleAls(neu);
  expect((await fahrtStarten(alsNeu, firmaA.id, neu.id)).error?.code).toBe("P0002");
  expect(await eintraegeVon(neu.id)).toEqual([]);

  // Nach „Arbeitstag beenden“ und nach mehr als 12 Stunden ohne
  // Zeiteintrag (z. B. gestern, von vor der Umstellung ohne Vermerk) auch
  // nicht. „Arbeitstag beenden“ setzt dann keinen Vermerk an einen
  // älteren Tag.
  for (const [was, { zugang, supabase }] of [
    ["mit Vermerk", await zuletztVor(30, true)],
    ["vor 12 Stunden und 5 Minuten", await zuletztVor(12 * 60 + 5)],
    ["gestern", await zuletztVor(20 * 60)],
  ] as const) {
    const vorher = await eintraegeVon(zugang.id);
    expect((await fahrtStarten(supabase, firmaA.id, zugang.id)).error?.code, was).toBe("P0002");
    const beenden = await supabase.rpc("arbeitstag_beenden", { wer: zugang.id });
    expect(beenden.error?.code, was).toBe("P0002");
    expect(await eintraegeVon(zugang.id), was).toEqual(vorher);
  }

  // Knapp 12 Stunden nach dem letzten Eintrag ist der Arbeitstag noch offen.
  const knapp = await zuletztVor(12 * 60 - 5);
  const fahrt = await fahrtStarten(knapp.supabase, firmaA.id, knapp.zugang.id);
  expect(fahrt.error).toBeNull();
  expect((await eintraegeVon(knapp.zugang.id)).at(-1)).toMatchObject({
    id: fahrt.data!.id,
    ende: null,
    nachtrag: false,
  });

  // Als Nachtrag geht eine Fahrt immer, auch am Tagesbeginn.
  const nachtrag = await alsNeu.from("zeiteintrag").insert({
    firma_id: firmaA.id,
    mitarbeiter_id: neu.id,
    art: "fahrt",
    beginn: vorMinuten(90),
    ende: vorMinuten(60),
  });
  expect(nachtrag.error).toBeNull();
  expect(await eintraegeVon(neu.id)).toMatchObject([{ art: "fahrt", nachtrag: true }]);
});

test("„Pause“ beendet den laufenden Eintrag ohne Vermerk; danach gehen „Fahrt starten“ und „Arbeitstag beenden“", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);
  const supabase = await schnittstelleAls(ich);

  // Läuft nichts, gibt es keine Pause.
  expect((await supabase.rpc("pause_machen", { wer: ich.id })).error?.code).toBe("P0002");

  // Pause am Objekt: Es endet, und nichts startet.
  const start = await starten(supabase, ich.id, objekt);
  expect((await supabase.rpc("pause_machen", { wer: ich.id })).error).toBeNull();
  const [amObjekt] = await eintraegeVon(ich.id);
  expect(amObjekt).toMatchObject({
    id: start.data,
    arbeitstag_endet_hier: false,
    nachtrag: false,
  });
  erwarteJetzt(amObjekt.ende);
  expect(await eintraegeVon(ich.id)).toHaveLength(1);
  // Doppelter Druck: Es läuft nichts mehr.
  expect((await supabase.rpc("pause_machen", { wer: ich.id })).error?.code).toBe("P0002");

  // Nach der Pause startet eine Fahrt; Pause gleich danach entfernt sie
  // als Mini-Fahrt.
  expect((await fahrtStarten(supabase, firmaA.id, ich.id)).error).toBeNull();
  expect((await supabase.rpc("pause_machen", { wer: ich.id })).error).toBeNull();
  expect((await eintraegeVon(ich.id)).map((e) => e.id)).toEqual([amObjekt.id]);

  // Eine Fahrt ab 2 Minuten bleibt bei der Pause gespeichert.
  await dienst
    .from("zeiteintrag")
    .update({ beginn: vorMinuten(90), ende: vorMinuten(30) })
    .eq("id", amObjekt.id);
  const fahrt = await fahrtStarten(supabase, firmaA.id, ich.id);
  expect(fahrt.error).toBeNull();
  await dienst
    .from("zeiteintrag")
    .update({ beginn: vorMinuten(10) })
    .eq("id", fahrt.data!.id);
  expect((await supabase.rpc("pause_machen", { wer: ich.id })).error).toBeNull();
  const nachPause = await eintraegeVon(ich.id);
  expect(nachPause).toMatchObject([
    { id: amObjekt.id, arbeitstag_endet_hier: false },
    { id: fahrt.data!.id, art: "fahrt", arbeitstag_endet_hier: false, nachtrag: false },
  ]);
  erwarteJetzt(nachPause[1].ende);

  // „Arbeitstag beenden“ nach der Pause: Der Vermerk kommt an den zuletzt
  // beendeten Eintrag, ohne Beginn oder Ende zu ändern.
  expect((await supabase.rpc("arbeitstag_beenden", { wer: ich.id })).error).toBeNull();
  expect(await eintraegeVon(ich.id)).toEqual([
    nachPause[0],
    { ...nachPause[1], arbeitstag_endet_hier: true },
  ]);

  // Danach ist der Arbeitstag beendet: kein zweites Beenden, keine Fahrt.
  expect((await supabase.rpc("arbeitstag_beenden", { wer: ich.id })).error?.code).toBe("P0002");
  expect((await fahrtStarten(supabase, firmaA.id, ich.id)).error?.code).toBe("P0002");
  expect(await eintraegeVon(ich.id)).toHaveLength(2);
});

test("Eine Mini-Fahrt nach einer Pause: „Arbeitstag beenden“ setzt den Vermerk an den Eintrag vor der Pause", async () => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);
  const supabase = await schnittstelleAls(ich);
  // Bis vor einer Stunde gearbeitet, dann Pause.
  const vorDerPause = await legeZeiteintragAn(dienstZugang()!, {
    firmaId: firmaA.id,
    mitarbeiterId: ich.id,
    ...objekt,
    beginn: vorMinuten(180),
    ende: vorMinuten(60),
  });

  expect((await fahrtStarten(supabase, firmaA.id, ich.id)).error).toBeNull();
  expect((await supabase.rpc("arbeitstag_beenden", { wer: ich.id })).error).toBeNull();
  expect(await eintraegeVon(ich.id)).toMatchObject([
    { id: vorDerPause, arbeitstag_endet_hier: true, nachtrag: false },
  ]);
  expect(await eintraegeVon(ich.id)).toHaveLength(1);
});

test("Pause, „Fahrt starten“ und Beenden nach der Pause gibt es als Vorarbeiter und Büro für Kollegen, nicht für andere", async () => {
  const { firmaA, firmaB } = testdaten();
  const kollege = await legeEigenenZugangAn(firmaA.id);
  const objekt = await auswahl(firmaA.id);
  const vorarbeiter = await schnittstelleAls(firmaA.vorarbeiter);
  const buero = await schnittstelleAls(firmaA.buero);
  await legeZeiteintragAn(dienstZugang()!, {
    firmaId: firmaA.id,
    mitarbeiterId: kollege.id,
    ...objekt,
    beginn: vorMinuten(30),
    ende: null,
  });

  // Der Vorarbeiter macht für den Kollegen Pause.
  expect((await vorarbeiter.rpc("pause_machen", { wer: kollege.id })).error).toBeNull();
  const nachPause = await eintraegeVon(kollege.id);

  // Ein normaler Mitarbeiter und das Büro einer anderen Firma können nach
  // der Pause weder eine Fahrt starten noch den Arbeitstag beenden.
  for (const zugang of [firmaA.mitarbeiter, firmaB.buero]) {
    const supabase = await schnittstelleAls(zugang);
    for (const firmaId of [firmaA.id, firmaB.id]) {
      const fahrt = await fahrtStarten(supabase, firmaId, kollege.id);
      expect(fahrt.error, zugang.name).not.toBeNull();
    }
    const beenden = await supabase.rpc("arbeitstag_beenden", { wer: kollege.id });
    expect(beenden.error, zugang.name).not.toBeNull();
  }
  const ohneAnmeldung = oeffentlicherZugang();
  expect((await ohneAnmeldung.rpc("pause_machen", { wer: kollege.id })).error).not.toBeNull();
  expect(await eintraegeVon(kollege.id)).toEqual(nachPause);

  // Der Vorarbeiter startet die Fahrt, das Büro beendet den Arbeitstag.
  const fahrt = await fahrtStarten(vorarbeiter, firmaA.id, kollege.id);
  expect(fahrt.error).toBeNull();
  expect((await eintraegeVon(kollege.id)).at(-1)).toMatchObject({
    id: fahrt.data!.id,
    angelegt_von: firmaA.vorarbeiter.id,
  });
  expect((await buero.rpc("arbeitstag_beenden", { wer: kollege.id })).error).toBeNull();
  // Die Fahrt war kürzer als 2 Minuten; der Vermerk kommt ans Objekt.
  expect(await eintraegeVon(kollege.id)).toEqual([
    { ...nachPause[0], arbeitstag_endet_hier: true },
  ]);

  // Danach auch für Vorarbeiter und Büro keine Fahrt mehr.
  for (const supabase of [vorarbeiter, buero]) {
    expect((await fahrtStarten(supabase, firmaA.id, kollege.id)).error?.code).toBe("P0002");
  }
});
