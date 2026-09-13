import { SheetFrame } from "./Sheets";
import type { Locale } from "../lib/types";
import policyHtml from "../../docs/privacy/index.html?raw";

export const privacyTitle: Record<Locale, string> = {
  ko: "개인정보처리방침", en: "Privacy policy", fr: "Politique de confidentialité",
};

/** The same checked-in policy is readable offline in the app and publishable
 * as the store's public policy. Only the selected language is rendered. */
export function PrivacySheet({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const document = new DOMParser().parseFromString(policyHtml, "text/html");
  const heading = document.getElementById(locale);
  const content: string[] = [];
  for (let node = heading?.nextElementSibling; node && node.tagName !== "H2" && node.tagName !== "FOOTER"; node = node.nextElementSibling) {
    content.push(node.outerHTML);
  }
  return <SheetFrame title={privacyTitle[locale]} locale={locale} onClose={onClose}>
    <div className="privacy-policy" dangerouslySetInnerHTML={{ __html: content.join("") }} />
  </SheetFrame>;
}
