package com.calorieme.app.data.repository

import com.calorieme.app.data.dao.FoodEntryDao
import com.calorieme.app.data.entity.FoodEntryEntity
import com.calorieme.app.domain.model.FoodEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.LocalDate

class FoodRepositoryImpl(private val dao: FoodEntryDao) : FoodRepository {

    override fun observeEntriesForDate(date: LocalDate): Flow<List<FoodEntry>> =
        dao.observeByDate(date.toEpochDay()).map { list -> list.map { it.toDomain() } }

    override fun observeEntriesInRange(start: LocalDate, end: LocalDate): Flow<List<FoodEntry>> =
        dao.observeRange(start.toEpochDay(), end.toEpochDay()).map { list -> list.map { it.toDomain() } }

    override suspend fun getEntriesInRange(start: LocalDate, end: LocalDate): List<FoodEntry> =
        dao.getRange(start.toEpochDay(), end.toEpochDay()).map { it.toDomain() }

    override suspend fun addEntry(entry: FoodEntry): Long = dao.insert(entry.toEntity())

    override suspend fun updateEntry(entry: FoodEntry) {
        dao.update(entry.toEntity())
    }

    override suspend fun deleteEntry(entry: FoodEntry) {
        dao.delete(entry.toEntity())
    }

    override suspend fun clearAll() {
        dao.clearAll()
    }

    private fun FoodEntryEntity.toDomain() = FoodEntry(
        id = id,
        foodName = foodName,
        mealType = mealType,
        portion = portion,
        calories = calories,
        proteinGrams = proteinGrams,
        carbsGrams = carbsGrams,
        fatGrams = fatGrams,
        imageUri = imageUri,
        entryDate = entryDate,
        entryTime = entryTime,
        createdAt = createdAt
    )

    private fun FoodEntry.toEntity() = FoodEntryEntity(
        id = id,
        foodName = foodName,
        mealType = mealType,
        portion = portion,
        calories = calories,
        proteinGrams = proteinGrams,
        carbsGrams = carbsGrams,
        fatGrams = fatGrams,
        imageUri = imageUri,
        entryDate = entryDate,
        entryTime = entryTime,
        createdAt = createdAt
    )
}
