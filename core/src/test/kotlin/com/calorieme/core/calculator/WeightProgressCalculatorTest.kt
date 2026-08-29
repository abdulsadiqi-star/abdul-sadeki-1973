package com.calorieme.core.calculator

import org.junit.Assert.assertEquals
import org.junit.Test

class WeightProgressCalculatorTest {

    @Test
    fun `progress halfway to a weight loss goal`() {
        val progress = WeightProgressCalculator.calculate(
            startingWeightKg = 90.0,
            currentWeightKg = 85.0,
            targetWeightKg = 80.0
        )
        assertEquals(-5.0, progress.totalChangeKg, 0.01)
        assertEquals(-5.0, progress.remainingToGoalKg, 0.01)
        assertEquals(50, progress.progressPercent)
    }

    @Test
    fun `progress clamps at 100 when goal exceeded`() {
        val progress = WeightProgressCalculator.calculate(
            startingWeightKg = 90.0,
            currentWeightKg = 78.0,
            targetWeightKg = 80.0
        )
        assertEquals(100, progress.progressPercent)
    }

    @Test
    fun `maintenance goal with equal start and target is fully complete`() {
        val progress = WeightProgressCalculator.calculate(
            startingWeightKg = 70.0,
            currentWeightKg = 70.0,
            targetWeightKg = 70.0
        )
        assertEquals(100, progress.progressPercent)
    }

    @Test
    fun `progress does not go negative before any change is made`() {
        val progress = WeightProgressCalculator.calculate(
            startingWeightKg = 90.0,
            currentWeightKg = 92.0,
            targetWeightKg = 80.0
        )
        assertEquals(0, progress.progressPercent)
    }
}
