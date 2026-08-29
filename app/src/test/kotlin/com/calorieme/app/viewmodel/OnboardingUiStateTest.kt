package com.calorieme.app.viewmodel

import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingUiStateTest {

    @Test
    fun `step 1 requires a non-blank name`() {
        assertFalse(OnboardingUiState(step = 1, name = "").canGoToNextStep)
        assertFalse(OnboardingUiState(step = 1, name = "   ").canGoToNextStep)
        assertTrue(OnboardingUiState(step = 1, name = "Ali").canGoToNextStep)
    }

    @Test
    fun `step 2 requires a plausible age`() {
        assertFalse(OnboardingUiState(step = 2, age = "5").canGoToNextStep)
        assertFalse(OnboardingUiState(step = 2, age = "150").canGoToNextStep)
        assertFalse(OnboardingUiState(step = 2, age = "").canGoToNextStep)
        assertTrue(OnboardingUiState(step = 2, age = "28").canGoToNextStep)
    }

    @Test
    fun `step 4 requires a plausible height`() {
        assertFalse(OnboardingUiState(step = 4, heightCm = "40").canGoToNextStep)
        assertTrue(OnboardingUiState(step = 4, heightCm = "175").canGoToNextStep)
    }

    @Test
    fun `step 8 target weight is optional when maintaining weight`() {
        val maintaining = OnboardingUiState(step = 8, goalType = GoalType.MAINTAIN_WEIGHT, targetWeightKg = "")
        assertTrue(maintaining.canGoToNextStep)

        val losing = OnboardingUiState(step = 8, goalType = GoalType.LOSE_WEIGHT, targetWeightKg = "")
        assertFalse(losing.canGoToNextStep)

        val losingWithTarget = OnboardingUiState(step = 8, goalType = GoalType.LOSE_WEIGHT, targetWeightKg = "70")
        assertTrue(losingWithTarget.canGoToNextStep)
    }

    @Test
    fun `steps requiring a selection are blocked until one is made`() {
        assertFalse(OnboardingUiState(step = 3, gender = null).canGoToNextStep)
        assertTrue(OnboardingUiState(step = 3, gender = Gender.FEMALE).canGoToNextStep)
        assertFalse(OnboardingUiState(step = 6, activityLevel = null).canGoToNextStep)
        assertTrue(OnboardingUiState(step = 6, activityLevel = ActivityLevel.LIGHTLY_ACTIVE).canGoToNextStep)
    }
}
