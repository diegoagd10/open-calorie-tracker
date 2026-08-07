import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Daily Intake | Personal nutrition ledger",
  description:
    "A local daily ledger for food snapshots, hydration, targets, and weight.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body>
        {/*
          THESIS: A personal nutrition ledger should make a busy day easy to scan, not turn tracking into a game.
          OWN-WORLD: Deep ink-blue surfaces, hairline grid rules, and flat citrus, coral, lilac, mint, and cyan signals create a Color-Field Ledger.
          STORY: Read the day, recognize each threshold by color, then make one precise entry without losing historical context.
          FIRST VIEWPORT: The Daily Log opens with a date control, a color-led calorie readout, nutrient field, target strip, and water actions before the food log.
          FORM: A Color-Field Ledger, third grounded direction, seed 47c14263.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
