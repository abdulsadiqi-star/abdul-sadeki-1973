package com.calorieme.app.data.local

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "calorie_me_prefs")

/**
 * Lightweight app-level flags and settings. Structured entity data (profile,
 * food, weight) lives in Room; this is only for small, always-available
 * preferences that gate app flow (language, onboarding).
 */
class PreferencesManager(private val context: Context) {

    private object Keys {
        val LANGUAGE_CODE = stringPreferencesKey("language_code")
        val ONBOARDING_COMPLETED = booleanPreferencesKey("onboarding_completed")
    }

    /** Null until the user picks a language on first launch. */
    val languageCode: Flow<String?> = context.dataStore.data.map { it[Keys.LANGUAGE_CODE] }

    val onboardingCompleted: Flow<Boolean> = context.dataStore.data.map { it[Keys.ONBOARDING_COMPLETED] ?: false }

    suspend fun setLanguageCode(code: String) {
        context.dataStore.edit { it[Keys.LANGUAGE_CODE] = code }
    }

    suspend fun setOnboardingCompleted(completed: Boolean) {
        context.dataStore.edit { it[Keys.ONBOARDING_COMPLETED] = completed }
    }

    /** Used by "Reset App": wipes flow-gating flags but keeps nothing else here. */
    suspend fun clearAll() {
        context.dataStore.edit { it.clear() }
    }
}
