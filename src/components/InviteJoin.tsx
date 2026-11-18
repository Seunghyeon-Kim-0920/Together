import { ExternalLink, Smartphone, UserPlus } from "lucide-react";
import { useState } from "react";
import { t } from "../lib/i18n";
import { buildPlayStoreLink } from "../lib/inviteLink";
import { inviteText as i } from "../lib/inviteLinkI18n";
import { sharedText as s } from "../lib/sharedTravelI18n";
import type { Locale } from "../lib/types";
import { currentBrowser } from "../lib/webCompanion";
import { SheetFrame } from "./Sheets";
import "./shared-travel.css";
import "./invite-fx.css";

/** The same consent and display name the shared-trip panel asks for. */
function InviteJoinForm({ locale, busy, onJoin, onCancel }: { locale: Locale; busy: boolean; onJoin: (displayName: string) => void; onCancel?: () => void }) {
  const [displayName, setDisplayName] = useState(""); const [consent, setConsent] = useState(false);
  const ready = Boolean(displayName.trim()) && consent && !busy;
  return <form className="invite-join-form" onSubmit={(event) => { event.preventDefault(); if (ready) onJoin(displayName.trim()); }}>
    <label className="field-label">{s(locale, "name")}<input maxLength={80} autoComplete="nickname" value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} /></label>
    <p className="storage-note">{i(locale, "nameHelp")}</p>
    <label className="shared-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>{s(locale, "consent")}</span></label>
    <div className={onCancel ? "sheet-actions" : "invite-join-actions"}>
      {onCancel ? <button type="button" disabled={busy} onClick={onCancel}>{i(locale, "later")}</button> : null}
      <button className="primary-button" type="submit" disabled={!ready}><UserPlus aria-hidden="true" />{busy ? i(locale, "joining") : onCancel ? i(locale, "joinShort") : s(locale, "join")}</button>
    </div>
  </form>;
}

/** Shown when an invitation link opens the app. `existingTitle` is set when
 * this device already belongs to the trip. */
export function InviteJoinSheet({ locale, configured, existingTitle, busy, onJoin, onOpenExisting, onClose }: { locale: Locale; configured: boolean; existingTitle: string | null; busy: boolean; onJoin: (displayName: string) => void; onOpenExisting: () => void; onClose: () => void }) {
  const close = () => { if (!busy) onClose(); };
  return <SheetFrame title={i(locale, "sheetTitle")} locale={locale} onClose={close}>
    {!configured ? <p className="sheet-intro" role="status">{s(locale, "unavailable")}</p>
      : existingTitle !== null ? <>
        <p className="sheet-intro">{i(locale, "already")}</p>
        <p className="invite-existing"><strong>{existingTitle}</strong></p>
        <div className="sheet-actions"><button type="button" onClick={close}>{t(locale, "close")}</button><button className="primary-button" type="button" onClick={onOpenExisting}>{i(locale, "open")}</button></div>
      </> : <>
        <p className="sheet-intro">{i(locale, "sheetIntro")}</p>
        <InviteJoinForm locale={locale} busy={busy} onJoin={onJoin} onCancel={close} />
      </>}
  </SheetFrame>;
}

/** Browser storage is easier to lose than app storage; say so where it matters. */
export function WebCompanionNotice({ locale, inviteCode }: { locale: Locale; inviteCode: string | null }) {
  const [browser] = useState(() => currentBrowser());
  const [externalLink] = useState(() => typeof window === "undefined" ? "" : `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`);
  return <aside className="mobile-panel web-companion-notice">
    {browser.inApp ? <p role="note">{i(locale, "webInApp")}</p> : null}
    {browser.inApp === "kakaotalk" && externalLink ? <a className="wide-secondary" href={externalLink}><ExternalLink aria-hidden="true" />{i(locale, "webOpenExternal")}</a> : null}
    <p className="storage-note">{i(locale, "webStorage")}</p>
    {browser.android ? <>
      <p className="storage-note">{i(locale, "webAndroid")}</p>
      <a className="wide-secondary" href={buildPlayStoreLink(inviteCode)} target="_blank" rel="noopener noreferrer"><Smartphone aria-hidden="true" />{i(locale, "webStore")}</a>
    </> : null}
  </aside>;
}

/** First screen of the hosted web version: join by invitation, nothing else. */
export function WebCompanionHome({ locale, inviteCode, configured, busy, onJoin }: { locale: Locale; inviteCode: string | null; configured: boolean; busy: boolean; onJoin: (displayName: string) => void }) {
  return <section className="ledger-screen web-companion-home">
    <section className="mobile-panel web-companion-card">
      <span className="web-companion-badge">{i(locale, "webBadge")}</span>
      {inviteCode ? <>
        <h2>{i(locale, "webTitle")}</h2>
        <p>{i(locale, "sheetIntro")}</p>
        {configured ? <InviteJoinForm locale={locale} busy={busy} onJoin={onJoin} /> : <p role="status">{s(locale, "unavailable")}</p>}
      </> : <>
        <h2>{i(locale, "webNoInviteTitle")}</h2>
        <p>{i(locale, "webNoInvite")}</p>
      </>}
    </section>
    <WebCompanionNotice locale={locale} inviteCode={inviteCode} />
  </section>;
}
