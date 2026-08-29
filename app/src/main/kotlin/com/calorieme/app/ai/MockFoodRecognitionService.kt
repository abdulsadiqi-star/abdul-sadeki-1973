package com.calorieme.app.ai

import kotlinx.coroutines.delay
import kotlin.math.abs

/**
 * Offline stand-in for a real multimodal food-recognition API. Returns a
 * plausible result after a short simulated analysis delay, and deterministically
 * simulates a "could not recognize this food" failure for a small fraction of
 * inputs so the error UI path is real and exercisable, not just theoretical.
 */
class MockFoodRecognitionService : FoodRecognitionService {

    override suspend fun analyzeFood(request: FoodAnalysisRequest): FoodAnalysisResponse {
        delay(ANALYSIS_DELAY_MS)

        val bucket = abs(request.imageUri.toString().hashCode()) % 10
        if (bucket == FAILURE_BUCKET) {
            return FoodAnalysisResponse.Error(FoodAnalysisError.RECOGNITION_FAILED)
        }

        val candidate = SAMPLE_FOODS[abs(request.imageUri.toString().hashCode()) % SAMPLE_FOODS.size]
        return FoodAnalysisResponse.Success(candidate)
    }

    private companion object {
        const val ANALYSIS_DELAY_MS = 1600L
        const val FAILURE_BUCKET = 0

        val SAMPLE_FOODS = listOf(
            FoodAnalysisResult("Grilled Chicken Salad", "1 bowl (~300 g)", 420, 38.0, 18.0, 20.0, 87),
            FoodAnalysisResult("Steamed Rice with Vegetables", "1 plate (~350 g)", 480, 12.0, 90.0, 6.0, 81),
            FoodAnalysisResult("Beef Kebab with Bread", "1 skewer + bread", 650, 42.0, 55.0, 28.0, 76),
            FoodAnalysisResult("Greek Yogurt with Berries", "1 cup (~250 g)", 220, 16.0, 28.0, 5.0, 90),
            FoodAnalysisResult("Lentil Soup", "1 bowl (~300 ml)", 310, 18.0, 42.0, 7.0, 84),
            FoodAnalysisResult("Salmon with Roasted Vegetables", "1 plate (~320 g)", 540, 40.0, 20.0, 30.0, 79),
            FoodAnalysisResult("Avocado Toast", "2 slices", 380, 10.0, 38.0, 20.0, 83),
            FoodAnalysisResult("Fruit Smoothie Bowl", "1 bowl (~400 ml)", 340, 8.0, 62.0, 8.0, 78)
        )
    }
}
