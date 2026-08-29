package com.calorieme.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.calorieme.app.domain.model.AppLanguage
import com.calorieme.app.domain.usecase.ChangeLanguageUseCase
import com.calorieme.app.util.LocaleController
import kotlinx.coroutines.launch

class LanguageSelectionViewModel(
    private val changeLanguageUseCase: ChangeLanguageUseCase
) : ViewModel() {

    /**
     * Persists the choice, then applies it — which recreates activities to
     * pick up the new layout direction. Screen-level navigation isn't
     * needed after this: on recreation, AppStartViewModel reads the saved
     * language and routes to onboarding automatically.
     */
    fun selectLanguage(language: AppLanguage) {
        viewModelScope.launch {
            changeLanguageUseCase(language)
            LocaleController.applyLanguage(language)
        }
    }
}
