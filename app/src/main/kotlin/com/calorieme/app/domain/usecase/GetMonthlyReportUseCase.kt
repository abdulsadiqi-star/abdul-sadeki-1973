package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.FoodRepository
import com.calorieme.app.data.repository.WeightRepository
import com.calorieme.app.domain.model.FoodEntry
import com.calorieme.app.domain.model.WeightEntry
import com.calorieme.core.calculator.DailyCalorieRecord
import com.calorieme.core.calculator.MonthlyReport
import com.calorieme.core.calculator.MonthlySummaryCalculator
import java.time.LocalDate
import java.time.YearMonth

class GetMonthlyReportUseCase(
    private val foodRepository: FoodRepository,
    private val weightRepository: WeightRepository
) {
    suspend operator fun invoke(month: YearMonth, dailyCalorieTarget: Int): MonthlyReport {
        val start = month.atDay(1)
        val end = month.atEndOfMonth()
        val foodEntries = foodRepository.getEntriesInRange(start, end)
        val weightEntries = weightRepository.getRange(start, end)
        return calculate(foodEntries, weightEntries, month, dailyCalorieTarget)
    }

    companion object {
        fun currentMonth(): YearMonth = YearMonth.from(LocalDate.now())

        /**
         * Pure aggregation over already-fetched entries — reusable by callers
         * (e.g. a reactive ViewModel combine chain) that already observe
         * food/weight entries as flows and don't want a second, non-reactive
         * fetch just to build this report.
         */
        fun calculate(
            foodEntries: List<FoodEntry>,
            weightEntries: List<WeightEntry>,
            month: YearMonth,
            dailyCalorieTarget: Int
        ): MonthlyReport {
            val start = month.atDay(1)
            val dailyRecords = (0 until month.lengthOfMonth()).map { offset ->
                val day = start.plusDays(offset.toLong())
                val consumed = foodEntries.filter { it.entryDate == day }.sumOf { it.calories }
                DailyCalorieRecord(consumedCalories = consumed, targetCalories = dailyCalorieTarget)
            }

            val sortedWeights = weightEntries.sortedBy { it.date }
            return MonthlySummaryCalculator.calculate(
                dailyRecords = dailyRecords,
                startingWeightKg = sortedWeights.firstOrNull()?.weightKg,
                endingWeightKg = sortedWeights.lastOrNull()?.weightKg
            )
        }
    }
}
