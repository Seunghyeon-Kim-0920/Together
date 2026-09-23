import { History, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { getAutomationPaymentHistory } from "../lib/paymentDuplicates";
import { formatMoney } from "../lib/currency";
import { t } from "../lib/i18n";
import type { GeneralLedger, Locale } from "../lib/types";
import { SheetFrame } from "./Sheets";

const copy = {
  ko: { title: "자동 기록 처리 이력", intro: "기록된 결제와 합쳐진 알림을 확인하세요. 실제로 따로 결제했다면 해당 알림만 별도 지출로 복구할 수 있습니다.", recorded: "기록 완료", merged: "중복 알림 병합", restored: "별도 결제로 복구", removed: "삭제·이동된 기록", all: "전체", undo: "별도 결제로 복구", confirm: "실제로 따로 결제한 내역인가요? 복구하면 총지출이 늘어납니다.", legacy: "이전 버전 알림입니다. 당시 사용처를 보관하지 않아 최초 결제 정보로 복구됩니다. 복구 후 확인해주세요.", empty: "아직 자동 기록 처리 이력이 없습니다.", more: "더 보기", sources: "수신한 결제 앱", help: "알림 내용·시각은 이 기기에만 보관합니다. 검토 대기 내역은 카드·이체 자동기록에서 확인할 수 있습니다." },
  en: { title: "Automatic recording history", intro: "Review recorded payments and merged alerts. If these were separate purchases, restore an alert as its own expense.", recorded: "Recorded", merged: "Duplicate alerts merged", restored: "Restored separately", removed: "Deleted or moved", all: "All", undo: "Restore separate payment", confirm: "Was this a separate purchase? Restoring it increases your total spending.", legacy: "This older alert has no saved merchant snapshot. The original payment details will be used; check them after restoring.", empty: "No automatic recording history yet.", more: "Show more", sources: "Payment apps", help: "Alert details and times stay on this device. Pending payments are in automatic card and transfer recording." },
  fr: { title: "Historique des enregistrements", intro: "Vérifiez les paiements enregistrés et les alertes fusionnées. S’il s’agissait d’achats distincts, restaurez une alerte comme dépense séparée.", recorded: "Enregistré", merged: "Alertes en double fusionnées", restored: "Paiement séparé rétabli", removed: "Supprimé ou déplacé", all: "Tous", undo: "Rétablir un paiement séparé", confirm: "Était-ce un achat distinct ? Le rétablir augmentera le total de vos dépenses.", legacy: "Cette ancienne alerte ne contient pas les détails du commerçant. Les données du paiement initial seront utilisées ; vérifiez-les après restauration.", empty: "Aucun enregistrement automatique pour le moment.", more: "Afficher plus", sources: "Applications de paiement", help: "Les détails et horaires des alertes restent sur cet appareil. Les paiements à vérifier se trouvent dans l’enregistrement automatique des cartes et virements." },
} as const;

export function AutomationHistory({ ledger, locale, onUndo }: { ledger: GeneralLedger; locale: Locale; onUndo: (expenseId: string, sourceId: string) => Promise<boolean> }) {
  const c = copy[locale];
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "merged">("all");
  const [limit, setLimit] = useState(30);
  const [confirmation, setConfirmation] = useState<{ expenseId: string; sourceId: string; legacy: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const history = useMemo(() => getAutomationPaymentHistory(ledger), [ledger]);
  const filtered = filter === "all" ? history : history.filter((item) => item.status === "merged");
  const restore = async () => {
    if (!confirmation || lock.current) return;
    lock.current = true; setBusy(true);
    try { if (await onUndo(confirmation.expenseId, confirmation.sourceId)) setConfirmation(null); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="mobile-panel automation-history">
    <button className="summary-setting-row" type="button" onClick={() => setOpen(true)}><History aria-hidden="true" /><span className="summary-setting-copy"><strong>{c.title}</strong><small>{history.length.toLocaleString(locale)}</small></span></button>
    {open ? <SheetFrame title={c.title} locale={locale} onClose={() => { if (!busy) { setOpen(false); setConfirmation(null); } }}>
      <p className="sheet-intro">{c.intro}</p><p className="storage-note">{c.help}</p>
      <div className="ledger-segments">{(["all", "merged"] as const).map((key) => <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "active" : ""} onClick={() => { setFilter(key); setLimit(30); }}>{c[key]}</button>)}</div>
      {confirmation ? <div className="delete-confirm" role="alert"><p>{c.confirm}</p>{confirmation.legacy ? <p>{c.legacy}</p> : null}<div><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>{t(locale, "cancel")}</button><button className="primary-button" type="button" disabled={busy} onClick={() => void restore()}>{c.undo}</button></div></div> : null}
      {filtered.length ? filtered.slice(0, limit).map((item) => <article className="mobile-panel" key={item.expenseId}>
        <div className="section-heading"><strong>{item.merchant}</strong><b>{formatMoney(item.minorUnits, item.currency, locale)}</b></div><p><small>{item.occurredOn} · {c[item.status]}</small></p>
        <details><summary>{c.sources} ({item.sources.length})</summary>{item.sources.map((source) => <div className="history-source" key={source.expenseId}><span>{ledger.automationSources.find((registered) => registered.packageName === source.packageName)?.displayName ?? source.packageName}<small>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(source.occurredAt))}</small></span>{source.canRestore ? <button type="button" disabled={busy} onClick={() => setConfirmation({ expenseId: item.expenseId, sourceId: source.expenseId, legacy: source.legacySnapshot })}><Undo2 aria-hidden="true" />{c.undo}</button> : null}</div>)}</details>
      </article>) : <p className="empty-inline">{c.empty}</p>}
      {filtered.length > limit ? <button className="wide-secondary" type="button" onClick={() => setLimit((value) => value + 30)}>{c.more}</button> : null}
    </SheetFrame> : null}
  </section>;
}
