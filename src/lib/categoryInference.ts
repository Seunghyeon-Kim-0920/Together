import { merchantDisplayName } from "./merchant";
import type { GeneralCategory, GeneralExpense, GeneralLedger, Ledger, MerchantCategoryPreference } from "./types";

export const MAX_MERCHANT_CATEGORY_PREFERENCES = 5000;

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").normalize("NFC").toLocaleLowerCase("en");
}

/** Ignore presentation and wallet wrappers, but keep branch names and digits:
 * similar names are not proof that two different merchants are the same. */
export function categoryMerchantKey(value: string, expenseId?: string): string {
  return normalized(merchantDisplayName(value, expenseId))
    .replace(/^(?:google\s*(?:pay|wallet)|samsung\s*(?:pay|wallet)|gpay|paypal)\s*[*:·-]\s*/u, "")
    .replace(/[^\p{Letter}\p{Number}]/gu, "").slice(0, 500);
}

// Specific compound merchants win before broad words (Uber Eats vs Uber,
// Amazon Prime vs Amazon, pharmacy vs shop). These are local suggestions,
// not merchant-category-code data or a claim of certainty.
const SPECIFIC: readonly [GeneralCategory, RegExp][] = [
  ["food", /uber\s*eats|ubereats|bolt\s*food|amazon\s*fresh|deliveroo|doordash|grubhub|just\s*eat|foodpanda|배달의?민족|배민|쿠팡이츠|요기요|美团|饿了么/u],
  ["subscriptions", /amazon\s*prime|prime\s*video|youtube\s*(?:premium|music)|apple\s*(?:music|tv|one)|google\s*one|microsoft\s*365|disney\s*plus/u],
  ["transport", /car\s*rental|rental\s*car|location\s*(?:de\s*)?voiture|렌터카|렌트카/u],
];
const TERMS: readonly [GeneralCategory, string, string][] = [
  ["health", "pharmacy|pharmacie|pharmacies|pharmacien|parapharmacie|hospital|hopital|clinic|clinique|doctor|medecin|dentist|dentiste|dental|opticien|optical|laboratoire|apotheke|farmacia|cvs|walgreens|boots|doctolib", "약국|병원|의원|치과|한의원|안과|의료|薬局|病院|医院|诊所|醫院|药店"],
  ["food", "lidl|aldi|carrefour|auchan|monoprix|franprix|intermarche|leclerc|picard|costco|tesco|sainsbury|woolworths|colruyt|delhaize|rewe|edeka|mercadona|continente|pingo|grocery|groceries|supermarket|supermarche|epicerie|restaurant|restaurants|resto|cafe|coffee|caffe|caffetteria|bakery|boulangerie|boulangeries|patisserie|boucherie|brasserie|bistro|bistrot|sushi|ramen|pizza|pizzeria|burger|sandwich|kebab|tacos|kfc|mcdonald|mcdonalds|starbucks|columbus|colombus|pret|subway|dunkin|tim hortons|7 eleven|familymart|lawson|ace mart|sagane|distrib gennevilliers|distri villette|sc alim|sc ace|strada cafe|lunch|dinner|breakfast|meal|repas|alimentation|alimentaire", "식당|음식|식비|외식|카페|커피|스타벅스|투썸|이디야|메가커피|컴포즈|빽다방|치킨|피자|버거|베이커리|파리바게뜨|뚜레쥬르|빵집|편의점|이마트|롯데마트|홈플러스|하나로마트|지에스25|씨유|세븐일레븐|식료품|정육|반찬|도시락|맛집|餐厅|餐廳|咖啡|食堂|超市|レストラン|スーパー|コンビニ|セブンイレブン"],
  ["subscriptions", "netflix|spotify|deezer|icloud|subscription|subscriptions|abonnement|abonnements|adobe|chatgpt|openai|claude|anthropic|dropbox|patreon|audible|crunchyroll|paramount|hulu|canalplus|membership", "넷플릭스|스포티파이|구독료|구독|정기이용권|멤버십|유튜브프리미엄|定期購読|订阅|訂閱"],
  ["travel", "hotel|hotels|hostel|motel|resort|airbnb|booking|agoda|expedia|airline|airlines|airways|airfrance|easyjet|ryanair|lufthansa|emirates|qatar|volotea|vueling|aeroport|airport|flight|aviation|tourism|vacances", "호텔|호스텔|숙박|펜션|게스트하우스|에어비앤비|대한항공|아시아나|제주항공|진에어|티웨이|항공|여행사|航空|机场|機場|酒店|旅館|空港|フライト"],
  ["transport", "uber|bolt|taxi|sncf|ratp|eurostar|trenitalia|renfe|ouigo|flixbus|flixtrain|blablacar|train|rail|railway|metro|metropolitain|bus|tram|tramway|parking|parkhaus|fuel|petrol|diesel|gasoline|essence|station service|shell|totalenergies|esso|bp|chevron|exxon|toll|autoroute|navigo|lime|dott|tfl|lyft|grab|gojek|suica|pasmo|korail|ktx|srt", "택시|교통|주유|충전소|주차|통행료|하이패스|버스|지하철|철도|기차|코레일|카카오티|따릉이|전기차충전|タクシー|電車|鉄道|駐車|汽油|地铁|高铁|公交|出租车|交通"],
  ["utilities", "electric|electricity|electricite|electricidad|energy|energie|water|internet|telecom|telecommunication|broadband|mobile|telephone|electricien|plomberie|edf|engie|enedis|veolia|suez|sfr|bouygues|vodafone|verizon|comcast|att", "전기요금|수도요금|가스요금|도시가스|관리비|통신비|휴대폰요금|인터넷요금|한국전력|통신요금|電気料金|水道料金|电费|水费|话费"],
  ["housing", "rent|rental|loyer|loyers|landlord|residence|mortgage|syndic|copropriete|immobilier|housing|apartment", "월세|전세|임대료|주거비|주택담보|기숙사비|家賃|房租|租金"],
  ["education", "school|ecole|university|universite|college|tuition|course|courses|formation|training|academy|udemy|coursera|duolingo|textbook|librairie|bookstore|kindle", "학원|교육|학교|대학교|등록금|수강료|강의|교재|교보문고|영풍문고|서점|学費|授業料|学校|教育|书店"],
  ["leisure", "cinema|theatre|museum|musee|concert|festival|ticketmaster|eventbrite|concert|bowling|karaoke|gym|fitness|piscine|sports|sport|stadium|game|gaming|steam|playstation|nintendo|xbox|disneyland|aquarium|zoo|spa|massage|salon|barber|coiffeur", "영화|롯데시네마|메가박스|씨지브이|공연|콘서트|박물관|미술관|전시|노래방|헬스|필라테스|요가|수영|볼링|게임|미용실|네일|마사지|사우나|映画|美容|健身|电影院"],
  ["shopping", "amazon|ikea|zara|uniqlo|decathlon|action|aliexpress|temu|shein|ebay|etsy|walmart|target|sephora|primark|hennes|fnac|darty|boulanger|leroy merlin|castorama|nike|adidas|new balance|clothing|clothes|fashion|apparel|cosmetics|boutique|store|shop|shopping|market|mall", "쿠팡|네이버페이|무신사|올리브영|다이소|유니클로|백화점|아울렛|쇼핑|의류|화장품|문구|생활용품|가전|잡화|이케아|衣料|百貨店|商场|商城|购物"],
];
const RULES = TERMS.map(([category, latin, other]) => [category,
  new RegExp(`(?:^|[^\\p{Letter}\\p{Number}])(?:${latin})(?:$|[^\\p{Letter}\\p{Number}])|(?:${other})`, "u")] as const);

export function inferGeneralCategory(merchant: string, hint?: GeneralCategory): GeneralCategory {
  const content = normalized(merchant).replace(/[’']/gu, "").replace(/[._*:/-]+/gu, " ");
  for (const [category, pattern] of SPECIFIC) if (pattern.test(content)) return category;
  for (const [category, pattern] of RULES) if (pattern.test(content)) return category;
  return hint ?? "other";
}

export function rememberMerchantCategory(ledger: GeneralLedger, expense: GeneralExpense, previous?: GeneralExpense): GeneralLedger {
  const aliases = [categoryMerchantKey(expense.description, expense.id)];
  if (previous) {
    aliases.push(categoryMerchantKey(previous.description, previous.id));
    for (const receipt of ledger.automationPaymentReceipts ?? []) if (receipt.expenseId === previous.id) aliases.push(categoryMerchantKey(receipt.merchant));
  }
  const keys = new Set(aliases.filter(Boolean)); const updatedAt = new Date().toISOString();
  const preferences = [...(ledger.merchantCategoryPreferences ?? []).filter((entry) => !keys.has(entry.merchantKey)), ...[...keys].map((merchantKey) => Object.freeze({ merchantKey, category: expense.category, updatedAt }))];
  return Object.freeze({ ...ledger, merchantCategoryPreferences: Object.freeze(preferences.slice(-MAX_MERCHANT_CATEGORY_PREFERENCES)) });
}

/** Build once per batch. Explicit user preferences win over older automatic
 * guesses, including after the source expense is moved or deleted. */
export function createCategoryResolver(ledgers: readonly Ledger[]) {
  const preferences = new Map<string, MerchantCategoryPreference>();
  type HistoricalCategory = { category: GeneralCategory; date: string; userReviewed: boolean };
  const byLedger = new Map<string, Map<string, HistoricalCategory>>();
  const history = new Map<string, HistoricalCategory>();
  const prefer = (previous: HistoricalCategory | undefined, next: HistoricalCategory) => !previous
    || next.userReviewed && !previous.userReviewed
    || next.userReviewed === previous.userReviewed && previous.date <= next.date;
  for (const ledger of ledgers) if (ledger.kind === "general") {
    const local = new Map<string, HistoricalCategory>();
    for (const expense of ledger.expenses) {
      const key = categoryMerchantKey(expense.description, expense.id); if (!key) continue;
      // Older versions did not track explicit category preferences. Manual
      // entries and reviewed imports are better evidence than automatic card
      // guesses. Old edits of card-auto rows cannot be distinguished reliably;
      // new user saves create the explicit preferences handled above.
      const entry = { category: expense.category, date: expense.occurredOn, userReviewed: !expense.automationFingerprint && !expense.id.startsWith("card-auto-") };
      if (prefer(local.get(key), entry)) local.set(key, entry);
      if (prefer(history.get(key), entry)) history.set(key, entry);
    }
    byLedger.set(ledger.id, local);
    for (const preference of ledger.merchantCategoryPreferences ?? []) {
      if (!preferences.has(preference.merchantKey) || preferences.get(preference.merchantKey)!.updatedAt <= preference.updatedAt) preferences.set(preference.merchantKey, preference);
    }
  }
  return (merchant: string, ledgerId: string, hint?: GeneralCategory): GeneralCategory => {
    const key = categoryMerchantKey(merchant);
    const local = byLedger.get(ledgerId)?.get(key); const global = history.get(key);
    const historical = global?.userReviewed && !local?.userReviewed ? global : local ?? global;
    return preferences.get(key)?.category ?? historical?.category ?? inferGeneralCategory(merchant, hint);
  };
}
