package com.calorieme.app.ui

import androidx.compose.runtime.staticCompositionLocalOf
import com.calorieme.app.domain.model.AppLanguage

/** The app's chosen display language, provided once near the navigation root. */
val LocalAppLanguage = staticCompositionLocalOf { AppLanguage.ENGLISH }
