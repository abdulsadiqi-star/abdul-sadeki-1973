package com.calorieme.app.domain.usecase

import com.calorieme.core.calculator.BmiCalculator
import com.calorieme.core.calculator.BmiResult

class CalculateBmiUseCase {
    operator fun invoke(weightKg: Double, heightCm: Double): BmiResult =
        BmiCalculator.calculate(weightKg, heightCm)
}
