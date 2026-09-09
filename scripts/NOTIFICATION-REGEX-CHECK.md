# Android notification regular-expression gate

Android's `java.util.regex.Pattern` is backed by ICU, while Gradle local JUnit tests run on the desktop JDK. Both must be checked: the embedded `(?U)` flag compiles on the JDK but throws `U_REGEX_INVALID_FLAG` in ICU. Android already uses Unicode character classes.

After compiling the Android release Java classes, run on Windows with the system `icu.dll`:

```powershell
.\scripts\check-notification-regex-icu.ps1 `
  -ClassesDirectory '<build directory>\android\app\build\intermediates\javac\release\compileReleaseJavaWithJavac\classes' `
  -JsonJar '<Gradle cache>\org.json\json\20240303\<hash>\json-20240303.jar' `
  -JavaHome '<JDK 21 directory>'
```

The gate reads the actual compiled parser fields, including concatenated expressions. It rejects any ICU compilation failure and checks 25 multilingual matching fixtures. A deliberately incompatible old expression must fail, proving that this check detects the regression that desktop-only tests missed. Keep new parser expressions in static `Pattern` fields so they are included in this inventory. The script returns a nonzero exit code on failure and removes its uniquely created helper-class directory.

Verified against Windows native ICU 72.1.0.4:

- Version 1.5.0 (`70ca804`): 13 of 36 static expressions failed, starting with `CREDIT_BALANCE_LABEL`.
- Fixed parser: all 52 expressions compiled and all 25 native matching fixtures passed.
- Parser, notification-text, and compatibility JUnit suites: 43 tests passed.

This gate is a useful ICU compatibility check, not an Android emulator or proof of notification delivery on every phone. Android service lifecycle and representative device/API tests remain necessary.

References: [Android Pattern documentation](https://developer.android.com/reference/java/util/regex/Pattern), [ICU regular-expression documentation](https://unicode-org.github.io/icu/userguide/strings/regexp.html).
