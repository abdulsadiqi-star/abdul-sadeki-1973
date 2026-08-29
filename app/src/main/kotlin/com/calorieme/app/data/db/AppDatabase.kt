package com.calorieme.app.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.calorieme.app.data.dao.FoodEntryDao
import com.calorieme.app.data.dao.UserProfileDao
import com.calorieme.app.data.dao.WeightEntryDao
import com.calorieme.app.data.entity.FoodEntryEntity
import com.calorieme.app.data.entity.UserProfileEntity
import com.calorieme.app.data.entity.WeightEntryEntity

@Database(
    entities = [UserProfileEntity::class, FoodEntryEntity::class, WeightEntryEntity::class],
    version = 1,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun userProfileDao(): UserProfileDao
    abstract fun foodEntryDao(): FoodEntryDao
    abstract fun weightEntryDao(): WeightEntryDao

    companion object {
        const val DATABASE_NAME = "calorie_me.db"
    }
}
