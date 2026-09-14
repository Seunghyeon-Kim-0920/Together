import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
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
        for (int i = 0; i < categories.length; i++) {
            System.out.println("CATEGORY_" + i + "|" + Base64.getEncoder().encodeToString(
                categories[i].pattern().getBytes(StandardCharsets.UTF_8)));
        }
    }
}
