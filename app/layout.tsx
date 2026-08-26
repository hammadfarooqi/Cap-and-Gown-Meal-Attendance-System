import type { Metadata, Viewport } from "next";
import { Figtree, Playfair_Display } from "next/font/google";
import "./globals.css";

/**
 * The club's site uses Degular Text and IvyPresto Display, both licensed
 * Adobe faces. These are the closest freely licensed pair on the same
 * contrast axis — a warm humanist sans and a high-contrast serif.
 */
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cap & Gown Meal Attendance",
  description: "Meal check-in for the Cap & Gown Club",
  manifest: "/manifest.json",
  // iOS ignores manifest icons and reads this instead.
  appleWebApp: {
    capable: true,
    title: "Cap & Gown",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#5e202c",
  // A kiosk. Pinch-zooming a check-in screen only ever happens by accident.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
