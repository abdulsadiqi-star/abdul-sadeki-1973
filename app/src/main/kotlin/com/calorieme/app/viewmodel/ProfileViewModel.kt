package com.calorieme.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.domain.model.AppLanguage
import com.calorieme.app.domain.model.UserProfile
import com.calorieme.app.domain.usecase.ChangeLanguageUseCase
import com.calorieme.app.domain.usecase.ClearLoggedDataUseCase
import com.calorieme.app.domain.usecase.ResetAppUseCase
import com.calorieme.app.domain.usecase.UpdateProfileUseCase
import com.calorieme.app.util.LocaleController
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ProfileViewModel(
    userProfileRepository: UserProfileRepository,
    private val updateProfileUseCase: UpdateProfileUseCase,
    private val changeLanguageUseCase: ChangeLanguageUseCase,
    private val clearLoggedDataUseCase: ClearLoggedDataUseCase,
    private val resetAppUseCase: ResetAppUseCase
) : ViewModel() {

    val profile: StateFlow<UserProfile?> = userProfileRepository.observeProfile()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    fun saveProfile(
        current: UserProfile,
        name: String,
        age: Int,
        gender: Gender,
        heightCm: Double,
        currentWeightKg: Double,
        activityLevel: ActivityLevel,
        goalType: GoalType,
        targetWeightKg: Double
    ) {
        viewModelScope.launch {
            updateProfileUseCase(
                current = current,
                name = name,
                age = age,
                gender = gender,
                heightCm = heightCm,
                currentWeightKg = currentWeightKg,
                activityLevel = activityLevel,
                goalType = goalType,
                targetWeightKg = targetWeightKg
            )
        }
    }

    fun changeLanguage(language: AppLanguage) {
        viewModelScope.launch {
            changeLanguageUseCase(language)
            LocaleController.applyLanguage(language)
        }
    }

    fun clearLoggedData() {
        viewModelScope.launch { clearLoggedDataUseCase() }
    }

    fun resetApp() {
        viewModelScope.launch { resetAppUseCase() }
    }
}
