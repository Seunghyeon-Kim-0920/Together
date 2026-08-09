import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { PwaRegistration } from "./PwaRegistration";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = "Together — multi-city travel, in the fastest order";
  const description = "Compare door-to-door travel time across flights, trains and buses, plan multi-city trips, share routes, and settle group expenses.";
  const image = new URL("/og.png", base).toString();
  return {
    metadataBase: base,
    title: { default: title, template: "%s · Together" },
    description,
    applicationName: "Together",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
        { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
      ],
      shortcut: "/favicon.svg",
      apple: [
        { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
      ],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Together",
    },
    formatDetection: { telephone: false },
    openGraph: { type: "website", title, description, siteName: "Together", images: [{ url: image, width: 1200, height: 630, alt: "Together multi-city route planner" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export const viewport: Viewport = {
  themeColor: "#071b3a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} antialiased`}>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
