-- Fahrt automatisch und Arbeitstag beenden (Ticket #63)
--
-- Statt Stopp gibt es bei der Live-Erfassung drei Schritte, die jeweils
-- ganz oder gar nicht und mit der Uhr der Datenbank laufen. Weil alle
-- Befehle eines Schritts in derselben Transaktion laufen, liefert now()
-- überall denselben Zeitpunkt: Das Ende des einen Eintrags ist genau der
-- Beginn des nächsten, ohne Lücke und ohne Überschneidung.
-- * fertig_hier: beendet das laufende Objekt und startet eine Fahrt.
-- * zeiteintrag_starten: beendet eine laufende Fahrt und beginnt ein
--   Objekt. Läuft nichts, beginnt nur das Objekt.
-- * arbeitstag_beenden: beendet den laufenden Eintrag, danach startet
--   nichts. Der Eintrag bekommt den Vermerk „Arbeitstag endet hier“.
--
-- Mini-Fahrt: Endet eine laufende Fahrt durch einen dieser Schritte nach
-- weniger als 2 Minuten, wird sie entfernt. Das ist die einzige Stelle, an
-- der ein Zeiteintrag gelöscht wird, und nur für die Fahrt, die im selben
-- Schritt endet. Ihr Änderungsprotokoll verschwindet mit ihr. Wird beim
-- Beenden des Arbeitstags eine Mini-Fahrt entfernt, kommt der Vermerk auf
-- den Eintrag davor. Dieselbe Grenze steht in der App
-- (src/lib/zeiterfassung/live-erfassung.ts, MINI_FAHRT_MINUTEN).
--
-- Den Vermerk setzen nur „Arbeitstag beenden“ und das Nachtragen des Endes
-- eines unvollständigen Eintrags (meist wurde dort nur das Beenden des
-- Arbeitstags vergessen). Er ändert weder Beginn noch Ende, macht einen
-- Eintrag also nicht zum Nachtrag. Alte Einträge behalten „nein“.
--
-- Zugriffsrechte: Die Schritte laufen mit den Rechten des angemeldeten
-- Nutzers ("security invoker"). Es gelten also dieselben Zugriffsregeln
-- und Trigger wie beim Starten und Stoppen über die Tabelle: Mitarbeiter
-- nur für sich selbst, Vorarbeiter und Büro für aktive Mitarbeiter der
-- eigenen Firma, nur aktive Objekte und Tätigkeiten, höchstens ein
-- laufender Eintrag, keine Überschneidung. Nur das Entfernen der
-- Mini-Fahrt und das Setzen des Vermerks brauchen mehr Rechte; das machen
-- zwei Hilfsfunktionen im Schema privat, das die Schnittstelle nicht
-- anbietet. Ein unvollständiger Eintrag (läuft seit mehr als 12 Stunden)
-- wird nie von diesen Schritten beendet (#13).

begin;

-- ---------------------------------------------------------------------------
-- Vermerk „Arbeitstag endet hier“
-- ---------------------------------------------------------------------------

alter table public.zeiteintrag
  add column arbeitstag_endet_hier boolean not null default false;

comment on column public.zeiteintrag.arbeitstag_endet_hier is
  'Mit diesem Zeiteintrag endet ein Arbeitstag. Setzen nur „Arbeitstag beenden“ und das Nachtragen des Endes eines unvollständigen Eintrags.';

-- Wie bisher (#11, #13), zusätzlich: Wer das Ende eines unvollständigen
-- Eintrags angibt, beendet damit auch den Arbeitstag. Eigene Spaltenrechte
-- für den Vermerk gibt es nicht; ihn setzen nur dieser Trigger und die
-- Hilfsfunktion unten.
create or replace function privat.zeiteintrag_nachtrag_erkennen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.ende is null then
      new.beginn := now();
      new.nachtrag := false;
    else
      new.nachtrag := true;
    end if;
  else
    if old.ende is not null and new.ende is null then
      raise exception 'Ein beendeter Zeiteintrag kann nicht wieder laufen.'
        using errcode = 'check_violation';
    end if;
    new.nachtrag := old.nachtrag
      or new.beginn is distinct from old.beginn
      or (old.ende is not null and new.ende is distinct from old.ende)
      or (
        old.ende is null
        and new.ende is not null
        and old.beginn < now() - interval '12 hours'
      );
    if old.ende is null
       and new.ende is not null
       and old.beginn < now() - interval '12 hours'
    then
      new.arbeitstag_endet_hier := true;
    end if;
  end if;

  if new.beginn > now() or new.ende > now() then
    raise exception 'Ein Zeiteintrag kann nicht in der Zukunft liegen.'
      using errcode = 'check_violation';
  end if;
  if new.nachtrag and new.ende <= new.beginn then
    raise exception 'Ein Nachtrag endet nach seinem Beginn.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function privat.zeiteintrag_nachtrag_erkennen() from public;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen für die Schritte
--
-- "security definer", weil Nutzer Zeiteinträge weder löschen noch den
-- Vermerk setzen dürfen. Aufgerufen werden sie nur aus den Schritten
-- unten, nachdem diese den betroffenen Eintrag mit den Rechten des Nutzers
-- beendet haben.
-- ---------------------------------------------------------------------------

-- Entfernt eine Fahrt, die in dieser Transaktion beendet wurde (Ende =
-- now()) und kürzer als 2 Minuten lief. Liefert, ob sie entfernt wurde.
create function privat.mini_fahrt_entfernen(eintrag uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.zeiteintrag z
  where z.id = eintrag
    and z.art = 'fahrt'
    and z.ende = now()
    and z.beginn > now() - interval '2 minutes';
  return found;
end
$$;

-- Setzt den Vermerk an einem beendeten Eintrag eines Mitarbeiters, für den
-- der angemeldete Nutzer erfassen darf. Ein abgerechneter Eintrag ändert
-- sich nicht mehr (#16); er bleibt dann ohne Vermerk, statt dass das
-- Beenden des Arbeitstags scheitert.
create function privat.arbeitstag_endet_hier_setzen(eintrag uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.zeiteintrag z
  set arbeitstag_endet_hier = true
  where z.id = eintrag
    and z.ende is not null
    and z.abgerechnet_in is null
    and z.firma_id = privat.meine_firma_id()
    and (
      z.mitarbeiter_id = privat.meine_mitarbeiter_id()
      or privat.meine_rolle() in ('vorarbeiter', 'buero')
    )
$$;

revoke all on function privat.mini_fahrt_entfernen(uuid) from public;
revoke all on function privat.arbeitstag_endet_hier_setzen(uuid) from public;
grant execute on function privat.mini_fahrt_entfernen(uuid) to authenticated;
grant execute on function privat.arbeitstag_endet_hier_setzen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Die Schritte der Live-Erfassung
--
-- wer ist der Mitarbeiter, dessen Zeit erfasst wird. Ein laufender Eintrag
-- zählt nur, solange er nicht unvollständig ist (dieselbe Grenze wie in
-- privat.zeiteintrag_ende_jetzt). Läuft nichts Passendes, meldet der
-- Schritt "no_data_found" (P0002); Fehler beim Anlegen kommen mit den
-- bekannten Codes (läuft schon, archiviert, nicht in der Firma). Dann
-- ändert sich nichts.
-- ---------------------------------------------------------------------------

-- „Fertig hier“: Objekt beenden, Fahrt starten. Liefert die Fahrt.
create function public.fertig_hier(wer uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  fahrt_id uuid;
begin
  update public.zeiteintrag z
  set ende = now()
  where z.mitarbeiter_id = wer
    and z.ende is null
    and z.art = 'taetigkeit'
    and z.beginn >= now() - interval '12 hours';
  if not found then
    raise exception 'Es läuft kein Objekt.'
      using errcode = 'no_data_found';
  end if;

  insert into public.zeiteintrag (firma_id, mitarbeiter_id, art)
  values (privat.meine_firma_id(), wer, 'fahrt')
  returning id into fahrt_id;
  return fahrt_id;
end
$$;

-- Start: eine laufende Fahrt beenden (oder als Mini-Fahrt entfernen) und
-- das Objekt beginnen. Läuft ein Objekt, scheitert das Anlegen wie bisher
-- (höchstens ein laufender Eintrag). Liefert das neue Objekt.
create function public.zeiteintrag_starten(
  wer uuid,
  objekt uuid,
  taetigkeit uuid,
  zusatzauftrag uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  fahrt_id uuid;
  neu_id uuid;
begin
  update public.zeiteintrag z
  set ende = now()
  where z.mitarbeiter_id = wer
    and z.ende is null
    and z.art = 'fahrt'
    and z.beginn >= now() - interval '12 hours'
  returning z.id into fahrt_id;
  if found then
    perform privat.mini_fahrt_entfernen(fahrt_id);
  end if;

  insert into public.zeiteintrag
    (firma_id, mitarbeiter_id, art, objekt_id, taetigkeit_id, zusatzauftrag_id)
  values (privat.meine_firma_id(), wer, 'taetigkeit', objekt, taetigkeit, zusatzauftrag)
  returning id into neu_id;
  return neu_id;
end
$$;

-- „Arbeitstag beenden“: den laufenden Eintrag beenden und den Vermerk
-- setzen. Eine Fahrt bleibt als Rückfahrt gespeichert, außer sie ist eine
-- Mini-Fahrt; dann kommt der Vermerk auf den Eintrag davor.
create function public.arbeitstag_beenden(wer uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  beendet public.zeiteintrag;
  davor_id uuid;
begin
  update public.zeiteintrag z
  set ende = now()
  where z.mitarbeiter_id = wer
    and z.ende is null
    and z.beginn >= now() - interval '12 hours'
  returning z.* into beendet;
  if not found then
    raise exception 'Es läuft kein Zeiteintrag.'
      using errcode = 'no_data_found';
  end if;

  if beendet.art = 'fahrt' and privat.mini_fahrt_entfernen(beendet.id) then
    select z.id into davor_id
    from public.zeiteintrag z
    where z.mitarbeiter_id = wer
      and z.ende is not null
      and z.beginn < beendet.beginn
    order by z.beginn desc
    limit 1;
    if found then
      perform privat.arbeitstag_endet_hier_setzen(davor_id);
    end if;
  else
    perform privat.arbeitstag_endet_hier_setzen(beendet.id);
  end if;
end
$$;

revoke all on function public.fertig_hier(uuid) from public, anon;
revoke all on function public.zeiteintrag_starten(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.arbeitstag_beenden(uuid) from public, anon;
grant execute on function public.fertig_hier(uuid) to authenticated;
grant execute on function public.zeiteintrag_starten(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.arbeitstag_beenden(uuid) to authenticated;

commit;
