package com.calorieme.core.calculator

data class DailyCalorieRecord(
    val consumedCalories: Int,
    val targetCalories: Int
)

data class MonthlyReport(
    val totalCaloriesConsumed: Int,
    val averageDailyCalories: Int,
    val startingWeightKg: Double?,
    val endingWeightKg: Double?,
    val totalWeightChangeKg: Double?,
    val loggedDaysCount: Int,
    val daysOnTargetCount: Int
)

object MonthlySummaryCalculator {

    /** A day counts as "on target" when consumption is within this tolerance of its target. */
    private const val ON_TARGET_TOLERANCE_CALORIES = 150

    fun calculate(
        dailyRecords: List<DailyCalorieRecord>,
        startingWeightKg: Double?,
        endingWeightKg: Double?
    ): MonthlyReport {
        val loggedDays = dailyRecords.filter { it.consumedCalories > 0 }
        val total = loggedDays.sumOf { it.consumedCalories }
        val average = if (loggedDays.isNotEmpty()) total / loggedDays.size else 0
        val onTarget = loggedDays.count {
            kotlin.math.abs(it.consumedCalories - it.targetCalories) <= ON_TARGET_TOLERANCE_CALORIES
        }
        val weightChange = if (startingWeightKg != null && endingWeightKg != null) {
            endingWeightKg - startingWeightKg
        } else {
            null
        }
        return MonthlyReport(
            totalCaloriesConsumed = total,
            averageDailyCalories = average,
            startingWeightKg = startingWeightKg,
            endingWeightKg = endingWeightKg,
            totalWeightChangeKg = weightChange,
            loggedDaysCount = loggedDays.size,
            daysOnTargetCount = onTarget
        )
    }
}
