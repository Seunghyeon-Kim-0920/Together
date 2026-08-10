import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { cookies, headers } from "next/headers";
import { LANGUAGE_TAGS, translate } from "../lib/i18n";
import { localeFromAcceptLanguage, parseSupportedLocale } from "../lib/locale";
import { PwaRegistration } from "./PwaRegistration";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const [requestHeaders, requestCookies] = await Promise.all([headers(), cookies()]);
  const locale = parseSupportedLocale(requestCookies.get("together-locale")?.value) ?? localeFromAcceptLanguage(requestHeaders.get("accept-language"));
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = translate(locale, "metadataTitle");
  const description = translate(locale, "metadataDescription");
  const image = new URL("/assets/eiffel-paris-hero.png", base).toString();
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
    openGraph: { type: "website", title, description, siteName: "Together", locale: LANGUAGE_TAGS[locale].replace("-", "_"), images: [{ url: image, width: 1792, height: 1024, alt: translate(locale, "ogAlt") }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export const viewport: Viewport = {
  themeColor: "#fffdf8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [requestHeaders, requestCookies] = await Promise.all([headers(), cookies()]);
  const locale = parseSupportedLocale(requestCookies.get("together-locale")?.value) ?? localeFromAcceptLanguage(requestHeaders.get("accept-language"));
  return (
    <html lang={LANGUAGE_TAGS[locale]}>
      <body className={`${geistSans.variable} antialiased`}>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
