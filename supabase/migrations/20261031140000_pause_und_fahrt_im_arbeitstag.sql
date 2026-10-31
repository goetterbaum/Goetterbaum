-- Pause und Fahrt nur innerhalb des Arbeitstags (Ticket #64)
--
-- * pause_machen: beendet den laufenden Eintrag, danach startet nichts.
--   Eine Fahrt unter 2 Minuten wird dabei entfernt (Mini-Fahrt, wie bei
--   den Schritten aus #63).
-- * arbeitstag_beenden geht jetzt auch nach einer Pause, wenn nichts
--   läuft: Der Vermerk „Arbeitstag endet hier“ kommt dann an den zuletzt
--   beendeten Eintrag, solange der Arbeitstag offen ist.
-- * Eine Fahrt live starten geht nur in einem offenen Arbeitstag. Ein
--   Arbeitstag beginnt also nie mit einer Fahrt. Fahrten als Nachtrag
--   bleiben ohne diese Einschränkung.
-- * Die Liste der Zeiteinträge eines Mitarbeiters liefert den Vermerk mit,
--   damit die App ohne Datenbank entscheiden kann, ob der Arbeitstag offen
--   ist (src/lib/zeiterfassung/live-erfassung.ts, arbeitstagOffen).
--
-- Offen heißt: Es läuft etwas, oder der zuletzt beendete Eintrag hat keinen
-- Vermerk und endete vor höchstens 12 Stunden. Dieselbe Grenze steht in der
-- App (ARBEITSTAG_ENDET_NACH_STUNDEN).
--
-- Zugriffsrechte wie bei den Schritten aus #63: Alles läuft mit den
-- Rechten des angemeldeten Nutzers ("security invoker"), es gelten die
-- bekannten Zugriffsregeln und Trigger. Das Entfernen der Mini-Fahrt und
-- das Setzen des Vermerks übernehmen die vorhandenen Hilfsfunktionen.

begin;

-- ---------------------------------------------------------------------------
-- Ist der Arbeitstag offen?
-- ---------------------------------------------------------------------------

-- Der zuletzt beendete Eintrag von wer, wenn mit ihm der Arbeitstag noch
-- offen ist (kein Vermerk, vor höchstens 12 Stunden beendet), sonst leer.
-- Ein laufender Eintrag zählt hier nicht; das prüfen die Aufrufer selbst.
-- Mit den Rechten des Nutzers: Wer die Einträge von wer nicht sehen darf,
-- bekommt immer leer.
create function privat.offener_arbeitstag_endet_mit(wer uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select z.id
  from (
    select z.id, z.ende, z.arbeitstag_endet_hier
    from public.zeiteintrag z
    where z.mitarbeiter_id = wer
      and z.ende is not null
    order by z.ende desc
    limit 1
  ) z
  where not z.arbeitstag_endet_hier
    and z.ende >= now() - interval '12 hours'
$$;

revoke all on function privat.offener_arbeitstag_endet_mit(uuid) from public;
grant execute on function privat.offener_arbeitstag_endet_mit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Fahrt live nur im offenen Arbeitstag
--
-- Nach dem Anlegen ("after insert"), damit zuerst wie bisher die
-- Zugriffsregeln, „läuft schon“ und die Prüfregeln greifen. Läuft der neue
-- Eintrag, gibt es keinen anderen laufenden (eindeutig je Mitarbeiter);
-- der Arbeitstag ist also offen, wenn der zuletzt beendete Eintrag ihn
-- offen lässt. Bei „Fertig hier“ ist das das Objekt, das im selben
-- Schritt endet. Wie die übrigen Trigger nur für angemeldete Nutzer, nicht
-- für Testdaten über den Dienstzugang.
-- ---------------------------------------------------------------------------

create function privat.live_fahrt_nur_im_arbeitstag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return null;
  end if;
  if privat.offener_arbeitstag_endet_mit(new.mitarbeiter_id) is null then
    raise exception 'Eine Fahrt startet nur in einem offenen Arbeitstag.'
      using errcode = 'no_data_found';
  end if;
  return null;
end
$$;

revoke all on function privat.live_fahrt_nur_im_arbeitstag() from public;

create trigger zeiteintrag_live_fahrt_nur_im_arbeitstag
  after insert on public.zeiteintrag
  for each row
  when (new.art = 'fahrt' and new.ende is null)
  execute function privat.live_fahrt_nur_im_arbeitstag();

-- ---------------------------------------------------------------------------
-- Die Schritte der Live-Erfassung
--
-- Wie in #63: Ein unvollständiger Eintrag (läuft seit mehr als 12 Stunden)
-- wird nie beendet. Läuft nichts Passendes, meldet der Schritt
-- "no_data_found" (P0002), und es ändert sich nichts.
-- ---------------------------------------------------------------------------

-- „Pause“: den laufenden Eintrag beenden, eine Mini-Fahrt entfernen.
create function public.pause_machen(wer uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  beendet public.zeiteintrag;
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

  if beendet.art = 'fahrt' then
    perform privat.mini_fahrt_entfernen(beendet.id);
  end if;
end
$$;

-- „Arbeitstag beenden“: Läuft etwas, wie bisher den laufenden Eintrag
-- beenden und den Vermerk an ihn setzen. Ist er eine Mini-Fahrt und wird
-- entfernt, oder lief nichts (nach einer Pause), kommt der Vermerk an den
-- zuletzt beendeten Eintrag, wenn der Arbeitstag mit ihm noch offen ist.
-- Läuft nichts und ist kein Arbeitstag offen, oder läuft ein
-- unvollständiger Eintrag, ändert sich nichts.
create or replace function public.arbeitstag_beenden(wer uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  beendet public.zeiteintrag;
  lief boolean;
  letzter uuid;
begin
  update public.zeiteintrag z
  set ende = now()
  where z.mitarbeiter_id = wer
    and z.ende is null
    and z.beginn >= now() - interval '12 hours'
  returning z.* into beendet;
  lief := found;

  if lief and not (beendet.art = 'fahrt' and privat.mini_fahrt_entfernen(beendet.id)) then
    perform privat.arbeitstag_endet_hier_setzen(beendet.id);
    return;
  end if;

  letzter := privat.offener_arbeitstag_endet_mit(wer);
  if not lief and (
    letzter is null
    or exists (select 1 from public.zeiteintrag z where z.mitarbeiter_id = wer and z.ende is null)
  ) then
    raise exception 'Es läuft kein Zeiteintrag, und kein Arbeitstag ist offen.'
      using errcode = 'no_data_found';
  end if;
  if letzter is not null then
    perform privat.arbeitstag_endet_hier_setzen(letzter);
  end if;
end
$$;

revoke all on function public.pause_machen(uuid) from public, anon;
grant execute on function public.pause_machen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Zeiteinträge eines Mitarbeiters, zusätzlich mit dem Vermerk
--
-- Wie bisher (Migration zu Zusatzaufträgen). meine_zeiteintraege baut
-- darauf auf und muss deshalb mit neu angelegt werden.
-- ---------------------------------------------------------------------------

drop function public.meine_zeiteintraege(timestamptz);
drop function public.zeiteintraege_von(uuid, timestamptz);

create function public.zeiteintraege_von(wer uuid, ab timestamptz)
returns table (
  id uuid,
  art public.zeiteintrag_art,
  beginn timestamptz,
  ende timestamptz,
  nachtrag boolean,
  freigegeben boolean,
  arbeitstag_endet_hier boolean,
  objekt_bezeichnung text,
  taetigkeit_name text,
  zusatzauftrag_beschreibung text,
  angelegt_von uuid,
  angelegt_von_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    z.id, z.art, z.beginn, z.ende, z.nachtrag, z.freigegeben_am is not null,
    z.arbeitstag_endet_hier, o.bezeichnung, t.name, za.beschreibung, a.id, a.name
  from public.zeiteintrag z
  left join public.mitarbeiter a on a.id = z.angelegt_von
  left join public.objekt o on o.id = z.objekt_id
  left join public.taetigkeit t on t.id = z.taetigkeit_id
  left join public.zusatzauftrag za on za.id = z.zusatzauftrag_id
  where z.mitarbeiter_id = wer
    and z.firma_id = privat.meine_firma_id()
    and (
      wer = privat.meine_mitarbeiter_id()
      or privat.meine_rolle() in ('vorarbeiter', 'buero')
    )
    and (z.beginn >= ab or z.ende is null)
  order by z.beginn desc
$$;

create function public.meine_zeiteintraege(ab timestamptz)
returns table (
  id uuid,
  art public.zeiteintrag_art,
  beginn timestamptz,
  ende timestamptz,
  nachtrag boolean,
  freigegeben boolean,
  arbeitstag_endet_hier boolean,
  objekt_bezeichnung text,
  taetigkeit_name text,
  zusatzauftrag_beschreibung text,
  angelegt_von uuid,
  angelegt_von_name text
)
language sql
stable
set search_path = ''
as $$
  select * from public.zeiteintraege_von(privat.meine_mitarbeiter_id(), ab)
$$;

revoke all on function public.zeiteintraege_von(uuid, timestamptz) from public, anon;
revoke all on function public.meine_zeiteintraege(timestamptz) from public, anon;
grant execute on function public.zeiteintraege_von(uuid, timestamptz) to authenticated;
grant execute on function public.meine_zeiteintraege(timestamptz) to authenticated;

commit;
