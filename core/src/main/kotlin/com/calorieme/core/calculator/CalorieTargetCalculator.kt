package com.calorieme.core.calculator

import com.calorieme.core.model.GoalType
import kotlin.math.roundToInt

object CalorieTargetCalculator {

    private const val LOSE_DEFICIT = 400.0
    private const val GAIN_SURPLUS = 300.0

    /** Never recommend fewer than this many calories per day, regardless of goal. */
    private const val SAFE_MINIMUM_CALORIES = 1200.0

    fun calculate(tdee: Double, goalType: GoalType): Int {
        if (tdee <= 0.0) return 0
        val target = when (goalType) {
            GoalType.LOSE_WEIGHT -> tdee - LOSE_DEFICIT
            GoalType.MAINTAIN_WEIGHT -> tdee
            GoalType.GAIN_WEIGHT -> tdee + GAIN_SURPLUS
        }
        return target.coerceAtLeast(SAFE_MINIMUM_CALORIES).roundToInt()
    }
}
