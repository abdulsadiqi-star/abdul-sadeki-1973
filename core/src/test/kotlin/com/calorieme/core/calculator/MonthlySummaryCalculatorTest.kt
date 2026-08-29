package com.calorieme.core.calculator

import org.junit.Assert.assertEquals
import org.junit.Test

class MonthlySummaryCalculatorTest {

    @Test
    fun `aggregates totals averages and on-target days`() {
        val records = listOf(
            DailyCalorieRecord(consumedCalories = 2000, targetCalories = 2000),
            DailyCalorieRecord(consumedCalories = 1900, targetCalories = 2000),
            DailyCalorieRecord(consumedCalories = 2600, targetCalories = 2000),
            DailyCalorieRecord(consumedCalories = 0, targetCalories = 2000) // not logged
        )

        val report = MonthlySummaryCalculator.calculate(
            dailyRecords = records,
            startingWeightKg = 80.0,
            endingWeightKg = 78.3
        )

        assertEquals(6500, report.totalCaloriesConsumed)
        assertEquals(2166, report.averageDailyCalories)
        assertEquals(3, report.loggedDaysCount)
        assertEquals(2, report.daysOnTargetCount)
        assertEquals(-1.7, report.totalWeightChangeKg!!, 0.01)
    }

    @Test
    fun `missing weight data yields null change`() {
        val report = MonthlySummaryCalculator.calculate(
            dailyRecords = emptyList(),
            startingWeightKg = null,
            endingWeightKg = 70.0
        )
        assertEquals(null, report.totalWeightChangeKg)
        assertEquals(0, report.loggedDaysCount)
    }
}
