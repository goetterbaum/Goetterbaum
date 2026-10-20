-- Zusatzaufträge anlegen und bei der Erfassung auswählen (Ticket #42)
--
-- Das Büro legt zu einem Objekt Zusatzaufträge an: Beschreibung und eine
-- eigene Abrechnungsart, nach Stunden oder mit Festbetrag. Es bearbeitet
-- sie und markiert sie als erledigt (und bei Bedarf wieder als offen).
-- Ein Zusatzauftrag gehört zu genau einem Objekt und damit zu einer Firma
-- (ADR-0001). Gelöscht wird nie; das Objekt eines Zusatzauftrags lässt
-- sich nach dem Anlegen nicht mehr ändern.
--
-- Ein Zeiteintrag kann optional einem Zusatzauftrag zugeordnet werden,
-- und zwar nur einem desselben Objekts und derselben Firma (Fremdschlüssel
-- über Zusatzauftrag, Objekt und Firma). Fahrten haben keinen. Neu
-- zuordnen lässt sich nur ein offener Zusatzauftrag; ein Eintrag, dessen
-- Zusatzauftrag inzwischen erledigt ist, bleibt aber änderbar (wie bei
-- archivierten Objekten). Wer welche Zeiteinträge anlegen und ändern darf,
-- bleibt unverändert; die Zuordnung steht wie jede Änderung im
-- Änderungsprotokoll (#11), und abgerechnete Einträge bleiben gesperrt
-- (#16).
--
-- Zugriffsrechte:
-- * Die Tabelle zusatzauftrag liest, beschreibt und ändert nur das Büro
--   der eigenen Firma. Festbeträge bleiben dem Büro vorbehalten.
-- * Mitarbeiter und Vorarbeiter bekommen über die Funktion
--   zusatzauftraege_zur_auswahl nur die offenen Zusatzaufträge aktiver
--   Objekte ihrer Firma, ohne Abrechnungsart und Festbetrag.
--
-- Die Rechnungsvorbereitung bleibt unverändert (#44).

begin;

create type public.zusatzauftrag_abrechnungsart as enum ('stunden', 'festbetrag');

-- ---------------------------------------------------------------------------
-- Zusatzauftrag
-- ---------------------------------------------------------------------------

create table public.zusatzauftrag (
  id uuid primary key default gen_random_uuid(),
  -- "on delete cascade" greift nur, wenn eine ganze Firma gelöscht wird
  -- (nur mit dem Dienstschlüssel möglich, z. B. Aufräumen nach Tests).
  firma_id uuid not null references public.firma (id) on delete cascade,
  objekt_id uuid not null,
  beschreibung text not null check (length(trim(beschreibung)) > 0),
  abrechnungsart public.zusatzauftrag_abrechnungsart not null,
  -- Einmaliger Betrag in ganzen Cent, nur bei Abrechnungsart Festbetrag.
  festbetrag_cent integer,
  erledigt boolean not null default false,
  angelegt_am timestamptz not null default now(),
  -- Genau ein Objekt, und zwar eines derselben Firma.
  foreign key (objekt_id, firma_id) references public.objekt (id, firma_id),
  -- Nötig, damit ein Zeiteintrag nur auf einen Zusatzauftrag desselben
  -- Objekts und derselben Firma zeigen kann.
  unique (id, objekt_id, firma_id),
  constraint festbetrag_nur_bei_festbetrag check (
    (abrechnungsart = 'festbetrag' and festbetrag_cent > 0)
    or (abrechnungsart = 'stunden' and festbetrag_cent is null)
  )
);

alter table public.zusatzauftrag enable row level security;

-- Neue Zusatzaufträge sind immer offen. Das Objekt lässt sich nicht
-- ändern, sonst hingen Zeiteinträge plötzlich an einem fremden Objekt.
revoke all on public.zusatzauftrag from anon, authenticated;
grant select on public.zusatzauftrag to authenticated;
grant all on public.zusatzauftrag to service_role;
grant insert (firma_id, objekt_id, beschreibung, abrechnungsart, festbetrag_cent)
  on public.zusatzauftrag to authenticated;
grant update (beschreibung, abrechnungsart, festbetrag_cent, erledigt)
  on public.zusatzauftrag to authenticated;

create policy "Büro sieht Zusatzaufträge der eigenen Firma"
  on public.zusatzauftrag
  for select
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro legt Zusatzaufträge der eigenen Firma an"
  on public.zusatzauftrag
  for insert
  to authenticated
  with check (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro ändert Zusatzaufträge der eigenen Firma"
  on public.zusatzauftrag
  for update
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  )
  with check (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

comment on table public.zusatzauftrag is
  'Vom Büro angelegte Arbeit in einem Objekt mit eigener Abrechnungsart (Stunden oder Festbetrag). Wird nie gelöscht.';

create index zusatzauftrag_firma_id_idx on public.zusatzauftrag (firma_id);
create index zusatzauftrag_objekt_id_idx on public.zusatzauftrag (objekt_id);

-- ---------------------------------------------------------------------------
-- Zuordnung am Zeiteintrag
-- ---------------------------------------------------------------------------

alter table public.zeiteintrag
  add column zusatzauftrag_id uuid,
  -- Nur ein Zusatzauftrag desselben Objekts und derselben Firma. Der
  -- Fremdschlüssel prüft nur, wenn alle drei Spalten gefüllt sind; dass
  -- eine Fahrt (ohne Objekt) keinen hat, sichert die Prüfregel.
  add constraint zeiteintrag_zusatzauftrag_fkey
    foreign key (zusatzauftrag_id, objekt_id, firma_id)
    references public.zusatzauftrag (id, objekt_id, firma_id),
  add constraint zusatzauftrag_nur_bei_taetigkeit
    check (zusatzauftrag_id is null or art = 'taetigkeit');

comment on column public.zeiteintrag.zusatzauftrag_id is
  'Der Zusatzauftrag, zu dem die Arbeit gehört; leer bei regulärer Arbeit und bei Fahrten.';

create index zeiteintrag_zusatzauftrag_id_idx on public.zeiteintrag (zusatzauftrag_id);

-- Beim Start, beim Nachtrag und beim Ändern wählbar, für alle, die den
-- Eintrag anlegen bzw. ändern dürfen.
grant insert (zusatzauftrag_id) on public.zeiteintrag to authenticated;
grant update (zusatzauftrag_id) on public.zeiteintrag to authenticated;

-- Neu zuordnen nur einen offenen Zusatzauftrag, aber nur wenn sich die
-- Zuordnung ändert: Ein Eintrag mit inzwischen erledigtem Zusatzauftrag
-- bleibt änderbar. "security definer", weil Mitarbeiter die Tabelle
-- zusatzauftrag selbst nicht lesen dürfen. Dass der Zusatzauftrag zu
-- Objekt und Firma passt, sichert der Fremdschlüssel.
create function privat.zeiteintrag_nur_offener_zusatzauftrag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.zusatzauftrag_id is not distinct from old.zusatzauftrag_id then
    return new;
  end if;
  if exists (
    select 1 from public.zusatzauftrag za where za.id = new.zusatzauftrag_id and za.erledigt
  ) then
    raise exception 'Der Zusatzauftrag ist schon erledigt.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger zeiteintrag_nur_offener_zusatzauftrag
  before insert or update of zusatzauftrag_id on public.zeiteintrag
  for each row
  when (new.zusatzauftrag_id is not null)
  execute function privat.zeiteintrag_nur_offener_zusatzauftrag();

revoke all on function privat.zeiteintrag_nur_offener_zusatzauftrag() from public;

-- ---------------------------------------------------------------------------
-- Auswahl für die Erfassung
-- ---------------------------------------------------------------------------

-- Wie objekte_zur_auswahl: nur die Spalten, die zum Erfassen nötig sind,
-- nur offene Zusatzaufträge aktiver Objekte der eigenen Firma.
create function public.zusatzauftraege_zur_auswahl()
returns table (id uuid, objekt_id uuid, beschreibung text)
language sql
stable
security definer
set search_path = ''
as $$
  select za.id, za.objekt_id, za.beschreibung
  from public.zusatzauftrag za
  join public.objekt o on o.id = za.objekt_id
  where za.firma_id = privat.meine_firma_id()
    and not za.erledigt
    and not o.archiviert
  order by za.beschreibung, za.id
$$;

revoke all on function public.zusatzauftraege_zur_auswahl() from public, anon;
grant execute on function public.zusatzauftraege_zur_auswahl() to authenticated;

-- ---------------------------------------------------------------------------
-- Lesen mit Zusatzauftrag
-- ---------------------------------------------------------------------------

-- Wie bisher, zusätzlich mit der Beschreibung des Zusatzauftrags (auch
-- wenn er inzwischen erledigt ist). meine_zeiteintraege baut darauf auf
-- und muss deshalb mit neu angelegt werden.
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
    o.bezeichnung, t.name, za.beschreibung, a.id, a.name
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

-- Wie bisher fürs Büro, zusätzlich mit Kennung und Beschreibung des
-- Zusatzauftrags.
drop function public.zeiteintraege_der_firma(timestamptz);
create function public.zeiteintraege_der_firma(ab timestamptz)
returns table (
  id uuid,
  mitarbeiter_id uuid,
  mitarbeiter_name text,
  art public.zeiteintrag_art,
  beginn timestamptz,
  ende timestamptz,
  nachtrag boolean,
  objekt_id uuid,
  objekt_bezeichnung text,
  kunde_id uuid,
  kunde_name text,
  taetigkeit_name text,
  zusatzauftrag_id uuid,
  zusatzauftrag_beschreibung text,
  angelegt_von_name text,
  freigegeben_am timestamptz,
  freigegeben_von_name text
)
language sql
stable
set search_path = ''
as $$
  select
    z.id, m.id, m.name, z.art, z.beginn, z.ende, z.nachtrag,
    o.id, o.bezeichnung, k.id, k.name, t.name, za.id, za.beschreibung, a.name,
    z.freigegeben_am, f.name
  from public.zeiteintrag z
  join public.mitarbeiter m on m.id = z.mitarbeiter_id
  left join public.mitarbeiter a on a.id = z.angelegt_von
  left join public.mitarbeiter f on f.id = z.freigegeben_von
  left join public.objekt o on o.id = z.objekt_id
  left join public.kunde k on k.id = o.kunde_id
  left join public.taetigkeit t on t.id = z.taetigkeit_id
  left join public.zusatzauftrag za on za.id = z.zusatzauftrag_id
  where privat.meine_rolle() = 'buero'
    and z.firma_id = privat.meine_firma_id()
    and (z.beginn >= ab or z.ende is null)
  order by z.beginn desc
$$;

revoke all on function public.zeiteintraege_von(uuid, timestamptz) from public, anon;
revoke all on function public.meine_zeiteintraege(timestamptz) from public, anon;
revoke all on function public.zeiteintraege_der_firma(timestamptz) from public, anon;
grant execute on function public.zeiteintraege_von(uuid, timestamptz) to authenticated;
grant execute on function public.meine_zeiteintraege(timestamptz) to authenticated;
grant execute on function public.zeiteintraege_der_firma(timestamptz) to authenticated;

commit;
