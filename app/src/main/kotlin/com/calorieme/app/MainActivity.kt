package com.calorieme.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.calorieme.app.domain.model.AppLanguage
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.LocalAppLanguage
import com.calorieme.app.ui.navigation.CalorieMeNavGraph
import com.calorieme.app.ui.theme.CalorieMeTheme
import kotlinx.coroutines.flow.map

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = (application as CalorieMeApplication).container

        setContent {
            val language by container.settingsRepository.languageCode
                .map { AppLanguage.fromCode(it) ?: AppLanguage.ENGLISH }
                .collectAsStateWithLifecycle(initialValue = AppLanguage.ENGLISH)

            CalorieMeTheme {
                CompositionLocalProvider(
                    LocalAppContainer provides container,
                    LocalAppLanguage provides language
                ) {
                    CalorieMeNavGraph()
                }
            }
        }
    }
}
