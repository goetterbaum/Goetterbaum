"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { alsBuero } from "@/lib/als-buero";
import { ladeKunde } from "@/lib/kunden/verwaltung";
import { pruefeObjektEingabe } from "@/lib/objekte/eingabe";
import { pruefeObjektAktiv } from "@/lib/objekte/regeln";
import { ladeObjekt } from "@/lib/objekte/verwaltung";
import { istId } from "@/lib/id";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { pruefeStundensatzEingabe } from "@/lib/stundensaetze/eingabe";
import { objektsatzFestlegen } from "@/lib/stundensaetze/regeln";
import { ladeKundenStundensaetze, ladeObjektStundensaetze } from "@/lib/stundensaetze/verwaltung";
import { ladeTaetigkeit } from "@/lib/taetigkeiten/verwaltung";
import { texte } from "@/texte";

// Prüft, dass der gewählte Kunde zur eigenen Firma gehört und ein Objekt
// mit diesem Archiv-Status haben darf. Liefert die Fehlermeldung oder null.
async function pruefeKundeFuerObjekt(
  supabase: SupabaseClient,
  kundeId: string,
  archiviert: boolean,
): Promise<string | null> {
  const kunde = await ladeKunde(supabase, kundeId);
  if (!kunde) return texte.objekte.fehlerKunde;
  return pruefeObjektAktiv({ archiviert }, kunde);
}

export async function objektAnlegen(
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase, ich } = await alsBuero();
  const eingabe = pruefeObjektEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const regelverstoss = await pruefeKundeFuerObjekt(supabase, eingabe.daten.kunde_id, false);
  if (regelverstoss) return FEHLER(regelverstoss);

  const { data, error } = await supabase
    .from("objekt")
    .insert({ firma_id: ich.firma_id, ...eingabe.daten })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    console.error("Objekt anlegen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  redirect(`/objekte/${data.id}`);
}

export async function objektSpeichern(
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const bestand = await ladeObjekt(supabase, id);
  if (!bestand) return FEHLER(texte.objekte.nichtGefunden);

  const eingabe = pruefeObjektEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const regelverstoss = await pruefeKundeFuerObjekt(
    supabase,
    eingabe.daten.kunde_id,
    bestand.archiviert,
  );
  if (regelverstoss) return FEHLER(regelverstoss);

  const { error } = await supabase.from("objekt").update(eingabe.daten).eq("id", id);
  if (error) {
    console.error("Objekt speichern fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK(texte.stammdaten.gespeichert);
}

export async function objektArchivieren(id: string, archiviert: boolean): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const bestand = await ladeObjekt(supabase, id);
  if (!bestand) return FEHLER(texte.objekte.nichtGefunden);

  const regelverstoss = pruefeObjektAktiv({ archiviert }, bestand.kunde);
  if (regelverstoss) return FEHLER(regelverstoss);

  const { error } = await supabase.from("objekt").update({ archiviert }).eq("id", id);
  if (error) {
    console.error("Objekt archivieren fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK();
}

// Es gibt schon einen Satz für dieses Objekt und diese Tätigkeit
// (Primärschlüssel, siehe Migration).
const SATZ_GIBT_ES_SCHON = "23505";

// Legt den Stundensatz des Objekts für eine Tätigkeit fest oder ändert
// ihn. Gleicht er dem Satz, der ohne ihn gälte (Kunde, sonst Standard),
// wird nichts gespeichert und ein vorhandener Objektsatz entfernt, damit
// das Objekt dem Kunden folgt.
export async function objektStundensatzFestlegen(
  objektId: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const { supabase, ich } = await alsBuero();
  const objekt = await ladeObjekt(supabase, objektId);
  if (!objekt) return FEHLER(texte.objekte.nichtGefunden);

  const eingabe = pruefeStundensatzEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);
  const { taetigkeit_id, stundensatz_cent } = eingabe.daten;
  const [taetigkeit, kundenSaetze, objektSaetze] = await Promise.all([
    ladeTaetigkeit(supabase, taetigkeit_id),
    ladeKundenStundensaetze(supabase, objekt.kunde_id),
    ladeObjektStundensaetze(supabase, [objekt.id]),
  ]);
  if (!taetigkeit) return FEHLER(texte.stundensaetze.fehlerTaetigkeit);
  if (taetigkeit.archiviert) {
    return FEHLER(texte.stundensaetze.fehlerTaetigkeitArchiviert);
  }
  const satzFuer = (saetze: { taetigkeit_id: string; stundensatz_cent: number }[]) =>
    saetze.find((s) => s.taetigkeit_id === taetigkeit_id)?.stundensatz_cent ?? null;
  const was = objektsatzFestlegen(stundensatz_cent, {
    standardCent: taetigkeit.standard_stundensatz_cent,
    kundeCent: satzFuer(kundenSaetze),
    objektCent: satzFuer(objektSaetze),
  });
  if (was === "nichts") return OK(texte.objektStundensaetze.unveraendert);
  if (was === "entfernen") {
    const entfernt = await entferneObjektStundensatz(supabase, objekt.id, taetigkeit_id);
    return entfernt.fehler ? entfernt : OK(texte.objektStundensaetze.entferntWeilGleich);
  }

  // Erst ändern, und nur wenn es noch keinen Satz gab, neu anlegen. Ein
  // "upsert" ginge nicht: Das Büro darf Objekt und Tätigkeit eines
  // vorhandenen Satzes nicht ändern.
  const aendern = () =>
    supabase
      .from("objekt_stundensatz")
      .update({ stundensatz_cent })
      .eq("objekt_id", objekt.id)
      .eq("taetigkeit_id", taetigkeit_id)
      .select("taetigkeit_id");
  const geaendert = await aendern();
  let error = geaendert.error;
  if (!error && geaendert.data?.length === 0) {
    ({ error } = await supabase.from("objekt_stundensatz").insert({
      firma_id: ich.firma_id,
      objekt_id: objekt.id,
      taetigkeit_id,
      stundensatz_cent,
    }));
    // Hat jemand den Satz gerade gleichzeitig angelegt (z. B. doppelter
    // Klick), gibt es ihn jetzt: dann einfach ändern.
    if (error?.code === SATZ_GIBT_ES_SCHON) ({ error } = await aendern());
  }
  if (error) {
    console.error("Objekt-Stundensatz festlegen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK(texte.stundensaetze.festgelegt);
}

// Entfernt den Stundensatz des Objekts; danach gilt wieder der des Kunden
// bzw. der Standard.
export async function objektStundensatzEntfernen(
  objektId: string,
  taetigkeitId: string,
): Promise<Rueckmeldung> {
  const { supabase } = await alsBuero();
  const objekt = await ladeObjekt(supabase, objektId);
  if (!objekt) return FEHLER(texte.objekte.nichtGefunden);
  if (!istId(taetigkeitId)) return FEHLER(texte.stundensaetze.fehlerTaetigkeit);
  return entferneObjektStundensatz(supabase, objekt.id, taetigkeitId);
}

// Nur nach der Prüfung von Büro und Objekt aufrufen.
async function entferneObjektStundensatz(
  supabase: SupabaseClient,
  objektId: string,
  taetigkeitId: string,
): Promise<Rueckmeldung> {
  const { error } = await supabase
    .from("objekt_stundensatz")
    .delete()
    .eq("objekt_id", objektId)
    .eq("taetigkeit_id", taetigkeitId);
  if (error) {
    console.error("Objekt-Stundensatz entfernen fehlgeschlagen", error);
    return FEHLER(texte.stammdaten.fehlerUnbekannt);
  }

  refresh();
  return OK();
}
