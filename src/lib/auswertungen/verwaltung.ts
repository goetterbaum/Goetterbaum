// Lädt die Daten für die Auswertungen des Büros. Welche Daten der Nutzer
// sehen darf, entscheidet die Datenbank: Alle Zeiteinträge kommen über
// zeiteintraege_der_firma, die nur dem Büro etwas liefert, und die
// Zugriffsregeln trennen die Firmen.
import type { SupabaseClient } from "@supabase/supabase-js";
import { istId } from "@/lib/id";
import { alleSeiten } from "@/lib/supabase/alle-seiten";
import type { ZeiteintragDerFirma } from "@/lib/zeiterfassung/verwaltung";
import { arbeitszeitnachweis, type Arbeitszeitnachweis } from "./arbeitszeitnachweis";
import { istZeit, type IstZeit } from "./ist-zeit";
import { auswertungsZeitraum, type AuswertungsZeitraum, type Parameter } from "./zeitraum";

export type MitarbeiterZurAuswahl = { id: string; name: string; aktiv: boolean };

// Alle Mitarbeiter der Firma, auch deaktivierte: Ihr Arbeitszeitnachweis
// muss aufbewahrt werden und abrufbar bleiben.
export async function ladeMitarbeiterZurAuswahl(
  supabase: SupabaseClient,
): Promise<MitarbeiterZurAuswahl[]> {
  const { data, error } = await supabase
    .from("mitarbeiter")
    .select("id, name, aktiv")
    .order("name")
    .returns<MitarbeiterZurAuswahl[]>();
  if (error) throw error;
  return data;
}

export type GeladenerArbeitszeitnachweis = {
  mitarbeiter: MitarbeiterZurAuswahl;
  zeitraum: AuswertungsZeitraum;
  nachweis: Arbeitszeitnachweis;
  // Laufende Zeiteinträge, die vor dem Ende des Zeitraums begonnen haben.
  // Sie fehlen im Nachweis, bis sie beendet sind.
  laufend: number;
};

// Der Zeitraum aus der Adresszeile, gemessen am jetzigen Tag in Berlin.
export function zeitraumAusAdresse(parameter: Parameter): AuswertungsZeitraum {
  return auswertungsZeitraum(parameter, Date.now());
}

// Der Arbeitszeitnachweis zu Mitarbeiter und Zeitraum aus der Adresszeile
// (mitarbeiter, von, bis; ohne Tage der Vormonat), oder null, wenn kein
// Mitarbeiter gewählt ist oder es ihn nicht gibt. Seite und CSV-Export
// laden über diese Funktion, damit beide dasselbe zeigen.
export async function ladeArbeitszeitnachweis(
  supabase: SupabaseClient,
  parameter: Parameter,
): Promise<GeladenerArbeitszeitnachweis | null> {
  const id = typeof parameter.mitarbeiter === "string" ? parameter.mitarbeiter : "";
  if (!istId(id)) return null;
  const zeitraum = zeitraumAusAdresse(parameter);

  // Mit "-infinity" liefert die Datenbank alle Zeiteinträge; gefiltert
  // wird hier, damit auch ein Eintrag vom Abend vor dem Zeitraum mit
  // seinem Teil nach Mitternacht dabei ist.
  const eintraegeDesMitarbeiters = () =>
    supabase
      .rpc("zeiteintraege_der_firma", { ab: "-infinity" })
      .eq("mitarbeiter_id", id)
      .lt("beginn", zeitraum.bisVor);
  const [mitarbeiter, beendete, laufende] = await Promise.all([
    supabase
      .from("mitarbeiter")
      .select("id, name, aktiv")
      .eq("id", id)
      .maybeSingle<MitarbeiterZurAuswahl>(),
    alleSeiten<ZeiteintragDerFirma & { ende: string }>((ab, bis) =>
      eintraegeDesMitarbeiters().gt("ende", zeitraum.ab).order("beginn").order("id").range(ab, bis),
    ),
    eintraegeDesMitarbeiters().is("ende", null),
  ]);
  if (mitarbeiter.error) throw mitarbeiter.error;
  if (laufende.error) throw laufende.error;
  if (!mitarbeiter.data) return null;

  return {
    mitarbeiter: mitarbeiter.data,
    zeitraum,
    nachweis: arbeitszeitnachweis(
      beendete.map((z) => ({
        art: z.art,
        beginn: z.beginn,
        ende: z.ende,
        objekt: z.objekt_bezeichnung,
        taetigkeit: z.taetigkeit_name,
        zusatzauftrag: z.zusatzauftrag_beschreibung,
        nachtrag: z.nachtrag,
      })),
      zeitraum.von,
      zeitraum.bis,
    ),
    laufend: (laufende.data as ZeiteintragDerFirma[]).length,
  };
}

export type PauschalObjekt = {
  id: string;
  bezeichnung: string;
  pauschale_cent: number;
  archiviert: boolean;
  kunde: { name: string };
};

// Alle Pauschal-Objekte der Firma, auch archivierte, nach Bezeichnung.
export async function ladePauschalObjekte(supabase: SupabaseClient): Promise<PauschalObjekt[]> {
  const { data, error } = await supabase
    .from("objekt")
    .select("id, bezeichnung, pauschale_cent, archiviert, kunde(name)")
    .eq("abrechnungsart", "pauschale")
    .order("bezeichnung")
    .returns<PauschalObjekt[]>();
  if (error) throw error;
  return data;
}

export type GeladeneIstZeit = {
  objekt: PauschalObjekt;
  zeitraum: AuswertungsZeitraum;
  istZeit: IstZeit;
  // Laufende Zeiteinträge im Objekt, die vor dem Ende des Zeitraums
  // begonnen haben. Sie fehlen, bis sie beendet sind.
  laufend: number;
};

// Die Ist-Zeit zu Pauschal-Objekt und Zeitraum aus der Adresszeile
// (objekt, von, bis; ohne Tage der Vormonat), oder null, wenn kein
// Pauschal-Objekt gewählt ist oder es keines ist. Gezählt werden alle
// beendeten Zeiteinträge, ob freigegeben oder nicht: Es geht um die
// tatsächlich geleistete Arbeit.
export async function ladeIstZeit(
  supabase: SupabaseClient,
  parameter: Parameter,
): Promise<GeladeneIstZeit | null> {
  const id = typeof parameter.objekt === "string" ? parameter.objekt : "";
  if (!istId(id)) return null;
  const zeitraum = zeitraumAusAdresse(parameter);

  // Wie beim Arbeitszeitnachweis: alle Einträge, hier gefiltert.
  const eintraegeImObjekt = () =>
    supabase
      .rpc("zeiteintraege_der_firma", { ab: "-infinity" })
      .eq("objekt_id", id)
      .lt("beginn", zeitraum.bisVor);
  const [objekt, beendete, laufende] = await Promise.all([
    supabase
      .from("objekt")
      .select("id, bezeichnung, pauschale_cent, archiviert, kunde(name)")
      .eq("id", id)
      .eq("abrechnungsart", "pauschale")
      .maybeSingle<PauschalObjekt>(),
    alleSeiten<ZeiteintragDerFirma & { ende: string; taetigkeit_name: string }>((ab, bis) =>
      eintraegeImObjekt().gt("ende", zeitraum.ab).order("beginn").order("id").range(ab, bis),
    ),
    eintraegeImObjekt().is("ende", null),
  ]);
  if (objekt.error) throw objekt.error;
  if (laufende.error) throw laufende.error;
  if (!objekt.data) return null;

  return {
    objekt: objekt.data,
    zeitraum,
    istZeit: istZeit(
      beendete.map((z) => ({
        taetigkeit: z.taetigkeit_name,
        zusatzauftragId: z.zusatzauftrag_id,
        beginn: z.beginn,
        ende: z.ende,
      })),
      zeitraum.von,
      zeitraum.bis,
    ),
    laufend: (laufende.data as ZeiteintragDerFirma[]).length,
  };
}
