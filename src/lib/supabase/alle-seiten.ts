// So viele Zeilen liefert die Schnittstelle höchstens auf einmal
// (max_rows in supabase/config.toml).
const SEITE = 1000;

// Lädt Seite für Seite, bis eine nicht mehr voll ist. Die Abfrage braucht
// eine eindeutige Sortierung, sonst können Zeilen doppelt kommen oder fehlen.
export async function alleSeiten<T>(
  seite: (ab: number, bis: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const alle: T[] = [];
  for (let ab = 0; ; ab += SEITE) {
    const { data, error } = await seite(ab, ab + SEITE - 1);
    if (error) throw error;
    const zeilen = data ?? [];
    alle.push(...zeilen);
    if (zeilen.length < SEITE) return alle;
  }
}
