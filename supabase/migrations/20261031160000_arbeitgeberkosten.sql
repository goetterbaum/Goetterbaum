-- Arbeitgeberkosten je Stunde (Ticket #68, Spec #67)
--
-- Das Büro pflegt, was ein Mitarbeiter die Firma je bezahlter Stunde
-- kostet: einen Standard der Firma und wahlweise einen eigenen Wert je
-- Mitarbeiter, jeweils mit „gültig ab“. Welcher Wert an einem Tag gilt,
-- rechnet die App (src/lib/arbeitgeberkosten/regeln.ts).
--
-- Die Werte stehen bewusst nicht in der Tabelle mitarbeiter: Dort darf
-- jeder Mitarbeiter seine eigene Zeile lesen.
--
-- Zugriffsrechte: Nur das Büro der eigenen Firma liest, legt an, ändert
-- und löscht. Mitarbeiter und Vorarbeiter haben gar keinen Zugriff, auch
-- nicht auf den eigenen Wert. Firma und Mitarbeiter eines Werts lassen
-- sich nicht ändern, nur „gültig ab“ und Betrag. Die Regeln stehen jeweils
-- direkt bei ihrer Tabelle (ADR-0003).

begin;

-- ---------------------------------------------------------------------------
-- Standard der Firma
-- ---------------------------------------------------------------------------

create table public.arbeitgeberkosten_standard (
  id uuid primary key default gen_random_uuid(),
  -- "on delete cascade" greift nur, wenn eine ganze Firma gelöscht wird
  -- (nur mit dem Dienstschlüssel möglich, z. B. Aufräumen nach Tests).
  firma_id uuid not null references public.firma (id) on delete cascade,
  -- Kalendertag in Berlin, ab dem der Wert gilt.
  gueltig_ab date not null,
  -- Kosten je bezahlter Stunde in ganzen Cent.
  kosten_je_stunde_cent integer not null check (kosten_je_stunde_cent > 0),
  angelegt_am timestamptz not null default now(),
  -- Höchstens ein Wert je Firma und „gültig ab“.
  unique (firma_id, gueltig_ab)
);

alter table public.arbeitgeberkosten_standard enable row level security;

revoke all on public.arbeitgeberkosten_standard from anon, authenticated;
grant select, delete on public.arbeitgeberkosten_standard to authenticated;
grant all on public.arbeitgeberkosten_standard to service_role;
grant insert (firma_id, gueltig_ab, kosten_je_stunde_cent)
  on public.arbeitgeberkosten_standard to authenticated;
grant update (gueltig_ab, kosten_je_stunde_cent)
  on public.arbeitgeberkosten_standard to authenticated;

create policy "Büro sieht Arbeitgeberkosten-Standard der eigenen Firma"
  on public.arbeitgeberkosten_standard
  for select
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro legt Arbeitgeberkosten-Standard der eigenen Firma an"
  on public.arbeitgeberkosten_standard
  for insert
  to authenticated
  with check (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro ändert Arbeitgeberkosten-Standard der eigenen Firma"
  on public.arbeitgeberkosten_standard
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

create policy "Büro löscht Arbeitgeberkosten-Standard der eigenen Firma"
  on public.arbeitgeberkosten_standard
  for delete
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

comment on table public.arbeitgeberkosten_standard is
  'Standard der Arbeitgeberkosten je Stunde einer Firma ab einem Tag. Gilt für jeden Mitarbeiter ohne eigenen Wert.';

-- ---------------------------------------------------------------------------
-- Eigener Wert eines Mitarbeiters
-- ---------------------------------------------------------------------------

create table public.arbeitgeberkosten_mitarbeiter (
  id uuid primary key default gen_random_uuid(),
  -- Direkt an der Firma, damit der Wert beim Löschen einer ganzen Firma
  -- im selben Schritt wie ihre Mitarbeiter verschwindet (siehe
  -- 20261018130000).
  firma_id uuid not null references public.firma (id) on delete cascade,
  mitarbeiter_id uuid not null,
  gueltig_ab date not null,
  -- Kosten je bezahlter Stunde in ganzen Cent; gehen vor dem Standard.
  kosten_je_stunde_cent integer not null check (kosten_je_stunde_cent > 0),
  angelegt_am timestamptz not null default now(),
  -- Höchstens ein Wert je Mitarbeiter und „gültig ab“.
  unique (mitarbeiter_id, gueltig_ab),
  -- Der Mitarbeiter gehört zur selben Firma.
  foreign key (mitarbeiter_id, firma_id) references public.mitarbeiter (id, firma_id)
);

alter table public.arbeitgeberkosten_mitarbeiter enable row level security;

revoke all on public.arbeitgeberkosten_mitarbeiter from anon, authenticated;
grant select, delete on public.arbeitgeberkosten_mitarbeiter to authenticated;
grant all on public.arbeitgeberkosten_mitarbeiter to service_role;
grant insert (firma_id, mitarbeiter_id, gueltig_ab, kosten_je_stunde_cent)
  on public.arbeitgeberkosten_mitarbeiter to authenticated;
grant update (gueltig_ab, kosten_je_stunde_cent)
  on public.arbeitgeberkosten_mitarbeiter to authenticated;

create policy "Büro sieht Arbeitgeberkosten je Mitarbeiter eigener Firma"
  on public.arbeitgeberkosten_mitarbeiter
  for select
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro legt Arbeitgeberkosten je Mitarbeiter eigener Firma an"
  on public.arbeitgeberkosten_mitarbeiter
  for insert
  to authenticated
  with check (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

create policy "Büro ändert Arbeitgeberkosten je Mitarbeiter eigener Firma"
  on public.arbeitgeberkosten_mitarbeiter
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

create policy "Büro löscht Arbeitgeberkosten je Mitarbeiter eigener Firma"
  on public.arbeitgeberkosten_mitarbeiter
  for delete
  to authenticated
  using (
    firma_id = (select privat.meine_firma_id())
    and (select privat.meine_rolle()) = 'buero'
  );

comment on table public.arbeitgeberkosten_mitarbeiter is
  'Eigener Wert der Arbeitgeberkosten je Stunde eines Mitarbeiters ab einem Tag. Geht vor dem Standard der Firma.';

create index arbeitgeberkosten_mitarbeiter_firma_id_idx
  on public.arbeitgeberkosten_mitarbeiter (firma_id);

commit;
