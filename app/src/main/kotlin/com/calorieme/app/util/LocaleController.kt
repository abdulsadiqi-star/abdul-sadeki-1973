package com.calorieme.app.util

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import com.calorieme.app.domain.model.AppLanguage

/**
 * Applies the app's chosen language at runtime via the per-app language API
 * (AppCompatDelegate.setApplicationLocales). This works without an
 * AppCompatActivity, persists automatically (backed by the platform on
 * API 33+, by AppCompat itself below that), and recreates activities to
 * apply the new locale/layout-direction immediately — so switching
 * language never touches or clears any stored user data.
 */
object LocaleController {

    fun applyLanguage(language: AppLanguage) {
        val locales = LocaleListCompat.forLanguageTags(language.code)
        AppCompatDelegate.setApplicationLocales(locales)
    }

    fun currentLanguageCode(): String? =
        AppCompatDelegate.getApplicationLocales().takeIf { !it.isEmpty }?.get(0)?.language
}
