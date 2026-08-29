package com.calorieme.core.calculator

import com.calorieme.core.model.BmiCategory
import kotlin.math.roundToInt

data class BmiResult(
    val value: Double,
    val category: BmiCategory
)

object BmiCalculator {

    fun calculate(weightKg: Double, heightCm: Double): BmiResult {
        if (weightKg <= 0.0 || heightCm <= 0.0) {
            return BmiResult(value = 0.0, category = BmiCategory.NORMAL)
        }
        val heightM = heightCm / 100.0
        val rawBmi = weightKg / (heightM * heightM)
        val rounded = (rawBmi * 10.0).roundToInt() / 10.0
        return BmiResult(value = rounded, category = categoryOf(rounded))
    }

    private fun categoryOf(bmi: Double): BmiCategory = when {
        bmi < 18.5 -> BmiCategory.UNDERWEIGHT
        bmi < 25.0 -> BmiCategory.NORMAL
        bmi < 30.0 -> BmiCategory.OVERWEIGHT
        else -> BmiCategory.OBESE
    }
}
