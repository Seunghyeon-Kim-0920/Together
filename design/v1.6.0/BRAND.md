# Wallet Diary brand assets

The approved `brand-symbol.png` is the production source: a cobalt wallet holding diary pages, with a coral bookmark. It was generated with the built-in image-generation tool and has an opaque pale background. Native packaging does not redraw, retouch, recolor, or remove that background.

## Files

- `brand-symbol.png`: original 1254 × 1254 source.
- `store-icon-512.png`: opaque, square 512 × 512 Play Store image (228,692 bytes at generation).
- `../../resources/icon.png`: opaque 1024 × 1024 master icon. The iOS app-icon asset has the same pixels.
- `../../public/brand/wallet-diary-mark.png`: 256 × 256 in-app mark; use next to localized, real-text app naming.
- `icon-48.png`, `icon-96.png`: actual-size legacy previews.
- `icon-adaptive-round-48.png`, `icon-adaptive-round-96.png`: round-mask previews of the adaptive icon's visible viewport, at actual display sizes.
- `brand-packaging.json`: source hash, output dimensions, sizes, alpha metadata, and measured adaptive safe-area result for all 68 packaged assets.

## Native packaging

Run `node scripts/package-brand.mjs` from the project root. It uses an installed `sharp` package, `SHARP_MODULE`, or the bundled desktop dependency runtime. Source artwork remains unchanged; processing is limited to proportional resize, centered padding, and the native round mask.

All six Android densities have legacy, round, foreground and background assets. The adaptive foreground is a 108dp canvas; the colored silhouette reaches a radius of 30.82dp, inside the required central 33dp radius. There is no second XML inset. This follows Android's [adaptive-icon safe-area guidance](https://developer.android.com/codelabs/basic-android-kotlin-compose-training-change-app-icon).

Android and iOS splash variants use the same mark and pale `#F7F8FC` background. Android's launch theme sets the icon and post-launch theme through the [SplashScreen theme attributes](https://developer.android.com/reference/androidx/core/splashscreen/SplashScreen). The navigation bar stays dark on Android 7, whose navigation buttons cannot switch to dark; Android 8+ gets the pale navigation bar with dark buttons.

## Visual verification

The original and the generated 48px/96px previews were opened with `view_image`. Checked: cobalt/coral color preservation; intact wallet/page/bookmark silhouette; no clipping in the round masks; no pre-rounded corners or alpha in store/iOS icons; centered, undistorted splash artwork; pale-background continuity. The static resources have been checked, not a physical launcher. Device/runtime validation remains part of the app release check.
