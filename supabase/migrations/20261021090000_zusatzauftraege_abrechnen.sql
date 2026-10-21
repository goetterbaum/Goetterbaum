-- Zusatzaufträge in Rechnungsvorbereitung und Abrechnung (Ticket #44)
--
-- Ein erledigter Zusatzauftrag mit Festbetrag wird beim Markieren als
-- abgerechnet in die Abrechnung aufgenommen. Er zeigt dann wie ein
-- Zeiteintrag mit abgerechnet_in auf seine Abrechnung, steckt so in
-- höchstens einer gültigen Abrechnung und ist für alle gesperrt. Die Zeit
-- für ihn gehört ganz zum Festbetrag: Seine freigegebenen Zeiteinträge
-- werden mit ihm abgerechnet, auch wenn sie in früheren Monaten liegen,
-- und nie ohne ihn. Zusatzaufträge nach Stunden werden nicht selbst
-- abgerechnet, nur ihre Zeiteinträge, wie bisher im Zeitraum.
--
-- Die Rücknahme der Abrechnung leert abgerechnet_in wieder; der Festbetrag
-- ist dann wieder abrechenbar und der Zusatzauftrag änderbar.
--
-- Zugriffsrechte, die sich ändern:
-- * abgerechnet_in am Zusatzauftrag setzen nur Abrechnen und Zurücknehmen,
--   auch nicht der Dienstschlüssel (wie am Zeiteintrag, #16).
-- * Ein abgerechneter Zusatzauftrag ändert sich nicht mehr, für niemanden,
--   bis die Abrechnung zurückgenommen ist.
-- * Ist schon Zeit eines Zusatzauftrags abgerechnet, lässt sich seine
--   Abrechnungsart nicht mehr ändern, für niemanden.
--
-- als_abgerechnet_markieren bekommt die Liste der Zusatzaufträge als
-- neuen, letzten Parameter. Er ist optional, damit die bisherige App bis
-- zum Wechsel auf die neue weiter abrechnen kann.

begin;

-- ---------------------------------------------------------------------------
-- Abgerechnete Zusatzaufträge
-- ---------------------------------------------------------------------------

alter table public.zusatzauftrag
  add column abgerechnet_in uuid,
  -- Die Abrechnung gehört zur selben Firma wie der Zusatzauftrag.
  add constraint zusatzauftrag_abgerechnet_in_fkey
    foreign key (abgerechnet_in, firma_id) references public.abrechnung (id, firma_id),
  add constraint nur_erledigte_festbetraege_abrechnen
    check (abgerechnet_in is null or (erledigt and abrechnungsart = 'festbetrag'));

comment on column public.zusatzauftrag.abgerechnet_in is
  'Die gültige Abrechnung, die den Festbetrag umfasst; leer, solange er nicht abgerechnet ist. Setzen nur die Abrechnungs-Funktionen.';

create index zusatzauftrag_abgerechnet_in_idx on public.zusatzauftrag (abgerechnet_in);

-- Wie privat.zeiteintrag_abgerechnet_sperren, dazu beim Anlegen: Auch der
-- Dienstschlüssel, der alle Spalten schreiben darf, legt keinen schon
-- abgerechneten Zusatzauftrag an.
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
  return new;
end
$$;

create trigger zusatzauftrag_abgerechnet_sperren
  before insert or update on public.zusatzauftrag
  for each row
  execute function privat.zusatzauftrag_abgerechnet_sperren();

revoke all on function privat.zusatzauftrag_abgerechnet_sperren() from public;

-- Ist schon Zeit eines Zusatzauftrags abgerechnet, bleibt seine
-- Abrechnungsart fest. Sonst würde z. B. ein nachträglicher Festbetrag die
-- schon nach Stunden berechnete Zeit noch einmal bezahlen. "security
-- definer", damit die Regel unabhängig davon greift, welche Zeiteinträge
-- der Ändernde sehen darf; deshalb nur in der Firma des Zusatzauftrags.
create function privat.zusatzauftrag_abrechnungsart_fest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.zeiteintrag z
    where z.zusatzauftrag_id = new.id
      and z.firma_id = new.firma_id
      and z.abgerechnet_in is not null
  ) then
    raise exception 'Für diesen Zusatzauftrag ist schon Zeit abgerechnet; die Abrechnungsart bleibt.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger zusatzauftrag_abrechnungsart_fest
  before update of abrechnungsart on public.zusatzauftrag
  for each row
  when (new.abrechnungsart is distinct from old.abrechnungsart)
  execute function privat.zusatzauftrag_abrechnungsart_fest();

revoke all on function privat.zusatzauftrag_abrechnungsart_fest() from public;

-- ---------------------------------------------------------------------------
-- Abrechnen
-- ---------------------------------------------------------------------------

-- Wie bisher (20261018120000_abrechnung.sql), dazu die Zusatzaufträge mit
-- Festbetrag. Die Datenbank prüft zusätzlich: Jeder übergebene
-- Zusatzauftrag hat einen Festbetrag, ist erledigt, noch nicht
-- abgerechnet und gehört zu einem Objekt des Kunden. Ein Zeiteintrag für
-- einen Zusatzauftrag mit Festbetrag wird nur mit diesem abgerechnet,
-- dann aber unabhängig vom Zeitraum; alle anderen Zeiteinträge wie bisher
-- nur im Zeitraum. Passt etwas nicht, wird nichts gespeichert.
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
  zusatzauftraege := array(select distinct za from unnest(coalesce(zusatzauftraege, '{}')) za);
  monate := coalesce(monate, '[]');
  if cardinality(eintraege) = 0
     and jsonb_array_length(monate) = 0
     and cardinality(zusatzauftraege) = 0
  then
    raise exception 'Es gibt nichts abzurechnen.' using errcode = 'check_violation';
  end if;

  insert into public.abrechnung
    (firma_id, kunde_id, erster_monat, abrechnungszeitraum, positionen, summe_cent,
     abgerechnet_von)
  values (firma, fuer_kunde, ab_monat, kunden_abrechnungszeitraum, aufstellung, summe, ich)
  returning id into neu;

  perform set_config('privat.abrechnung_laeuft', 'ja', true);

  update public.zusatzauftrag za
  set abgerechnet_in = neu
  where za.id = any (zusatzauftraege)
    and za.firma_id = firma
    and za.abgerechnet_in is null
    and za.erledigt
    and za.abrechnungsart = 'festbetrag'
    and za.objekt_id in (select o.id from public.objekt o where o.kunde_id = fuer_kunde);
  get diagnostics anzahl = row_count;
  if anzahl <> cardinality(zusatzauftraege) then
    raise exception 'Mindestens ein Zusatzauftrag ist nicht (mehr) abrechenbar.'
      using errcode = 'check_violation';
  end if;

  update public.zeiteintrag z
  set abgerechnet_in = neu
  where z.id = any (eintraege)
    and z.firma_id = firma
    and z.abgerechnet_in is null
    and z.freigegeben_am is not null
    and z.objekt_id in (select o.id from public.objekt o where o.kunde_id = fuer_kunde)
    and case (select za.abrechnungsart from public.zusatzauftrag za where za.id = z.zusatzauftrag_id)
      when 'festbetrag' then z.zusatzauftrag_id = any (zusatzauftraege)
      else z.beginn >= zeitraum_beginn and z.beginn < zeitraum_ende
    end;
  get diagnostics anzahl = row_count;
  if anzahl <> cardinality(eintraege) then
    raise exception 'Mindestens ein Zeiteintrag ist nicht (mehr) abrechenbar.'
      using errcode = 'check_violation';
  end if;

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

revoke all on function public.als_abgerechnet_markieren(uuid, date, uuid[], jsonb, jsonb, integer, uuid[])
  from public, anon;
grant execute on function public.als_abgerechnet_markieren(uuid, date, uuid[], jsonb, jsonb, integer, uuid[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- Zurücknehmen
-- ---------------------------------------------------------------------------

-- Wie bisher, dazu werden die Zusatzaufträge mit Festbetrag wieder
-- abrechenbar.
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

commit;
