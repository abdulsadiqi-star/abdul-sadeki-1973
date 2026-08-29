package com.calorieme.app.data.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.calorieme.app.domain.model.MealType
import java.time.LocalDate
import java.time.LocalTime

@Entity(tableName = "food_entries")
data class FoodEntryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val foodName: String,
    val mealType: MealType,
    val portion: String?,
    val calories: Int,
    val proteinGrams: Double,
    val carbsGrams: Double,
    val fatGrams: Double,
    val imageUri: String?,
    val entryDate: LocalDate,
    val entryTime: LocalTime,
    val createdAt: Long
)
