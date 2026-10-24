# Datenbank-Änderungen prüft nur die CI

Auf dem Firmenlaptop gibt es kein Docker (Lizenz- und IT-Vorgaben). Supabase läuft deshalb nie lokal; `npx supabase start` und `npx supabase db start` gehen hier nicht. Migrationen, Zugriffsregeln und Trigger werden ausschließlich in der CI geprüft, gegen das kostenfreie Supabase-Staging-Projekt. Produktion berühren Tests nie.

## Ablauf nach jedem Push auf einen PR (`.github/workflows/e2e.yml`)

1. **Migrationen-Probelauf**: alle Migrationen auf einer Wegwerf-Datenbank im GitHub-Runner (ADR-0003).
2. **Migrationen auf Staging**: `supabase db push` spielt neue Migrationsdateien auf Staging ein.
3. **Browsertests** gegen die Vercel-Preview, die mit Staging verbunden ist. Die `*-rechte.spec.ts` gehen direkt auf die Supabase-Schnittstelle und sind die eigentlichen Tests der Datenbank-Regeln.

## Was das beim Arbeiten heißt

- Lokal prüfbar sind nur `bash scripts/pruefe-migrationen.sh` (begin/commit) und die Einzeltests. Datenbank-Logik deshalb besonders sorgfältig lesen und jede Regel mit einem Rechte-Test abdecken.
- Eine Migration ist nach dem ersten Push auf Staging eingespielt. `db push` spielt dieselbe Datei nie erneut ein, auch wenn sie sich geändert hat. Korrekturen nach dem ersten Push kommen in eine **neue** Migrationsdatei.
- Die PR-Beschreibung nennt unter „Evidence“, dass die Datenbank-Regeln erst in der CI laufen.
