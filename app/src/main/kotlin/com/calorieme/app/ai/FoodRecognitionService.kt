package com.calorieme.app.ai

/**
 * Clean integration seam for food-photo recognition.
 *
 * [MockFoodRecognitionService] is wired up by default so the feature is fully
 * usable offline during development and review. To go live with a real
 * multimodal model (e.g. Gemini), implement this interface against that
 * API (see AiConfig for where the API key is read from) and swap the
 * binding in AppContainer — no other code in the app needs to change.
 */
interface FoodRecognitionService {
    suspend fun analyzeFood(request: FoodAnalysisRequest): FoodAnalysisResponse
}
