package com.calorieme.app.domain.model

import java.time.LocalDate

data class WeightEntry(
    val id: Long = 0L,
    val weightKg: Double,
    val date: LocalDate,
    val createdAt: Long
)
