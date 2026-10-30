import Image from "next/image";
import styles from "./logo.module.css";

// Das Firmenlogo. Rein zur Zierde (alt leer); den Namen für Screenreader
// liefert die Umgebung, z. B. die Überschrift der Startseite.
export function Logo({ gross = false }: { gross?: boolean }) {
  return (
    <span className={`${styles.rahmen} ${gross ? styles.gross : ""}`}>
      <Image src="/logo.png" width={429} height={144} alt="" priority className={styles.bild} />
    </span>
  );
}
