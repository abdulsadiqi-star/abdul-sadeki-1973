package com.calorieme.app.data.repository

import com.calorieme.app.data.dao.UserProfileDao
import com.calorieme.app.data.entity.UserProfileEntity
import com.calorieme.app.domain.model.UserProfile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class UserProfileRepositoryImpl(private val dao: UserProfileDao) : UserProfileRepository {

    override fun observeProfile(): Flow<UserProfile?> = dao.observeProfile().map { it?.toDomain() }

    override suspend fun getProfile(): UserProfile? = dao.getProfile()?.toDomain()

    override suspend fun saveProfile(profile: UserProfile) {
        dao.upsert(profile.toEntity())
    }

    override suspend fun clear() {
        dao.clear()
    }

    private fun UserProfileEntity.toDomain() = UserProfile(
        name = name,
        age = age,
        gender = gender,
        heightCm = heightCm,
        currentWeightKg = currentWeightKg,
        startingWeightKg = startingWeightKg,
        targetWeightKg = targetWeightKg,
        activityLevel = activityLevel,
        goalType = goalType,
        dailyCalorieTarget = dailyCalorieTarget,
        createdAt = createdAt,
        updatedAt = updatedAt
    )

    private fun UserProfile.toEntity() = UserProfileEntity(
        name = name,
        age = age,
        gender = gender,
        heightCm = heightCm,
        currentWeightKg = currentWeightKg,
        startingWeightKg = startingWeightKg,
        targetWeightKg = targetWeightKg,
        activityLevel = activityLevel,
        goalType = goalType,
        dailyCalorieTarget = dailyCalorieTarget,
        createdAt = createdAt,
        updatedAt = updatedAt
    )
}
