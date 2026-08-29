package com.calorieme.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.domain.model.UserProfile
import com.calorieme.app.domain.usecase.CalculateBmiUseCase
import com.calorieme.app.domain.usecase.ObserveDailyTotalsUseCase
import com.calorieme.app.domain.usecase.ObserveWeightProgressUseCase
import com.calorieme.core.calculator.BmiResult
import com.calorieme.core.calculator.DailyTotals
import com.calorieme.core.calculator.WeightProgress
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import java.time.LocalDate

data class HomeUiState(
    val isLoading: Boolean = true,
    val profile: UserProfile? = null,
    val dailyTotals: DailyTotals? = null,
    val bmi: BmiResult? = null,
    val weightProgress: WeightProgress? = null
)

class HomeViewModel(
    userProfileRepository: UserProfileRepository,
    observeDailyTotalsUseCase: ObserveDailyTotalsUseCase,
    observeWeightProgressUseCase: ObserveWeightProgressUseCase,
    private val calculateBmiUseCase: CalculateBmiUseCase
) : ViewModel() {

    val uiState: StateFlow<HomeUiState> = userProfileRepository.observeProfile()
        .flatMapLatest { profile ->
            if (profile == null) {
                flowOf(HomeUiState(isLoading = false, profile = null))
            } else {
                combine(
                    observeDailyTotalsUseCase(LocalDate.now(), profile.dailyCalorieTarget),
                    observeWeightProgressUseCase(profile)
                ) { totals, progress ->
                    HomeUiState(
                        isLoading = false,
                        profile = profile,
                        dailyTotals = totals,
                        bmi = calculateBmiUseCase(progress.currentWeightKg, profile.heightCm),
                        weightProgress = progress
                    )
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), HomeUiState())
}
