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
// Supabase-Schnittstelle. Sie prüfen, dass die Datenbank selbst schützt:
// Den Zusatzauftrag eines freigegebenen Zeiteintrags ändert nur das Büro,
// jede Änderung steht im Protokoll, und abgerechnete sind für alle
// gesperrt.

async function gespeicherteZuordnung(zeiteintragId: string) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("zusatzauftrag_id")
    .eq("id", zeiteintragId)
    .single<{ zusatzauftrag_id: string | null }>();
  return data!.zusatzauftrag_id;
}

test("Den Zusatzauftrag eines freigegebenen Zeiteintrags ändert und entfernt nur das Büro, mit Protokoll, bis er abgerechnet ist", async () => {
  const { firmaA } = testdaten();
  const dienst = dienstZugang()!;
  const mitarbeiter = await legeEigenenZugangAn(firmaA.id);
  const { kundeId, objektId } = await legeKundeMitObjektAn(dienst, firmaA.id);
  const anderes = await legeKundeMitObjektAn(dienst, firmaA.id);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaA.id);
  const sturmschaden = await legeZusatzauftragAn(dienst, firmaA.id, objektId);
  const laub = await legeZusatzauftragAn(dienst, firmaA.id, objektId);
  const amAnderen = await legeZusatzauftragAn(dienst, firmaA.id, anderes.objektId);
  // 12.03.2026, 07:04:31 bis 09:47:12 in Berlin (Winterzeit, UTC + 1 Stunde).
  const id = await legeZeiteintragAn(dienst, {
    firmaId: firmaA.id,
    mitarbeiterId: mitarbeiter.id,
    objektId,
    taetigkeitId,
    zusatzauftragId: sturmschaden.zusatzauftragId,
    beginn: "2026-03-12T06:04:31Z",
    ende: "2026-03-12T08:47:12Z",
  });
  await dienst
    .from("zeiteintrag")
    .update({ freigegeben_am: "2026-03-13T08:00:00Z" })
    .eq("id", id)
    .throwOnError();

  // Mitarbeiter und Vorarbeiter finden den freigegebenen Eintrag zum
  // Ändern gar nicht, auch nicht zum Entfernen der Zuordnung.
  for (const zugang of [mitarbeiter, firmaA.vorarbeiter]) {
    const supabase = await schnittstelleAls(zugang);
    for (const zusatzauftrag_id of [laub.zusatzauftragId, null]) {
      const { data, error } = await supabase
        .from("zeiteintrag")
        .update({ zusatzauftrag_id })
        .eq("id", id)
        .select("id");
      expect(error, zugang.name).toBeNull();
      expect(data, zugang.name).toEqual([]);
    }
  }
  expect(await gespeicherteZuordnung(id)).toBe(sturmschaden.zusatzauftragId);

  // Das Büro hängt um und entfernt, aber nur Zusatzaufträge desselben
  // Objekts.
  const buero = await schnittstelleAls(firmaA.buero);
  const fremdesObjekt = await buero
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: amAnderen.zusatzauftragId })
    .eq("id", id);
  expect(fremdesObjekt.error?.code).toBe("23503");
  for (const zusatzauftrag_id of [laub.zusatzauftragId, null]) {
    const { data, error } = await buero
      .from("zeiteintrag")
      .update({ zusatzauftrag_id })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await gespeicherteZuordnung(id)).toBe(zusatzauftrag_id);
  }

  // Beides steht mit Namen im Protokoll, nach dem Anlegen und der Freigabe
  // (beide ohne Benutzer, über den Dienstschlüssel).
  const { data: protokoll } = await buero.rpc("protokoll_zum_zeiteintrag", { eintrag: id });
  expect(
    protokoll.map(
      (p: {
        geaendert_von_name: string | null;
        vorher: { zusatzauftrag_id: string | null } | null;
        nachher: { zusatzauftrag_id: string | null };
      }) => [p.geaendert_von_name, p.vorher?.zusatzauftrag_id, p.nachher.zusatzauftrag_id],
    ),
  ).toEqual([
    [null, undefined, sturmschaden.zusatzauftragId],
    [null, sturmschaden.zusatzauftragId, sturmschaden.zusatzauftragId],
    [firmaA.buero.name, sturmschaden.zusatzauftragId, laub.zusatzauftragId],
    [firmaA.buero.name, laub.zusatzauftragId, null],
  ]);

  // Abgerechnet lässt er sich nicht mehr umhängen, auch nicht vom Büro.
  const { error: abrechnen } = await buero.rpc("als_abgerechnet_markieren", {
    fuer_kunde: kundeId,
    ab_monat: "2026-03-01",
    eintraege: [id],
    monate: [],
    aufstellung: [{ art: "pauschale", objektId, monat: "2026-03" }],
    summe: 50000,
  });
  expect(abrechnen).toBeNull();
  const umhaengen = await buero
    .from("zeiteintrag")
    .update({ zusatzauftrag_id: sturmschaden.zusatzauftragId })
    .eq("id", id);
  expect(umhaengen.error?.code).toBe("23514");
  expect(await gespeicherteZuordnung(id)).toBeNull();
});
