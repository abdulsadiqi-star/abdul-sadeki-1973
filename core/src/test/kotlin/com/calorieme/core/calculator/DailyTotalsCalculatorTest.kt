package com.calorieme.core.calculator

import org.junit.Assert.assertEquals
import org.junit.Test

class DailyTotalsCalculatorTest {

    @Test
    fun `sums calories and macros across entries`() {
        val entries = listOf(
            MacroAmounts(calories = 400, proteinGrams = 20.0, carbsGrams = 40.0, fatGrams = 10.0),
            MacroAmounts(calories = 600, proteinGrams = 30.0, carbsGrams = 60.0, fatGrams = 20.0)
        )
        val totals = DailyTotalsCalculator.calculate(entries, targetCalories = 2000)

        assertEquals(1000, totals.consumedCalories)
        assertEquals(1000, totals.remainingCalories)
        assertEquals(50.0, totals.proteinGrams, 0.01)
        assertEquals(100.0, totals.carbsGrams, 0.01)
        assertEquals(30.0, totals.fatGrams, 0.01)
        assertEquals(2, totals.entryCount)
    }

    @Test
    fun `remaining calories can go negative when over target`() {
        val entries = listOf(MacroAmounts(calories = 2500, proteinGrams = 0.0, carbsGrams = 0.0, fatGrams = 0.0))
        val totals = DailyTotalsCalculator.calculate(entries, targetCalories = 2000)
        assertEquals(-500, totals.remainingCalories)
    }

    @Test
    fun `empty entries yields zero totals`() {
        val totals = DailyTotalsCalculator.calculate(emptyList(), targetCalories = 2000)
        assertEquals(0, totals.consumedCalories)
        assertEquals(2000, totals.remainingCalories)
        assertEquals(0, totals.entryCount)
    }
}
