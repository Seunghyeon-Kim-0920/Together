"use client";

import { Cigarette, GlassWater, LockKeyhole, Save, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { SupportedLocale } from "../../lib/domain";
import { translate } from "../../lib/i18n";

type ProfileState = {
  displayName: string;
  ageBand: string;
  smoking: string;
  drinking: string;
  mbti: string;
};

const mbtiTypes = ["unspecified", "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"];
const ageBands = ["unspecified", "teens", "20s", "30s", "40s", "50s", "60s", "70plus"];

function ageLabel(value: string, locale: SupportedLocale) {
  if (value === "unspecified") return translate(locale, "unspecified");
  if (locale === "ko") return value === "teens" ? "10대" : value === "70plus" ? "70대 이상" : `${value.replace("s", "")}대`;
  if (locale === "ja") return value === "teens" ? "10代" : value === "70plus" ? "70代以上" : `${value.replace("s", "")}代`;
  if (locale === "zh") return value === "teens" ? "10多岁" : value === "70plus" ? "70岁以上" : `${value.replace("s", "")}多岁`;
  if (locale === "fr") return value === "teens" ? "Adolescence" : value === "70plus" ? "70 ans et plus" : `${value.replace("s", "")} à ${Number(value.replace("s", "")) + 9} ans`;
  return value === "teens" ? "Teens" : value === "70plus" ? "70+" : `${value.replace("s", "")}s`;
}

export function ProfilePanel({ locale, user, signInUrl, onNotify }: {
  locale: SupportedLocale;
  user: { displayName: string; email: string } | null;
  signInUrl: string;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [profile, setProfile] = useState<ProfileState>({ displayName: user?.displayName ?? "", ageBand: "unspecified", smoking: "unspecified", drinking: "unspecified", mbti: "unspecified" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetch("/api/profile")
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        return await response.json() as { profile: ProfileState };
      })
      .then((data) => { if (active) setProfile(data.profile); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user]);

  const saveProfile = async () => {
    if (!user) {
      onNotify(translate(locale, "noAccountData"), "info");
      window.location.href = signInUrl;
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
      if (!response.ok) throw new Error("save failed");
      onNotify(translate(locale, "profileSaved"), "success");
    } catch {
      onNotify(translate(locale, "retry"), "error");
    } finally {
      setSaving(false);
    }
  };

  const preferenceOptions = ["unspecified", "yes", "no"];
  return (
    <main className="content-page profile-page">
      <section className="page-title-row">
        <div><h1>{translate(locale, "profileTitle")}</h1><p>{translate(locale, "profileDescription")}</p></div>
        <span className="privacy-indicator"><LockKeyhole size={17} />{translate(locale, "private")}</span>
      </section>
      <div className="profile-layout">
        <section className="profile-preview">
          <div className="profile-avatar"><UserRound size={46} /></div>
          <h2>{profile.displayName || translate(locale, "guest")}</h2>
          <p>{user?.email ?? translate(locale, "noAccountData")}</p>
          <div className="profile-facts">
            <span>{ageLabel(profile.ageBand, locale)}</span>
            <span><Cigarette size={16} />{profile.smoking === "unspecified" ? translate(locale, "unspecified") : translate(locale, profile.smoking as "yes" | "no")}</span>
            <span><GlassWater size={16} />{profile.drinking === "unspecified" ? translate(locale, "unspecified") : translate(locale, profile.drinking as "yes" | "no")}</span>
            <span>{profile.mbti === "unspecified" ? translate(locale, "unspecified") : profile.mbti}</span>
          </div>
          <div className="profile-route-decoration"><MapJourney /></div>
        </section>
        <section className="profile-form">
          <label><span>{translate(locale, "name")}</span><input value={profile.displayName} onChange={(event) => setProfile((value) => ({ ...value, displayName: event.target.value }))} maxLength={80} autoComplete="name" /></label>
          <label><span>{translate(locale, "ageBand")}</span><select value={profile.ageBand} onChange={(event) => setProfile((value) => ({ ...value, ageBand: event.target.value }))}>{ageBands.map((item) => <option key={item} value={item}>{ageLabel(item, locale)}</option>)}</select></label>
          <div className="two-column-fields">
            <label><span>{translate(locale, "smoking")}</span><select value={profile.smoking} onChange={(event) => setProfile((value) => ({ ...value, smoking: event.target.value }))}>{preferenceOptions.map((item) => <option key={item} value={item}>{translate(locale, item as "unspecified" | "yes" | "no")}</option>)}</select></label>
            <label><span>{translate(locale, "drinking")}</span><select value={profile.drinking} onChange={(event) => setProfile((value) => ({ ...value, drinking: event.target.value }))}>{preferenceOptions.map((item) => <option key={item} value={item}>{translate(locale, item as "unspecified" | "yes" | "no")}</option>)}</select></label>
          </div>
          <label><span>{translate(locale, "mbti")}</span><select value={profile.mbti} onChange={(event) => setProfile((value) => ({ ...value, mbti: event.target.value }))}>{mbtiTypes.map((item) => <option key={item} value={item}>{item === "unspecified" ? translate(locale, "unspecified") : item}</option>)}</select></label>
          {!user ? <a className="sign-in-notice" href={signInUrl}><LockKeyhole size={17} />{translate(locale, "signInToSave")}</a> : null}
          <button className="primary-action full" type="button" onClick={saveProfile} disabled={saving || !profile.displayName.trim()}><Save size={18} />{translate(locale, "profileSave")}</button>
        </section>
      </div>
      <section className="privacy-explainer"><ShieldCheck size={25} /><div><h2>{translate(locale, "privacyTitle")}</h2><p>{translate(locale, "privacyText")}</p></div></section>
    </main>
  );
}

function MapJourney() {
  return <div className="mini-journey" aria-hidden="true"><span /><i /><span /><i /><span /></div>;
}
