package com.calorieme.app.data.repository

import com.calorieme.app.data.local.PreferencesManager
import com.calorieme.app.domain.model.AppLanguage
import kotlinx.coroutines.flow.Flow

class SettingsRepositoryImpl(private val preferencesManager: PreferencesManager) : SettingsRepository {

    override val languageCode: Flow<String?> = preferencesManager.languageCode

    override val onboardingCompleted: Flow<Boolean> = preferencesManager.onboardingCompleted

    override suspend fun setLanguage(language: AppLanguage) {
        preferencesManager.setLanguageCode(language.code)
    }

    override suspend fun setOnboardingCompleted(completed: Boolean) {
        preferencesManager.setOnboardingCompleted(completed)
    }

    override suspend fun clearFlags() {
        preferencesManager.clearAll()
    }
}
