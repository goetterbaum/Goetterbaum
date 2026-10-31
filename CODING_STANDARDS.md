# Coding Standards

Regeln für das Review. Was ESLint, TypeScript oder Prettier prüfen, steht hier nicht.

## Sprache und Begriffe

- Bezeichner, Kommentare und Testnamen sind deutsch und nutzen die Fachbegriffe aus `GLOSSARY.md`, nie die dort unter _Avoid_ genannten Wörter.
- Kommentare erklären das Warum, so knapp und so dicht wie im umliegenden Code.
- Jeder sichtbare Text der Oberfläche steht in `src/texte.ts`.

## Rechte und Datenbank

- Die Datenbank setzt Firmentrennung und Rechte durch (Zugriffsregeln, Spaltenrechte, Trigger). Die Oberfläche blendet nur aus.
- Jede Server-Aktion prüft zuerst den angemeldeten Mitarbeiter (`angemeldeterMitarbeiter`, `alsBuero`) und schreibt in seinem Namen. Der Dienstschlüssel ist dem Test-Setup vorbehalten.
- Jede neue Datenbank-Regel hat einen Test in `e2e/*-rechte.spec.ts`, der direkt über die öffentliche Supabase-Schnittstelle zeigt, dass sie greift.
- Migrationen folgen `docs/adr/0003-migrationen-ganz-oder-gar-nicht.md`. Eine schon auf Staging eingespielte Migration bleibt unverändert, siehe `docs/agents/datenbank-pruefung.md`.

## Zeit und Geld

- Zeiten sind Zeitpunkte mit Zeitzone. Tage und Uhrzeiten gelten in Berlin und laufen über `src/lib/berliner-zeit.ts`.
- Beträge sind ganze Cent. Einnahmen rechnet nur der Rechenbaustein der Rechnungsvorbereitung (`src/lib/rechnungsvorbereitung.ts`), Kosten und Deckungsbeitrag nur der Rechenbaustein der Kostenanalyse (`src/lib/kostenanalyse.ts`), der für die Einnahmen den ersten mitnutzt.

## Tests

- Tests prüfen äußeres Verhalten: was ein Nutzer sieht und tun kann bzw. was ein Baustein für eine Eingabe liefert. Erwartete Werte stehen als feste Werte im Test.
- Testdaten sehen aus wie echte Daten: Live-Zeiten haben Sekunden, Tagesgrenzen werden mit Mitternacht und der Zeitumstellung in Berlin geprüft.
- Wird eine bestehende Prüfung geändert, prüft sie danach mindestens genauso streng, und die PR-Beschreibung nennt sie.
