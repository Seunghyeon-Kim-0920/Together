import { TogetherApp } from "./TogetherApp";
import { cookies, headers } from "next/headers";
import { localeFromAcceptLanguage, parseSupportedLocale } from "../lib/locale";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [requestCookies, requestHeaders] = await Promise.all([cookies(), headers()]);
  const initialLocale = parseSupportedLocale(requestCookies.get("together-locale")?.value) ?? localeFromAcceptLanguage(requestHeaders.get("accept-language"));
  return (
    <TogetherApp
      initialLocale={initialLocale}
      initialTimestamp={new Date().toISOString()}
    />
  );
}
