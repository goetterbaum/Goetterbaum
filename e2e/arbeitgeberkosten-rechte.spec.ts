import { expect, test } from "@playwright/test";
import { schnittstelleAls, testdaten } from "./testumgebung/hilfen";
import {
  dienstZugang,
  entferneFirma,
  legeEigeneFirmaAn,
  legeEigenenZugangAn,
  type Rolle,
} from "./testumgebung/testdaten";

// Diese Tests gehen an der App vorbei direkt auf die öffentliche
// Supabase-Schnittstelle. Sie prüfen, dass die Datenbank selbst schützt.
// Jeder Test hat eine eigene Firma, weil je Firma bzw. Mitarbeiter nur ein
// Wert je „gültig ab“ erlaubt ist.

// Eine eigene Firma mit einer Person der Rolle, dazu ein Standard (26,00 €
// ab 01.01.2026) und ein eigener Wert dieser Person (31,00 € ab
// 01.03.2026).
async function firmaMitArbeitgeberkosten(rolle: Rolle) {
  const dienst = dienstZugang()!;
  const firma = await legeEigeneFirmaAn();
  const person = await legeEigenenZugangAn(firma.id, rolle);
  const { error: standardFehler } = await dienst.from("arbeitgeberkosten_standard").insert({
    firma_id: firma.id,
    gueltig_ab: "2026-01-01",
    kosten_je_stunde_cent: 2600,
  });
  if (standardFehler) throw standardFehler;
  const { error: eigenerFehler } = await dienst.from("arbeitgeberkosten_mitarbeiter").insert({
    firma_id: firma.id,
    mitarbeiter_id: person.id,
    gueltig_ab: "2026-03-01",
    kosten_je_stunde_cent: 3100,
  });
  if (eigenerFehler) throw eigenerFehler;
  return { firma, person };
}

// Der gespeicherte Stand, am eigenen Zugang vorbei gelesen.
async function gespeicherteWerte(firmaId: string) {
  const dienst = dienstZugang()!;
  const standard = await dienst
    .from("arbeitgeberkosten_standard")
    .select("gueltig_ab, kosten_je_stunde_cent")
    .eq("firma_id", firmaId)
    .order("gueltig_ab");
  const eigene = await dienst
    .from("arbeitgeberkosten_mitarbeiter")
    .select("mitarbeiter_id, gueltig_ab, kosten_je_stunde_cent")
    .eq("firma_id", firmaId)
    .order("gueltig_ab")
    .order("kosten_je_stunde_cent");
  return { standard: standard.data, eigene: eigene.data };
}

for (const rolle of ["mitarbeiter", "vorarbeiter"] as const) {
  test(`Ein ${rolle === "mitarbeiter" ? "Mitarbeiter" : "Vorarbeiter"} kann Arbeitgeberkosten über die Schnittstelle weder sehen noch anlegen, ändern oder löschen, auch nicht die eigenen`, async () => {
    const { firma, person } = await firmaMitArbeitgeberkosten(rolle);
    try {
      const vorher = await gespeicherteWerte(firma.id);
      const supabase = await schnittstelleAls(person);

      expect((await supabase.from("arbeitgeberkosten_standard").select("id")).data).toEqual([]);
      expect((await supabase.from("arbeitgeberkosten_mitarbeiter").select("id")).data).toEqual([]);

      const standardAnlegen = await supabase.from("arbeitgeberkosten_standard").insert({
        firma_id: firma.id,
        gueltig_ab: "2026-06-01",
        kosten_je_stunde_cent: 1,
      });
      expect(standardAnlegen.error?.code).toBe("42501");
      const eigenenAnlegen = await supabase.from("arbeitgeberkosten_mitarbeiter").insert({
        firma_id: firma.id,
        mitarbeiter_id: person.id,
        gueltig_ab: "2026-06-01",
        kosten_je_stunde_cent: 1,
      });
      expect(eigenenAnlegen.error?.code).toBe("42501");

      // Die Datenbank findet die Zeilen für ihn gar nicht, ändert also
      // nichts.
      for (const tabelle of ["arbeitgeberkosten_standard", "arbeitgeberkosten_mitarbeiter"]) {
        const geaendert = await supabase
          .from(tabelle)
          .update({ kosten_je_stunde_cent: 1 })
          .eq("firma_id", firma.id)
          .select("id");
        expect(geaendert.error, tabelle).toBeNull();
        expect(geaendert.data, tabelle).toEqual([]);

        await supabase.from(tabelle).delete().eq("firma_id", firma.id);
      }

      expect(await gespeicherteWerte(firma.id)).toEqual(vorher);
      expect(vorher).toEqual({
        standard: [{ gueltig_ab: "2026-01-01", kosten_je_stunde_cent: 2600 }],
        eigene: [
          { mitarbeiter_id: person.id, gueltig_ab: "2026-03-01", kosten_je_stunde_cent: 3100 },
        ],
      });
    } finally {
      await entferneFirma(firma.id);
    }
  });
}

test("Das Büro kann Arbeitgeberkosten einer anderen Firma weder sehen noch anlegen, ändern oder löschen", async () => {
  const { firmaB } = testdaten();
  const { firma, person } = await firmaMitArbeitgeberkosten("mitarbeiter");
  try {
    const vorher = await gespeicherteWerte(firma.id);
    const supabase = await schnittstelleAls(firmaB.buero);

    for (const tabelle of ["arbeitgeberkosten_standard", "arbeitgeberkosten_mitarbeiter"]) {
      expect(
        (await supabase.from(tabelle).select("id").eq("firma_id", firma.id)).data,
        tabelle,
      ).toEqual([]);

      const geaendert = await supabase
        .from(tabelle)
        .update({ kosten_je_stunde_cent: 1 })
        .eq("firma_id", firma.id)
        .select("id");
      expect(geaendert.data, tabelle).toEqual([]);

      await supabase.from(tabelle).delete().eq("firma_id", firma.id);
    }

    const standardAnlegen = await supabase.from("arbeitgeberkosten_standard").insert({
      firma_id: firma.id,
      gueltig_ab: "2026-06-01",
      kosten_je_stunde_cent: 1,
    });
    expect(standardAnlegen.error?.code).toBe("42501");
    const fremdeFirma = await supabase.from("arbeitgeberkosten_mitarbeiter").insert({
      firma_id: firma.id,
      mitarbeiter_id: person.id,
      gueltig_ab: "2026-06-01",
      kosten_je_stunde_cent: 1,
    });
    expect(fremdeFirma.error?.code).toBe("42501");
    // Mit der eigenen Firma als firma_id passt der fremde Mitarbeiter nicht.
    const fremderMitarbeiter = await supabase.from("arbeitgeberkosten_mitarbeiter").insert({
      firma_id: firmaB.id,
      mitarbeiter_id: person.id,
      gueltig_ab: "2026-06-01",
      kosten_je_stunde_cent: 1,
    });
    expect(fremderMitarbeiter.error).not.toBeNull();

    expect(await gespeicherteWerte(firma.id)).toEqual(vorher);
    const { data: beiFirmaB } = await dienstZugang()!
      .from("arbeitgeberkosten_mitarbeiter")
      .select("id")
      .eq("mitarbeiter_id", person.id)
      .eq("firma_id", firmaB.id);
    expect(beiFirmaB).toEqual([]);
  } finally {
    await entferneFirma(firma.id);
  }
});

test("Die Datenbank erlaubt je Firma bzw. Mitarbeiter höchstens einen Wert über 0 € je „gültig ab“, Firma und Mitarbeiter bleiben fest, und das Büro kann ändern und löschen", async () => {
  const { firma, person } = await firmaMitArbeitgeberkosten("mitarbeiter");
  try {
    const anderer = await legeEigenenZugangAn(firma.id);
    const supabase = await schnittstelleAls(firma.buero);

    expect(
      (await supabase.from("arbeitgeberkosten_standard").select("kosten_je_stunde_cent")).data,
    ).toEqual([{ kosten_je_stunde_cent: 2600 }]);
    expect(
      (await supabase.from("arbeitgeberkosten_mitarbeiter").select("kosten_je_stunde_cent")).data,
    ).toEqual([{ kosten_je_stunde_cent: 3100 }]);

    const doppelterStandard = await supabase.from("arbeitgeberkosten_standard").insert({
      firma_id: firma.id,
      gueltig_ab: "2026-01-01",
      kosten_je_stunde_cent: 2700,
    });
    expect(doppelterStandard.error?.code).toBe("23505");
    const doppelterEigener = await supabase.from("arbeitgeberkosten_mitarbeiter").insert({
      firma_id: firma.id,
      mitarbeiter_id: person.id,
      gueltig_ab: "2026-03-01",
      kosten_je_stunde_cent: 3200,
    });
    expect(doppelterEigener.error?.code).toBe("23505");
    // Derselbe Tag bei einem anderen Mitarbeiter ist erlaubt.
    const andererMitarbeiter = await supabase.from("arbeitgeberkosten_mitarbeiter").insert({
      firma_id: firma.id,
      mitarbeiter_id: anderer.id,
      gueltig_ab: "2026-03-01",
      kosten_je_stunde_cent: 2900,
    });
    expect(andererMitarbeiter.error).toBeNull();

    for (const tabelle of ["arbeitgeberkosten_standard", "arbeitgeberkosten_mitarbeiter"]) {
      for (const kosten_je_stunde_cent of [0, -2600]) {
        const ungueltig = await supabase
          .from(tabelle)
          .update({ kosten_je_stunde_cent })
          .eq("firma_id", firma.id);
        expect(ungueltig.error?.code, `${tabelle} ${kosten_je_stunde_cent}`).toBe("23514");
      }
      const verschoben = await supabase
        .from(tabelle)
        .update({ firma_id: firma.id })
        .eq("firma_id", firma.id);
      expect(verschoben.error?.code, tabelle).toBe("42501");
    }
    const umgehaengt = await supabase
      .from("arbeitgeberkosten_mitarbeiter")
      .update({ mitarbeiter_id: anderer.id })
      .eq("mitarbeiter_id", person.id);
    expect(umgehaengt.error?.code).toBe("42501");

    const standardGeaendert = await supabase
      .from("arbeitgeberkosten_standard")
      .update({ gueltig_ab: "2026-02-01", kosten_je_stunde_cent: 2650 })
      .eq("firma_id", firma.id);
    expect(standardGeaendert.error).toBeNull();
    const eigenerGeaendert = await supabase
      .from("arbeitgeberkosten_mitarbeiter")
      .update({ kosten_je_stunde_cent: 3150 })
      .eq("mitarbeiter_id", person.id);
    expect(eigenerGeaendert.error).toBeNull();
    expect(await gespeicherteWerte(firma.id)).toEqual({
      standard: [{ gueltig_ab: "2026-02-01", kosten_je_stunde_cent: 2650 }],
      eigene: [
        { mitarbeiter_id: anderer.id, gueltig_ab: "2026-03-01", kosten_je_stunde_cent: 2900 },
        { mitarbeiter_id: person.id, gueltig_ab: "2026-03-01", kosten_je_stunde_cent: 3150 },
      ],
    });

    expect(
      (await supabase.from("arbeitgeberkosten_standard").delete().eq("firma_id", firma.id)).error,
    ).toBeNull();
    expect(
      (await supabase.from("arbeitgeberkosten_mitarbeiter").delete().eq("firma_id", firma.id))
        .error,
    ).toBeNull();
    expect(await gespeicherteWerte(firma.id)).toEqual({ standard: [], eigene: [] });
  } finally {
    await entferneFirma(firma.id);
  }
});
