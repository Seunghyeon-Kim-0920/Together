import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** Emits the exact compiled expressions, including concatenated currency tokens. */
public final class NotificationRegexDump {
    public static void main(String[] args) throws Exception {
        Class<?> parser = Class.forName("com.seunghyeonkim.walletdiary.PaymentNotificationParser");
        for (Field field : parser.getDeclaredFields()) {
            if (field.getType() != Pattern.class) continue;
            field.setAccessible(true);
            Pattern pattern = (Pattern) field.get(null);
            System.out.println(field.getName() + "|" + Base64.getEncoder().encodeToString(
                pattern.pattern().getBytes(StandardCharsets.UTF_8)));
        }
        Class<?> hints = Class.forName("com.seunghyeonkim.walletdiary.PaymentCategoryHints");
        Field patterns = hints.getDeclaredField("PATTERNS");
        patterns.setAccessible(true);
        Pattern[] categories = (Pattern[]) patterns.get(null);
        Field rulesField = hints.getDeclaredField("RULES");
        rulesField.setAccessible(true);
        String[][] rules = (String[][]) rulesField.get(null);
        if (rules.length != categories.length) throw new IllegalStateException("Category inventory mismatch");
        Map<String, Integer> occurrences = new HashMap<>();
        for (int i = 0; i < categories.length; i++) {
            // Keep fixtures stable when another category is inserted in the rule list.
            String category = rules[i][0];
            int occurrence = occurrences.merge(category, 1, Integer::sum);
            System.out.println("CATEGORY_" + category + "_" + occurrence + "|" + Base64.getEncoder().encodeToString(
                categories[i].pattern().getBytes(StandardCharsets.UTF_8)));
        }
        Class<?> sms = Class.forName("com.seunghyeonkim.walletdiary.SmsPaymentPolicy");
        for (Field field : sms.getDeclaredFields()) {
            if (field.getType() != Pattern.class) continue;
            field.setAccessible(true);
            Pattern pattern = (Pattern) field.get(null);
            System.out.println("SMS_" + field.getName() + "|" + Base64.getEncoder().encodeToString(
                pattern.pattern().getBytes(StandardCharsets.UTF_8)));
        }
    }
}
