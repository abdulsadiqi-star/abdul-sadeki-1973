package com.calorieme.app.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import com.calorieme.app.data.entity.WeightEntryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface WeightEntryDao {

    @Insert
    suspend fun insert(entry: WeightEntryEntity): Long

    @Delete
    suspend fun delete(entry: WeightEntryEntity)

    @Query("SELECT * FROM weight_entries ORDER BY date ASC")
    fun observeAll(): Flow<List<WeightEntryEntity>>

    @Query("SELECT * FROM weight_entries ORDER BY date DESC LIMIT 1")
    suspend fun getLatest(): WeightEntryEntity?

    @Query("SELECT * FROM weight_entries WHERE date BETWEEN :startEpochDay AND :endEpochDay ORDER BY date ASC")
    suspend fun getRange(startEpochDay: Long, endEpochDay: Long): List<WeightEntryEntity>

    @Query("DELETE FROM weight_entries")
    suspend fun clearAll()
}
