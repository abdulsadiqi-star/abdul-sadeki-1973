package com.calorieme.app.ui

import androidx.compose.runtime.staticCompositionLocalOf
import com.calorieme.app.AppContainer

val LocalAppContainer = staticCompositionLocalOf<AppContainer> {
    error("AppContainer not provided — wrap the app in CompositionLocalProvider(LocalAppContainer provides ...)")
}
