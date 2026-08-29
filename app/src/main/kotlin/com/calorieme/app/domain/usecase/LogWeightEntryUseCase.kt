package com.calorieme.app.domain.usecase

import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.data.repository.WeightRepository
import com.calorieme.app.domain.model.WeightEntry
import java.time.LocalDate

/**
 * Logging a weight entry also refreshes the profile's current weight when
 * the new entry is the most recent one on record, so the dashboard and BMI
 * card immediately reflect it.
 */
class LogWeightEntryUseCase(
    private val weightRepository: WeightRepository,
    private val userProfileRepository: UserProfileRepository
) {
    suspend operator fun invoke(weightKg: Double, date: LocalDate) {
        weightRepository.addEntry(
            WeightEntry(weightKg = weightKg, date = date, createdAt = System.currentTimeMillis())
        )

        val latest = weightRepository.getLatest()
        if (latest != null && !date.isBefore(latest.date)) {
            val profile = userProfileRepository.getProfile()
            if (profile != null) {
                userProfileRepository.saveProfile(
                    profile.copy(currentWeightKg = weightKg, updatedAt = System.currentTimeMillis())
                )
            }
        }
    }
}

class DeleteWeightEntryUseCase(private val weightRepository: WeightRepository) {
    suspend operator fun invoke(entry: WeightEntry) = weightRepository.deleteEntry(entry)
}
