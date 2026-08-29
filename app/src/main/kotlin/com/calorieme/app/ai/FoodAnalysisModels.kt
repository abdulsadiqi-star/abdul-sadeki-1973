package com.calorieme.app.ai

import android.net.Uri

data class FoodAnalysisRequest(val imageUri: Uri)

data class FoodAnalysisResult(
    val foodName: String,
    val portion: String,
    val calories: Int,
    val proteinGrams: Double,
    val carbsGrams: Double,
    val fatGrams: Double,
    /** 0..100. Shown to the user alongside the "these values are estimates" note. */
    val confidencePercent: Int
)

enum class FoodAnalysisError {
    NO_INTERNET,
    RECOGNITION_FAILED,
    UNKNOWN
}

sealed interface FoodAnalysisResponse {
    data class Success(val result: FoodAnalysisResult) : FoodAnalysisResponse
    data class Error(val error: FoodAnalysisError) : FoodAnalysisResponse
}
