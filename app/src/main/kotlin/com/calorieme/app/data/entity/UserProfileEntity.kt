package com.calorieme.app.data.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType

/** A single-row table: this app tracks exactly one local user profile. */
@Entity(tableName = "user_profile")
data class UserProfileEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val name: String,
    val age: Int,
    val gender: Gender,
    val heightCm: Double,
    val currentWeightKg: Double,
    val startingWeightKg: Double,
    val targetWeightKg: Double,
    val activityLevel: ActivityLevel,
    val goalType: GoalType,
    val dailyCalorieTarget: Int,
    val createdAt: Long,
    val updatedAt: Long
) {
    companion object {
        const val SINGLETON_ID = 1
    }
}
