package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.WeightRepository
import com.calorieme.app.domain.model.UserProfile
import com.calorieme.core.calculator.WeightProgress
import com.calorieme.core.calculator.WeightProgressCalculator
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class ObserveWeightProgressUseCase(private val weightRepository: WeightRepository) {

    operator fun invoke(profile: UserProfile): Flow<WeightProgress> =
        weightRepository.observeAll().map { entries ->
            val latest = entries.maxByOrNull { it.date }?.weightKg ?: profile.currentWeightKg
            WeightProgressCalculator.calculate(
                startingWeightKg = profile.startingWeightKg,
                currentWeightKg = latest,
                targetWeightKg = profile.targetWeightKg
            )
        }
}
