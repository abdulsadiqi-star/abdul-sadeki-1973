package com.calorieme.app.domain.model

import java.time.LocalDate
import java.time.LocalTime

data class FoodEntry(
    val id: Long = 0L,
    val foodName: String,
    val mealType: MealType,
    val portion: String?,
    val calories: Int,
    val proteinGrams: Double,
    val carbsGrams: Double,
    val fatGrams: Double,
    val imageUri: String?,
    val entryDate: LocalDate,
    val entryTime: LocalTime,
    val createdAt: Long
)
