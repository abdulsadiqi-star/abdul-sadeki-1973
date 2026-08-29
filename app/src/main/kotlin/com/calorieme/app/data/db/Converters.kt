package com.calorieme.app.data.db

import androidx.room.TypeConverter
import com.calorieme.app.domain.model.MealType
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType
import java.time.LocalDate
import java.time.LocalTime

class Converters {

    @TypeConverter
    fun fromEpochDay(value: Long?): LocalDate? = value?.let { LocalDate.ofEpochDay(it) }

    @TypeConverter
    fun toEpochDay(date: LocalDate?): Long? = date?.toEpochDay()

    @TypeConverter
    fun fromSecondOfDay(value: Int?): LocalTime? = value?.let { LocalTime.ofSecondOfDay(it.toLong()) }

    @TypeConverter
    fun toSecondOfDay(time: LocalTime?): Int? = time?.toSecondOfDay()

    @TypeConverter
    fun fromGender(value: String?): Gender? = value?.let { Gender.valueOf(it) }

    @TypeConverter
    fun toGender(gender: Gender?): String? = gender?.name

    @TypeConverter
    fun fromActivityLevel(value: String?): ActivityLevel? = value?.let { ActivityLevel.valueOf(it) }

    @TypeConverter
    fun toActivityLevel(level: ActivityLevel?): String? = level?.name

    @TypeConverter
    fun fromGoalType(value: String?): GoalType? = value?.let { GoalType.valueOf(it) }

    @TypeConverter
    fun toGoalType(goal: GoalType?): String? = goal?.name

    @TypeConverter
    fun fromMealType(value: String?): MealType? = value?.let { MealType.valueOf(it) }

    @TypeConverter
    fun toMealType(meal: MealType?): String? = meal?.name
}
