package com.calorieme.app.domain.model

import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType

data class UserProfile(
    val name: String,
    val age: Int,
    val gender: Gender,
    val heightCm: Double,
    val currentWeightKg: Double,
    val startingWeightKg: Double,
    val targetWeightKg: Double,
    val activityLevel: ActivityLevel,
    val goalType: GoalType,
    val dailyCalorieTarget: Int,
    val createdAt: Long,
    val updatedAt: Long
) {
    companion object {
        fun empty(): UserProfile = UserProfile(
            name = "",
            age = 0,
            gender = Gender.MALE,
            heightCm = 0.0,
            currentWeightKg = 0.0,
            startingWeightKg = 0.0,
            targetWeightKg = 0.0,
            activityLevel = ActivityLevel.SEDENTARY,
            goalType = GoalType.MAINTAIN_WEIGHT,
            dailyCalorieTarget = 0,
            createdAt = 0L,
            updatedAt = 0L
        )
    }
}
