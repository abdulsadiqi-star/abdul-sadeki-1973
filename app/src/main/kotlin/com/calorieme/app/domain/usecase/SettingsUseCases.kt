package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.FoodRepository
import com.calorieme.app.data.repository.SettingsRepository
import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.data.repository.WeightRepository
import com.calorieme.app.domain.model.AppLanguage

class ChangeLanguageUseCase(private val settingsRepository: SettingsRepository) {
    suspend operator fun invoke(language: AppLanguage) = settingsRepository.setLanguage(language)
}

/** "Clear Data": wipes food and weight history but keeps the profile and language. */
class ClearLoggedDataUseCase(
    private val foodRepository: FoodRepository,
    private val weightRepository: WeightRepository
) {
    suspend operator fun invoke() {
        foodRepository.clearAll()
        weightRepository.clearAll()
    }
}

/** "Reset App": wipes everything, including the profile, and restarts onboarding. */
class ResetAppUseCase(
    private val foodRepository: FoodRepository,
    private val weightRepository: WeightRepository,
    private val userProfileRepository: UserProfileRepository,
    private val settingsRepository: SettingsRepository
) {
    suspend operator fun invoke() {
        foodRepository.clearAll()
        weightRepository.clearAll()
        userProfileRepository.clear()
        settingsRepository.setOnboardingCompleted(false)
    }
}
