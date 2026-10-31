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
// während einer Fahrt und „Arbeitstag beenden“ in der Datenbank selbst.

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

  for (const schritt of ["fertig_hier", "arbeitstag_beenden"] as const) {
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
    for (const schritt of ["fertig_hier", "arbeitstag_beenden"] as const) {
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
  for (const schritt of ["fertig_hier", "arbeitstag_beenden"] as const) {
    const { error } = await ohneAnmeldung.rpc(schritt, { wer: kollege.id });
    expect(error, schritt).not.toBeNull();
  }
  expect((await starten(ohneAnmeldung, kollege.id, objekt)).error).not.toBeNull();
});
