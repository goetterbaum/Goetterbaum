# Projekt

Diese Web-App ist die zentrale Management-Software für die Gebäudereinigungs- und Gartenpflegeunternehmen und soll schrittweise alle betrieblichen Abläufe digital abbilden.
Erstes Kernfeature ist die objektbezogene Zeiterfassung der Mitarbeiter vor Ort, deren Daten als Grundlage für die Rechnungsvorbereitung und später für die Rechnungserstellung und den Versand dienen.

# Über mich

- Ich bin kein Entwickler. Erkläre alles in einfacher Sprache.
- Frag, statt zu raten. Bei technischen Entscheidungen: 2–3 Optionen mit Vor- und Nachteilen.
- Kleinere Entscheidungen triffst du selbst und nennst sie in der PR-Beschreibung.

# Technik

- Next.js mit TypeScript, Node.js 24
- Hosting: Vercel (EU-Region)
- Datenbank: Supabase (Postgres, EU-Region), Login: Supabase Auth (mit Resend)
- Datenbank-Migrationen: in `begin;` … `commit;`, Zugriffsregeln direkt nach `create table`. See `docs/adr/0003-migrationen-ganz-oder-gar-nicht.md`.
- Datenbank-Änderungen werden nur in der CI geprüft, nie lokal. See `docs/agents/datenbank-pruefung.md`.
- Ziel: verbreitete Standardtechnik, für andere Entwickler übernehmbar, Daten jederzeit exportierbar. Nichts Exotisches einführen.

# Arbeitsweise

- Neue Features starten mit /grill-with-docs, nie direkt mit Code.
- Gebaut wird nur, was als Ticket auf GitHub steht, mit /implement.
- Nie direkt auf main: ein Ticket = ein Branch = ein Pull Request.
- PR-Beschreibungen folgen dem Skill `mattpocock-skills:pr` (Summary, Evidence, Merge Danger), in der jeweils installierten Fassung. Text auf Deutsch, in einfacher Sprache; kleinere Entscheidungen am Ende unter „Kleinere Entscheidungen“.

# Ohne meine Zustimmung nie

- Neue Pakete hinzufügen
- Login, Rechte oder Datenbankschema ändern
- Tests löschen oder abschwächen
- Passwörter oder Schlüssel in den Code schreiben (nur Umgebungsvariablen)

Was ein Ticket mit dem Label `ready-for-agent` ausdrücklich verlangt, gilt als zugestimmt, auch Schema- und Rechteänderungen. Bestehende Tests, deren Verhalten das Ticket ändert, werden angepasst, nicht gelöscht. Jede solche Änderung steht im PR unter „Merge Danger“.

## Agent skills

### Issue tracker

Tickets liegen als GitHub Issues im Repo goetterbaum/Goetterbaum (über die `gh`-CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Die fünf Standard-Labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: ein `GLOSSARY.md` und `docs/adr/` im Hauptordner. See `docs/agents/domain.md`.
