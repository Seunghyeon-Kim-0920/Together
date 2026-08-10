"use client";

import { ChevronDown, Luggage, Menu, Route, UserRound, WalletCards, X } from "lucide-react";
import { useState } from "react";
import { LOCALE_NAMES, translate, type MessageKey } from "../../lib/i18n";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../../lib/domain";

export type ViewName = "route" | "trips" | "expenses" | "profile";

type HeaderProps = {
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  activeView: ViewName;
  onViewChange: (view: ViewName) => void;
  user: { displayName: string; email: string } | null;
  signInUrl: string;
  signOutUrl: string;
};

const navigation: ReadonlyArray<{ id: ViewName; label: MessageKey; icon: typeof Route }> = [
  { id: "route", label: "route", icon: Route },
  { id: "trips", label: "trips", icon: Luggage },
  { id: "expenses", label: "expenses", icon: WalletCards },
  { id: "profile", label: "profile", icon: UserRound },
];

export function Header({ locale, onLocaleChange, activeView, onViewChange, user, signInUrl, signOutUrl }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const selectView = (view: ViewName) => {
    onViewChange(view);
    setMobileOpen(false);
  };

  return (
    <header className="site-header">
      <button className="brand" type="button" onClick={() => selectView("route")} aria-label={translate(locale, "brandHome")}>
        Together
      </button>
      <nav className="desktop-nav" aria-label={translate(locale, "primaryNavigation")}>
        {navigation.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={activeView === id ? "nav-link active" : "nav-link"} onClick={() => selectView(id)}>
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            {translate(locale, label)}
          </button>
        ))}
      </nav>
      <div className="header-actions">
        <label className="language-select">
          <span className="sr-only">{translate(locale, "language")}</span>
          <select value={locale} onChange={(event) => onLocaleChange(event.target.value as SupportedLocale)}>
            {SUPPORTED_LOCALES.map((item) => <option value={item} key={item}>{LOCALE_NAMES[locale][item]}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
        {user ? (
          <a className="account-chip" href={signOutUrl} title={user.email}>
            <span className="avatar" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="account-name">{user.displayName}</span>
          </a>
        ) : (
          <a className="sign-in-link" href={signInUrl}>{translate(locale, "signIn")}</a>
        )}
        <button className="mobile-menu-button" type="button" onClick={() => setMobileOpen((value) => !value)} aria-expanded={mobileOpen} aria-label={translate(locale, "menu")}>
          {mobileOpen ? <X size={23} /> : <Menu size={23} />}
        </button>
      </div>
      {mobileOpen ? (
        <nav className="mobile-menu" aria-label={translate(locale, "mobileNavigation")}>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={activeView === id ? "mobile-menu-link active" : "mobile-menu-link"} onClick={() => selectView(id)}>
              <Icon size={20} aria-hidden="true" />
              {translate(locale, label)}
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
