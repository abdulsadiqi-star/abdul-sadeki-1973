package com.calorieme.core.calculator

import com.calorieme.core.model.Gender

/**
 * Mifflin-St Jeor equation.
 */
object BmrCalculator {

    fun calculate(gender: Gender, weightKg: Double, heightCm: Double, age: Int): Double {
        if (weightKg <= 0.0 || heightCm <= 0.0 || age <= 0) return 0.0
        val base = 10.0 * weightKg + 6.25 * heightCm - 5.0 * age
        val bmr = when (gender) {
            Gender.MALE -> base + 5.0
            Gender.FEMALE -> base - 161.0
        }
        return bmr.coerceAtLeast(0.0)
    }
}
