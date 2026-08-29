package com.calorieme.core.calculator

data class MacroAmounts(
    val calories: Int,
    val proteinGrams: Double,
    val carbsGrams: Double,
    val fatGrams: Double
)

data class DailyTotals(
    val consumedCalories: Int,
    val targetCalories: Int,
    val remainingCalories: Int,
    val proteinGrams: Double,
    val carbsGrams: Double,
    val fatGrams: Double,
    val entryCount: Int
)

object DailyTotalsCalculator {

    fun calculate(entries: List<MacroAmounts>, targetCalories: Int): DailyTotals {
        val consumed = entries.sumOf { it.calories }
        val protein = entries.sumOf { it.proteinGrams }
        val carbs = entries.sumOf { it.carbsGrams }
        val fat = entries.sumOf { it.fatGrams }
        return DailyTotals(
            consumedCalories = consumed,
            targetCalories = targetCalories,
            remainingCalories = targetCalories - consumed,
            proteinGrams = protein,
            carbsGrams = carbs,
            fatGrams = fat,
            entryCount = entries.size
        )
    }
}
