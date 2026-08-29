package com.calorieme.app.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import com.calorieme.app.data.entity.FoodEntryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface FoodEntryDao {

    @Insert
    suspend fun insert(entry: FoodEntryEntity): Long

    @Update
    suspend fun update(entry: FoodEntryEntity)

    @Delete
    suspend fun delete(entry: FoodEntryEntity)

    @Query("SELECT * FROM food_entries WHERE entryDate = :epochDay ORDER BY entryTime ASC")
    fun observeByDate(epochDay: Long): Flow<List<FoodEntryEntity>>

    @Query("SELECT * FROM food_entries WHERE entryDate BETWEEN :startEpochDay AND :endEpochDay ORDER BY entryDate ASC, entryTime ASC")
    fun observeRange(startEpochDay: Long, endEpochDay: Long): Flow<List<FoodEntryEntity>>

    @Query("SELECT * FROM food_entries WHERE entryDate BETWEEN :startEpochDay AND :endEpochDay ORDER BY entryDate ASC, entryTime ASC")
    suspend fun getRange(startEpochDay: Long, endEpochDay: Long): List<FoodEntryEntity>

    @Query("DELETE FROM food_entries")
    suspend fun clearAll()
}
