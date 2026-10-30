import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { StartseitenLeiste } from "./startseiten-leiste";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Götterbaum",
  description: "Management-Software für Gebäudereinigung und Gartenpflege",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* Die Leiste hängt von der Adresse ab, die erst beim Aufruf feststeht;
            ohne Suspense könnte Next.js keine Seite vorab erzeugen. */}
        <Suspense fallback={null}>
          <StartseitenLeiste />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
