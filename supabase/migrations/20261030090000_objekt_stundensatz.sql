-- Stundensatz je Objekt (Ticket #60)
--
-- Das Büro kann für ein Objekt je Tätigkeit einen abweichenden
-- Stundensatz festlegen und wieder entfernen. Er hat Vorrang vor dem Satz
-- des Kunden und dem Standard-Stundensatz; ohne ihn folgt das Objekt
-- wieder dem Kunden. Aufgebaut wie kunden_stundensatz.
--
-- Zugriffsrechte wie bei den Kundensätzen: Nur das Büro der eigenen Firma
-- liest, legt an, ändert und entfernt. Mitarbeiter haben keinen Zugriff.
-- Objekt, Tätigkeit und Firma eines Satzes lassen sich nicht ändern, nur
-- der Betrag. Abgerechnetes bleibt unberührt, weil jede Abrechnung ihre
-- Positionen mit Stundensatz und Betrag selbst speichert.

begin;

create table public.objekt_stundensatz (
  -- Direkt an der Firma, damit der Satz beim Löschen einer ganzen Firma
  -- (nur mit dem Dienstschlüssel) im selben Schritt wie ihre Objekte
  -- verschwindet (siehe 20261018130000).
  firma_id uuid not null references public.firma (id) on delete cascade,
  objekt_id uuid not null,
  taetigkeit_id uuid not null,
  -- Preis pro Stunde in ganzen Cent; hat Vorrang vor Kunde und Standard.
  stundensatz_cent integer not null check (stundensatz_cent > 0),
  angelegt_am timestamptz not null default now(),
  -- Höchstens ein Satz je Objekt und Tätigkeit.
  primary key (objekt_id, taetigkeit_id),
  -- Objekt und Tätigkeit gehören beide zur selben Firma.
  foreign key (objekt_id, firma_id) references public.objekt (id, firma_id),
  foreign key (taetigkeit_id, firma_id) references public.taetigkeit (id, firma_id)
);

alter table public.objekt_stundensatz enable row level security;

revoke all on public.objekt_stundensatz from anon, authenticated;
grant select, delete on public.objekt_stundensatz to authenticated;
grant all on public.objekt_stundensatz to service_role;
grant insert (firma_id, objekt_id, taetigkeit_id, stundensatz_cent)
  on public.objekt_stundensatz to authenticated;
grant update (stundensatz_cent) on public.objekt_stundensatz to authenticated;

create policy "Büro sieht Objekt-Stundensätze der eigenen Firma"
  on public.objekt_stundensatz
  for select
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro legt Objekt-Stundensätze der eigenen Firma an"
  on public.objekt_stundensatz
  for insert
  to authenticated
  with check (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro ändert Objekt-Stundensätze der eigenen Firma"
  on public.objekt_stundensatz
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

create policy "Büro entfernt Objekt-Stundensätze der eigenen Firma"
  on public.objekt_stundensatz
  for delete
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

comment on table public.objekt_stundensatz is
  'Abweichender Stundensatz eines Objekts für eine Tätigkeit. Hat Vorrang vor dem Satz des Kunden; ohne Eintrag gilt dieser, sonst der Standard-Stundensatz.';

create index objekt_stundensatz_firma_id_idx on public.objekt_stundensatz (firma_id);
create index objekt_stundensatz_taetigkeit_id_idx on public.objekt_stundensatz (taetigkeit_id);

commit;
