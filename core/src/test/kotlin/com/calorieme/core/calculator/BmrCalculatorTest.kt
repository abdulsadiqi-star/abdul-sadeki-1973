package com.calorieme.core.calculator

import com.calorieme.core.model.Gender
import org.junit.Assert.assertEquals
import org.junit.Test

class BmrCalculatorTest {

    @Test
    fun `male bmr matches Mifflin-St Jeor formula`() {
        // 10*70 + 6.25*175 - 5*30 + 5 = 700 + 1093.75 - 150 + 5 = 1648.75
        val bmr = BmrCalculator.calculate(Gender.MALE, weightKg = 70.0, heightCm = 175.0, age = 30)
        assertEquals(1648.75, bmr, 0.01)
    }

    @Test
    fun `female bmr matches Mifflin-St Jeor formula`() {
        // 10*60 + 6.25*165 - 5*28 - 161 = 600 + 1031.25 - 140 - 161 = 1330.25
        val bmr = BmrCalculator.calculate(Gender.FEMALE, weightKg = 60.0, heightCm = 165.0, age = 28)
        assertEquals(1330.25, bmr, 0.01)
    }

    @Test
    fun `invalid inputs return zero instead of throwing`() {
        assertEquals(0.0, BmrCalculator.calculate(Gender.MALE, weightKg = 0.0, heightCm = 175.0, age = 30), 0.0)
        assertEquals(0.0, BmrCalculator.calculate(Gender.MALE, weightKg = 70.0, heightCm = 175.0, age = 0), 0.0)
    }
}
