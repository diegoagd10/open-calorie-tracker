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
          THESIS: A personal nutrition ledger should feel like a calm field instrument, not a gamified dashboard.
          OWN-WORLD: Graphite surfaces, paper-white type, hairline rules, amber actions, and a cool water signal form a night field ledger.
          STORY: Read the day, understand its thresholds, then make one precise entry without losing historical context.
          FIRST VIEWPORT: The Daily Log opens with the date and calorie readout, a compact metric matrix, water actions, and the food log's primary action.
          FORM: A night field ledger, seventh grounded direction, seed 9ae1c146.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
