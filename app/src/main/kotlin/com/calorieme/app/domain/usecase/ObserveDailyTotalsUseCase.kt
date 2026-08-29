package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.FoodRepository
import com.calorieme.core.calculator.DailyTotals
import com.calorieme.core.calculator.DailyTotalsCalculator
import com.calorieme.core.calculator.MacroAmounts
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.LocalDate

class ObserveDailyTotalsUseCase(private val foodRepository: FoodRepository) {

    operator fun invoke(date: LocalDate, targetCalories: Int): Flow<DailyTotals> =
        foodRepository.observeEntriesForDate(date).map { entries ->
            val macros = entries.map {
                MacroAmounts(
                    calories = it.calories,
                    proteinGrams = it.proteinGrams,
                    carbsGrams = it.carbsGrams,
                    fatGrams = it.fatGrams
                )
            }
            DailyTotalsCalculator.calculate(macros, targetCalories)
        }
}
