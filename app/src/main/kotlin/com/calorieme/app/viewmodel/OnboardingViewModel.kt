package com.calorieme.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.calorieme.app.domain.usecase.CompleteOnboardingUseCase
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

const val ONBOARDING_STEP_COUNT = 8

data class OnboardingUiState(
    val step: Int = 1,
    val name: String = "",
    val age: String = "",
    val gender: Gender? = null,
    val heightCm: String = "",
    val currentWeightKg: String = "",
    val activityLevel: ActivityLevel? = null,
    val goalType: GoalType? = null,
    val targetWeightKg: String = "",
    val isSubmitting: Boolean = false,
    val isComplete: Boolean = false
) {
    val canGoToNextStep: Boolean
        get() = when (step) {
            1 -> name.isNotBlank()
            2 -> age.toIntOrNull()?.let { it in 10..100 } == true
            3 -> gender != null
            4 -> heightCm.toDoubleOrNull()?.let { it in 80.0..250.0 } == true
            5 -> currentWeightKg.toDoubleOrNull()?.let { it in 25.0..300.0 } == true
            6 -> activityLevel != null
            7 -> goalType != null
            8 -> goalType == GoalType.MAINTAIN_WEIGHT || targetWeightKg.toDoubleOrNull()?.let { it in 25.0..300.0 } == true
            else -> false
        }
}

class OnboardingViewModel(
    private val completeOnboardingUseCase: CompleteOnboardingUseCase
) : ViewModel() {

    private val _uiState = MutableStateFlow(OnboardingUiState())
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    fun updateName(value: String) = _uiState.update { it.copy(name = value) }
    fun updateAge(value: String) = _uiState.update { it.copy(age = value.filter { c -> c.isDigit() }) }
    fun updateGender(value: Gender) = _uiState.update { it.copy(gender = value) }
    fun updateHeight(value: String) = _uiState.update { it.copy(heightCm = value.filterDecimal()) }
    fun updateCurrentWeight(value: String) = _uiState.update { it.copy(currentWeightKg = value.filterDecimal()) }
    fun updateActivityLevel(value: ActivityLevel) = _uiState.update { it.copy(activityLevel = value) }
    fun updateGoalType(value: GoalType) = _uiState.update { it.copy(goalType = value) }
    fun updateTargetWeight(value: String) = _uiState.update { it.copy(targetWeightKg = value.filterDecimal()) }

    fun goToNextStep() {
        val current = _uiState.value
        if (!current.canGoToNextStep) return
        if (current.step >= ONBOARDING_STEP_COUNT) {
            submit()
        } else {
            _uiState.update { it.copy(step = it.step + 1) }
        }
    }

    fun goToPreviousStep() {
        _uiState.update { if (it.step > 1) it.copy(step = it.step - 1) else it }
    }

    private fun submit() {
        val state = _uiState.value
        val gender = state.gender ?: return
        val activityLevel = state.activityLevel ?: return
        val goalType = state.goalType ?: return
        val age = state.age.toIntOrNull() ?: return
        val height = state.heightCm.toDoubleOrNull() ?: return
        val weight = state.currentWeightKg.toDoubleOrNull() ?: return
        val targetWeight = state.targetWeightKg.toDoubleOrNull() ?: weight

        _uiState.update { it.copy(isSubmitting = true) }
        viewModelScope.launch {
            completeOnboardingUseCase(
                name = state.name,
                age = age,
                gender = gender,
                heightCm = height,
                currentWeightKg = weight,
                activityLevel = activityLevel,
                goalType = goalType,
                targetWeightKg = targetWeight
            )
            _uiState.update { it.copy(isSubmitting = false, isComplete = true) }
        }
    }

    private fun String.filterDecimal(): String = filterIndexed { index, c ->
        c.isDigit() || (c == '.' && !this.take(index).contains('.'))
    }
}
