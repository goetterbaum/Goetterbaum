-- Zusatzaufträge (Ticket #17)
--
-- Das Büro legt zu einem Objekt einen Zusatzauftrag mit Beschreibung und
-- eigener Abrechnungsart an: nach Stunden oder mit Festbetrag. Der
-- Festbetrag ist nur bei Abrechnungsart Festbetrag anzugeben und dann
-- Pflicht. Das Büro bearbeitet Zusatzaufträge und markiert sie als
-- erledigt (und nimmt das zurück, solange sie nicht abgerechnet sind).
-- Gelöscht wird nie.
--
-- Ein Zeiteintrag kann einem Zusatzauftrag seines Objekts zugeordnet
-- werden. Beim Start und Nachtrag wählen Mitarbeiter und Vorarbeiter nur
-- offene Zusatzaufträge; das Büro darf beim Prüfen auch einen erledigten
-- zuordnen. Einem abgerechneten Zusatzauftrag wird nichts mehr
-- zugeordnet. Jede Änderung der Zuordnung steht wie jede andere Änderung
-- im Änderungsprotokoll des Zeiteintrags (#11).
--
-- Abgerechnet wird ein Zusatzauftrag auf zwei Wegen:
-- * Mit der Abrechnung eines Zeitraums (#16): Zeit für Zusatzaufträge nach
--   Stunden zählt wie andere Zeit zu dem Zeitraum, in dem sie beginnt. Ein
--   erledigter Zusatzauftrag mit Festbetrag wird mit seiner ganzen Zeit
--   abgerechnet, egal wann sie lag.
-- * Einzeln, sobald er erledigt ist, ohne das Ende des Zeitraums
--   abzuwarten. Die Abrechnung umfasst dann den Zusatzauftrag und alle
--   seine noch offenen Zeiteinträge.
-- Ein so abgerechneter Zusatzauftrag (abgerechnet_in) ist abgeschlossen:
-- Er erscheint in keiner weiteren Rechnungsvorbereitung und ändert sich
-- nicht mehr. Abgeschlossen wird er nur, wenn alle seine Zeiteinträge
-- beendet und freigegeben sind; sonst blieben Einträge übrig, die nie
-- abgerechnet würden. Die Rücknahme der Abrechnung öffnet ihn wieder.
--
-- Zugriffsrechte:
-- * Zusatzaufträge sieht, legt an und ändert nur das Büro der eigenen
--   Firma. Mitarbeiter und Vorarbeiter bekommen über eine eigene Funktion
--   nur die offenen Zusatzaufträge aktiver Objekte zur Auswahl, ohne
--   Festbetrag.
-- * Die Zuordnung eines Zeiteintrags ändert, wer den Eintrag ändern darf
--   (#11, #12, #14); abgerechnete Einträge bleiben für alle gesperrt (#16).
-- * Abrechnungen entstehen weiterhin nur über die Funktionen unten.

begin;

-- ---------------------------------------------------------------------------
-- Zusatzauftrag
-- ---------------------------------------------------------------------------

create type public.zusatzauftrag_abrechnungsart as enum ('stunden', 'festbetrag');

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
  -- Die gültige Abrechnung, die den Zusatzauftrag abschließt; leer,
  -- solange er offen ist. Setzen nur die Abrechnungs-Funktionen.
  abgerechnet_in uuid,
  angelegt_am timestamptz not null default now(),
  unique (id, firma_id),
  -- Nötig, damit ein Zeiteintrag nur auf einen Zusatzauftrag seines
  -- eigenen Objekts zeigen kann.
  unique (id, objekt_id),
  -- Objekt und Abrechnung gehören zur selben Firma.
  foreign key (objekt_id, firma_id) references public.objekt (id, firma_id),
  foreign key (abgerechnet_in, firma_id) references public.abrechnung (id, firma_id),
  constraint festbetrag_nur_bei_festbetrag check (
    (abrechnungsart = 'festbetrag' and festbetrag_cent is not null and festbetrag_cent > 0)
    or (abrechnungsart = 'stunden' and festbetrag_cent is null)
  ),
  constraint nur_erledigte_abrechnen check (abgerechnet_in is null or erledigt)
);

alter table public.zusatzauftrag enable row level security;

-- Objekt und abgerechnet_in sind bewusst nicht änderbar.
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
  'Eine vom Büro angelegte Arbeit in einem Objekt mit eigener Abrechnungsart (Stunden oder Festbetrag). Wird nie gelöscht.';
comment on column public.zusatzauftrag.abgerechnet_in is
  'Die gültige Abrechnung, die den Zusatzauftrag abschließt. Setzen nur die Abrechnungs-Funktionen.';

create index zusatzauftrag_firma_id_idx on public.zusatzauftrag (firma_id);
create index zusatzauftrag_objekt_id_idx on public.zusatzauftrag (objekt_id);
create index zusatzauftrag_abgerechnet_in_idx on public.zusatzauftrag (abgerechnet_in);

-- Ein abgeschlossener Zusatzauftrag ändert sich nicht mehr, für niemanden.
-- abgerechnet_in ändern nur die Abrechnungs-Funktionen (Einstellung
-- privat.abrechnung_laeuft, wie beim Zeiteintrag). Die Abrechnungsart
-- bleibt, sobald Zeit für ihn abgerechnet ist: Sonst würde dieselbe Zeit
-- noch einmal anders berechnet.
create function privat.zusatzauftrag_abgerechnet_sperren()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.abgerechnet_in is not null then
      raise exception 'abgerechnet_in setzen nur Abrechnen und Zurücknehmen.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.abgerechnet_in is distinct from old.abgerechnet_in
     and current_setting('privat.abrechnung_laeuft', true) is distinct from 'ja'
  then
    raise exception 'abgerechnet_in ändern nur Abrechnen und Zurücknehmen.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.abgerechnet_in is not null
     and (to_jsonb(new) - 'abgerechnet_in') is distinct from (to_jsonb(old) - 'abgerechnet_in')
  then
    raise exception 'Ein abgerechneter Zusatzauftrag kann nicht geändert werden.'
      using errcode = 'check_violation';
  end if;
  if new.abrechnungsart is distinct from old.abrechnungsart
     and exists (
       select 1 from public.zeiteintrag z
       where z.zusatzauftrag_id = new.id and z.abgerechnet_in is not null
     )
  then
    raise exception 'Für diesen Zusatzauftrag ist schon Zeit abgerechnet; die Abrechnungsart bleibt.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger zusatzauftrag_abgerechnet_sperren
  before insert or update on public.zusatzauftrag
  for each row
  execute function privat.zusatzauftrag_abgerechnet_sperren();

revoke all on function privat.zusatzauftrag_abgerechnet_sperren() from public;

-- ---------------------------------------------------------------------------
-- Zuordnung eines Zeiteintrags
-- ---------------------------------------------------------------------------

alter table public.zeiteintrag
  add column zusatzauftrag_id uuid,
  -- Nur ein Zusatzauftrag desselben Objekts (und damit derselben Firma).
  add constraint zeiteintrag_zusatzauftrag_fkey
    foreign key (zusatzauftrag_id, objekt_id) references public.zusatzauftrag (id, objekt_id),
  -- Der Fremdschlüssel greift nicht, wenn das Objekt fehlt (Fahrt).
  add constraint zusatzauftrag_nur_mit_objekt
    check (zusatzauftrag_id is null or objekt_id is not null);

comment on column public.zeiteintrag.zusatzauftrag_id is
  'Der Zusatzauftrag im selben Objekt, für den die Zeit gearbeitet wurde; leer bei regulärer Arbeit.';

create index zeiteintrag_zusatzauftrag_id_idx on public.zeiteintrag (zusatzauftrag_id);

grant insert (zusatzauftrag_id), update (zusatzauftrag_id) on public.zeiteintrag to authenticated;

-- Zugeordnet wird nur ein noch nicht abgerechneter Zusatzauftrag, von
-- Mitarbeitern und Vorarbeitern nur ein offener. Geprüft wird nur, wenn
-- sich die Zuordnung ändert: Ein Eintrag eines inzwischen erledigten
-- Zusatzauftrags bleibt änderbar. "security definer", weil Mitarbeiter die
-- Tabelle zusatzauftrag nicht lesen dürfen; "for share" hält den
-- Zusatzauftrag fest, bis die Zuordnung gespeichert ist, damit ihn niemand
-- gleichzeitig abschließt. Mit dem Dienstschlüssel (Test-Setup) gilt nur
-- die Regel zum Abrechnen.
create function privat.zeiteintrag_zusatzauftrag_pruefen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ist_erledigt boolean;
  ist_abgerechnet boolean;
begin
  if new.zusatzauftrag_id is null
     or (tg_op = 'UPDATE' and new.zusatzauftrag_id is not distinct from old.zusatzauftrag_id)
  then
    return new;
  end if;
  -- Gibt es ihn nicht, meldet das der Fremdschlüssel.
  select za.erledigt, za.abgerechnet_in is not null
  into ist_erledigt, ist_abgerechnet
  from public.zusatzauftrag za
  where za.id = new.zusatzauftrag_id
  for share;
  if ist_abgerechnet then
    raise exception 'Dieser Zusatzauftrag ist schon abgerechnet.'
      using errcode = 'check_violation';
  end if;
  if ist_erledigt
     and auth.role() = 'authenticated'
     and privat.meine_rolle() is distinct from 'buero'
  then
    raise exception 'Dieser Zusatzauftrag ist erledigt.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger zeiteintrag_zusatzauftrag_pruefen
  before insert or update of zusatzauftrag_id on public.zeiteintrag
  for each row
  execute function privat.zeiteintrag_zusatzauftrag_pruefen();

revoke all on function privat.zeiteintrag_zusatzauftrag_pruefen() from public;

-- ---------------------------------------------------------------------------
-- Abrechnung eines einzelnen Zusatzauftrags
--
-- Eine Abrechnung gilt entweder einem Zeitraum (erster Monat und
-- Abrechnungszeitraum) oder einem einzelnen Zusatzauftrag.
-- ---------------------------------------------------------------------------

alter table public.abrechnung
  add column zusatzauftrag_id uuid,
  alter column erster_monat drop not null,
  alter column abrechnungszeitraum drop not null,
  add constraint abrechnung_zusatzauftrag_fkey
    foreign key (zusatzauftrag_id, firma_id) references public.zusatzauftrag (id, firma_id),
  add constraint zeitraum_oder_zusatzauftrag check (
    (zusatzauftrag_id is null and erster_monat is not null and abrechnungszeitraum is not null)
    or (zusatzauftrag_id is not null and erster_monat is null and abrechnungszeitraum is null)
  );

comment on column public.abrechnung.zusatzauftrag_id is
  'Der einzeln abgerechnete Zusatzauftrag; leer bei der Abrechnung eines Zeitraums.';

create index abrechnung_zusatzauftrag_id_idx on public.abrechnung (zusatzauftrag_id);

-- ---------------------------------------------------------------------------
-- Abrechnen und Zurücknehmen
-- ---------------------------------------------------------------------------

-- Wie bisher (#16), zusätzlich mit den erledigten Zusatzaufträgen mit
-- Festbetrag, die diese Abrechnung abschließt. Ihre Zeiteinträge gehören
-- dazu, egal in welchem Zeitraum sie beginnen, und zwar alle; Zeit für
-- einen Zusatzauftrag mit Festbetrag wird nie ohne ihn abgerechnet.
-- Die Parameter bleiben in derselben Reihenfolge; ohne zusatzauftraege
-- verhält sich die Funktion wie bisher.
drop function public.als_abgerechnet_markieren(uuid, date, uuid[], jsonb, jsonb, integer);

create function public.als_abgerechnet_markieren(
  fuer_kunde uuid,
  ab_monat date,
  eintraege uuid[],
  monate jsonb,
  aufstellung jsonb,
  summe integer,
  zusatzauftraege uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ich uuid := privat.meine_mitarbeiter_id();
  firma uuid := privat.meine_firma_id();
  kunden_abrechnungszeitraum public.abrechnungszeitraum;
  anzahl_monate integer;
  zeitraum_beginn timestamptz;
  zeitraum_ende timestamptz;
  neu uuid;
  anzahl integer;
begin
  if privat.meine_rolle() is distinct from 'buero' then
    raise exception 'Abrechnen darf nur das Büro.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Sperrt den Kunden bis zum Ende: Zwei gleichzeitige Abrechnungen
  -- desselben Kunden warten aufeinander und rechnen nichts doppelt ab.
  select k.abrechnungszeitraum into kunden_abrechnungszeitraum
  from public.kunde k
  where k.id = fuer_kunde and k.firma_id = firma
  for update;
  if not found then
    raise exception 'Diesen Kunden gibt es nicht.' using errcode = 'no_data_found';
  end if;

  anzahl_monate := case when kunden_abrechnungszeitraum = 'quartalsweise' then 3 else 1 end;
  if extract(day from ab_monat) <> 1
     or (
       kunden_abrechnungszeitraum = 'quartalsweise'
       and extract(month from ab_monat) not in (1, 4, 7, 10)
     )
  then
    raise exception 'Der Zeitraum passt nicht zum Abrechnungszeitraum des Kunden.'
      using errcode = 'check_violation';
  end if;
  -- Tage gelten in Berlin.
  zeitraum_beginn := ab_monat::timestamp at time zone 'Europe/Berlin';
  zeitraum_ende := (ab_monat + make_interval(months => anzahl_monate))::timestamp
    at time zone 'Europe/Berlin';

  eintraege := array(select distinct e from unnest(coalesce(eintraege, '{}')) e);
  monate := coalesce(monate, '[]');
  zusatzauftraege := array(select distinct za from unnest(coalesce(zusatzauftraege, '{}')) za);
  if cardinality(eintraege) = 0
     and jsonb_array_length(monate) = 0
     and cardinality(zusatzauftraege) = 0
  then
    raise exception 'Es gibt nichts abzurechnen.' using errcode = 'check_violation';
  end if;

  -- Sperrt die Zusatzaufträge zuerst: Wer gleichzeitig einen Zeiteintrag
  -- zuordnet, wartet, und ein schon zugeordneter fällt unten auf.
  perform 1
  from public.zusatzauftrag za
  join public.objekt o on o.id = za.objekt_id
  where za.id = any (zusatzauftraege)
    and za.firma_id = firma
    and o.kunde_id = fuer_kunde
    and za.abrechnungsart = 'festbetrag'
    and za.erledigt
    and za.abgerechnet_in is null
  for update of za;
  get diagnostics anzahl = row_count;
  if anzahl <> cardinality(zusatzauftraege) then
    raise exception 'Mindestens ein Zusatzauftrag ist nicht (mehr) abrechenbar.'
      using errcode = 'check_violation';
  end if;

  insert into public.abrechnung
    (firma_id, kunde_id, erster_monat, abrechnungszeitraum, positionen, summe_cent,
     abgerechnet_von)
  values (firma, fuer_kunde, ab_monat, kunden_abrechnungszeitraum, aufstellung, summe, ich)
  returning id into neu;

  perform set_config('privat.abrechnung_laeuft', 'ja', true);

  update public.zeiteintrag z
  set abgerechnet_in = neu
  where z.id = any (eintraege)
    and z.firma_id = firma
    and z.abgerechnet_in is null
    and z.freigegeben_am is not null
    and z.objekt_id in (select o.id from public.objekt o where o.kunde_id = fuer_kunde)
    and (
      z.zusatzauftrag_id = any (zusatzauftraege)
      or (
        z.beginn >= zeitraum_beginn
        and z.beginn < zeitraum_ende
        and not exists (
          select 1 from public.zusatzauftrag za
          where za.id = z.zusatzauftrag_id and za.abrechnungsart = 'festbetrag'
        )
      )
    );
  get diagnostics anzahl = row_count;
  if anzahl <> cardinality(eintraege) then
    raise exception 'Mindestens ein Zeiteintrag ist nicht (mehr) abrechenbar.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.zeiteintrag z
    where z.zusatzauftrag_id = any (zusatzauftraege) and z.abgerechnet_in is null
  ) then
    raise exception 'Ein Zusatzauftrag hat Zeiteinträge, die fehlen oder nicht freigegeben sind.'
      using errcode = 'check_violation';
  end if;
  update public.zusatzauftrag za set abgerechnet_in = neu where za.id = any (zusatzauftraege);

  -- Ein schon abgerechneter Monat scheitert am eindeutigen Index.
  insert into public.abrechnung_pauschal_monat (abrechnung_id, firma_id, objekt_id, monat)
  select neu, firma, p.objekt_id, p.monat
  from jsonb_to_recordset(monate) as p (objekt_id uuid, monat date)
  join public.objekt o
    on o.id = p.objekt_id
    and o.kunde_id = fuer_kunde
    and o.abrechnungsart = 'pauschale'
  where p.monat >= ab_monat
    and p.monat < ab_monat + make_interval(months => anzahl_monate);
  get diagnostics anzahl = row_count;
  if anzahl <> jsonb_array_length(monate) then
    raise exception 'Mindestens ein Pauschal-Monat gehört nicht zu dieser Abrechnung.'
      using errcode = 'check_violation';
  end if;

  return neu;
end
$$;

-- Rechnet einen erledigten Zusatzauftrag einzeln ab und gibt die Kennung
-- der neuen Abrechnung zurück. Positionen und Summe kommen wie beim
-- Zeitraum aus dem Rechenbaustein der App. eintraege sind alle noch
-- offenen Zeiteinträge des Zusatzauftrags; fehlt einer oder ist er nicht
-- freigegeben, wird nichts gespeichert. Ein Zusatzauftrag nach Stunden
-- ohne offene Zeit hat nichts abzurechnen.
create function public.zusatzauftrag_abrechnen(
  welcher uuid,
  eintraege uuid[],
  aufstellung jsonb,
  summe integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ich uuid := privat.meine_mitarbeiter_id();
  firma uuid := privat.meine_firma_id();
  fuer_kunde uuid;
  art public.zusatzauftrag_abrechnungsart;
  neu uuid;
  anzahl integer;
begin
  if privat.meine_rolle() is distinct from 'buero' then
    raise exception 'Abrechnen darf nur das Büro.'
      using errcode = 'insufficient_privilege';
  end if;

  select o.kunde_id into fuer_kunde
  from public.zusatzauftrag za
  join public.objekt o on o.id = za.objekt_id
  where za.id = welcher and za.firma_id = firma;
  if not found then
    raise exception 'Diesen Zusatzauftrag gibt es nicht.' using errcode = 'no_data_found';
  end if;

  -- Sperrt wie beim Abrechnen eines Zeitraums erst den Kunden, dann den
  -- Zusatzauftrag.
  perform 1 from public.kunde k where k.id = fuer_kunde for update;
  select za.abrechnungsart into art
  from public.zusatzauftrag za
  where za.id = welcher and za.erledigt and za.abgerechnet_in is null
  for update;
  if not found then
    raise exception 'Dieser Zusatzauftrag ist nicht erledigt oder schon abgerechnet.'
      using errcode = 'check_violation';
  end if;

  eintraege := array(select distinct e from unnest(coalesce(eintraege, '{}')) e);
  if art = 'stunden' and cardinality(eintraege) = 0 then
    raise exception 'Es gibt nichts abzurechnen.' using errcode = 'check_violation';
  end if;

  insert into public.abrechnung
    (firma_id, kunde_id, zusatzauftrag_id, positionen, summe_cent, abgerechnet_von)
  values (firma, fuer_kunde, welcher, aufstellung, summe, ich)
  returning id into neu;

  perform set_config('privat.abrechnung_laeuft', 'ja', true);

  update public.zeiteintrag z
  set abgerechnet_in = neu
  where z.id = any (eintraege)
    and z.zusatzauftrag_id = welcher
    and z.abgerechnet_in is null
    and z.freigegeben_am is not null;
  get diagnostics anzahl = row_count;
  if anzahl <> cardinality(eintraege) then
    raise exception 'Mindestens ein Zeiteintrag ist nicht (mehr) abrechenbar.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.zeiteintrag z
    where z.zusatzauftrag_id = welcher and z.abgerechnet_in is null
  ) then
    raise exception 'Der Zusatzauftrag hat Zeiteinträge, die fehlen oder nicht freigegeben sind.'
      using errcode = 'check_violation';
  end if;

  update public.zusatzauftrag za set abgerechnet_in = neu where za.id = welcher;
  return neu;
end
$$;

-- Wie bisher, zusätzlich: Zusatzaufträge, die die Abrechnung
-- abgeschlossen hat, sind wieder offen.
create or replace function public.abrechnung_zuruecknehmen(welche uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if privat.meine_rolle() is distinct from 'buero' then
    raise exception 'Abrechnungen zurücknehmen darf nur das Büro.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.abrechnung a
  set zurueckgenommen_am = now(), zurueckgenommen_von = privat.meine_mitarbeiter_id()
  where a.id = welche
    and a.firma_id = privat.meine_firma_id()
    and a.zurueckgenommen_am is null;
  if not found then
    raise exception 'Diese Abrechnung gibt es nicht, oder sie ist schon zurückgenommen.'
      using errcode = 'no_data_found';
  end if;

  perform set_config('privat.abrechnung_laeuft', 'ja', true);
  update public.zeiteintrag z set abgerechnet_in = null where z.abgerechnet_in = welche;
  update public.zusatzauftrag za set abgerechnet_in = null where za.abgerechnet_in = welche;
  update public.abrechnung_pauschal_monat p set gueltig = false where p.abrechnung_id = welche;
end
$$;

-- Wie bisher, zusätzlich mit dem einzeln abgerechneten Zusatzauftrag
-- (Beschreibung); bei ihm fehlen erster Monat und Abrechnungszeitraum.
drop function public.abrechnungen_des_kunden(uuid);
create function public.abrechnungen_des_kunden(fuer_kunde uuid)
returns table (
  id uuid,
  erster_monat date,
  abrechnungszeitraum public.abrechnungszeitraum,
  zusatzauftrag_beschreibung text,
  summe_cent integer,
  abgerechnet_am timestamptz,
  abgerechnet_von_name text,
  zurueckgenommen_am timestamptz,
  zurueckgenommen_von_name text
)
language sql
stable
set search_path = ''
as $$
  select
    a.id, a.erster_monat, a.abrechnungszeitraum, za.beschreibung, a.summe_cent,
    a.abgerechnet_am, m.name, a.zurueckgenommen_am, r.name
  from public.abrechnung a
  join public.mitarbeiter m on m.id = a.abgerechnet_von
  left join public.mitarbeiter r on r.id = a.zurueckgenommen_von
  left join public.zusatzauftrag za on za.id = a.zusatzauftrag_id
  where a.kunde_id = fuer_kunde
  order by a.abgerechnet_am desc, a.id
$$;

revoke all on function public.als_abgerechnet_markieren(uuid, date, uuid[], jsonb, jsonb, integer, uuid[])
  from public, anon;
revoke all on function public.zusatzauftrag_abrechnen(uuid, uuid[], jsonb, integer)
  from public, anon;
revoke all on function public.abrechnung_zuruecknehmen(uuid) from public, anon;
revoke all on function public.abrechnungen_des_kunden(uuid) from public, anon;
grant execute on function public.als_abgerechnet_markieren(uuid, date, uuid[], jsonb, jsonb, integer, uuid[])
  to authenticated;
grant execute on function public.zusatzauftrag_abrechnen(uuid, uuid[], jsonb, integer)
  to authenticated;
grant execute on function public.abrechnung_zuruecknehmen(uuid) to authenticated;
grant execute on function public.abrechnungen_des_kunden(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Auswahl und Lesen mit Zusatzauftrag
-- ---------------------------------------------------------------------------

-- Die offenen Zusatzaufträge aktiver Objekte der eigenen Firma zum
-- Auswählen, ohne Festbetrag. dazu: ein weiterer Zusatzauftrag der Firma,
-- der auch erledigt sein darf, z. B. der bisherige eines Eintrags, den
-- jemand ändert.
create function public.zusatzauftraege_zur_auswahl(dazu uuid default null)
returns table (id uuid, objekt_id uuid, beschreibung text, erledigt boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select za.id, za.objekt_id, za.beschreibung, za.erledigt
  from public.zusatzauftrag za
  join public.objekt o on o.id = za.objekt_id
  where za.firma_id = privat.meine_firma_id()
    and za.abgerechnet_in is null
    and ((not za.erledigt and not o.archiviert) or za.id = dazu)
  order by za.beschreibung, za.id
$$;

-- Wie bisher (#14), zusätzlich mit dem Zusatzauftrag. meine_zeiteintraege
-- baut darauf auf und muss deshalb mit neu angelegt werden.
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
  angelegt_von uuid,
  angelegt_von_name text,
  zusatzauftrag_id uuid,
  zusatzauftrag_beschreibung text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    z.id, z.art, z.beginn, z.ende, z.nachtrag, z.freigegeben_am is not null,
    o.bezeichnung, t.name, a.id, a.name, za.id, za.beschreibung
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
  angelegt_von uuid,
  angelegt_von_name text,
  zusatzauftrag_id uuid,
  zusatzauftrag_beschreibung text
)
language sql
stable
set search_path = ''
as $$
  select * from public.zeiteintraege_von(privat.meine_mitarbeiter_id(), ab)
$$;

-- Wie bisher fürs Büro, zusätzlich mit dem Zusatzauftrag.
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
  angelegt_von_name text,
  freigegeben_am timestamptz,
  freigegeben_von_name text,
  zusatzauftrag_id uuid,
  zusatzauftrag_beschreibung text
)
language sql
stable
set search_path = ''
as $$
  select
    z.id, m.id, m.name, z.art, z.beginn, z.ende, z.nachtrag,
    o.id, o.bezeichnung, k.id, k.name, t.name, a.name,
    z.freigegeben_am, f.name, za.id, za.beschreibung
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

revoke all on function public.zusatzauftraege_zur_auswahl(uuid) from public, anon;
revoke all on function public.zeiteintraege_von(uuid, timestamptz) from public, anon;
revoke all on function public.meine_zeiteintraege(timestamptz) from public, anon;
revoke all on function public.zeiteintraege_der_firma(timestamptz) from public, anon;
grant execute on function public.zusatzauftraege_zur_auswahl(uuid) to authenticated;
grant execute on function public.zeiteintraege_von(uuid, timestamptz) to authenticated;
grant execute on function public.meine_zeiteintraege(timestamptz) to authenticated;
grant execute on function public.zeiteintraege_der_firma(timestamptz) to authenticated;

commit;
