package com.calorieme.app.domain.usecase

import com.calorieme.core.calculator.BmrCalculator
import com.calorieme.core.calculator.CalorieTargetCalculator
import com.calorieme.core.calculator.TdeeCalculator
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType

data class ProfileTargets(
    val bmr: Double,
    val tdee: Double,
    val dailyCalorieTarget: Int
)

/** Turns raw body/activity/goal inputs into the derived calorie targets, per the app's estimation model. */
class ComputeProfileTargetsUseCase {

    operator fun invoke(
        gender: Gender,
        age: Int,
        heightCm: Double,
        weightKg: Double,
        activityLevel: ActivityLevel,
        goalType: GoalType
    ): ProfileTargets {
        val bmr = BmrCalculator.calculate(gender, weightKg, heightCm, age)
        val tdee = TdeeCalculator.calculate(bmr, activityLevel)
        val target = CalorieTargetCalculator.calculate(tdee, goalType)
        return ProfileTargets(bmr = bmr, tdee = tdee, dailyCalorieTarget = target)
    }
}
