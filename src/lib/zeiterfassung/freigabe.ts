// Die Freigabe von Zeiteinträgen durch das Büro: welche Einträge die
// Prüfliste zeigt und welche freigegeben werden sollen. Tage gelten in
// Berlin.
import {
  auswertungsZeitraum,
  type AuswertungsZeitraum,
  type Parameter,
} from "@/lib/auswertungen/zeitraum";
import { istId } from "@/lib/id";
import { texte } from "@/texte";

// Was das Büro auf der Freigabe-Seite eingestellt hat: der Zeitraum wie bei
// den Auswertungen (von, bis, monat, ab, bisVor) und die Filter. Ohne
// Mitarbeiter, Kunde oder Objekt wird danach nicht gefiltert.
// freigegebene: statt der wartenden die schon freigegebenen Einträge, um
// eine Freigabe zurückzunehmen.
export type FreigabeFilter = AuswertungsZeitraum & {
  mitarbeiter: string | null;
  kunde: string | null;
  objekt: string | null;
  freigegebene: boolean;
};

// Ein einzelner Wert aus der Adresszeile; mehrfach angegeben zählt keiner.
function einzeln(wert: string | string[] | undefined): string {
  return typeof wert === "string" ? wert.trim() : "";
}

function kennung(wert: string | string[] | undefined): string | null {
  const text = einzeln(wert);
  return istId(text) ? text : null;
}

// Liest die Einstellungen aus der Adresszeile. Ohne gültige Tage gilt wie
// bei den Auswertungen der vorausgewählte Monat.
export function freigabeFilter(parameter: Parameter, jetzt: number): FreigabeFilter {
  return {
    ...auswertungsZeitraum(parameter, jetzt),
    mitarbeiter: kennung(parameter.mitarbeiter),
    kunde: kennung(parameter.kunde),
    objekt: kennung(parameter.objekt),
    freigegebene: einzeln(parameter.freigegebene) === "ja",
  };
}

export type FreigabeAuswahl = { ok: true; ids: string[] } | { ok: false; fehler: string };

// Welche Einträge das Büro freigeben will: der eine, dessen Knopf in der
// Zeile gedrückt wurde (einzeln), sonst alle angehakten (id). Ob sie
// freigegeben werden können, entscheidet die Datenbank.
export function freigabeAuswahl(formData: FormData): FreigabeAuswahl {
  const einzelner = String(formData.get("einzeln") ?? "");
  const ids = istId(einzelner)
    ? [einzelner]
    : [...new Set(formData.getAll("id").map(String).filter(istId))];
  if (ids.length === 0) return { ok: false, fehler: texte.freigabe.fehlerKeineAuswahl };
  return { ok: true, ids };
}
