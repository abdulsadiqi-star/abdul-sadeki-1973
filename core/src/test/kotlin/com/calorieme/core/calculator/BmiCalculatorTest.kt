package com.calorieme.core.calculator

import com.calorieme.core.model.BmiCategory
import org.junit.Assert.assertEquals
import org.junit.Test

class BmiCalculatorTest {

    @Test
    fun `normal weight is categorized correctly`() {
        val result = BmiCalculator.calculate(weightKg = 70.0, heightCm = 175.0)
        assertEquals(22.9, result.value, 0.01)
        assertEquals(BmiCategory.NORMAL, result.category)
    }

    @Test
    fun `underweight is categorized correctly`() {
        val result = BmiCalculator.calculate(weightKg = 45.0, heightCm = 170.0)
        assertEquals(BmiCategory.UNDERWEIGHT, result.category)
    }

    @Test
    fun `overweight is categorized correctly`() {
        val result = BmiCalculator.calculate(weightKg = 80.0, heightCm = 170.0)
        assertEquals(BmiCategory.OVERWEIGHT, result.category)
    }

    @Test
    fun `obese is categorized correctly`() {
        val result = BmiCalculator.calculate(weightKg = 100.0, heightCm = 170.0)
        assertEquals(BmiCategory.OBESE, result.category)
    }

    @Test
    fun `zero height does not crash and returns zero`() {
        val result = BmiCalculator.calculate(weightKg = 70.0, heightCm = 0.0)
        assertEquals(0.0, result.value, 0.0)
    }

    @Test
    fun `boundary between normal and overweight is inclusive of 25`() {
        val result = BmiCalculator.calculate(weightKg = 25.0, heightCm = 100.0)
        assertEquals(25.0, result.value, 0.01)
        assertEquals(BmiCategory.OVERWEIGHT, result.category)
    }
}
