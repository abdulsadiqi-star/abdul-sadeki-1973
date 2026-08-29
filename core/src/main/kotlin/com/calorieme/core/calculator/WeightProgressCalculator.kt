package com.calorieme.core.calculator

import kotlin.math.abs

data class WeightProgress(
    val startingWeightKg: Double,
    val currentWeightKg: Double,
    val targetWeightKg: Double,
    val totalChangeKg: Double,
    val remainingToGoalKg: Double,
    /** 0..100, clamped. 100 when the target has been reached or passed. */
    val progressPercent: Int
)

object WeightProgressCalculator {

    fun calculate(
        startingWeightKg: Double,
        currentWeightKg: Double,
        targetWeightKg: Double
    ): WeightProgress {
        val totalChange = currentWeightKg - startingWeightKg
        val remaining = targetWeightKg - currentWeightKg
        val totalPlannedChange = targetWeightKg - startingWeightKg

        val progress = if (abs(totalPlannedChange) < 0.01) {
            100
        } else {
            (((currentWeightKg - startingWeightKg) / totalPlannedChange) * 100.0)
                .let { it.coerceIn(0.0, 100.0) }
                .let { Math.round(it).toInt() }
        }

        return WeightProgress(
            startingWeightKg = startingWeightKg,
            currentWeightKg = currentWeightKg,
            targetWeightKg = targetWeightKg,
            totalChangeKg = totalChange,
            remainingToGoalKg = remaining,
            progressPercent = progress
        )
    }
}
