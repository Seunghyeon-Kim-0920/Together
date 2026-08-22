import { EllipsisVertical, Home, Plane, Plus } from "lucide-react";
import type { Ledger, Locale } from "../lib/types";
import { t } from "../lib/i18n";

export function LedgerTabs({ ledgers, activeId, locale, onSelect, onAdd, onMenu }: {
  ledgers: readonly Ledger[]; activeId: string | null; locale: Locale;
  onSelect: (id: string) => void; onAdd: () => void; onMenu: (ledger: Ledger) => void;
}) {
  return (
    <nav className="ledger-tabs" aria-label={t(locale, "ledgers")}>
      {ledgers.map((ledger) => {
        const Icon = ledger.kind === "travel" ? Plane : Home;
        return (
          <div className={ledger.id === activeId ? "ledger-tab selected" : "ledger-tab"} key={ledger.id}>
            <button className="ledger-tab-main" type="button" onClick={() => onSelect(ledger.id)} aria-current={ledger.id === activeId ? "page" : undefined}>
              <Icon aria-hidden="true" /><span><strong>{ledger.title}</strong><small>{t(locale, ledger.kind === "travel" ? "travelLedger" : "generalLedger")}</small></span>
            </button>
            <button className="tab-menu-button" type="button" aria-label={`${ledger.title} ${t(locale, "menu")}`} onClick={() => onMenu(ledger)}><EllipsisVertical /></button>
          </div>
        );
      })}
      <button className="new-ledger-tab" type="button" onClick={onAdd}><Plus aria-hidden="true" /><span>{t(locale, "newLedger")}</span></button>
    </nav>
  );
}
