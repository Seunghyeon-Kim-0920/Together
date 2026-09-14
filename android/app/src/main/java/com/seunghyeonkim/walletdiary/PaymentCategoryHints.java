package com.seunghyeonkim.walletdiary;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/** Local category suggestion only. Never stores notification text or changes
 * payment acceptance, money, identity, confidence or deduplication rules. */
final class PaymentCategoryHints {
    private static final String[][] RULES = {
        {"food", "uber\\s*eats|bolt\\s*food|amazon\\s*fresh|deliveroo|doordash|배달의?민족|배민|쿠팡이츠"},
        {"subscriptions", "amazon\\s*prime|prime\\s*video|youtube\\s*premium|apple\\s*music|google\\s*one"},
        {"health", "pharmacy|pharmacie|hospital|hopital|clinic|clinique|doctor|medecin|dentist|dentiste|apotheke|farmacia|약국|병원|의원|치과|薬局|医院"},
        {"food", "lidl|aldi|carrefour|auchan|monoprix|franprix|supermarche|supermarket|grocery|groceries|restaurant|resto|cafe|coffee|bakery|boulangerie|epicerie|repas|meal|lunch|dinner|kfc|mcdonalds|starbucks|식당|음식|식비|외식|카페|커피|스타벅스|치킨|피자|마트|편의점|식료품|超市|食堂|咖啡"},
        {"subscriptions", "netflix|spotify|deezer|icloud|subscription|abonnement|adobe|chatgpt|openai|넷플릭스|구독|멤버십|订阅"},
        {"travel", "hotel|hostel|airbnb|agoda|airline|airways|airfrance|easyjet|ryanair|airport|flight|호텔|숙박|항공|여행사|酒店|航空"},
        {"transport", "uber|bolt|taxi|sncf|ratp|eurostar|trenitalia|renfe|flixbus|train|railway|metro|bus|tram|parking|fuel|petrol|diesel|essence|toll|shell|totalenergies|택시|주유|주차|교통|통행료|철도|버스|지하철|汽油|地铁"},
        {"utilities", "electricity|electricite|energy|energie|water|internet|telecom|telephone|broadband|edf|engie|veolia|sfr|vodafone|전기요금|수도요금|가스요금|관리비|통신비|한국전력|电费|水费"},
        {"housing", "rent|loyer|landlord|residence|mortgage|syndic|housing|월세|전세|임대료|주거비|기숙사|家賃|房租"},
        {"education", "school|ecole|university|universite|tuition|course|formation|academy|udemy|coursera|librairie|bookstore|학원|교육|등록금|수강료|교재|서점|学費"},
        {"leisure", "cinema|theatre|museum|musee|concert|festival|gym|fitness|sports|gaming|steam|playstation|nintendo|spa|coiffeur|영화|공연|헬스|필라테스|게임|미용실|마사지"},
        {"shopping", "amazon|ikea|zara|uniqlo|decathlon|aliexpress|temu|ebay|etsy|sephora|fnac|clothing|fashion|apparel|boutique|store|shop|shopping|쿠팡|무신사|올리브영|다이소|백화점|쇼핑|의류|화장품"}
    };
    private static final Pattern[] PATTERNS = new Pattern[RULES.length];
    static {
        for (int i = 0; i < RULES.length; i++) {
            StringBuilder alternatives = new StringBuilder();
            for (String term : RULES[i][1].split("\\|")) {
                if (alternatives.length() > 0) alternatives.append('|');
                // Latin words have boundaries; CJK words also match compounds.
                if (term.charAt(0) < 128) alternatives.append("(?:^|[^\\p{L}\\p{N}])(?:").append(term).append(")(?:$|[^\\p{L}\\p{N}])");
                else alternatives.append(term);
            }
            PATTERNS[i] = Pattern.compile(alternatives.toString());
        }
    }
    private PaymentCategoryHints() { }
    private static String normalized(String text) {
        String value = text == null ? "" : text.substring(0, Math.min(12000, text.length()));
        value = Normalizer.normalize(value, Normalizer.Form.NFKD).replaceAll("\\p{M}+", "");
        return Normalizer.normalize(value, Normalizer.Form.NFC).toLowerCase(Locale.ROOT).replaceAll("[’']", "").replaceAll("[._*:/-]+", " ");
    }
    private static String match(String text) {
        String value = normalized(text);
        for (int i = 0; i < RULES.length; i++) if (PATTERNS[i].matcher(value).find()) return RULES[i][0];
        return null;
    }
    static String infer(String merchant, String title, String body) {
        String category = match(merchant);
        return category != null ? category : match((title == null ? "" : title) + "\n" + (body == null ? "" : body));
    }
}
