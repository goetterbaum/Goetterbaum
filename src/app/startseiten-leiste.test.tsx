import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StartseitenLeiste } from "./startseiten-leiste";

let aktuellerPfad = "/";
vi.mock("next/navigation", () => ({ usePathname: () => aktuellerPfad }));

afterEach(cleanup);

function zeigeLeisteAuf(pfad: string) {
  aktuellerPfad = pfad;
  render(<StartseitenLeiste />);
}

test.each(["/kunden", "/zeiteintraege/3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", "/einstellungen"])(
  "Auf %s führt der Button „Startseite“ zur Startseite",
  (pfad) => {
    zeigeLeisteAuf(pfad);
    expect(screen.getByRole("link", { name: "Startseite" }).getAttribute("href")).toBe("/");
  },
);

test.each(["/", "/anmelden", "/passwort-vergessen", "/passwort-festlegen"])(
  "Auf %s gibt es keine Leiste",
  (pfad) => {
    zeigeLeisteAuf(pfad);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: "Startseite" })).toBeNull();
  },
);
