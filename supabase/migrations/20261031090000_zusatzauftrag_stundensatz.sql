-- Eigener Stundensatz beim Zusatzauftrag nach Stunden (Ticket #61)
--
-- Ein Zusatzauftrag nach Stunden kann einen eigenen Stundensatz haben. Er
-- gilt für alle Tätigkeiten des Zusatzauftrags und hat Vorrang vor Objekt,
-- Kunde und Standard. Ohne ihn gilt wie bisher Objekt → Kunde → Standard
-- (#60). Gerechnet wird in der App (Rechenbaustein); die Datenbank
-- speichert nur den Satz.
--
-- Der Satz ist freiwillig, größer als 0 und nur bei Abrechnungsart
-- Stunden erlaubt: Wechselt ein Zusatzauftrag auf Festbetrag, muss der
-- Satz entfallen.
--
-- Zugriffsrechte, die sich ändern:
-- * Die Spalte lesen, setzen und ändern nur, wer die Tabelle zusatzauftrag
--   lesen und ändern darf, also das Büro der eigenen Firma. Mitarbeiter
--   bekommen über zusatzauftraege_zur_auswahl weiterhin nur Kennung,
--   Objekt und Beschreibung.
-- * Ist schon Zeit eines Zusatzauftrags abgerechnet, bleibt sein
--   Stundensatz fest, für niemanden änderbar (wie die Abrechnungsart,
--   20261021090000). Sonst stünde derselbe Auftrag mit zwei Preisen in
--   verschiedenen Abrechnungen. Abgerechnetes selbst bleibt unberührt,
--   weil jede Abrechnung ihre Positionen mit Stundensatz speichert.

begin;

alter table public.zusatzauftrag
  -- Preis pro Stunde in ganzen Cent für alle Tätigkeiten des
  -- Zusatzauftrags; leer gelten die Sätze des Objekts bzw. Kunden.
  add column stundensatz_cent integer,
  -- "is null or …": Eine Prüfregel mit Ergebnis "unbekannt" gilt als
  -- erfüllt (siehe 20261020100000); deshalb ausdrücklich ausgeschrieben.
  add constraint stundensatz_nur_bei_stunden check (
    stundensatz_cent is null
    or (abrechnungsart = 'stunden' and stundensatz_cent > 0)
  );

comment on column public.zusatzauftrag.stundensatz_cent is
  'Eigener Stundensatz eines Zusatzauftrags nach Stunden für alle seine Tätigkeiten; hat Vorrang vor Objekt, Kunde und Standard. Leer: es gelten diese.';

grant insert (stundensatz_cent) on public.zusatzauftrag to authenticated;
grant update (stundensatz_cent) on public.zusatzauftrag to authenticated;

-- Wie privat.zusatzauftrag_abrechnungsart_fest: "security definer", damit
-- die Regel unabhängig davon greift, welche Zeiteinträge der Ändernde
-- sehen darf; deshalb nur in der Firma des Zusatzauftrags.
create function privat.zusatzauftrag_stundensatz_fest()
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
    raise exception 'Für diesen Zusatzauftrag ist schon Zeit abgerechnet; der Stundensatz bleibt.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger zusatzauftrag_stundensatz_fest
  before update of stundensatz_cent on public.zusatzauftrag
  for each row
  when (new.stundensatz_cent is distinct from old.stundensatz_cent)
  execute function privat.zusatzauftrag_stundensatz_fest();

revoke all on function privat.zusatzauftrag_stundensatz_fest() from public;

commit;
