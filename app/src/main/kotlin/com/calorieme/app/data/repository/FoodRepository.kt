package com.calorieme.app.data.repository

import com.calorieme.app.domain.model.FoodEntry
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate

interface FoodRepository {
    fun observeEntriesForDate(date: LocalDate): Flow<List<FoodEntry>>
    fun observeEntriesInRange(start: LocalDate, end: LocalDate): Flow<List<FoodEntry>>
    suspend fun getEntriesInRange(start: LocalDate, end: LocalDate): List<FoodEntry>
    suspend fun addEntry(entry: FoodEntry): Long
    suspend fun updateEntry(entry: FoodEntry)
    suspend fun deleteEntry(entry: FoodEntry)
    suspend fun clearAll()
}
