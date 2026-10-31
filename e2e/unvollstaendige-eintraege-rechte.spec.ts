import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { schnittstelleAls, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  legeEigenenZugangAn,
  legeKundeMitObjektAn,
  legeTaetigkeitAn,
  legeZeiteintragAn,
  legeZugangAn,
} from "./testumgebung/testdaten";

// Diese Tests gehen an der App vorbei direkt auf die öffentliche
// Supabase-Schnittstelle. Sie prüfen, dass die Datenbank bei einem
// unvollständigen Eintrag (läuft seit mehr als 12 Stunden) das angegebene
// Ende übernimmt und ihn zum Nachtrag macht, bei jedem anderen laufenden
// aber weiterhin ihre eigene Uhr.

// Spielraum für Uhren, die zwischen Testrechner und Datenbank abweichen.
const UHR_SPIELRAUM_MS = 2 * 60 * 1000;
const STUNDE = 60 * 60 * 1000;
// Live-Zeiten haben Sekunden.
const vor = (stunden: number) =>
  new Date(Math.floor((Date.now() - stunden * STUNDE) / 1000) * 1000 - 17_000).toISOString();

async function laufenderEintrag(firmaId: string, mitarbeiterId: string, beginn: string) {
  const dienst = dienstZugang()!;
  const { objektId } = await legeKundeMitObjektAn(dienst, firmaId);
  const { taetigkeitId } = await legeTaetigkeitAn(dienst, firmaId);
  return legeZeiteintragAn(dienst, {
    firmaId,
    mitarbeiterId,
    objektId,
    taetigkeitId,
    beginn,
    ende: null,
  });
}

async function gespeicherterEintrag(id: string) {
  const { data } = await dienstZugang()!
    .from("zeiteintrag")
    .select("beginn, ende, nachtrag, arbeitstag_endet_hier")
    .eq("id", id)
    .single<{
      beginn: string;
      ende: string | null;
      nachtrag: boolean;
      arbeitstag_endet_hier: boolean;
    }>();
  return data!;
}

test("Ein Mitarbeiter trägt das Ende seines unvollständigen Eintrags nach; er wird zum Nachtrag und beendet den Arbeitstag", async () => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const beginn = vor(13);
  const id = await laufenderEintrag(firmaA.id, ich.id, beginn);
  const supabase = await schnittstelleAls(ich);

  // Von selbst beendet wird nichts.
  expect(await gespeicherterEintrag(id)).toMatchObject({
    ende: null,
    nachtrag: false,
    arbeitstag_endet_hier: false,
  });

  // In der Zukunft oder vor dem Beginn geht nicht.
  for (const ende of [vor(-1), vor(14)]) {
    const falsch = await supabase.from("zeiteintrag").update({ ende }).eq("id", id);
    expect(falsch.error?.code, ende).toBe("23514");
  }
  expect((await gespeicherterEintrag(id)).ende).toBeNull();

  const ende = vor(5);
  const { data, error } = await supabase
    .from("zeiteintrag")
    .update({ ende })
    .eq("id", id)
    .select("id");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  const gespeichert = await gespeicherterEintrag(id);
  expect(gespeichert.nachtrag).toBe(true);
  expect(gespeichert.arbeitstag_endet_hier).toBe(true);
  expect(Date.parse(gespeichert.ende!)).toBe(Date.parse(ende));
  expect(Date.parse(gespeichert.beginn)).toBe(Date.parse(beginn));
});

test("Bei einem Eintrag, der noch keine 12 Stunden läuft, setzt der Stopp weiterhin die Uhr der Datenbank", async () => {
  const { firmaA } = testdaten();
  const ich = await legeEigenenZugangAn(firmaA.id);
  const id = await laufenderEintrag(firmaA.id, ich.id, vor(11.5));
  const supabase = await schnittstelleAls(ich);

  const { error } = await supabase
    .from("zeiteintrag")
    .update({ ende: vor(5) })
    .eq("id", id);
  expect(error).toBeNull();
  const gespeichert = await gespeicherterEintrag(id);
  expect(gespeichert.nachtrag).toBe(false);
  // Ein normales Ende beendet keinen Arbeitstag.
  expect(gespeichert.arbeitstag_endet_hier).toBe(false);
  expect(Math.abs(Date.parse(gespeichert.ende!) - Date.now())).toBeLessThan(UHR_SPIELRAUM_MS);
});

test("Vorarbeiter tragen das Ende für andere nach, normale Mitarbeiter nicht", async () => {
  const { firmaA } = testdaten();
  const betroffener = await legeEigenenZugangAn(firmaA.id);
  const kollege = await legeEigenenZugangAn(firmaA.id);
  const vorarbeiter = await legeEigenenZugangAn(firmaA.id, "vorarbeiter");
  const id = await laufenderEintrag(firmaA.id, betroffener.id, vor(20));
  const ende = vor(10);

  const alsKollege = await (
    await schnittstelleAls(kollege)
  )
    .from("zeiteintrag")
    .update({ ende })
    .eq("id", id)
    .select("id");
  expect(alsKollege.data).toHaveLength(0);
  expect((await gespeicherterEintrag(id)).ende).toBeNull();

  const alsVorarbeiter = await (
    await schnittstelleAls(vorarbeiter)
  )
    .from("zeiteintrag")
    .update({ ende })
    .eq("id", id)
    .select("id");
  expect(alsVorarbeiter.data).toHaveLength(1);
  const gespeichert = await gespeicherterEintrag(id);
  expect(gespeichert.nachtrag).toBe(true);
  expect(Date.parse(gespeichert.ende!)).toBe(Date.parse(ende));
});

test("Das Büro trägt das Ende auch für deaktivierte Mitarbeiter nach", async () => {
  const { firmaA } = testdaten();
  const buero = await legeEigenenZugangAn(firmaA.id, "buero");
  const ehemaliger = await legeZugangAn(dienstZugang()!, firmaA.id, {
    name: `Ehemaliger ${randomUUID().slice(0, 8)}`,
    rolle: "mitarbeiter",
    aktiv: false,
  });
  const id = await laufenderEintrag(firmaA.id, ehemaliger.id, vor(40));
  const ende = vor(31);

  const { data, error } = await (
    await schnittstelleAls(buero)
  )
    .from("zeiteintrag")
    .update({ ende })
    .eq("id", id)
    .select("id");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  const gespeichert = await gespeicherterEintrag(id);
  expect(gespeichert.nachtrag).toBe(true);
  expect(Date.parse(gespeichert.ende!)).toBe(Date.parse(ende));
});
