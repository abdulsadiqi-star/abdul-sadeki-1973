package com.calorieme.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.calorieme.app.data.repository.SettingsRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

sealed interface StartDestination {
    data object Loading : StartDestination
    data object NeedsLanguage : StartDestination
    data object NeedsOnboarding : StartDestination
    data object Ready : StartDestination
}

class AppStartViewModel(settingsRepository: SettingsRepository) : ViewModel() {

    val startDestination: StateFlow<StartDestination> = combine(
        settingsRepository.languageCode,
        settingsRepository.onboardingCompleted
    ) { languageCode, onboardingCompleted ->
        when {
            languageCode == null -> StartDestination.NeedsLanguage
            !onboardingCompleted -> StartDestination.NeedsOnboarding
            else -> StartDestination.Ready
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), StartDestination.Loading)
}
