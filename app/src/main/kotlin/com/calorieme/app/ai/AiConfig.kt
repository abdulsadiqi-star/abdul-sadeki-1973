package com.calorieme.app.ai

/**
 * Configuration seam for a real food-recognition API.
 *
 * This app ships with [MockFoodRecognitionService] and no network call is
 * ever made for food analysis. To wire up a real provider later:
 *
 * 1. Never hardcode the API key in source. Add it to the machine-local
 *    `local.properties` (already git-ignored) as e.g. `AI_API_KEY=...`,
 *    then expose it via `buildConfigField` in app/build.gradle.kts so it
 *    lands in `BuildConfig.AI_API_KEY` at build time.
 * 2. Implement [FoodRecognitionService] against the chosen provider
 *    (request/response mapping only — the rest of the app already speaks
 *    [FoodAnalysisRequest] / [FoodAnalysisResponse]).
 * 3. Swap the [FoodRecognitionService] instance created in AppContainer.
 */
object AiConfig {
    const val REAL_PROVIDER_CONFIGURED = false
}
