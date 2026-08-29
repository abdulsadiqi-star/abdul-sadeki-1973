package com.calorieme.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.calorieme.app.data.repository.FoodRepository
import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.data.repository.WeightRepository
import com.calorieme.app.domain.model.UserProfile
import com.calorieme.app.domain.model.WeightEntry
import com.calorieme.app.domain.usecase.DeleteWeightEntryUseCase
import com.calorieme.app.domain.usecase.GetMonthlyReportUseCase
import com.calorieme.app.domain.usecase.LogWeightEntryUseCase
import com.calorieme.core.calculator.MonthlyReport
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate

enum class WeightRangeFilter(val days: Long?) {
    SEVEN_DAYS(7),
    THIRTY_DAYS(30),
    THREE_MONTHS(90),
    ALL(null)
}

data class ProgressUiState(
    val isLoading: Boolean = true,
    val profile: UserProfile? = null,
    val allWeightEntries: List<WeightEntry> = emptyList(),
    val filteredWeightEntries: List<WeightEntry> = emptyList(),
    val calorieHistory: List<Pair<LocalDate, Int>> = emptyList(),
    val monthlyReport: MonthlyReport? = null,
    val rangeFilter: WeightRangeFilter = WeightRangeFilter.THIRTY_DAYS
)

class ProgressViewModel(
    private val userProfileRepository: UserProfileRepository,
    private val weightRepository: WeightRepository,
    private val foodRepository: FoodRepository,
    private val logWeightEntryUseCase: LogWeightEntryUseCase,
    private val deleteWeightEntryUseCase: DeleteWeightEntryUseCase
) : ViewModel() {

    private val rangeFilter = MutableStateFlow(WeightRangeFilter.THIRTY_DAYS)
    private val currentMonth = GetMonthlyReportUseCase.currentMonth()

    val uiState: StateFlow<ProgressUiState> = combine(
        userProfileRepository.observeProfile(),
        weightRepository.observeAll(),
        rangeFilter
    ) { profile, weightEntries, filter -> Triple(profile, weightEntries, filter) }
        .flatMapLatest { (profile, weightEntries, filter) ->
            val windowDays = filter.days ?: 90
            val windowEnd = LocalDate.now()
            val windowStart = windowEnd.minusDays(windowDays)
            val monthStart = currentMonth.atDay(1)
            val monthEnd = currentMonth.atEndOfMonth()

            combine(
                foodRepository.observeEntriesInRange(windowStart, windowEnd),
                foodRepository.observeEntriesInRange(monthStart, monthEnd)
            ) { windowFoodEntries, monthFoodEntries ->
                val calorieHistory = windowFoodEntries.groupBy { it.entryDate }
                    .mapValues { (_, entries) -> entries.sumOf { it.calories } }
                    .toSortedMap()
                    .map { it.key to it.value }

                val monthWeightEntries = weightEntries.filter {
                    !it.date.isBefore(monthStart) && !it.date.isAfter(monthEnd)
                }

                val monthlyReport = profile?.let {
                    GetMonthlyReportUseCase.calculate(
                        foodEntries = monthFoodEntries,
                        weightEntries = monthWeightEntries,
                        month = currentMonth,
                        dailyCalorieTarget = it.dailyCalorieTarget
                    )
                }

                ProgressUiState(
                    isLoading = false,
                    profile = profile,
                    allWeightEntries = weightEntries,
                    filteredWeightEntries = filterEntries(weightEntries, filter),
                    calorieHistory = calorieHistory,
                    monthlyReport = monthlyReport,
                    rangeFilter = filter
                )
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), ProgressUiState())

    fun setRangeFilter(filter: WeightRangeFilter) {
        rangeFilter.value = filter
    }

    fun logWeight(weightKg: Double, date: LocalDate = LocalDate.now()) {
        viewModelScope.launch { logWeightEntryUseCase(weightKg, date) }
    }

    fun deleteWeight(entry: WeightEntry) {
        viewModelScope.launch { deleteWeightEntryUseCase(entry) }
    }

    private fun filterEntries(entries: List<WeightEntry>, filter: WeightRangeFilter): List<WeightEntry> {
        val sorted = entries.sortedBy { it.date }
        val days = filter.days ?: return sorted
        val cutoff = LocalDate.now().minusDays(days)
        return sorted.filter { !it.date.isBefore(cutoff) }
    }
}
