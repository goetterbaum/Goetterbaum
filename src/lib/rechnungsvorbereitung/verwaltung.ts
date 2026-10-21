// Lädt, was der Rechenbaustein für einen Kunden und Zeitraum braucht, und
// lässt ihn rechnen. Welche Daten der Nutzer sehen darf, entscheiden die
// Zugriffsregeln der Datenbank (nur das Büro der eigenen Firma).
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Abrechnungsart,
  Abrechnungszeitraum,
  Rundungsregel,
  ZusatzauftragAbrechnungsart,
} from "@/lib/abrechnung";
import { ladeFirma } from "@/lib/firma/verwaltung";
import { ladeKunde, type Kunde } from "@/lib/kunden/verwaltung";
import { istId } from "@/lib/id";
import {
  rechnungsvorbereitung,
  rechnungsvorbereitungFuerZusatzauftrag,
  type Monat,
  type Rechnungsvorbereitung,
  type Taetigkeit,
  type Zeiteintrag,
} from "@/lib/rechnungsvorbereitung";
import { ladeKundenStundensaetze } from "@/lib/stundensaetze/verwaltung";
import { gewaehlterZeitraum, monatVon, type GewaehlterZeitraum } from "./zeitraum";
import type { Namen } from "./zeilen";

// So viele Zeilen liefert die Schnittstelle höchstens auf einmal
// (max_rows in supabase/config.toml).
const SEITE = 1000;

type ObjektZeile = {
  id: string;
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
  erledigt: boolean;
};

const ZEITEINTRAG_SPALTEN =
  "id, mitarbeiter_id, art, objekt_id, taetigkeit_id, zusatzauftrag_id, beginn, ende";

type ZeiteintragZeile = {
  id: string;
  mitarbeiter_id: string;
  art: Zeiteintrag["art"];
  objekt_id: string | null;
  taetigkeit_id: string | null;
  zusatzauftrag_id: string | null;
  beginn: string;
  ende: string;
};

function zeiteintragFuerRechenbaustein(z: ZeiteintragZeile): Zeiteintrag {
  return {
    id: z.id,
    mitarbeiterId: z.mitarbeiter_id,
    art: z.art,
    objektId: z.objekt_id,
    taetigkeitId: z.taetigkeit_id,
    zusatzauftragId: z.zusatzauftrag_id,
    beginn: z.beginn,
    ende: z.ende,
  };
}

export type GeladeneRechnungsvorbereitung = {
  ergebnis: Rechnungsvorbereitung;
  namen: Namen;
  rundungsregel: Rundungsregel;
  // Noch nicht freigegebene Zeiteinträge des Kunden, die im Zeitraum
  // beginnen (beim einzelnen Zusatzauftrag: alle seine); sie fehlen im
  // Ergebnis.
  nichtFreigegeben: number;
};

// Dazu Kunde und Zeitraum, wie sie aus der Adresszeile gewählt wurden.
export type RechnungsvorbereitungAusAdresse = GeladeneRechnungsvorbereitung & {
  kunde: Kunde;
  zeitraum: GewaehlterZeitraum;
};

export async function ladeRechnungsvorbereitung(
  supabase: SupabaseClient,
  kunde: Kunde,
  standardDerFirma: Rundungsregel,
  zeitraum: GewaehlterZeitraum,
): Promise<GeladeneRechnungsvorbereitung> {
  const rundungsregel = kunde.rundungsregel ?? standardDerFirma;
  const [objekte, taetigkeiten] = await Promise.all([
    supabase
      .from("objekt")
      .select("id, bezeichnung, abrechnungsart, pauschale_cent, archiviert")
      .eq("kunde_id", kunde.id)
      .order("bezeichnung")
      .returns<ObjektZeile[]>(),
    ladeTaetigkeiten(supabase, kunde.id),
  ]);
  if (objekte.error) throw objekte.error;

  const objektIds = objekte.data.map((o) => o.id);
  const zusatzauftraege = await ladeNichtAbgerechneteZusatzauftraege(supabase, objektIds);
  const erledigteFestbetraege = zusatzauftraege
    .filter((za) => za.abrechnungsart === "festbetrag" && za.erledigt)
    .map((za) => za.id);
  const [zeiteintraege, nichtFreigegeben, abgerechnetePauschalMonate] = await Promise.all([
    ladeAbrechenbareZeiteintraege(supabase, objektIds, zeitraum, erledigteFestbetraege),
    zaehleNichtFreigegebene(supabase, objektIds, zeitraum),
    ladeAbgerechnetePauschalMonate(supabase, objektIds),
  ]);

  const ergebnis = rechnungsvorbereitung({
    kunde: { rundungsregel, abrechnungszeitraum: kunde.abrechnungszeitraum },
    ersterMonat: zeitraum.ersterMonat,
    // Ein archiviertes Pauschal-Objekt bekommt keine Pauschale mehr; die
    // Zeit in archivierten Stunden-Objekten wird noch abgerechnet.
    objekte: objekte.data
      .filter((o) => !o.archiviert || o.abrechnungsart === "stunden")
      .map((o) => ({
        id: o.id,
        abrechnungsart: o.abrechnungsart,
        pauschaleCent: o.pauschale_cent,
      })),
    taetigkeiten: taetigkeiten.fuerRechenbaustein,
    zusatzauftraege: zusatzauftraege.map((za) => ({
      id: za.id,
      objektId: za.objekt_id,
      abrechnungsart: za.abrechnungsart,
      festbetragCent: za.festbetrag_cent,
      erledigt: za.erledigt,
    })),
    zeiteintraege: zeiteintraege.map(zeiteintragFuerRechenbaustein),
    abgerechnetePauschalMonate,
  });

  return {
    ergebnis,
    namen: {
      objekte: new Map(objekte.data.map((o) => [o.id, o.bezeichnung])),
      taetigkeiten: taetigkeiten.namen,
      zusatzauftraege: new Map(zusatzauftraege.map((za) => [za.id, za.beschreibung])),
    },
    rundungsregel,
    nichtFreigegeben,
  };
}

// Alle Tätigkeiten mit den Stundensätzen für den Kunden, auch archivierte:
// Ihre Zeit wird noch abgerechnet.
async function ladeTaetigkeiten(
  supabase: SupabaseClient,
  kundeId: string,
): Promise<{ fuerRechenbaustein: Taetigkeit[]; namen: Map<string, string> }> {
  const [taetigkeiten, kundenSaetze] = await Promise.all([
    supabase
      .from("taetigkeit")
      .select("id, name, standard_stundensatz_cent")
      .order("name")
      .returns<{ id: string; name: string; standard_stundensatz_cent: number }[]>(),
    ladeKundenStundensaetze(supabase, kundeId),
  ]);
  if (taetigkeiten.error) throw taetigkeiten.error;
  return {
    fuerRechenbaustein: taetigkeiten.data.map((t) => ({
      id: t.id,
      standardStundensatzCent: t.standard_stundensatz_cent,
      kundenStundensatzCent:
        kundenSaetze.find((s) => s.taetigkeit_id === t.id)?.stundensatz_cent ?? null,
    })),
    namen: new Map(taetigkeiten.data.map((t) => [t.id, t.name])),
  };
}

type EinzelnerZusatzauftragZeile = ZusatzauftragZeile & {
  abgerechnet_in: string | null;
  objekt: { bezeichnung: string; kunde_id: string };
};

// Dazu Kunde und Zusatzauftrag. abgerechnetIn ist die gültige Abrechnung
// eines Festbetrags, sonst null.
export type RechnungsvorbereitungFuerZusatzauftrag = GeladeneRechnungsvorbereitung & {
  kunde: Kunde;
  zusatzauftrag: {
    id: string;
    beschreibung: string;
    erledigt: boolean;
    abgerechnetIn: string | null;
  };
};

// Die Rechnungsvorbereitung für einen einzelnen Zusatzauftrag mit seiner
// freigegebenen, noch offenen Zeit aus allen Monaten, oder null, wenn es
// ihn nicht gibt. Seite, CSV-Export und Abrechnen laden über diese
// Funktion, damit alle dieselben Positionen sehen.
export async function ladeRechnungsvorbereitungFuerZusatzauftrag(
  supabase: SupabaseClient,
  firmaId: string,
  zusatzauftragId: string,
): Promise<RechnungsvorbereitungFuerZusatzauftrag | null> {
  if (!istId(zusatzauftragId)) return null;
  const { data: za, error } = await supabase
    .from("zusatzauftrag")
    .select(
      "id, objekt_id, beschreibung, abrechnungsart, festbetrag_cent, erledigt, abgerechnet_in, objekt(bezeichnung, kunde_id)",
    )
    .eq("id", zusatzauftragId)
    .maybeSingle<EinzelnerZusatzauftragZeile>();
  if (error) throw error;
  if (!za) return null;

  const [kunde, firma, taetigkeiten, zeiteintraege, nichtFreigegeben] = await Promise.all([
    ladeKunde(supabase, za.objekt.kunde_id),
    ladeFirma(supabase, firmaId),
    ladeTaetigkeiten(supabase, za.objekt.kunde_id),
    alleSeiten((ab, bis) =>
      supabase
        .from("zeiteintrag")
        .select(ZEITEINTRAG_SPALTEN)
        .eq("zusatzauftrag_id", za.id)
        .not("freigegeben_am", "is", null)
        .is("abgerechnet_in", null)
        .order("beginn")
        .order("id")
        .range(ab, bis)
        .returns<ZeiteintragZeile[]>(),
    ),
    supabase
      .from("zeiteintrag")
      .select("id", { count: "exact", head: true })
      .eq("zusatzauftrag_id", za.id)
      .is("freigegeben_am", null)
      .then(({ count, error }) => {
        if (error) throw error;
        return count ?? 0;
      }),
  ]);
  if (!kunde) return null;
  const rundungsregel = kunde.rundungsregel ?? firma.rundungsregel;

  const ergebnis = rechnungsvorbereitungFuerZusatzauftrag({
    rundungsregel,
    zusatzauftrag: {
      id: za.id,
      objektId: za.objekt_id,
      abrechnungsart: za.abrechnungsart,
      festbetragCent: za.festbetrag_cent,
      // Ein abgerechneter Festbetrag ist nicht noch einmal abrechenbar.
      erledigt: za.erledigt && za.abgerechnet_in === null,
    },
    taetigkeiten: taetigkeiten.fuerRechenbaustein,
    zeiteintraege: zeiteintraege.map(zeiteintragFuerRechenbaustein),
  });

  return {
    ergebnis,
    namen: {
      objekte: new Map([[za.objekt_id, za.objekt.bezeichnung]]),
      taetigkeiten: taetigkeiten.namen,
      zusatzauftraege: new Map([[za.id, za.beschreibung]]),
    },
    rundungsregel,
    nichtFreigegeben,
    kunde,
    zusatzauftrag: {
      id: za.id,
      beschreibung: za.beschreibung,
      erledigt: za.erledigt,
      abgerechnetIn: za.abgerechnet_in,
    },
  };
}

// Die noch nicht abgerechneten Zusatzaufträge der Objekte. Abgerechnet
// werden nur solche mit Festbetrag; die nach Stunden bleiben, solange es
// Zeit für sie gibt.
async function ladeNichtAbgerechneteZusatzauftraege(
  supabase: SupabaseClient,
  objektIds: string[],
): Promise<ZusatzauftragZeile[]> {
  if (objektIds.length === 0) return [];
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .select("id, objekt_id, beschreibung, abrechnungsart, festbetrag_cent, erledigt")
    .in("objekt_id", objektIds)
    .is("abgerechnet_in", null)
    .order("angelegt_am")
    .order("id")
    .returns<ZusatzauftragZeile[]>();
  if (error) throw error;
  return data;
}

// Die freigegebenen, noch nicht abgerechneten Zeiteinträge in den
// Objekten, die im Zeitraum beginnen. Frühere bleiben auf Wunsch des Büros
// draußen: Ein spät freigegebener Eintrag erscheint, wenn das Büro seinen
// Zeitraum noch einmal aufruft. Dazu kommt die Zeit für erledigte
// Zusatzaufträge mit Festbetrag aus allen Monaten, denn sie wird mit dem
// Festbetrag abgerechnet.
async function ladeAbrechenbareZeiteintraege(
  supabase: SupabaseClient,
  objektIds: string[],
  zeitraum: GewaehlterZeitraum,
  erledigteFestbetraege: string[],
): Promise<ZeiteintragZeile[]> {
  if (objektIds.length === 0) return [];
  const abrechenbar = () =>
    supabase
      .from("zeiteintrag")
      .select(ZEITEINTRAG_SPALTEN)
      .not("freigegeben_am", "is", null)
      .is("abgerechnet_in", null);
  const [imZeitraum, fuerFestbetraege] = await Promise.all([
    alleSeiten((ab, bis) =>
      abrechenbar()
        .in("objekt_id", objektIds)
        .gte("beginn", zeitraum.ab)
        .lt("beginn", zeitraum.bisVor)
        .order("id")
        .range(ab, bis)
        .returns<ZeiteintragZeile[]>(),
    ),
    erledigteFestbetraege.length === 0
      ? []
      : alleSeiten((ab, bis) =>
          abrechenbar()
            .in("zusatzauftrag_id", erledigteFestbetraege)
            .order("id")
            .range(ab, bis)
            .returns<ZeiteintragZeile[]>(),
        ),
  ]);
  const schonDabei = new Set(imZeitraum.map((z) => z.id));
  return [...imZeitraum, ...fuerFestbetraege.filter((z) => !schonDabei.has(z.id))];
}

// Lädt Seite für Seite, bis eine nicht mehr voll ist.
async function alleSeiten<T>(
  seite: (ab: number, bis: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const alle: T[] = [];
  for (let ab = 0; ; ab += SEITE) {
    const { data, error } = await seite(ab, ab + SEITE - 1);
    if (error) throw error;
    const zeilen = data ?? [];
    alle.push(...zeilen);
    if (zeilen.length < SEITE) return alle;
  }
}

// Die Pauschal-Monate der Objekte aus gültigen Abrechnungen.
async function ladeAbgerechnetePauschalMonate(
  supabase: SupabaseClient,
  objektIds: string[],
): Promise<{ objektId: string; monat: Monat }[]> {
  if (objektIds.length === 0) return [];
  const { data, error } = await supabase
    .from("abrechnung_pauschal_monat")
    .select("objekt_id, monat")
    .in("objekt_id", objektIds)
    .eq("gueltig", true)
    .returns<{ objekt_id: string; monat: string }[]>();
  if (error) throw error;
  return data.map((m) => ({ objektId: m.objekt_id, monat: monatVon(m.monat) }));
}

async function zaehleNichtFreigegebene(
  supabase: SupabaseClient,
  objektIds: string[],
  zeitraum: GewaehlterZeitraum,
): Promise<number> {
  if (objektIds.length === 0) return 0;
  const { count, error } = await supabase
    .from("zeiteintrag")
    .select("id", { count: "exact", head: true })
    .in("objekt_id", objektIds)
    .is("freigegeben_am", null)
    .gte("beginn", zeitraum.ab)
    .lt("beginn", zeitraum.bisVor);
  if (error) throw error;
  return count ?? 0;
}

type Parameter = Record<string, string | string[] | undefined>;

// Die Rechnungsvorbereitung zu Kunde und Monat aus der Adresszeile (kunde,
// monat; ohne Monat der zuletzt abgeschlossene Zeitraum), oder null, wenn
// kein Kunde gewählt ist oder es ihn nicht gibt. Seite und CSV-Export laden
// über diese Funktion, damit beide dieselben Positionen zeigen.
export async function ladeRechnungsvorbereitungAusAdresse(
  supabase: SupabaseClient,
  firmaId: string,
  parameter: Parameter,
): Promise<RechnungsvorbereitungAusAdresse | null> {
  const kundeId = typeof parameter.kunde === "string" ? parameter.kunde : "";
  const [kunde, firma] = await Promise.all([
    ladeKunde(supabase, kundeId),
    ladeFirma(supabase, firmaId),
  ]);
  if (!kunde) return null;
  const zeitraum = gewaehlterZeitraum(parameter.monat, kunde.abrechnungszeitraum, Date.now());
  const geladen = await ladeRechnungsvorbereitung(supabase, kunde, firma.rundungsregel, zeitraum);
  return { ...geladen, kunde, zeitraum };
}

// Eine bisherige Abrechnung eines Kunden, wie die Datenbank-Funktion
// abrechnungen_des_kunden sie liefert. erster_monat als "JJJJ-MM-01".
// Entweder mit Zeitraum oder, bei der Einzel-Abrechnung, mit Zusatzauftrag.
export type BisherigeAbrechnung = {
  id: string;
  summe_cent: number;
  abgerechnet_am: string;
  abgerechnet_von_name: string;
  zurueckgenommen_am: string | null;
  zurueckgenommen_von_name: string | null;
} & (
  | {
      erster_monat: string;
      abrechnungszeitraum: Abrechnungszeitraum;
      zusatzauftrag_id: null;
      zusatzauftrag_beschreibung: null;
    }
  | {
      erster_monat: null;
      abrechnungszeitraum: null;
      zusatzauftrag_id: string;
      zusatzauftrag_beschreibung: string;
    }
);

// Alle Abrechnungen des Kunden, die neueste zuerst, auch zurückgenommene.
export async function ladeAbrechnungen(
  supabase: SupabaseClient,
  kundeId: string,
): Promise<BisherigeAbrechnung[]> {
  const { data, error } = await supabase.rpc("abrechnungen_des_kunden", { fuer_kunde: kundeId });
  if (error) throw error;
  return data;
}
