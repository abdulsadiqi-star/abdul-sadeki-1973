package com.calorieme.app.util

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.calorieme.app.R
import com.calorieme.app.domain.model.MealType
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.BmiCategory
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType

/** Maps pure domain/core enums to their localized display strings. */

@Composable
fun Gender.label(): String = stringResource(
    when (this) {
        Gender.MALE -> R.string.onboarding_gender_male
        Gender.FEMALE -> R.string.onboarding_gender_female
    }
)

@Composable
fun ActivityLevel.title(): String = stringResource(
    when (this) {
        ActivityLevel.SEDENTARY -> R.string.activity_sedentary_title
        ActivityLevel.LIGHTLY_ACTIVE -> R.string.activity_light_title
        ActivityLevel.MODERATELY_ACTIVE -> R.string.activity_moderate_title
        ActivityLevel.VERY_ACTIVE -> R.string.activity_very_title
        ActivityLevel.EXTREMELY_ACTIVE -> R.string.activity_extreme_title
    }
)

@Composable
fun ActivityLevel.description(): String = stringResource(
    when (this) {
        ActivityLevel.SEDENTARY -> R.string.activity_sedentary_desc
        ActivityLevel.LIGHTLY_ACTIVE -> R.string.activity_light_desc
        ActivityLevel.MODERATELY_ACTIVE -> R.string.activity_moderate_desc
        ActivityLevel.VERY_ACTIVE -> R.string.activity_very_desc
        ActivityLevel.EXTREMELY_ACTIVE -> R.string.activity_extreme_desc
    }
)

@Composable
fun GoalType.title(): String = stringResource(
    when (this) {
        GoalType.LOSE_WEIGHT -> R.string.goal_lose_title
        GoalType.MAINTAIN_WEIGHT -> R.string.goal_maintain_title
        GoalType.GAIN_WEIGHT -> R.string.goal_gain_title
    }
)

@Composable
fun GoalType.description(): String = stringResource(
    when (this) {
        GoalType.LOSE_WEIGHT -> R.string.goal_lose_desc
        GoalType.MAINTAIN_WEIGHT -> R.string.goal_maintain_desc
        GoalType.GAIN_WEIGHT -> R.string.goal_gain_desc
    }
)

@Composable
fun BmiCategory.label(): String = stringResource(
    when (this) {
        BmiCategory.UNDERWEIGHT -> R.string.bmi_underweight
        BmiCategory.NORMAL -> R.string.bmi_normal
        BmiCategory.OVERWEIGHT -> R.string.bmi_overweight
        BmiCategory.OBESE -> R.string.bmi_obese
    }
)

@Composable
fun MealType.label(): String = stringResource(
    when (this) {
        MealType.BREAKFAST -> R.string.meal_breakfast
        MealType.LUNCH -> R.string.meal_lunch
        MealType.DINNER -> R.string.meal_dinner
        MealType.SNACK -> R.string.meal_snack
    }
)
