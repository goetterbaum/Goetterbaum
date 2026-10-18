// Lädt, was der Rechenbaustein für einen Kunden und Zeitraum oder für einen
// einzelnen Zusatzauftrag braucht, und lässt ihn rechnen. Welche Daten der
// Nutzer sehen darf, entscheiden die Zugriffsregeln der Datenbank (nur das
// Büro der eigenen Firma).
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Abrechnungsart,
  Abrechnungszeitraum,
  Rundungsregel,
  ZusatzauftragAbrechnungsart,
} from "@/lib/abrechnung";
import { ladeFirma } from "@/lib/firma/verwaltung";
import { istId } from "@/lib/id";
import { ladeKunde, type Kunde } from "@/lib/kunden/verwaltung";
import {
  rechnungsvorbereitung,
  zusatzauftragsAbrechnung,
  type Monat,
  type Rechnungsvorbereitung,
  type Taetigkeit,
  type Zeiteintrag,
  type Zusatzauftrag,
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
  "id, mitarbeiter_id, art, objekt_id, taetigkeit_id, zusatzauftrag_id, beginn, ende, freigegeben_am";

type ZeiteintragZeile = {
  id: string;
  mitarbeiter_id: string;
  art: Zeiteintrag["art"];
  objekt_id: string | null;
  taetigkeit_id: string | null;
  zusatzauftrag_id: string | null;
  beginn: string;
  // Leer nur bei laufenden; die sind nie freigegeben.
  ende: string | null;
  freigegeben_am: string | null;
};

export type GeladeneRechnungsvorbereitung = {
  ergebnis: Rechnungsvorbereitung;
  namen: Namen;
  rundungsregel: Rundungsregel;
  // Noch nicht freigegebene Zeiteinträge des Kunden, die im Zeitraum
  // beginnen; sie fehlen im Ergebnis.
  nichtFreigegeben: number;
  // Erledigte Zusatzaufträge mit Festbetrag, die noch nicht freigegebene
  // Zeiteinträge haben und deshalb noch fehlen (Beschreibungen).
  wartendeZusatzauftraege: string[];
};

// Dazu Kunde und Zeitraum, wie sie aus der Adresszeile gewählt wurden.
export type RechnungsvorbereitungAusAdresse = GeladeneRechnungsvorbereitung & {
  kunde: Kunde;
  zeitraum: GewaehlterZeitraum;
};

// Alle Tätigkeiten, auch archivierte (ihre Zeit wird noch abgerechnet), mit
// dem Stundensatz, der für den Kunden gilt.
async function ladeTaetigkeiten(
  supabase: SupabaseClient,
  kundeId: string,
): Promise<{ taetigkeiten: Taetigkeit[]; namen: Map<string, string> }> {
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
    taetigkeiten: taetigkeiten.data.map((t) => ({
      id: t.id,
      standardStundensatzCent: t.standard_stundensatz_cent,
      kundenStundensatzCent:
        kundenSaetze.find((s) => s.taetigkeit_id === t.id)?.stundensatz_cent ?? null,
    })),
    namen: new Map(taetigkeiten.data.map((t) => [t.id, t.name])),
  };
}

// Die noch nicht abgerechneten Zusatzaufträge der Objekte.
async function ladeOffeneZusatzauftraege(
  supabase: SupabaseClient,
  objektIds: string[],
): Promise<ZusatzauftragZeile[]> {
  if (objektIds.length === 0) return [];
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .select("id, objekt_id, beschreibung, abrechnungsart, festbetrag_cent, erledigt")
    .in("objekt_id", objektIds)
    .is("abgerechnet_in", null)
    .order("beschreibung")
    .order("id")
    .returns<ZusatzauftragZeile[]>();
  if (error) throw error;
  return data;
}

function alsZusatzauftrag(za: ZusatzauftragZeile, erledigt = za.erledigt): Zusatzauftrag {
  return {
    id: za.id,
    objektId: za.objekt_id,
    abrechnungsart: za.abrechnungsart,
    festbetragCent: za.festbetrag_cent,
    erledigt,
  };
}

function alsZeiteintrag(z: ZeiteintragZeile & { ende: string }): Zeiteintrag {
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

function freigegeben(z: ZeiteintragZeile): z is ZeiteintragZeile & { ende: string } {
  return z.freigegeben_am !== null && z.ende !== null;
}

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
  const [imZeitraum, nichtFreigegeben, abgerechnetePauschalMonate, zusatzauftraege] =
    await Promise.all([
      ladeAbrechenbareZeiteintraege(supabase, objektIds, zeitraum),
      zaehleNichtFreigegebene(supabase, objektIds, zeitraum),
      ladeAbgerechnetePauschalMonate(supabase, objektIds),
      ladeOffeneZusatzauftraege(supabase, objektIds),
    ]);

  // Ein erledigter Zusatzauftrag mit Festbetrag wird mit all seiner Zeit
  // abgerechnet, egal wann sie lag, aber erst, wenn sie ganz freigegeben
  // ist. Sonst bliebe ein Rest, der nie abgerechnet würde.
  const festbetraege = zusatzauftraege.filter(
    (za) => za.erledigt && za.abrechnungsart === "festbetrag",
  );
  const ihreZeit = await ladeOffeneZeitDerZusatzauftraege(
    supabase,
    festbetraege.map((za) => za.id),
  );
  const wartend = new Set(ihreZeit.filter((z) => !freigegeben(z)).map((z) => z.zusatzauftrag_id));
  const zeiteintraege = new Map(
    [...imZeitraum, ...ihreZeit.filter(freigegeben)].map((z) => [z.id, z]),
  );

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
    taetigkeiten: taetigkeiten.taetigkeiten,
    // Ein wartender gilt als noch nicht erledigt.
    zusatzauftraege: zusatzauftraege.map((za) =>
      alsZusatzauftrag(za, za.erledigt && !wartend.has(za.id)),
    ),
    zeiteintraege: [...zeiteintraege.values()].map(alsZeiteintrag),
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
    wartendeZusatzauftraege: festbetraege
      .filter((za) => wartend.has(za.id))
      .map((za) => za.beschreibung),
  };
}

// Die freigegebenen, noch nicht abgerechneten Zeiteinträge in den
// Objekten, die im Zeitraum beginnen. Frühere bleiben auf Wunsch des Büros
// draußen: Ein spät freigegebener Eintrag erscheint, wenn das Büro seinen
// Zeitraum noch einmal aufruft.
async function ladeAbrechenbareZeiteintraege(
  supabase: SupabaseClient,
  objektIds: string[],
  zeitraum: GewaehlterZeitraum,
): Promise<(ZeiteintragZeile & { ende: string })[]> {
  if (objektIds.length === 0) return [];
  return alleSeiten((ab) =>
    supabase
      .from("zeiteintrag")
      .select(ZEITEINTRAG_SPALTEN)
      .in("objekt_id", objektIds)
      .not("freigegeben_am", "is", null)
      .is("abgerechnet_in", null)
      .gte("beginn", zeitraum.ab)
      .lt("beginn", zeitraum.bisVor)
      .order("id")
      .range(ab, ab + SEITE - 1)
      .returns<(ZeiteintragZeile & { ende: string })[]>(),
  );
}

// Alle noch nicht abgerechneten Zeiteinträge der Zusatzaufträge, auch
// nicht freigegebene und laufende, egal wann sie beginnen.
async function ladeOffeneZeitDerZusatzauftraege(
  supabase: SupabaseClient,
  zusatzauftragIds: string[],
): Promise<ZeiteintragZeile[]> {
  if (zusatzauftragIds.length === 0) return [];
  return alleSeiten((ab) =>
    supabase
      .from("zeiteintrag")
      .select(ZEITEINTRAG_SPALTEN)
      .in("zusatzauftrag_id", zusatzauftragIds)
      .is("abgerechnet_in", null)
      .order("id")
      .range(ab, ab + SEITE - 1)
      .returns<ZeiteintragZeile[]>(),
  );
}

async function alleSeiten<T>(
  seite: (ab: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const alle: T[] = [];
  for (let ab = 0; ; ab += SEITE) {
    const { data, error } = await seite(ab);
    if (error) throw error;
    alle.push(...data!);
    if (data!.length < SEITE) return alle;
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

// Die Einzelabrechnung eines erledigten, noch nicht abgerechneten
// Zusatzauftrags. Solange einer seiner Zeiteinträge nicht freigegeben ist
// (nichtFreigegeben), lässt er sich nicht abrechnen.
export type Einzelabrechnung = {
  zusatzauftrag: {
    id: string;
    beschreibung: string;
    objekt: string;
    abrechnungsart: ZusatzauftragAbrechnungsart;
  };
  ergebnis: Rechnungsvorbereitung;
  namen: Namen;
  nichtFreigegeben: number;
};

// Alle erledigten, noch nicht abgerechneten Zusatzaufträge des Kunden mit
// ihrer Einzelabrechnung (auf Wunsch nur einer davon). Ohne etwas
// abzurechnen (nach Stunden ohne offene Zeit) erscheint keiner.
export async function ladeEinzelabrechnungen(
  supabase: SupabaseClient,
  kunde: Kunde,
  standardDerFirma: Rundungsregel,
  nurZusatzauftrag?: string,
): Promise<Einzelabrechnung[]> {
  const rundungsregel = kunde.rundungsregel ?? standardDerFirma;
  const { data: objekte, error } = await supabase
    .from("objekt")
    .select("id, bezeichnung")
    .eq("kunde_id", kunde.id)
    .returns<{ id: string; bezeichnung: string }[]>();
  if (error) throw error;
  const erledigte = (
    await ladeOffeneZusatzauftraege(
      supabase,
      objekte.map((o) => o.id),
    )
  ).filter((za) => za.erledigt && (!nurZusatzauftrag || za.id === nurZusatzauftrag));
  if (erledigte.length === 0) return [];

  const [taetigkeiten, zeit] = await Promise.all([
    ladeTaetigkeiten(supabase, kunde.id),
    ladeOffeneZeitDerZusatzauftraege(
      supabase,
      erledigte.map((za) => za.id),
    ),
  ]);
  const objektNamen = new Map(objekte.map((o) => [o.id, o.bezeichnung]));

  return erledigte.flatMap((za): Einzelabrechnung[] => {
    const seineZeit = zeit.filter((z) => z.zusatzauftrag_id === za.id);
    const ergebnis = zusatzauftragsAbrechnung({
      rundungsregel,
      zusatzauftrag: alsZusatzauftrag(za),
      taetigkeiten: taetigkeiten.taetigkeiten,
      zeiteintraege: seineZeit.filter(freigegeben).map(alsZeiteintrag),
    });
    const nichtFreigegeben = seineZeit.filter((z) => !freigegeben(z)).length;
    if (ergebnis.positionen.length === 0 && nichtFreigegeben === 0) return [];
    return [
      {
        zusatzauftrag: {
          id: za.id,
          beschreibung: za.beschreibung,
          objekt: objektNamen.get(za.objekt_id) ?? "",
          abrechnungsart: za.abrechnungsart,
        },
        ergebnis,
        namen: {
          objekte: objektNamen,
          taetigkeiten: taetigkeiten.namen,
          zusatzauftraege: new Map([[za.id, za.beschreibung]]),
        },
        nichtFreigegeben,
      },
    ];
  });
}

// Die Einzelabrechnung eines Zusatzauftrags mit seinem Kunden, oder null,
// wenn es ihn nicht gibt oder er nicht einzeln abrechenbar ist. Seite,
// CSV-Export und das Abrechnen laden über diese Funktion.
export async function ladeEinzelabrechnung(
  supabase: SupabaseClient,
  firmaId: string,
  zusatzauftragId: string,
): Promise<(Einzelabrechnung & { kunde: Kunde }) | null> {
  if (!istId(zusatzauftragId)) return null;
  const { data, error } = await supabase
    .from("zusatzauftrag")
    .select("objekt(kunde_id)")
    .eq("id", zusatzauftragId)
    .maybeSingle<{ objekt: { kunde_id: string } }>();
  if (error) throw error;
  if (!data) return null;
  const [kunde, firma] = await Promise.all([
    ladeKunde(supabase, data.objekt.kunde_id),
    ladeFirma(supabase, firmaId),
  ]);
  if (!kunde) return null;
  const [einzel] = await ladeEinzelabrechnungen(
    supabase,
    kunde,
    firma.rundungsregel,
    zusatzauftragId,
  );
  return einzel ? { ...einzel, kunde } : null;
}

// Eine bisherige Abrechnung eines Kunden, wie die Datenbank-Funktion
// abrechnungen_des_kunden sie liefert: für einen Zeitraum (erster_monat als
// "JJJJ-MM-01" und Abrechnungszeitraum) oder für einen einzelnen
// Zusatzauftrag (seine Beschreibung).
export type BisherigeAbrechnung = {
  id: string;
  erster_monat: string | null;
  abrechnungszeitraum: Abrechnungszeitraum | null;
  zusatzauftrag_beschreibung: string | null;
  summe_cent: number;
  abgerechnet_am: string;
  abgerechnet_von_name: string;
  zurueckgenommen_am: string | null;
  zurueckgenommen_von_name: string | null;
};

// Alle Abrechnungen des Kunden, die neueste zuerst, auch zurückgenommene.
export async function ladeAbrechnungen(
  supabase: SupabaseClient,
  kundeId: string,
): Promise<BisherigeAbrechnung[]> {
  const { data, error } = await supabase.rpc("abrechnungen_des_kunden", { fuer_kunde: kundeId });
  if (error) throw error;
  return data;
}
