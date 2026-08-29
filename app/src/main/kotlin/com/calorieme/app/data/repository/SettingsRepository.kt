package com.calorieme.app.data.repository

import com.calorieme.app.domain.model.AppLanguage
import kotlinx.coroutines.flow.Flow

interface SettingsRepository {
    val languageCode: Flow<String?>
    val onboardingCompleted: Flow<Boolean>
    suspend fun setLanguage(language: AppLanguage)
    suspend fun setOnboardingCompleted(completed: Boolean)
    suspend fun clearFlags()
}
