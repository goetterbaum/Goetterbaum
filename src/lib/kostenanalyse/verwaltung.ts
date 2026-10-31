// Lädt, was der Rechenbaustein der Kostenanalyse für einen Zeitraum
// braucht, und lässt ihn rechnen. Welche Daten der Nutzer sehen darf,
// entscheiden die Zugriffsregeln der Datenbank: Kunden, Objekte, alle
// Zeiteinträge der Firma und die Arbeitgeberkosten bekommt nur das Büro
// der eigenen Firma.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Abrechnungsart, ZusatzauftragAbrechnungsart } from "@/lib/abrechnung";
import type { Arbeitgeberkosten } from "@/lib/arbeitgeberkosten/regeln";
import { type Parameter } from "@/lib/auswertungen/zeitraum";
import { berlinerDatum, berlinerMitternacht } from "@/lib/berliner-zeit";
import { ladeFirma } from "@/lib/firma/verwaltung";
import {
  kostenanalyse,
  tagesansicht,
  type Kostenanalyse,
  type TagesEingabe,
  type Tagesansicht,
  type ZeiteintragFuerKosten,
} from "@/lib/kostenanalyse";
import { ladeKundenliste } from "@/lib/kunden/verwaltung";
import { alleSeiten } from "@/lib/supabase/alle-seiten";
import { kostenTag, kostenZeitraum, monatDerKosten, type KostenZeitraum } from "./zeitraum";

export type Namen = {
  kunden: Map<string, string>;
  objekte: Map<string, string>;
  zusatzauftraege: Map<string, string>;
  mitarbeiter: Map<string, string>;
};

export type GeladeneKostenanalyse = {
  zeitraum: KostenZeitraum;
  ergebnis: Kostenanalyse;
  namen: Namen;
};

export type GeladeneTagesansicht = {
  // Der Tag als "JJJJ-MM-TT".
  datum: string;
  ergebnis: Tagesansicht;
  namen: Namen;
};

type ObjektZeile = {
  id: string;
  kunde_id: string;
  bezeichnung: string;
  abrechnungsart: Abrechnungsart;
  pauschale_cent: number | null;
  archiviert: boolean;
};

type ZusatzauftragZeile = {
  id: string;
  objekt_id: string;
  beschreibung: string;
  abrechnungsart: ZusatzauftragAbrechnungsart;
  festbetrag_cent: number | null;
  stundensatz_cent: number | null;
  erledigt: boolean;
};

type ZeiteintragZeile = {
  id: string;
  mitarbeiter_id: string;
  art: "taetigkeit" | "fahrt";
  objekt_id: string | null;
  taetigkeit_id: string | null;
  zusatzauftrag_id: string | null;
  beginn: string;
  ende: string;
  freigegeben_am: string | null;
  arbeitstag_endet_hier: boolean;
};

type KostenZeile = { gueltig_ab: string; kosten_je_stunde_cent: number };

const ZEITEINTRAG_SPALTEN =
  "id, mitarbeiter_id, art, objekt_id, taetigkeit_id, zusatzauftrag_id, beginn, ende, freigegeben_am, arbeitstag_endet_hier";

// So weit vor und nach dem Zeitraum werden Zeiteinträge mitgeladen, damit
// Arbeitstage über die Grenze hinweg ganz dabei sind.
const RAND_MS = 24 * 60 * 60 * 1000;

// Die Kostenanalyse zum Zeitraum aus der Adresszeile (von, bis; ohne
// Angabe der vorausgewählte Monat). Objektübersicht, Details und
// CSV-Export laden über diese Funktion, damit alle dieselben Zahlen zeigen.
export async function ladeKostenanalyse(
  supabase: SupabaseClient,
  firmaId: string,
  parameter: Parameter,
): Promise<GeladeneKostenanalyse> {
  const zeitraum = kostenZeitraum(parameter, Date.now());
  const { eingabe, namen } = await ladeEingabe(supabase, firmaId, zeitraum);
  return { zeitraum, ergebnis: kostenanalyse({ ...eingabe, monate: zeitraum.monate }), namen };
}

// Die Tagesansicht zum Tag aus der Adresszeile (datum; ohne Angabe heute
// in Berlin). Geladen wird der ganze Monat des Tags, denn der
// Pauschal-Anteil hängt an allen Einsätzen im Monat.
export async function ladeTagesansicht(
  supabase: SupabaseClient,
  firmaId: string,
  parameter: Parameter,
): Promise<GeladeneTagesansicht> {
  const jetzt = Date.now();
  const datum = kostenTag(parameter, jetzt);
  const { eingabe, namen } = await ladeEingabe(supabase, firmaId, monatDerKosten(datum));
  return { datum, ergebnis: tagesansicht(eingabe, datum, berlinerDatum(jetzt)), namen };
}

async function ladeEingabe(
  supabase: SupabaseClient,
  firmaId: string,
  zeitraum: KostenZeitraum,
): Promise<{ eingabe: TagesEingabe; namen: Namen }> {
  const [
    firma,
    kunden,
    objekte,
    taetigkeiten,
    kundenStundensaetze,
    objektStundensaetze,
    zusatzauftraege,
    mitarbeiter,
    standard,
    eigeneWerte,
  ] = await Promise.all([
    ladeFirma(supabase, firmaId),
    ladeKundenliste(supabase),
    alle<ObjektZeile>(
      supabase
        .from("objekt")
        .select("id, kunde_id, bezeichnung, abrechnungsart, pauschale_cent, archiviert")
        .order("bezeichnung")
        .order("id"),
    ),
    alle<{ id: string; standard_stundensatz_cent: number }>(
      supabase.from("taetigkeit").select("id, standard_stundensatz_cent").order("id"),
    ),
    alle<{ kunde_id: string; taetigkeit_id: string; stundensatz_cent: number }>(
      supabase
        .from("kunden_stundensatz")
        .select("kunde_id, taetigkeit_id, stundensatz_cent")
        .order("kunde_id")
        .order("taetigkeit_id"),
    ),
    alle<{ objekt_id: string; taetigkeit_id: string; stundensatz_cent: number }>(
      supabase
        .from("objekt_stundensatz")
        .select("objekt_id, taetigkeit_id, stundensatz_cent")
        .order("objekt_id")
        .order("taetigkeit_id"),
    ),
    alle<ZusatzauftragZeile>(
      supabase
        .from("zusatzauftrag")
        .select(
          "id, objekt_id, beschreibung, abrechnungsart, festbetrag_cent, stundensatz_cent, erledigt",
        )
        .order("angelegt_am")
        .order("id"),
    ),
    alle<{ id: string; name: string }>(supabase.from("mitarbeiter").select("id, name").order("id")),
    alle<KostenZeile>(
      supabase
        .from("arbeitgeberkosten_standard")
        .select("gueltig_ab, kosten_je_stunde_cent")
        .order("gueltig_ab"),
    ),
    alle<KostenZeile & { mitarbeiter_id: string }>(
      supabase
        .from("arbeitgeberkosten_mitarbeiter")
        .select("mitarbeiter_id, gueltig_ab, kosten_je_stunde_cent")
        .order("mitarbeiter_id")
        .order("gueltig_ab"),
    ),
  ]);

  const zeiteintraege = await ladeZeiteintraege(
    supabase,
    zeitraum,
    zusatzauftraege.filter((za) => za.abrechnungsart === "festbetrag").map((za) => za.id),
  );

  const jeMitarbeiter: Record<string, Arbeitgeberkosten[]> = {};
  for (const w of eigeneWerte) {
    (jeMitarbeiter[w.mitarbeiter_id] ??= []).push(alsArbeitgeberkosten(w));
  }

  const eingabe: TagesEingabe = {
    kunden: kunden.map((k) => ({
      id: k.id,
      rundungsregel: k.rundungsregel ?? firma.rundungsregel,
      kundenStundensaetze: kundenStundensaetze
        .filter((s) => s.kunde_id === k.id)
        .map((s) => ({ taetigkeitId: s.taetigkeit_id, stundensatzCent: s.stundensatz_cent })),
    })),
    objekte: objekte.map((o) => ({
      id: o.id,
      kundeId: o.kunde_id,
      abrechnungsart: o.abrechnungsart,
      pauschaleCent: o.pauschale_cent,
      archiviert: o.archiviert,
    })),
    taetigkeiten: taetigkeiten.map((t) => ({
      id: t.id,
      standardStundensatzCent: t.standard_stundensatz_cent,
    })),
    objektStundensaetze: objektStundensaetze.map((s) => ({
      objektId: s.objekt_id,
      taetigkeitId: s.taetigkeit_id,
      stundensatzCent: s.stundensatz_cent,
    })),
    zusatzauftraege: zusatzauftraege.map((za) => ({
      id: za.id,
      objektId: za.objekt_id,
      abrechnungsart: za.abrechnungsart,
      festbetragCent: za.festbetrag_cent,
      stundensatzCent: za.stundensatz_cent,
      erledigt: za.erledigt,
    })),
    zeiteintraege,
    arbeitgeberkosten: { standard: standard.map(alsArbeitgeberkosten), jeMitarbeiter },
  };

  return {
    eingabe,
    namen: {
      kunden: new Map(kunden.map((k) => [k.id, k.name])),
      objekte: new Map(objekte.map((o) => [o.id, o.bezeichnung])),
      zusatzauftraege: new Map(zusatzauftraege.map((za) => [za.id, za.beschreibung])),
      mitarbeiter: new Map(mitarbeiter.map((m) => [m.id, m.name])),
    },
  };
}

// Die beendeten Zeiteinträge der Firma im Zeitraum mit einem Tag Rand
// davor und danach, dazu alle Einträge der Zusatzaufträge mit Festbetrag.
// Erscheint einer von ihnen im Zeitraum, reicht der Rand bis vor seinen
// ersten Eintrag, damit auch dessen Fahrten zugeordnet werden.
async function ladeZeiteintraege(
  supabase: SupabaseClient,
  zeitraum: KostenZeitraum,
  festbetragIds: string[],
): Promise<ZeiteintragFuerKosten[]> {
  const beendete = () =>
    supabase.from("zeiteintrag").select(ZEITEINTRAG_SPALTEN).not("ende", "is", null);
  const fuerFestbetraege =
    festbetragIds.length === 0
      ? []
      : await alleSeiten((ab, bis) =>
          beendete()
            .in("zusatzauftrag_id", festbetragIds)
            .order("id")
            .range(ab, bis)
            .returns<ZeiteintragZeile[]>(),
        );

  // Der letzte Eintrag entscheidet, in welchem Monat ein Festbetrag erscheint.
  const letzterBeginn = new Map<string, string>();
  for (const z of fuerFestbetraege) {
    const bisher = letzterBeginn.get(z.zusatzauftrag_id!);
    if (!bisher || Date.parse(z.beginn) > Date.parse(bisher)) {
      letzterBeginn.set(z.zusatzauftrag_id!, z.beginn);
    }
  }
  const monate = new Set(zeitraum.monate);
  const imZeitraum = new Set(
    [...letzterBeginn]
      .filter(([, beginn]) => monate.has(berlinerDatum(Date.parse(beginn)).slice(0, 7)))
      .map(([id]) => id),
  );
  const [jahr, monat, tag] = zeitraum.bis.split("-").map(Number);
  const tagNachBis = new Date(Date.UTC(jahr, monat - 1, tag + 1)).toISOString().slice(0, 10);
  const ab = Math.min(
    berlinerMitternacht(zeitraum.von),
    ...fuerFestbetraege
      .filter((z) => imZeitraum.has(z.zusatzauftrag_id!))
      .map((z) => Date.parse(z.beginn)),
  );

  const imFenster = await alleSeiten((von, bis) =>
    beendete()
      .gte("beginn", new Date(ab - RAND_MS).toISOString())
      .lt("beginn", new Date(berlinerMitternacht(tagNachBis) + RAND_MS).toISOString())
      .order("id")
      .range(von, bis)
      .returns<ZeiteintragZeile[]>(),
  );
  const schonDabei = new Set(imFenster.map((z) => z.id));
  return [...imFenster, ...fuerFestbetraege.filter((z) => !schonDabei.has(z.id))].map((z) => ({
    id: z.id,
    mitarbeiterId: z.mitarbeiter_id,
    art: z.art,
    objektId: z.objekt_id,
    taetigkeitId: z.taetigkeit_id,
    zusatzauftragId: z.zusatzauftrag_id,
    beginn: z.beginn,
    ende: z.ende,
    freigegeben: z.freigegeben_am !== null,
    arbeitstagEndetHier: z.arbeitstag_endet_hier,
  }));
}

function alsArbeitgeberkosten(w: KostenZeile): Arbeitgeberkosten {
  return { gueltigAb: w.gueltig_ab, centJeStunde: w.kosten_je_stunde_cent };
}

// Die Zeilen einer Abfrage; Stammdaten passen in eine Seite.
async function alle<T>(abfrage: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await abfrage;
  if (error) throw error;
  return data as T[];
}
