package com.calorieme.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.components.AppScaffold
import com.calorieme.app.ui.screens.language.LanguageSelectionScreen
import com.calorieme.app.ui.screens.onboarding.OnboardingScreen
import com.calorieme.app.ui.screens.splash.SplashScreen
import com.calorieme.app.viewmodel.AppStartViewModel
import com.calorieme.app.viewmodel.StartDestination
import com.calorieme.app.viewmodel.factoryOf
import kotlinx.coroutines.delay

private const val MIN_SPLASH_DURATION_MS = 900L

@Composable
fun CalorieMeNavGraph(modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val navController = rememberNavController()

    val appStartViewModel: AppStartViewModel = viewModel(
        factory = factoryOf { AppStartViewModel(container.settingsRepository) }
    )
    val startDestination by appStartViewModel.startDestination.collectAsStateWithLifecycle()

    var minSplashElapsed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(MIN_SPLASH_DURATION_MS)
        minSplashElapsed = true
    }

    LaunchedEffect(startDestination, minSplashElapsed) {
        if (!minSplashElapsed) return@LaunchedEffect
        val target = when (startDestination) {
            StartDestination.Loading -> return@LaunchedEffect
            StartDestination.NeedsLanguage -> Routes.LANGUAGE_SELECTION
            StartDestination.NeedsOnboarding -> Routes.ONBOARDING
            StartDestination.Ready -> Routes.MAIN
        }
        if (navController.currentDestination?.route != target) {
            navController.navigate(target) {
                popUpTo(0) { inclusive = true }
                launchSingleTop = true
            }
        }
    }

    AppScaffold(modifier = modifier) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.SPLASH,
            modifier = Modifier.padding(padding)
        ) {
            composable(Routes.SPLASH) { SplashScreen() }
            composable(Routes.LANGUAGE_SELECTION) { LanguageSelectionScreen() }
            composable(Routes.ONBOARDING) { OnboardingScreen() }
            composable(Routes.MAIN) { MainScreen() }
        }
    }
}
