package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.domain.model.UserProfile
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType

/**
 * Edits from the Profile screen recompute the calorie target whenever body
 * data, activity level or goal changes, since those all feed the estimate.
 */
class UpdateProfileUseCase(
    private val userProfileRepository: UserProfileRepository,
    private val computeProfileTargets: ComputeProfileTargetsUseCase = ComputeProfileTargetsUseCase()
) {
    suspend operator fun invoke(
        current: UserProfile,
        name: String,
        age: Int,
        gender: Gender,
        heightCm: Double,
        currentWeightKg: Double,
        activityLevel: ActivityLevel,
        goalType: GoalType,
        targetWeightKg: Double
    ) {
        val targets = computeProfileTargets(gender, age, heightCm, currentWeightKg, activityLevel, goalType)
        val resolvedTargetWeight = if (goalType == GoalType.MAINTAIN_WEIGHT) currentWeightKg else targetWeightKg

        val updated = current.copy(
            name = name.trim(),
            age = age,
            gender = gender,
            heightCm = heightCm,
            currentWeightKg = currentWeightKg,
            targetWeightKg = resolvedTargetWeight,
            activityLevel = activityLevel,
            goalType = goalType,
            dailyCalorieTarget = targets.dailyCalorieTarget,
            updatedAt = System.currentTimeMillis()
        )
        userProfileRepository.saveProfile(updated)
    }
}
