package com.calorieme.core.calculator

import com.calorieme.core.model.GoalType
import org.junit.Assert.assertEquals
import org.junit.Test

class CalorieTargetCalculatorTest {

    @Test
    fun `maintain goal returns tdee unchanged`() {
        assertEquals(2200, CalorieTargetCalculator.calculate(2200.0, GoalType.MAINTAIN_WEIGHT))
    }

    @Test
    fun `lose weight goal subtracts deficit`() {
        assertEquals(1800, CalorieTargetCalculator.calculate(2200.0, GoalType.LOSE_WEIGHT))
    }

    @Test
    fun `gain weight goal adds surplus`() {
        assertEquals(2500, CalorieTargetCalculator.calculate(2200.0, GoalType.GAIN_WEIGHT))
    }

    @Test
    fun `never recommends below the safe minimum`() {
        val target = CalorieTargetCalculator.calculate(1300.0, GoalType.LOSE_WEIGHT)
        assertEquals(1200, target)
    }
}
