import { texte } from "@/texte";

// Der Link zum Stundennachweis. Er wird nur auf Nachfrage des Kunden
// gebraucht und entsteht erst beim Herunterladen; ohne nach Stunden
// berechnete Tage gibt es keinen.
export function Stundennachweis({ href, anzahlTage }: { href: string; anzahlTage: number }) {
  if (anzahlTage === 0) return null;
  const t = texte.stundennachweis;
  return (
    <p>
      {t.hinweis} {/* Ein normaler Link: Die Datei kommt vom Server, nicht als Seite. */}
      <a href={href} download>
        {t.herunterladen}
      </a>
    </p>
  );
}
