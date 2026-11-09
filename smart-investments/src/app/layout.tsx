import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import { Nav } from "@/components/chrome";
import { parseLang } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Investments Today",
  description: "South Florida property analysis and lead finding, with a source on every number.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Applies the saved light/dark choice before the page paints.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = parseLang((await cookies()).get("lang")?.value);
  return (
    <html lang={lang} className={GeistSans.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Nav lang={lang} />
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">{children}</main>
      </body>
    </html>
  );
}
