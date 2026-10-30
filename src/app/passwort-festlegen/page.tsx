import { texte } from "@/texte";
import { Logo } from "../logo";
import styles from "../page.module.css";
import { PasswortFormular } from "./passwort-formular";

// Hierher führt der Link aus der Einladung bzw. aus "Passwort vergessen".
// Der Nutzer ist dann bereits angemeldet (sonst schickt ihn der Proxy zur
// Anmeldung) und legt nur noch sein Passwort fest.
export default function PasswortFestlegen() {
  return (
    <div className={styles.page}>
      <main className={`${styles.main} ${styles.schmal}`}>
        <h1>
          <span className="sr-only">{texte.appName}</span>
          <Logo gross />
        </h1>
        <h2>{texte.passwortFestlegen.titel}</h2>
        <p>{texte.passwortFestlegen.hinweis}</p>
        <PasswortFormular />
      </main>
    </div>
  );
}
