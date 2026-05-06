import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import Background from "@/components/Background";
import "./globals.css";

const geist = Geist({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist",
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-jetbrains-mono",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "LightPulse — световой передатчик",
  description: "Превратите фонарик или экран устройства в передатчик морзянки.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${geist.variable} ${jetbrains.variable}`}>
      <body>
        <Background />
        {children}
      </body>
    </html>
  );
}
