"use client";

import { Luggage, Route, UserRound, WalletCards } from "lucide-react";
import { translate, type MessageKey } from "../../lib/i18n";
import type { SupportedLocale } from "../../lib/domain";
import type { ViewName } from "./Header";

const navigation: ReadonlyArray<{ id: ViewName; label: MessageKey; icon: typeof Route }> = [
  { id: "route", label: "route", icon: Route },
  { id: "trips", label: "trips", icon: Luggage },
  { id: "expenses", label: "expenses", icon: WalletCards },
  { id: "profile", label: "profile", icon: UserRound },
];

export function BottomNav({ locale, activeView, onViewChange }: { locale: SupportedLocale; activeView: ViewName; onViewChange: (view: ViewName) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Mobile primary navigation">
      {navigation.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" className={activeView === id ? "bottom-nav-link active" : "bottom-nav-link"} onClick={() => onViewChange(id)}>
          <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
          <span>{translate(locale, label)}</span>
        </button>
      ))}
    </nav>
  );
}
