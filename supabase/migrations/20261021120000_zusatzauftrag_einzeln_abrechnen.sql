-- Erledigten Zusatzauftrag einzeln abrechnen (Ticket #45)
--
-- Ein erledigter Zusatzauftrag lässt sich sofort für sich abrechnen, ohne
-- das Ende des Abrechnungszeitraums abzuwarten, z. B. ein Sturmschaden.
-- Gespeichert wird das als Abrechnung wie bisher, aber ohne Zeitraum und
-- mit Verweis auf den Zusatzauftrag. Sie umfasst alle freigegebenen, noch
-- nicht abgerechneten Zeiteinträge des Zusatzauftrags aus allen Monaten,
-- bei Festbetrag dazu den Zusatzauftrag selbst (wie in #44). Danach
-- erscheint nichts davon in einer weiteren Rechnungsvorbereitung.
--
-- Ein Zusatzauftrag nach Stunden wird dabei nicht selbst als abgerechnet
-- markiert, nur seine Zeit (wie in der regulären Abrechnung). So bleibt
-- Zeit, die erst später freigegeben wird oder durch die Rücknahme einer
-- anderen Abrechnung wieder offen ist, abrechenbar und geht nicht
-- verloren.
--
-- Zurückgenommen wird wie jede Abrechnung über abrechnung_zuruecknehmen;
-- die Funktion leert schon alle Verweise und bleibt unverändert.
--
-- Zugriffsrechte, die sich ändern: keine neuen Tabellen. Einzeln abrechnen
-- darf nur das Büro der eigenen Firma, über die neue Funktion. Die neue
-- Spalte abrechnung.zusatzauftrag_id setzt nur sie.

begin;

-- ---------------------------------------------------------------------------
-- Abrechnung eines einzelnen Zusatzauftrags
-- ---------------------------------------------------------------------------

-- Nötig, damit eine Abrechnung nur auf einen Zusatzauftrag derselben Firma
-- zeigen kann.
alter table public.zusatzauftrag
  add constraint zusatzauftrag_id_firma_id_key unique (id, firma_id);

-- Eine Abrechnung hat entweder einen Zeitraum oder einen Zusatzauftrag.
alter table public.abrechnung
  add column zusatzauftrag_id uuid,
  alter column erster_monat drop not null,
  alter column abrechnungszeitraum drop not null,
  add constraint abrechnung_zusatzauftrag_id_fkey
    foreign key (zusatzauftrag_id, firma_id) references public.zusatzauftrag (id, firma_id),
  add constraint zeitraum_oder_zusatzauftrag check (
    (zusatzauftrag_id is null and erster_monat is not null and abrechnungszeitraum is not null)
    or (zusatzauftrag_id is not null and erster_monat is null and abrechnungszeitraum is null)
  );

comment on column public.abrechnung.zusatzauftrag_id is
  'Bei der Einzel-Abrechnung eines Zusatzauftrags dieser; dann ohne Zeitraum. Leer bei der regulären Abrechnung eines Zeitraums.';

create index abrechnung_zusatzauftrag_id_idx on public.abrechnung (zusatzauftrag_id);

comment on table public.abrechnung is
  'Eine als abgerechnet markierte Rechnungsvorbereitung eines Zeitraums oder eines einzelnen Zusatzauftrags. Schreiben nur über als_abgerechnet_markieren, zusatzauftrag_einzeln_abrechnen und abrechnung_zuruecknehmen.';

-- Rechnet einen erledigten Zusatzauftrag einzeln ab und gibt die Kennung
-- der neuen Abrechnung zurück. Positionen und Summe kommen aus dem
-- Rechenbaustein der App; nachgerechnet wird hier nicht. Die Datenbank
-- prüft: Der Zusatzauftrag gehört zur eigenen Firma, ist erledigt und
-- (bei Festbetrag) noch nicht abgerechnet. Die übergebenen Zeiteinträge
-- sind genau die freigegebenen, noch nicht abgerechneten des
-- Zusatzauftrags: keiner zu viel und keiner vergessen. Passt etwas nicht,
-- wird nichts gespeichert.
create function public.zusatzauftrag_einzeln_abrechnen(
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
  sein_kunde uuid;
  auftrag public.zusatzauftrag;
  neu uuid;
  anzahl integer;
begin
  if privat.meine_rolle() is distinct from 'buero' then
    raise exception 'Abrechnen darf nur das Büro.'
      using errcode = 'insufficient_privilege';
  end if;

  select o.kunde_id into sein_kunde
  from public.zusatzauftrag za
  join public.objekt o on o.id = za.objekt_id
  where za.id = welcher and za.firma_id = firma;
  if not found then
    raise exception 'Diesen Zusatzauftrag gibt es nicht.' using errcode = 'no_data_found';
  end if;

  -- Sperrt erst den Kunden, dann den Zusatzauftrag, in derselben
  -- Reihenfolge wie als_abgerechnet_markieren: Gleichzeitige Abrechnungen
  -- desselben Kunden warten aufeinander und rechnen nichts doppelt ab.
  perform 1 from public.kunde k where k.id = sein_kunde for update;
  select * into auftrag from public.zusatzauftrag za where za.id = welcher for update;

  if not auftrag.erledigt then
    raise exception 'Nur ein erledigter Zusatzauftrag lässt sich einzeln abrechnen.'
      using errcode = 'check_violation';
  end if;
  if auftrag.abgerechnet_in is not null then
    raise exception 'Der Zusatzauftrag ist schon abgerechnet.'
      using errcode = 'check_violation';
  end if;

  eintraege := array(select distinct e from unnest(coalesce(eintraege, '{}')) e);
  if auftrag.abrechnungsart = 'stunden' and cardinality(eintraege) = 0 then
    raise exception 'Es gibt nichts abzurechnen.' using errcode = 'check_violation';
  end if;

  insert into public.abrechnung
    (firma_id, kunde_id, zusatzauftrag_id, positionen, summe_cent, abgerechnet_von)
  values (firma, sein_kunde, welcher, aufstellung, summe, ich)
  returning id into neu;

  perform set_config('privat.abrechnung_laeuft', 'ja', true);

  if auftrag.abrechnungsart = 'festbetrag' then
    update public.zusatzauftrag za set abgerechnet_in = neu where za.id = welcher;
  end if;

  update public.zeiteintrag z
  set abgerechnet_in = neu
  where z.id = any (eintraege)
    and z.firma_id = firma
    and z.zusatzauftrag_id = welcher
    and z.abgerechnet_in is null
    and z.freigegeben_am is not null;
  get diagnostics anzahl = row_count;
  if anzahl <> cardinality(eintraege) then
    raise exception 'Mindestens ein Zeiteintrag ist nicht (mehr) abrechenbar.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.zeiteintrag z
    where z.zusatzauftrag_id = welcher
      and z.firma_id = firma
      and z.abgerechnet_in is null
      and z.freigegeben_am is not null
  ) then
    raise exception 'Mindestens ein freigegebener Zeiteintrag des Zusatzauftrags fehlt.'
      using errcode = 'check_violation';
  end if;

  return neu;
end
$$;

revoke all on function public.zusatzauftrag_einzeln_abrechnen(uuid, uuid[], jsonb, integer)
  from public, anon;
grant execute on function public.zusatzauftrag_einzeln_abrechnen(uuid, uuid[], jsonb, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Bisherige Abrechnungen
-- ---------------------------------------------------------------------------

-- Wie bisher, dazu der Zusatzauftrag einer Einzel-Abrechnung (Kennung und
-- Beschreibung); erster_monat und abrechnungszeitraum sind dann leer.
drop function public.abrechnungen_des_kunden(uuid);

create function public.abrechnungen_des_kunden(fuer_kunde uuid)
returns table (
  id uuid,
  erster_monat date,
  abrechnungszeitraum public.abrechnungszeitraum,
  zusatzauftrag_id uuid,
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
    a.id, a.erster_monat, a.abrechnungszeitraum, za.id, za.beschreibung, a.summe_cent,
    a.abgerechnet_am, m.name, a.zurueckgenommen_am, r.name
  from public.abrechnung a
  join public.mitarbeiter m on m.id = a.abgerechnet_von
  left join public.mitarbeiter r on r.id = a.zurueckgenommen_von
  left join public.zusatzauftrag za on za.id = a.zusatzauftrag_id
  where a.kunde_id = fuer_kunde
  order by a.abgerechnet_am desc, a.id
$$;

revoke all on function public.abrechnungen_des_kunden(uuid) from public, anon;
grant execute on function public.abrechnungen_des_kunden(uuid) to authenticated;

commit;
