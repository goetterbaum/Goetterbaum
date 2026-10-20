-- Zusatzaufträge (Ticket #42): Festbetrag wirklich zur Pflicht machen
--
-- Die Regel aus 20261020090000 ließ einen Zusatzauftrag mit Festbetrag
-- ohne Betrag zu: Ist festbetrag_cent leer (NULL), ergibt
-- "festbetrag_cent > 0" nicht "falsch", sondern "unbekannt", und eine
-- Prüfregel mit Ergebnis "unbekannt" gilt als erfüllt (wie schon bei der
-- Pauschale, 20261017130000). Deshalb jetzt ausdrücklich "is not null".
--
-- Ein einziger Befehl, damit die alte Regel nie ohne die neue wegfällt.

begin;

alter table public.zusatzauftrag
  drop constraint festbetrag_nur_bei_festbetrag,
  add constraint festbetrag_nur_bei_festbetrag check (
    (abrechnungsart = 'festbetrag' and festbetrag_cent is not null and festbetrag_cent > 0)
    or (abrechnungsart = 'stunden' and festbetrag_cent is null)
  );

commit;
