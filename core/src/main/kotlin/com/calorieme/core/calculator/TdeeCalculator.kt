package com.calorieme.core.calculator

import com.calorieme.core.model.ActivityLevel

object TdeeCalculator {

    fun calculate(bmr: Double, activityLevel: ActivityLevel): Double {
        if (bmr <= 0.0) return 0.0
        return bmr * activityLevel.multiplier
    }
}
