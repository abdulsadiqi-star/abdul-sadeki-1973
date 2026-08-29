package com.calorieme.core.calculator

import com.calorieme.core.model.ActivityLevel
import org.junit.Assert.assertEquals
import org.junit.Test

class TdeeCalculatorTest {

    @Test
    fun `sedentary multiplier applied correctly`() {
        val tdee = TdeeCalculator.calculate(bmr = 1600.0, activityLevel = ActivityLevel.SEDENTARY)
        assertEquals(1920.0, tdee, 0.01)
    }

    @Test
    fun `extremely active multiplier applied correctly`() {
        val tdee = TdeeCalculator.calculate(bmr = 1600.0, activityLevel = ActivityLevel.EXTREMELY_ACTIVE)
        assertEquals(3040.0, tdee, 0.01)
    }

    @Test
    fun `zero bmr yields zero tdee`() {
        assertEquals(0.0, TdeeCalculator.calculate(bmr = 0.0, activityLevel = ActivityLevel.MODERATELY_ACTIVE), 0.0)
    }
}
