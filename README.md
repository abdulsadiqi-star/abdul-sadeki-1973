# CalorieMe

A premium, bilingual (Persian/English) calorie-tracking and weight-management
Android app: onboarding, BMI/BMR/TDEE-based calorie targets, food logging
with photo-based recognition, weight tracking, charts, and a monthly report.

The app name is temporary and easy to change — see **Renaming the app** below.

## Stack

- Kotlin, Jetpack Compose, Material 3
- MVVM + repository pattern, hand-rolled DI (`AppContainer`, no framework)
- Room (structured data) + DataStore Preferences (language / onboarding flags)
- Coroutines / Flow, Navigation Compose, Android Photo Picker
- Coil (image loading), AndroidX AppCompat (`AppCompatDelegate.setApplicationLocales`
  for per-app language switching)
- Gradle Kotlin DSL, version catalog (`gradle/libs.versions.toml`)
- minSdk 26, targetSdk/compileSdk 35

## Architecture

Two Gradle modules:

- **`:core`** — pure Kotlin/JVM, zero Android dependencies. All the health
  math lives here: `BmiCalculator`, `BmrCalculator` (Mifflin-St Jeor),
  `TdeeCalculator`, `CalorieTargetCalculator`, `DailyTotalsCalculator`,
  `WeightProgressCalculator`, `MonthlySummaryCalculator`. Fully unit tested
  (`:core:test`) — see **Testing** below for why this split exists.
- **`:app`** — the Android app, organized as:
  ```
  data/       Room entities, DAOs, AppDatabase, DataStore (PreferencesManager),
              repositories (interface + impl)
  domain/     model/ (UserProfile, FoodEntry, WeightEntry, enums) and
              usecase/ (wraps :core calculators + repositories; e.g.
              CompleteOnboardingUseCase, ObserveDailyTotalsUseCase,
              GetMonthlyReportUseCase, LogWeightEntryUseCase)
  ai/         FoodRecognitionService interface + FoodAnalysisRequest/Result
              models + MockFoodRecognitionService (see AI section below)
  ui/         theme/ (colors, type, the dark Material3 color scheme),
              components/ (the reusable design system: AppCard, PrimaryButton,
              ProgressRing, MacroProgressBar, FoodEntryCard, EmptyState, ...),
              charts/ (hand-rolled Canvas line/bar charts), navigation/,
              screens/ (splash, language, onboarding, home, food, progress,
              profile)
  viewmodel/  one StateFlow-based ViewModel per screen
  util/       LocaleController, Formatters, enum → string-resource mapping
  ```

Calculation logic never lives in a Composable — screens read `StateFlow`s
that ViewModels derive by calling `domain/usecase` code, which in turn calls
`:core` calculators.

## Renaming the app

Change `APP_DISPLAY_NAME` in the root `gradle.properties`. It's wired into
`app/build.gradle.kts` as a generated `R.string.app_name` (via `resValue`),
which drives the launcher label and every in-app reference to the app's name
— nothing else needs to change.

## Bilingual support (Persian RTL / English LTR)

- All user-facing text is in `app/src/main/res/values/strings.xml` (English,
  default) and `values-fa/strings.xml` (Persian). `android:supportsRtl="true"`
  is set, and Compose derives layout direction from the active locale
  automatically.
- Language is chosen once (first-launch language-selection screen) and
  persisted in DataStore. `LocaleController.applyLanguage()` calls
  `AppCompatDelegate.setApplicationLocales(...)`, which is the modern
  per-app-language API — it works without an `AppCompatActivity`, persists
  the choice itself, and recreates activities to re-render in the new
  direction. Nothing in Room or DataStore's structured data is touched by a
  language change, so switching languages from Profile never loses data.
- The two language-picker cards (`فارسی` / `English`) show their own script
  regardless of the active locale — they're marked `translatable="false"` in
  `strings.xml` on purpose.

## AI food-photo analysis

Photo-based food recognition is architected as a real integration seam, not
a placeholder:

- `ai/FoodRecognitionService` — the interface the rest of the app depends on.
- `ai/FoodAnalysisModels.kt` — request/result/error types
  (`FoodAnalysisRequest`, `FoodAnalysisResult`, `FoodAnalysisResponse`
  as a `Success`/`Error` sealed type).
- `ai/MockFoodRecognitionService` — the default implementation. It's wired
  up in `AppContainer` and used everywhere in the app today; it simulates a
  short analysis delay and returns one of several plausible foods (and
  deterministically simulates a "couldn't recognize this" failure for some
  inputs, so the error UI path is real and exercisable — not just a plan).
- `ai/AiConfig.kt` documents exactly how to swap in a real multimodal API
  later: read the key from a git-ignored `local.properties` entry, expose it
  via `buildConfigField`, implement `FoodRecognitionService` against the
  provider, and swap the instance created in `AppContainer`. **No API key is
  hardcoded anywhere in this repo.**

The Food screen uses the Android Photo Picker (`ActivityResultContracts.PickVisualMedia`)
so no storage permission is ever requested.

## Local data & offline behavior

Everything (profile, food entries, weight entries, language, onboarding
state) is stored on-device via Room + DataStore. The only feature that would
ever need network access is a *real* AI provider, which isn't wired up —
today the app is fully offline end to end.

## Testing

```
./gradlew :core:test
```

`:core` has 25 unit tests covering BMI, BMR, TDEE, the calorie-target
formula (including the safe-minimum floor), daily totals, weight-progress
percentage, and the monthly-summary aggregation — the exact calculations the
spec calls out. `app/src/test` adds a pure-logic test for the onboarding
step-validation rules.

**Why the split matters here:** this project was built in a sandboxed CI-like
environment whose network egress policy blocks `dl.google.com` (Google's
Android SDK/AndroidX Maven distribution host). That means no Android SDK
platform could be installed and no Android Gradle Plugin build could be
run in that environment — `:core:test` above is the one thing that could
actually be executed and verified there, which is exactly why the
core health-math is isolated into a plain Kotlin/JVM module.

## Build

On a machine or CI with normal access to `google()`/`dl.google.com` (any
regular dev machine, Android Studio, or standard CI):

```
./gradlew assembleDebug   # builds app/build/outputs/apk/debug/app-debug.apk
./gradlew test            # all unit tests, both modules
```

The Gradle wrapper (`./gradlew`) and `gradle/libs.versions.toml` version
catalog are already set up (AGP 8.7.3, Kotlin 2.0.21, Compose BOM
2024.12.01). Point `local.properties`' `sdk.dir` at your Android SDK, or set
`ANDROID_HOME`.

## Known limitations

- The full `:app` module (Compose UI, Room, Navigation, etc.) could not be
  compiled or run in this sandbox for the reason above — the code was
  written and manually reviewed carefully (correct API usage, no
  placeholder/TODO logic, all `R.string.*` references cross-checked against
  `strings.xml`), but it has not been verified by an actual Android build or
  on a device/emulator. Please run `./gradlew assembleDebug` and click
  through the app on your machine as the first step, and file/fix anything
  that surfaces — that step is expected, not optional.
- Food-photo "analysis" is a local mock (see AI section) — it does not call
  a real vision model.
- Date/number formatting is centralized in `util/Formatters.kt` but uses the
  Gregorian calendar for both locales; swapping in a Jalali calendar for
  Persian is a contained change to that one file.
