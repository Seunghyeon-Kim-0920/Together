import { ArrowLeft, ArrowRight, Check, Home, LockKeyhole, NotebookPen, Plane } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { availableCurrencies, currencyName } from "../lib/currency";
import { t } from "../lib/i18n";
import type { LedgerKind, Locale } from "../lib/types";
import "./first-use-guide.css";

const copy = {
  ko: {
    steps: ["종류", "이름과 화폐", "첫 기록"] as const,
    welcome: "나에게 맞는 첫 가계부",
    welcomeHelp: "생활비도 여행 경비도, 빈 가계부에서 가볍게 시작하세요.",
    dailyHelp: "매일 쓴 금액과 월 예산을 살펴봐요.",
    travelHelp: "누가 결제했는지 기록하고 함께 나눠요.",
    setup: "어떤 가계부로 쓸까요?",
    setupHelp: "알아보기 쉬운 이름과 실제로 사용하는 화폐를 골라 주세요.",
    defaultGeneral: "생활", defaultTravel: "나의 여행",
    ready: "이제 첫 지출을 기록해 보세요",
    readyHelp: "날짜, 사용처, 금액과 카테고리만 입력하면 됩니다. 기록한 뒤에도 수정할 수 있어요.",
    travelReady: "여행 참가자를 추가하고 첫 지출을 기록하세요. 결제한 사람과 함께 나눌 사람을 선택할 수 있어요.",
    noSamples: "예시 지출은 넣지 않아요. 내가 입력하거나 승인한 내역부터 시작합니다.",
    optional: "자동기록은 선택이에요. 가계부를 만든 뒤 필요할 때 알림 접근을 설정하세요.",
    private: "직접 공유하기 전에는 이 가계부의 내역이 다른 사람에게 공개되지 않아요.",
    back: "이전", next: "다음", begin: "빈 가계부 만들기", saving: "가계부 저장 중…",
    error: "가계부를 저장하지 못했어요. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요.",
    progress: (step: number) => `3단계 중 ${step}단계`,
  },
  en: {
    steps: ["Type", "Name & currency", "First entry"] as const,
    welcome: "Your first notebook",
    welcomeHelp: "Everyday spending or a trip together. Start with a clean page.",
    dailyHelp: "Keep track of daily spending and your monthly budget.",
    travelHelp: "Record who paid and split expenses together.",
    setup: "Make it yours",
    setupHelp: "Choose a recognizable name and the currency you actually use.",
    defaultGeneral: "Everyday", defaultTravel: "My trip",
    ready: "Ready for your first expense",
    readyHelp: "Enter the date, merchant, amount and category. You can edit the entry afterwards.",
    travelReady: "Add your travel companions, then record your first expense. Choose who paid and who shares the cost.",
    noSamples: "No sample expenses are added. Your notebook starts with entries you enter or approve.",
    optional: "Auto-recording is optional. Set up notification access later, only if you want it.",
    private: "Your entries are not visible to other people unless you choose to share them.",
    back: "Back", next: "Next", begin: "Create empty notebook", saving: "Saving notebook…",
    error: "Could not save your notebook. Check your device storage, then try again.",
    progress: (step: number) => `Step ${step} of 3`,
  },
  fr: {
    steps: ["Type", "Nom et devise", "Première dépense"] as const,
    welcome: "Votre premier carnet",
    welcomeHelp: "Dépenses du quotidien ou voyage à plusieurs : commencez sur une page blanche.",
    dailyHelp: "Suivez vos dépenses quotidiennes et votre budget mensuel.",
    travelHelp: "Notez qui a payé et partagez les frais.",
    setup: "Un carnet à votre image",
    setupHelp: "Choisissez un nom facile à reconnaître et la devise que vous utilisez.",
    defaultGeneral: "Quotidien", defaultTravel: "Mon voyage",
    ready: "Prêt pour votre première dépense",
    readyHelp: "Indiquez la date, le commerçant, le montant et la catégorie. Vous pourrez modifier la dépense ensuite.",
    travelReady: "Ajoutez vos compagnons de voyage, puis votre première dépense. Choisissez qui a payé et qui partage les frais.",
    noSamples: "Aucune dépense fictive n’est ajoutée. Seules les dépenses que vous saisissez ou validez sont enregistrées.",
    optional: "L’enregistrement automatique est facultatif. Activez l’accès aux notifications plus tard, si vous le souhaitez.",
    private: "Vos dépenses ne sont pas visibles par d’autres personnes, sauf si vous choisissez de les partager.",
    back: "Retour", next: "Suivant", begin: "Créer un carnet vide", saving: "Enregistrement du carnet…",
    error: "Impossible d’enregistrer le carnet. Vérifiez l’espace de stockage de votre appareil, puis réessayez.",
    progress: (step: number) => `Étape ${step} sur 3`,
  },
} as const;

export interface FirstUseGuideProps {
  locale: Locale;
  /** Resolve only after the empty ledger has been saved; reject if saving fails. */
  onCreate: (kind: LedgerKind, title: string, currency: string) => Promise<void>;
}

/** Shown only while the wallet has no ledgers. Never inserts sample expenses. */
export function FirstUseGuide({ locale, onCreate }: FirstUseGuideProps) {
  const text = copy[locale];
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [kind, setKind] = useState<LedgerKind>("general");
  // Keep an untouched suggested name localized, but never translate or replace
  // a name the user has entered when they change language or notebook type.
  const [enteredTitle, setEnteredTitle] = useState<string | null>(null);
  const title = enteredTitle ?? (kind === "general" ? text.defaultGeneral : text.defaultTravel);
  const [currency, setCurrency] = useState(locale === "ko" ? "KRW" : "EUR");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);
  const currencies = useMemo(() => availableCurrencies(), []);
  const heading = step === 0 ? text.welcome : step === 1 ? text.setup : text.ready;

  useEffect(() => {
    if (previousStepRef.current !== step) headingRef.current?.focus();
    previousStepRef.current = step;
  }, [step]);

  function nextStep() {
    if (step === 0) {
      setStep(1);
    } else if (step === 1 && title.trim()) setStep(2);
  }

  async function create() {
    if (savingRef.current || !title.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      await onCreate(kind, title.trim(), currency);
    } catch {
      setFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <section className="first-use-guide" aria-labelledby="first-use-title" aria-busy={saving}>
    <ol className="first-use-progress" aria-label={text.progress(step + 1)}>
      {text.steps.map((label, index) => <li key={index} aria-current={step === index ? "step" : undefined} className={index <= step ? "reached" : ""}>
        <span aria-hidden="true">{index < step ? <Check /> : index + 1}</span><small>{label}</small>
      </li>)}
    </ol>
    <div className="first-use-mark" aria-hidden="true">{step === 2 ? <NotebookPen /> : kind === "travel" ? <Plane /> : <Home />}</div>
    <h2 id="first-use-title" ref={headingRef} tabIndex={-1}>{heading}</h2>
    <p className="first-use-intro">{step === 0 ? text.welcomeHelp : step === 1 ? text.setupHelp : kind === "travel" ? text.travelReady : text.readyHelp}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (step === 2) void create(); else nextStep(); }}>
      {step === 0 ? <div className="ledger-type-options" role="group" aria-label={t(locale, "chooseLedgerType")}>
        <button className={`type-row${kind === "general" ? " selected" : ""}`} aria-pressed={kind === "general"} type="button" onClick={() => setKind("general")}>
          <Home aria-hidden="true" /><span className="type-description"><strong>{t(locale, "generalLedger")}</strong><small>{text.dailyHelp}</small></span><span className="radio-dot" aria-hidden="true" />
        </button>
        <button className={`type-row${kind === "travel" ? " selected" : ""}`} aria-pressed={kind === "travel"} type="button" onClick={() => setKind("travel")}>
          <Plane aria-hidden="true" /><span className="type-description"><strong>{t(locale, "travelLedger")}</strong><small>{text.travelHelp}</small></span><span className="radio-dot" aria-hidden="true" />
        </button>
      </div> : step === 1 ? <>
        <label className="field-label">{t(locale, "ledgerName")}<input value={title} maxLength={80} required autoComplete="off" onChange={(event) => setEnteredTitle(event.target.value)} /></label>
        <label className="field-label">{t(locale, kind === "travel" ? "localCurrency" : "baseCurrency")}
          <select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code} value={code}>{currencyName(code, locale)}</option>)}</select>
        </label>
      </> : <>
        <div className="first-use-notebook"><span>{t(locale, kind === "travel" ? "travelLedger" : "generalLedger")}</span><strong>{title}</strong><small>{currencyName(currency, locale)}</small></div>
        <p className="first-use-note">{text.noSamples}</p>
        {kind === "general" ? <p className="first-use-note">{text.optional}</p> : null}
      </>}
      {failed ? <p className="first-use-error" role="alert">{text.error}</p> : null}
      <div className="first-use-actions">
        {step > 0 ? <button type="button" disabled={saving} onClick={() => { setFailed(false); setStep(step === 2 ? 1 : 0); }}><ArrowLeft aria-hidden="true" />{text.back}</button> : null}
        <button type="submit" className="primary-button" disabled={saving || (step > 0 && !title.trim())}>{saving ? text.saving : step === 2 ? text.begin : text.next}{!saving && step < 2 ? <ArrowRight aria-hidden="true" /> : null}</button>
      </div>
    </form>
    <p className="first-use-private"><LockKeyhole aria-hidden="true" /><span>{text.private}</span></p>
  </section>;
}
