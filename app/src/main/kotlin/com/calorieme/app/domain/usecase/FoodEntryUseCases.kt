package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.FoodRepository
import com.calorieme.app.domain.model.FoodEntry

class AddFoodEntryUseCase(private val foodRepository: FoodRepository) {
    suspend operator fun invoke(entry: FoodEntry): Long = foodRepository.addEntry(entry)
}

class UpdateFoodEntryUseCase(private val foodRepository: FoodRepository) {
    suspend operator fun invoke(entry: FoodEntry) = foodRepository.updateEntry(entry)
}

class DeleteFoodEntryUseCase(private val foodRepository: FoodRepository) {
    suspend operator fun invoke(entry: FoodEntry) = foodRepository.deleteEntry(entry)
}
