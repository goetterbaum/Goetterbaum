import { istZusatzauftragAbrechnungsart, type ZusatzauftragAbrechnungsart } from "@/lib/abrechnung";
import { euroInCent, HOECHSTER_BETRAG_CENT } from "@/lib/geld";
import { texte } from "@/texte";

// Die Angaben eines Zusatzauftrags, wie sie in der Tabelle zusatzauftrag
// stehen. Das Objekt legt die Seite fest, auf der er angelegt wird.
export type ZusatzauftragDaten = {
  beschreibung: string;
  abrechnungsart: ZusatzauftragAbrechnungsart;
  // Nur bei Abrechnungsart Festbetrag, dann Pflicht.
  festbetrag_cent: number | null;
};

export type EingabeErgebnis =
  { ok: true; daten: ZusatzauftragDaten } | { ok: false; fehler: string };

// Prüft die Angaben aus dem Formular für einen Zusatzauftrag und bringt sie
// in eine einheitliche Form.
export function pruefeZusatzauftragEingabe(formData: FormData): EingabeErgebnis {
  const feld = (name: string) => String(formData.get(name) ?? "").trim();
  const beschreibung = feld("beschreibung");
  const abrechnungsart = feld("abrechnungsart");
  const festbetrag = feld("festbetrag");
  const t = texte.zusatzauftraege;

  if (!beschreibung) return { ok: false, fehler: t.fehlerBeschreibung };
  if (!istZusatzauftragAbrechnungsart(abrechnungsart)) {
    return { ok: false, fehler: t.fehlerAbrechnungsart };
  }

  let festbetrag_cent: number | null = null;
  if (abrechnungsart === "festbetrag") {
    if (!festbetrag) return { ok: false, fehler: t.fehlerFestbetragFehlt };
    festbetrag_cent = euroInCent(festbetrag);
    if (!festbetrag_cent || festbetrag_cent > HOECHSTER_BETRAG_CENT) {
      return { ok: false, fehler: t.fehlerFestbetragUngueltig };
    }
  } else if (festbetrag) {
    return { ok: false, fehler: t.fehlerFestbetragBeiStunden };
  }

  return { ok: true, daten: { beschreibung, abrechnungsart, festbetrag_cent } };
}
