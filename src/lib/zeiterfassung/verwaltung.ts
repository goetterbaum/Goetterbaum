import type { SupabaseClient } from "@supabase/supabase-js";
import { istId } from "@/lib/id";
import type { Sparte } from "@/lib/sparte";
import {
  angezeigtAb,
  istUnvollstaendig,
  type MeinZeiteintrag,
  type ZeiteintragArt,
} from "./anzeige";
import { freigabeFilter, type FreigabeFilter } from "./freigabe";
import { protokollAnzeigen, type AngezeigteProtokollZeile, type ProtokollZeile } from "./protokoll";

// Was ein Mitarbeiter beim Start sieht. Preise und Kunden liefern die
// Datenbank-Funktionen bewusst nicht mit.
export type ObjektZurAuswahl = {
  id: string;
  bezeichnung: string;
  strasse: string;
  adresszusatz: string | null;
  plz: string;
  ort: string;
};

export type TaetigkeitZurAuswahl = { id: string; name: string; sparte: Sparte };

// Ein offener Zusatzauftrag, ohne Abrechnungsart und Festbetrag.
export type ZusatzauftragZurAuswahl = { id: string; objekt_id: string; beschreibung: string };

// Die aktiven Objekte und Tätigkeiten der eigenen Firma und die offenen
// Zusatzaufträge dieser Objekte.
export async function ladeAuswahl(supabase: SupabaseClient): Promise<{
  objekte: ObjektZurAuswahl[];
  taetigkeiten: TaetigkeitZurAuswahl[];
  zusatzauftraege: ZusatzauftragZurAuswahl[];
}> {
  const [objekte, taetigkeiten, zusatzauftraege] = await Promise.all([
    supabase.rpc("objekte_zur_auswahl"),
    supabase.rpc("taetigkeiten_zur_auswahl"),
    supabase.rpc("zusatzauftraege_zur_auswahl"),
  ]);
  if (objekte.error) throw objekte.error;
  if (taetigkeiten.error) throw taetigkeiten.error;
  if (zusatzauftraege.error) throw zusatzauftraege.error;
  return {
    objekte: objekte.data,
    taetigkeiten: taetigkeiten.data,
    zusatzauftraege: zusatzauftraege.data,
  };
}

// Die Zeiteinträge eines Mitarbeiters in den angezeigten Tagen und immer
// der laufende, dazu der Zeitpunkt, zu dem geladen wurde. Fremde
// Mitarbeiter liefert die Datenbank nur Vorarbeitern und dem Büro.
export async function ladeZeiteintraegeVon(
  supabase: SupabaseClient,
  mitarbeiterId: string,
): Promise<{ eintraege: MeinZeiteintrag[]; jetzt: number }> {
  const jetzt = Date.now();
  const { data, error } = await supabase.rpc("zeiteintraege_von", {
    wer: mitarbeiterId,
    ab: angezeigtAb(jetzt),
  });
  if (error) throw error;
  return { eintraege: data, jetzt };
}

// Ein aktiver Mitarbeiter, für den erfasst wird.
export type MitarbeiterZumErfassen = { id: string; name: string };

// Alle aktiven Mitarbeiter der Firma außer dem angemeldeten, nach Name.
export async function ladeAndereMitarbeiter(
  supabase: SupabaseClient,
  ichId: string,
): Promise<MitarbeiterZumErfassen[]> {
  const { data, error } = await supabase
    .from("mitarbeiter")
    .select("id, name")
    .eq("aktiv", true)
    .neq("id", ichId)
    .order("name")
    .returns<MitarbeiterZumErfassen[]>();
  if (error) throw error;
  return data;
}

// Ein Mitarbeiter, oder null, wenn es ihn nicht gibt, der angemeldete
// Nutzer ihn nicht sehen darf oder er deaktiviert ist (außer mit
// auchDeaktivierte).
export async function ladeMitarbeiterZumErfassen(
  supabase: SupabaseClient,
  id: string,
  auchDeaktivierte: boolean,
): Promise<(MitarbeiterZumErfassen & { aktiv: boolean }) | null> {
  if (!istId(id)) return null;
  let abfrage = supabase.from("mitarbeiter").select("id, name, aktiv").eq("id", id);
  if (!auchDeaktivierte) abfrage = abfrage.eq("aktiv", true);
  const { data, error } = await abfrage.maybeSingle<MitarbeiterZumErfassen & { aktiv: boolean }>();
  if (error) throw error;
  return data;
}

// Ein Zeiteintrag mit allem, was zum Ändern nötig ist, oder null, wenn es
// ihn nicht gibt oder der angemeldete Nutzer ihn nicht sehen darf (normale
// Mitarbeiter sehen nur ihre eigenen). unvollstaendig: Er läuft seit mehr
// als 12 Stunden, zum Zeitpunkt des Ladens. freigegeben: Mitarbeiter und
// Vorarbeiter dürfen ihn nicht mehr ändern. abgerechnet: niemand darf ihn
// mehr ändern.
export type ZeiteintragZumAendern = {
  id: string;
  mitarbeiter_id: string;
  art: ZeiteintragArt;
  objekt_id: string | null;
  taetigkeit_id: string | null;
  zusatzauftrag_id: string | null;
  beginn: string;
  ende: string | null;
  unvollstaendig: boolean;
  freigegeben: boolean;
  abgerechnet: boolean;
};

export async function ladeZeiteintragZumAendern(
  supabase: SupabaseClient,
  id: string,
): Promise<ZeiteintragZumAendern | null> {
  if (!istId(id)) return null;
  const { data, error } = await supabase
    .from("zeiteintrag")
    .select(
      "id, mitarbeiter_id, art, objekt_id, taetigkeit_id, zusatzauftrag_id, beginn, ende, freigegeben_am, abgerechnet_in",
    )
    .eq("id", id)
    .maybeSingle<
      Omit<ZeiteintragZumAendern, "unvollstaendig" | "freigegeben" | "abgerechnet"> & {
        freigegeben_am: string | null;
        abgerechnet_in: string | null;
      }
    >();
  if (error) throw error;
  if (!data) return null;
  const { freigegeben_am, abgerechnet_in, ...eintrag } = data;
  return {
    ...eintrag,
    unvollstaendig: istUnvollstaendig(eintrag, Date.now()),
    freigegeben: freigegeben_am !== null,
    abgerechnet: abgerechnet_in !== null,
  };
}

// Ein Zeiteintrag, wie ihn das Büro in der Übersicht und bei der Freigabe
// sieht. Kunde und Objekt fehlen bei Fahrten, der Zusatzauftrag bei
// regulärer Arbeit.
export type ZeiteintragDerFirma = Omit<MeinZeiteintrag, "angelegt_von" | "freigegeben"> & {
  mitarbeiter_id: string;
  mitarbeiter_name: string;
  objekt_id: string | null;
  kunde_id: string | null;
  kunde_name: string | null;
  zusatzauftrag_id: string | null;
  freigegeben_am: string | null;
  freigegeben_von_name: string | null;
};

// Fürs Büro: alle Zeiteinträge der Firma in den angezeigten Tagen und alle
// laufenden, der neueste zuerst, dazu der Zeitpunkt, zu dem geladen wurde.
export async function ladeZeiteintraegeDerFirma(
  supabase: SupabaseClient,
): Promise<{ eintraege: ZeiteintragDerFirma[]; jetzt: number }> {
  const jetzt = Date.now();
  const { data, error } = await supabase.rpc("zeiteintraege_der_firma", {
    ab: angezeigtAb(jetzt),
  });
  if (error) throw error;
  return { eintraege: data, jetzt };
}

// Fürs Büro: die Prüfliste aller unvollständigen Zeiteinträge der Firma,
// der älteste zuerst. Mit "ab" = unendlich liefert die Datenbank nur die
// laufenden.
export async function ladeUnvollstaendigeEintraege(
  supabase: SupabaseClient,
): Promise<{ eintraege: ZeiteintragDerFirma[]; jetzt: number }> {
  const jetzt = Date.now();
  const { data, error } = await supabase
    .rpc("zeiteintraege_der_firma", { ab: "infinity" })
    .order("beginn");
  if (error) throw error;
  const laufende: ZeiteintragDerFirma[] = data;
  return { eintraege: laufende.filter((e) => istUnvollstaendig(e, jetzt)), jetzt };
}

// Fürs Büro: ein Zeiteintrag der Firma mit seinem aufbereiteten
// Änderungsprotokoll und dem Zeitpunkt, zu dem geladen wurde, oder null,
// wenn es ihn nicht gibt.
export async function ladeZeiteintragMitProtokoll(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  eintrag: ZeiteintragDerFirma;
  abgerechnet: boolean;
  protokoll: AngezeigteProtokollZeile[];
  jetzt: number;
} | null> {
  if (!istId(id)) return null;
  const jetzt = Date.now();
  const [eintrag, protokoll, abrechnung] = await Promise.all([
    supabase
      .rpc("zeiteintraege_der_firma", { ab: "-infinity" })
      .eq("id", id)
      .maybeSingle<ZeiteintragDerFirma>(),
    supabase.rpc("protokoll_zum_zeiteintrag", { eintrag: id }),
    supabase
      .from("zeiteintrag")
      .select("abgerechnet_in")
      .eq("id", id)
      .maybeSingle<{ abgerechnet_in: string | null }>(),
  ]);
  if (eintrag.error) throw eintrag.error;
  if (protokoll.error) throw protokoll.error;
  if (abrechnung.error) throw abrechnung.error;
  if (!eintrag.data) return null;

  const zeilen: ProtokollZeile[] = protokoll.data;
  const ids = (spalte: "objekt_id" | "taetigkeit_id" | "zusatzauftrag_id") => [
    ...new Set(
      zeilen
        .flatMap((z) => [z.vorher?.[spalte], z.nachher[spalte]])
        .filter((wert): wert is string => typeof wert === "string"),
    ),
  ];
  // Auch archivierte bzw. erledigte, damit alte Stände lesbar bleiben.
  const [objekte, taetigkeiten, zusatzauftraege] = await Promise.all([
    supabase.from("objekt").select("id, bezeichnung").in("id", ids("objekt_id")),
    supabase.from("taetigkeit").select("id, name").in("id", ids("taetigkeit_id")),
    supabase.from("zusatzauftrag").select("id, beschreibung").in("id", ids("zusatzauftrag_id")),
  ]);
  if (objekte.error) throw objekte.error;
  if (taetigkeiten.error) throw taetigkeiten.error;
  if (zusatzauftraege.error) throw zusatzauftraege.error;

  return {
    eintrag: eintrag.data,
    abgerechnet: (abrechnung.data?.abgerechnet_in ?? null) !== null,
    jetzt,
    protokoll: protokollAnzeigen(zeilen, {
      objekte: new Map(objekte.data.map((o) => [o.id, o.bezeichnung])),
      taetigkeiten: new Map(taetigkeiten.data.map((t) => [t.id, t.name])),
      zusatzauftraege: new Map(zusatzauftraege.data.map((z) => [z.id, z.beschreibung])),
    }),
  };
}

// Fürs Büro: die noch nicht freigegebenen (oder auf Wunsch die schon
// freigegebenen) Zeiteinträge, die im Zeitraum des Filters aus der
// Adresszeile beginnen, nach Mitarbeiter und Beginn,
// dazu der Filter und der Zeitpunkt, zu dem geladen wurde. Laufende sind
// dabei, damit das Büro sieht, was noch fehlt; freigeben lassen sie sich
// erst nach dem Beenden.
export async function ladeEintraegeZurFreigabe(
  supabase: SupabaseClient,
  parameter: Record<string, string | string[] | undefined>,
): Promise<{ filter: FreigabeFilter; eintraege: ZeiteintragDerFirma[]; jetzt: number }> {
  const jetzt = Date.now();
  const filter = freigabeFilter(parameter, jetzt);
  let abfrage = supabase
    .rpc("zeiteintraege_der_firma", { ab: filter.ab })
    .gte("beginn", filter.ab)
    .lt("beginn", filter.bisVor);
  abfrage = filter.freigegebene
    ? abfrage.not("freigegeben_am", "is", null)
    : abfrage.is("freigegeben_am", null);
  if (filter.mitarbeiter) abfrage = abfrage.eq("mitarbeiter_id", filter.mitarbeiter);
  if (filter.kunde) abfrage = abfrage.eq("kunde_id", filter.kunde);
  if (filter.objekt) abfrage = abfrage.eq("objekt_id", filter.objekt);
  const { data, error } = await abfrage.order("mitarbeiter_name").order("beginn");
  if (error) throw error;
  return { filter, eintraege: data, jetzt };
}

// Was in den Filtern der Freigabe zur Wahl steht: alle Mitarbeiter, Kunden
// und Objekte der Firma, auch deaktivierte und archivierte, denn auch ihre
// Einträge brauchen eine Freigabe.
export type FreigabeFilterAuswahl = {
  mitarbeiter: { id: string; name: string }[];
  kunden: { id: string; name: string }[];
  objekte: { id: string; bezeichnung: string }[];
};

export async function ladeFreigabeFilterAuswahl(
  supabase: SupabaseClient,
): Promise<FreigabeFilterAuswahl> {
  const [mitarbeiter, kunden, objekte] = await Promise.all([
    supabase.from("mitarbeiter").select("id, name").order("name"),
    supabase.from("kunde").select("id, name").order("name"),
    supabase.from("objekt").select("id, bezeichnung").order("bezeichnung"),
  ]);
  if (mitarbeiter.error) throw mitarbeiter.error;
  if (kunden.error) throw kunden.error;
  if (objekte.error) throw objekte.error;
  return { mitarbeiter: mitarbeiter.data, kunden: kunden.data, objekte: objekte.data };
}
