package com.calorieme.app.data.repository

import com.calorieme.app.data.dao.WeightEntryDao
import com.calorieme.app.data.entity.WeightEntryEntity
import com.calorieme.app.domain.model.WeightEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.LocalDate

class WeightRepositoryImpl(private val dao: WeightEntryDao) : WeightRepository {

    override fun observeAll(): Flow<List<WeightEntry>> =
        dao.observeAll().map { list -> list.map { it.toDomain() } }

    override suspend fun getLatest(): WeightEntry? = dao.getLatest()?.toDomain()

    override suspend fun getRange(start: LocalDate, end: LocalDate): List<WeightEntry> =
        dao.getRange(start.toEpochDay(), end.toEpochDay()).map { it.toDomain() }

    override suspend fun addEntry(entry: WeightEntry): Long = dao.insert(entry.toEntity())

    override suspend fun deleteEntry(entry: WeightEntry) {
        dao.delete(entry.toEntity())
    }

    override suspend fun clearAll() {
        dao.clearAll()
    }

    private fun WeightEntryEntity.toDomain() = WeightEntry(
        id = id,
        weightKg = weightKg,
        date = date,
        createdAt = createdAt
    )

    private fun WeightEntry.toEntity() = WeightEntryEntity(
        id = id,
        weightKg = weightKg,
        date = date,
        createdAt = createdAt
    )
}
