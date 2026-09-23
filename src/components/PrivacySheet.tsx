import { SheetFrame } from "./Sheets";
import { useEffect, useState } from "react";
import type { Locale } from "../lib/types";
import policyHtml from "../../docs/privacy/index.html?raw";

export const privacyTitle: Record<Locale, string> = {
  ko: "개인정보처리방침", en: "Privacy policy", fr: "Politique de confidentialité",
};
export const deleteAccountTitle: Record<Locale, string> = {
  ko: "계정·데이터 삭제 요청", en: "Account & data deletion", fr: "Suppression du compte et des données",
};

const deletionText: Record<Locale, { heading: string; explanation: string; identity: string; none: string; unavailable: string; request: string; website: string }> = {
  ko: { heading: "공동 여행 계정·데이터 삭제 요청", explanation: "앱 삭제만으로 서버의 익명 계정과 공동 여행 내역은 삭제되지 않습니다. 이메일로 삭제를 요청할 수 있습니다. 생활 가계부는 휴대폰에만 저장되므로 앱에서 삭제하거나 앱을 제거하세요. 요청 전에 필요한 내역을 백업하세요.", identity: "삭제 확인용 익명 계정 ID", none: "이 기기에 연결된 공동 여행 계정이 없습니다.", unavailable: "계정 ID를 확인할 수 없습니다. 이메일에 여행 이름 등 본인 확인에 도움이 되는 정보만 적어 주세요. 카드번호나 명세서는 보내지 마세요.", request: "이메일로 삭제 요청", website: "앱 없이 삭제 요청하는 방법" },
  en: { heading: "Request deletion of shared-trip account and data", explanation: "Uninstalling does not delete the anonymous server account or shared trips. You can request deletion by email. Personal ledgers stay on your phone; delete them in the app or uninstall it. Back up anything you need first.", identity: "Anonymous account ID for verification", none: "No shared-trip account is connected on this device.", unavailable: "The account ID could not be read. Include only information needed to identify the trip in your email; do not send card numbers or statements.", request: "Request deletion by email", website: "How to request deletion without the app" },
  fr: { heading: "Demander la suppression du compte et des voyages partagés", explanation: "La désinstallation ne supprime ni le compte anonyme sur le serveur ni les voyages partagés. Vous pouvez demander leur suppression par courriel. Les carnets personnels restent sur votre téléphone ; supprimez-les dans l'application ou désinstallez-la. Sauvegardez d'abord ce dont vous avez besoin.", identity: "Identifiant du compte anonyme pour vérification", none: "Aucun compte de voyage partagé n'est connecté sur cet appareil.", unavailable: "Impossible de lire l'identifiant. Indiquez uniquement les éléments nécessaires pour identifier le voyage ; n'envoyez pas de numéro de carte ni de relevé.", request: "Demander la suppression par courriel", website: "Demander la suppression sans l'application" },
};
const deletionMail: Record<Locale, { subject: string; body: (uid: string | null | undefined, tripIds: string[]) => string }> = {
  ko: { subject: "지갑의 일기 계정·데이터 삭제 요청", body: (uid, tripIds) => `지갑의 일기 익명 계정과 연결된 공동 여행 데이터 삭제를 요청합니다.\n익명 계정 ID: ${uid ?? "확인 불가"}\n이 기기의 여행 ID: ${tripIds.length ? tripIds.join(", ") : "확인 불가"}\n휴대폰 내부 기록은 별도로 삭제해야 함을 이해했습니다.\n` },
  en: { subject: "Wallet Diary account and data deletion request", body: (uid, tripIds) => `Please delete my Wallet Diary anonymous account and associated shared-trip data.\nAccount ID: ${uid ?? "not available"}\nTrip IDs on this device: ${tripIds.length ? tripIds.join(", ") : "none available"}\nI understand that local data on my device must be deleted separately.\n` },
  fr: { subject: "Demande de suppression du compte et des données Journal du portefeuille", body: (uid, tripIds) => `Je demande la suppression de mon compte anonyme et des données des voyages partagés associés.\nIdentifiant du compte : ${uid ?? "indisponible"}\nIdentifiants des voyages sur cet appareil : ${tripIds.length ? tripIds.join(", ") : "indisponibles"}\nJe comprends que les données locales sur mon appareil doivent être supprimées séparément.\n` },
};

/** The same checked-in policy is readable offline in the app and publishable
 * as the store's public policy. Only the selected language is rendered. */
export function PrivacySheet({ locale, tripIds, onClose }: { locale: Locale; tripIds: string[]; onClose: () => void }) {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [identityFailed, setIdentityFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import("../lib/sharedTravelClient").then(({ existingSharedTravelUid }) => existingSharedTravelUid()).then((value) => {
      if (active) setUid(value);
    }).catch(() => { if (active) setIdentityFailed(true); });
    return () => { active = false; };
  }, []);
  const document = new DOMParser().parseFromString(policyHtml, "text/html");
  const heading = document.getElementById(locale);
  const content: string[] = [];
  for (let node = heading?.nextElementSibling; node && node.tagName !== "H2" && node.tagName !== "FOOTER"; node = node.nextElementSibling) {
    content.push(node.outerHTML);
  }
  const copy = deletionText[locale];
  const subject = encodeURIComponent(deletionMail[locale].subject);
  const body = encodeURIComponent(deletionMail[locale].body(uid, tripIds));
  return <SheetFrame title={privacyTitle[locale]} locale={locale} onClose={onClose}>
    <section className="privacy-deletion" aria-labelledby="privacy-deletion-heading">
      <h3 id="privacy-deletion-heading">{copy.heading}</h3>
      <p>{copy.explanation}</p>
      {uid ? <p>{copy.identity}: <code>{uid}</code></p> : uid === null ? <p>{copy.none}</p> : identityFailed ? <p>{copy.unavailable}</p> : null}
      <a className="wide-secondary" href={`mailto:rlatmdgus0920@gmail.com?subject=${subject}&body=${body}`}>{copy.request}</a>
      <a href={`https://wallet-diary-c2a1a.web.app/delete-account.html#${locale}`} target="_blank" rel="noopener noreferrer">{copy.website}</a>
    </section>
    <div className="privacy-policy" dangerouslySetInnerHTML={{ __html: content.join("") }} />
  </SheetFrame>;
}
