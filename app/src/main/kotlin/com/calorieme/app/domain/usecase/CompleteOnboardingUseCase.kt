package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.SettingsRepository
import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.domain.model.UserProfile
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType

class CompleteOnboardingUseCase(
    private val userProfileRepository: UserProfileRepository,
    private val settingsRepository: SettingsRepository,
    private val computeProfileTargets: ComputeProfileTargetsUseCase = ComputeProfileTargetsUseCase()
) {
    suspend operator fun invoke(
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
        val now = System.currentTimeMillis()
        val resolvedTargetWeight = if (goalType == GoalType.MAINTAIN_WEIGHT) currentWeightKg else targetWeightKg

        val profile = UserProfile(
            name = name.trim(),
            age = age,
            gender = gender,
            heightCm = heightCm,
            currentWeightKg = currentWeightKg,
            startingWeightKg = currentWeightKg,
            targetWeightKg = resolvedTargetWeight,
            activityLevel = activityLevel,
            goalType = goalType,
            dailyCalorieTarget = targets.dailyCalorieTarget,
            createdAt = now,
            updatedAt = now
        )
        userProfileRepository.saveProfile(profile)
        settingsRepository.setOnboardingCompleted(true)
    }
}
