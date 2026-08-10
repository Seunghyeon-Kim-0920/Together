import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import { TogetherApp } from "./TogetherApp";
import { cookies, headers } from "next/headers";
import { localeFromAcceptLanguage, parseSupportedLocale } from "../lib/locale";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [user, requestCookies, requestHeaders] = await Promise.all([getChatGPTUser(), cookies(), headers()]);
  const initialLocale = parseSupportedLocale(requestCookies.get("together-locale")?.value) ?? localeFromAcceptLanguage(requestHeaders.get("accept-language"));
  return (
    <TogetherApp
      initialLocale={initialLocale}
      user={user ? { displayName: user.displayName, email: user.email } : null}
      signInUrl={chatGPTSignInPath("/")}
      signOutUrl={chatGPTSignOutPath("/")}
      initialTimestamp={new Date().toISOString()}
    />
  );
}
