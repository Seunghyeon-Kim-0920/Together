import type { GeneralCategory } from "../../src/lib/types";

/** Public brand names or invented merchants only. Never add real notifications here. */
export interface CategoryFixture {
  readonly id: string;
  readonly merchant: string;
  readonly expectedCategory: GeneralCategory;
  readonly labelConfidence: "clear" | "ambiguous";
  readonly split: "development" | "validation";
  readonly description?: string;
  readonly sourceName?: string;
  readonly categoryHint?: GeneralCategory;
  /** Synthetic protection cases; these must never be sent to Jev. */
  readonly learned?: { readonly kind: "preference" | "history"; readonly category: GeneralCategory };
}

type Row = readonly [merchant: string, confidence?: "clear" | "ambiguous", description?: string, sourceName?: string, categoryHint?: GeneralCategory];

const rows: Record<GeneralCategory, readonly Row[]> = {
  food: [
    ["Uber Eats"], ["Lidl Paris"], ["Maison du Bento"], ["달빛 분식"],
    ["서울 떡볶이집"], ["Le Comptoir des Saveurs"], ["HelloFresh"],
    ["Bio c' Bon"], ["Daily Harvest", "ambiguous", "Brand name alone may not clearly identify groceries."],
    ["Example ABC", "clear", "Synthetic Android food hint from a synthetic restaurant alert.", "Example Bank", "food"],
  ],
  transport: [
    ["Uber trip"], ["SNCF Connect"], ["Vélib' Métropole"], ["Île-de-France Mobilités"],
    ["MTA OMNY"], ["JR East"], ["ParkMobile"], ["가온 주차장"],
    ["BlaBlaCar"], ["Busan Express", "ambiguous", "Could be a transport operator or an unrelated business."],
  ],
  housing: [
    ["월세 이체"], ["Loyer Paris"], ["Apartment 47 management"], ["임대관리 봄"],
    ["Habitat Résidence"], ["Seoul Stay Monthly Rent"],
    ["ImmoZen charges locatives", "ambiguous", "Property charges may overlap with utilities."],
    ["MaisonLease"], ["집주인 월세"], ["Nest Housing"],
  ],
  utilities: [
    ["EDF"], ["한국전력"], ["Orange facture fibre"], ["KT 인터넷요금"],
    ["Vodafone"], ["Veolia Eau"], ["FibrePlus", "ambiguous", "Name could denote a telecom provider or an unrelated product."],
    ["광명 도시가스"], ["Suez Eau"], ["Verizon Fios"],
  ],
  shopping: [
    ["Amazon Marketplace", "ambiguous", "Marketplace purchases can cover many purposes; shopping is the existing broad default."],
    ["Zara"], ["Le Bon Marché"], ["무신사"], ["옷장마켓"],
    ["Cdiscount"], ["Vinted"], ["Etsy"], ["다이소"], ["Bloomingdale's"],
  ],
  health: [
    ["PHARMACIE DU CENTRE"], ["서울약국"], ["바른정형외과"], ["Doctolib"],
    ["Vision Express Opticians"], ["MediCare Laboratory"], ["Santé Dentaire"],
    ["CVS Health", "ambiguous", "A pharmacy chain can also sell ordinary groceries and goods."],
    ["Olive Dental"], ["한빛 물리치료"],
  ],
  leisure: [
    ["CGV"], ["Cinépolis"], ["Rock en Seine"], ["서울 볼링장"],
    ["La Villette Spectacles"], ["Steam Games"],
    ["FitPass", "ambiguous", "A fitness pass may be leisure or a subscription."],
    ["Aquaboulevard"], ["뮤지컬 별빛"], ["Pathé Cinémas"],
  ],
  education: [
    ["Université test"], ["한빛 영어학원"],
    ["Luma Books", "ambiguous", "Book purchases can be education or general shopping."],
    ["OpenClassrooms"], ["Coursera"], ["Codecademy"],
    ["문해력 연구소 수업료"], ["Alliance Française cours"], ["Mathnasium"],
    ["Book Depository", "ambiguous", "Book retail may also be general shopping."],
  ],
  subscriptions: [
    ["Netflix"], ["Spotify"], ["YouTube Premium"], ["Apple Music"],
    ["Canal+"], ["Readly"],
    ["Headspace Plus", "ambiguous", "Could be a recurring subscription or wellness/leisure purchase."],
    ["Notion Plus"], ["Patreon"], ["Antivirus annual plan"],
  ],
  travel: [
    ["Air France"], ["Hôtel de la Gare"], ["Airbnb"], ["Korean Air"],
    ["라온 게스트하우스"], ["오로라 항공권"], ["Hostelworld"],
    ["Accor"], ["Expedia"], ["Trip.com"],
  ],
  other: [
    ["Acme 47", "clear", "No defensible spending purpose from the merchant alone."],
    ["Aurore SAS", "clear", "Generic legal entity name."],
    ["민수상사", "ambiguous", "Generic business name; goods or services unknown."],
    ["Maison Lumière", "ambiguous", "Could be food, housing, shopping, or another business."],
    ["Société Delta", "clear", "Generic legal entity name."],
    ["OneTwoThree Ltd", "clear", "Opaque company name."],
    ["Paris 2026", "clear", "Location and year do not establish purchase type."],
    ["회계대행 라온", "clear", "Accounting service has no dedicated existing category."],
    ["Local Services 24", "clear", "Service is too broad to classify."],
    ["Bluebird", "clear", "Opaque name; category cannot be inferred."],
  ],
};

const developmentIndices = new Set([0, 3, 6, 9]);
const generated = Object.entries(rows).flatMap(([category, categoryRows]) => categoryRows.map((row, index): CategoryFixture => {
  const [merchant, labelConfidence = "clear", description, sourceName, categoryHint] = row;
  return Object.freeze({
    id: `synthetic-${category}-${String(index + 1).padStart(2, "0")}`,
    merchant,
    expectedCategory: category as GeneralCategory,
    labelConfidence,
    split: developmentIndices.has(index) ? "development" : "validation",
    ...(description ? { description } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(categoryHint ? { categoryHint } : {}),
  });
}));

export const CATEGORY_FIXTURES: readonly CategoryFixture[] = Object.freeze([
  ...generated,
  // Explicitly verify that even an "other" user choice cannot trigger Jev.
  Object.freeze({ id: "synthetic-learned-preference", merchant: "Luma Books", expectedCategory: "other", labelConfidence: "ambiguous", split: "validation", description: "Synthetic user preference intentionally overrides the merchant's possible book category.", learned: { kind: "preference" as const, category: "other" as const } }),
  Object.freeze({ id: "synthetic-learned-history", merchant: "Maison du Bento", expectedCategory: "shopping", labelConfidence: "ambiguous", split: "validation", description: "Synthetic reviewed historical category overrides a merchant rule.", learned: { kind: "history" as const, category: "shopping" as const } }),
]);
