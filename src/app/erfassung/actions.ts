"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { angemeldeterMitarbeiter } from "@/lib/angemeldeter-mitarbeiter";
import { darfFuerAndereErfassen } from "@/lib/rollen";
import { FEHLER, OK, type Rueckmeldung } from "@/lib/rueckmeldung";
import { createClient } from "@/lib/supabase/server";
import { pruefeStartEingabe } from "@/lib/zeiterfassung/eingabe";
import { UNVOLLSTAENDIG_NACH_STUNDEN } from "@/lib/zeiterfassung/anzeige";
import { pruefeEndeEingabe, pruefeNachtragEingabe } from "@/lib/zeiterfassung/nachtrag";
import { ladeZeiteintragZumAendern } from "@/lib/zeiterfassung/verwaltung";
import { texte } from "@/texte";

// Fehlercodes der Datenbank (siehe Migrationen zum Zeiteintrag und zu
// Zusatzaufträgen): Es läuft schon einer (eindeutig je Mitarbeiter), bzw.
// Objekt oder Tätigkeit sind archiviert oder der Zusatzauftrag ist
// erledigt (Prüfregel), oder sie gehören nicht zur Firma bzw. der
// Zusatzauftrag nicht zum Objekt (Fremdschlüssel).
const LAEUFT_SCHON = "23505";
const PRUEFREGEL_VERLETZT = "23514";
const FREMDSCHLUESSEL_VERLETZT = "23503";
// Der Eintrag überschneidet sich mit einem anderen desselben Mitarbeiters
// (Ausschlussregel, siehe Migration zu Nachträgen).
const UEBERSCHNEIDUNG = "23P01";
// Für einen Schritt der Live-Erfassung läuft nichts Passendes (mehr), oder
// der laufende Eintrag ist unvollständig (Migration zu Fahrt und
// Arbeitstag). Beim Start einer Fahrt: Es ist kein Arbeitstag offen
// (Migration zu Pause und Fahrt im Arbeitstag).
const LAEUFT_NICHTS = "P0002";

// Jede Aktion ist auch ohne die Oberfläche per Direktaufruf erreichbar.
// Deshalb prüft sie zuerst, wer angemeldet ist und ob er für den Mitarbeiter
// fuer erfassen darf (sich selbst immer, andere nur als Vorarbeiter oder
// Büro). Gespeichert wird im Namen dieses Nutzers, die Zugriffsregeln der
// Datenbank greifen also zusätzlich. Bewusst ohne Umleitung: Die
// Oberfläche fängt Fehler der Verbindung ab, eine Umleitung würde dabei
// verloren gehen.
async function alsErfasser(fuer: string) {
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich) return { fehler: FEHLER(texte.erfassung.fehlerAbgemeldet) } as const;
  if (fuer !== ich.id && !darfFuerAndereErfassen(ich.rolle)) {
    return { fehler: FEHLER(texte.fuerAndere.keineBerechtigung) } as const;
  }
  return { fehler: null, supabase, ich } as const;
}

function fehlerBeimStart(error: PostgrestError): Rueckmeldung {
  // Ein Start überschneidet sich nur mit einem laufenden Eintrag, denn
  // Nachträge enden nie in der Zukunft.
  if (error.code === LAEUFT_SCHON || error.code === UEBERSCHNEIDUNG) {
    return FEHLER(texte.erfassung.fehlerLaeuftSchon);
  }
  if (error.code === PRUEFREGEL_VERLETZT || error.code === FREMDSCHLUESSEL_VERLETZT) {
    return FEHLER(texte.erfassung.fehlerNichtZurAuswahl);
  }
  console.error("Zeiteintrag starten fehlgeschlagen", error);
  return FEHLER(texte.erfassung.fehlerStart);
}

// fuer ist bei allen Aktionen der Mitarbeiter, dessen Zeit erfasst wird.
// Läuft eine Fahrt, beendet die Datenbank sie im selben Schritt, ohne
// Lücke (unter 2 Minuten wird sie nicht gespeichert).
export async function zeiteintragStarten(
  fuer: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const erfasser = await alsErfasser(fuer);
  if (erfasser.fehler) return erfasser.fehler;
  const { supabase } = erfasser;

  const eingabe = pruefeStartEingabe(formData);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { error } = await supabase.rpc("zeiteintrag_starten", {
    wer: fuer,
    objekt: eingabe.daten.objekt_id,
    taetigkeit: eingabe.daten.taetigkeit_id,
    zusatzauftrag: eingabe.daten.zusatzauftrag_id,
  });
  if (error) return fehlerBeimStart(error);

  refresh();
  return OK();
}

// Nur in einem offenen Arbeitstag, also nach einer Pause; sonst lehnt die
// Datenbank ab (z. B. wenn inzwischen auf einem anderen Gerät der
// Arbeitstag beendet wurde).
export async function fahrtStarten(fuer: string): Promise<Rueckmeldung> {
  const erfasser = await alsErfasser(fuer);
  if (erfasser.fehler) return erfasser.fehler;
  const { supabase, ich } = erfasser;

  const { error } = await supabase
    .from("zeiteintrag")
    .insert({ firma_id: ich.firma_id, mitarbeiter_id: fuer, art: "fahrt" });
  if (error?.code === LAEUFT_NICHTS) {
    refresh();
    return FEHLER(texte.erfassung.fehlerKeinArbeitstag);
  }
  if (error) return fehlerBeimStart(error);

  refresh();
  return OK();
}

// „Fertig hier“, „Pause“ und „Arbeitstag beenden“: Die Datenbank beendet den
// laufenden Eintrag mit ihrer eigenen Uhr, aber nie einen unvollständigen
// (die Seite wurde vor Ablauf der 12 Stunden geladen und erst danach
// gedrückt). Dann meldet sie LAEUFT_NICHTS, ebenso wenn schon woanders
// beendet wurde (z. B. auf einem zweiten Gerät oder durch doppelten
// Druck); die neu geladene Seite zeigt, was gilt.
async function schrittAusfuehren(
  fuer: string,
  schritt: "fertig_hier" | "pause_machen" | "arbeitstag_beenden",
  meldungen: { laeuftNichts: string; fehler: string },
): Promise<Rueckmeldung> {
  const erfasser = await alsErfasser(fuer);
  if (erfasser.fehler) return erfasser.fehler;
  const { supabase } = erfasser;

  const { error } = await supabase.rpc(schritt, { wer: fuer });
  refresh();
  if (!error) return OK();
  if (error.code === LAEUFT_NICHTS) return FEHLER(meldungen.laeuftNichts);
  // Beim Start der Fahrt läuft inzwischen doch etwas (zweites Gerät).
  if (error.code === LAEUFT_SCHON || error.code === UEBERSCHNEIDUNG) {
    return FEHLER(texte.erfassung.fehlerLaeuftSchon);
  }
  console.error(`Schritt ${schritt} fehlgeschlagen`, error);
  return FEHLER(meldungen.fehler);
}

// Beendet das laufende Objekt und startet im selben Schritt eine Fahrt.
export async function fertigHier(fuer: string): Promise<Rueckmeldung> {
  return schrittAusfuehren(fuer, "fertig_hier", {
    laeuftNichts: texte.erfassung.fehlerLaeuftKeinObjekt,
    fehler: texte.erfassung.fehlerFertigHier,
  });
}

// Beendet den laufenden Eintrag; danach startet nichts. Eine Fahrt unter
// 2 Minuten wird nicht gespeichert.
export async function pauseMachen(fuer: string): Promise<Rueckmeldung> {
  return schrittAusfuehren(fuer, "pause_machen", {
    laeuftNichts: texte.erfassung.fehlerLaeuftNichtsOderUnvollstaendig,
    fehler: texte.erfassung.fehlerPause,
  });
}

// Beendet den laufenden Eintrag mit dem Vermerk „Arbeitstag endet hier“;
// danach startet nichts. Eine Fahrt bleibt als Rückfahrt gespeichert. Nach
// einer Pause kommt der Vermerk an den zuletzt beendeten Eintrag.
export async function arbeitstagBeenden(fuer: string): Promise<Rueckmeldung> {
  return schrittAusfuehren(fuer, "arbeitstag_beenden", {
    laeuftNichts: texte.erfassung.fehlerArbeitstagSchonBeendet,
    fehler: texte.erfassung.fehlerArbeitstagBeenden,
  });
}

// eigener: Der Eintrag gehört dem angemeldeten Nutzer selbst.
function fehlerBeimNachtrag(error: PostgrestError, eigener: boolean): Rueckmeldung {
  if (error.code === UEBERSCHNEIDUNG) {
    return FEHLER(
      eigener ? texte.nachtrag.fehlerUeberschneidung : texte.fuerAndere.fehlerUeberschneidung,
    );
  }
  if (error.code === PRUEFREGEL_VERLETZT || error.code === FREMDSCHLUESSEL_VERLETZT) {
    return FEHLER(texte.erfassung.fehlerNichtZurAuswahl);
  }
  console.error("Nachtrag speichern fehlgeschlagen", error);
  return FEHLER(texte.nachtrag.fehlerNichtGespeichert);
}

// Trägt einen beendeten Zeiteintrag nachträglich ein. Als Nachtrag
// markiert ihn die Datenbank.
export async function zeiteintragNachtragen(
  fuer: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const erfasser = await alsErfasser(fuer);
  if (erfasser.fehler) return erfasser.fehler;
  const { supabase, ich } = erfasser;

  const eingabe = pruefeNachtragEingabe(formData, Date.now());
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { error } = await supabase
    .from("zeiteintrag")
    .insert({ firma_id: ich.firma_id, mitarbeiter_id: fuer, ...eingabe.daten });
  if (error) return fehlerBeimNachtrag(error, fuer === ich.id);

  refresh();
  return OK(texte.nachtrag.gespeichert);
}

// Ändert einen beendeten Zeiteintrag, einen eigenen oder als Vorarbeiter
// bzw. Büro einen fremden. Ändern sich Beginn oder Ende, wird er in der
// Datenbank zum Nachtrag.
export async function zeiteintragAendern(
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich) return FEHLER(texte.erfassung.fehlerAbgemeldet);
  // Wem der Eintrag gehört, steht erst nach dem Laden fest. Normale
  // Mitarbeiter bekommen von der Datenbank ohnehin nur eigene.
  const bisher = await ladeZeiteintragZumAendern(supabase, id);
  if (!bisher || bisher.ende === null) return FEHLER(texte.nachtrag.nichtGefunden);
  const eigener = bisher.mitarbeiter_id === ich.id;
  if (!eigener && !darfFuerAndereErfassen(ich.rolle)) return FEHLER(texte.nachtrag.nichtGefunden);
  // Abgerechnete ändert niemand, freigegebene nur noch das Büro; die
  // Datenbank sperrt sie ohnehin.
  if (bisher.abgerechnet) return FEHLER(texte.abrechnung.gesperrt);
  if (bisher.freigegeben && ich.rolle !== "buero") return FEHLER(texte.freigabe.gesperrt);

  const eingabe = pruefeNachtragEingabe(formData, Date.now(), {
    beginn: bisher.beginn,
    ende: bisher.ende,
  });
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { data, error } = await supabase
    .from("zeiteintrag")
    .update(eingabe.daten)
    .eq("id", id)
    .not("ende", "is", null)
    .select("id");
  if (error) return fehlerBeimNachtrag(error, eigener);

  refresh();
  if (data.length === 0) return FEHLER(texte.nachtrag.nichtGefunden);
  return OK(texte.nachtrag.gespeichert);
}

// Trägt das Ende eines unvollständigen Zeiteintrags nach (läuft seit mehr
// als 12 Stunden), für sich selbst oder als Vorarbeiter bzw. Büro für
// einen anderen. Die Datenbank übernimmt das Ende nur bei einem
// unvollständigen Eintrag und markiert ihn dann als Nachtrag; bei jedem
// anderen laufenden setzt sie ihre eigene Uhr wie bei „Fertig hier“.
export async function endeNachtragen(
  id: string,
  _vorher: Rueckmeldung,
  formData: FormData,
): Promise<Rueckmeldung> {
  const supabase = await createClient();
  const ich = await angemeldeterMitarbeiter(supabase);
  if (!ich) return FEHLER(texte.erfassung.fehlerAbgemeldet);
  const bisher = await ladeZeiteintragZumAendern(supabase, id);
  if (!bisher) return FEHLER(texte.nachtrag.nichtGefunden);
  if (bisher.mitarbeiter_id !== ich.id && !darfFuerAndereErfassen(ich.rolle)) {
    return FEHLER(texte.nachtrag.nichtGefunden);
  }
  if (bisher.ende !== null) return FEHLER(texte.nachtrag.schonBeendet);
  if (!bisher.unvollstaendig) {
    return FEHLER(texte.nachtrag.nichtUnvollstaendig(UNVOLLSTAENDIG_NACH_STUNDEN));
  }

  const eingabe = pruefeEndeEingabe(formData, Date.now(), bisher.beginn);
  if (!eingabe.ok) return FEHLER(eingabe.fehler);

  const { data, error } = await supabase
    .from("zeiteintrag")
    .update({ ende: eingabe.ende })
    .eq("id", id)
    .is("ende", null)
    .select("nachtrag");
  if (error) {
    console.error("Ende nachtragen fehlgeschlagen", error);
    return FEHLER(texte.nachtrag.fehlerNichtGespeichert);
  }

  refresh();
  // Inzwischen woanders beendet.
  if (data.length === 0) return FEHLER(texte.nachtrag.schonBeendet);
  // Nach der Uhr der Datenbank lief er noch keine 12 Stunden (die Uhren
  // weichen knapp an der Grenze ab): Sie hat ihn wie bei „Fertig hier“ mit
  // ihrer eigenen Uhr beendet.
  if (!data[0].nachtrag) return FEHLER(texte.nachtrag.mitJetztBeendet(UNVOLLSTAENDIG_NACH_STUNDEN));
  return OK(texte.nachtrag.gespeichert);
}
