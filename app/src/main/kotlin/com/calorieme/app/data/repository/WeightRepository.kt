package com.calorieme.app.data.repository

import com.calorieme.app.domain.model.WeightEntry
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate

interface WeightRepository {
    fun observeAll(): Flow<List<WeightEntry>>
    suspend fun getLatest(): WeightEntry?
    suspend fun getRange(start: LocalDate, end: LocalDate): List<WeightEntry>
    suspend fun addEntry(entry: WeightEntry): Long
    suspend fun deleteEntry(entry: WeightEntry)
    suspend fun clearAll()
}
