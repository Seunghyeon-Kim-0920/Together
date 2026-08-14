import type { NextRequest } from "next/server";
import { translate } from "../../lib/i18n";
import { localeFromAcceptLanguage, parseSupportedLocale } from "../../lib/locale";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const isAndroidPackage = request.nextUrl.searchParams.get("platform") === "android";
  const locale = parseSupportedLocale(request.cookies.get("together-locale")?.value)
    ?? localeFromAcceptLanguage(request.headers.get("accept-language"));
  return Response.json({
    id: "/",
    name: isAndroidPackage ? "Together" : translate(locale, "metadataTitle"),
    short_name: "Together",
    description: isAndroidPackage ? "Together" : translate(locale, "metadataDescription"),
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    background_color: "#fffdf8",
    theme_color: "#fffdf8",
    lang: isAndroidPackage ? "und" : locale,
    dir: "ltr",
    orientation: "any",
    categories: ["travel", "navigation", "finance", "utilities"],
    prefer_related_applications: false,
    launch_handler: { client_mode: "navigate-existing" },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  }, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/manifest+json; charset=utf-8",
      vary: "Cookie, Accept-Language",
    },
  });
}
