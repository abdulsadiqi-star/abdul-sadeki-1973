package com.calorieme.app.ui.screens.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.calorieme.app.R
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.components.ActivityCard
import com.calorieme.app.ui.components.GoalCard
import com.calorieme.app.ui.components.LocalizedTextField
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.theme.AppGradients
import com.calorieme.app.ui.theme.TextMuted
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.util.description
import com.calorieme.app.util.label
import com.calorieme.app.util.title
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType
import com.calorieme.app.viewmodel.ONBOARDING_STEP_COUNT
import com.calorieme.app.viewmodel.OnboardingUiState
import com.calorieme.app.viewmodel.OnboardingViewModel
import com.calorieme.app.viewmodel.factoryOf

@Composable
fun OnboardingScreen(modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val viewModel: OnboardingViewModel = viewModel(
        factory = factoryOf { OnboardingViewModel(container.completeOnboardingUseCase) }
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (state.step > 1) {
                IconButton(onClick = viewModel::goToPreviousStep) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = stringResource(id = R.string.common_back),
                        tint = TextPrimary
                    )
                }
            } else {
                Spacer(modifier = Modifier.height(48.dp))
            }
        }

        Text(
            text = stringResource(id = R.string.common_step_of, state.step, ONBOARDING_STEP_COUNT),
            style = MaterialTheme.typography.labelLarge,
            color = TextSecondary,
            modifier = Modifier.padding(horizontal = 24.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        StepProgressBar(step = state.step, totalSteps = ONBOARDING_STEP_COUNT, modifier = Modifier.padding(horizontal = 24.dp))
        Spacer(modifier = Modifier.height(24.dp))

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
        ) {
            OnboardingStepContent(state = state, viewModel = viewModel)
        }

        Column(modifier = Modifier.padding(24.dp)) {
            PrimaryButton(
                text = if (state.step == ONBOARDING_STEP_COUNT) {
                    stringResource(id = R.string.onboarding_finish)
                } else {
                    stringResource(id = R.string.common_continue)
                },
                enabled = state.canGoToNextStep,
                loading = state.isSubmitting,
                onClick = viewModel::goToNextStep
            )
        }
    }
}

@Composable
private fun StepProgressBar(step: Int, totalSteps: Int, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(totalSteps) { index ->
            val filled = index < step
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(if (filled) AppGradients.PrimaryButton else androidx.compose.ui.graphics.SolidColor(TextMuted.copy(alpha = 0.2f)))
            )
        }
    }
}

@Composable
private fun OnboardingStepContent(state: OnboardingUiState, viewModel: OnboardingViewModel) {
    when (state.step) {
        1 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_name_question))
            LocalizedTextField(
                value = state.name,
                onValueChange = viewModel::updateName,
                label = stringResource(id = R.string.profile_field_name),
                placeholder = stringResource(id = R.string.onboarding_step_name_placeholder),
                modifier = Modifier.fillMaxWidth()
            )
        }
        2 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_age_question))
            LocalizedTextField(
                value = state.age,
                onValueChange = viewModel::updateAge,
                label = stringResource(id = R.string.profile_field_age),
                keyboardType = KeyboardType.Number,
                trailingText = stringResource(id = R.string.onboarding_step_age_unit),
                modifier = Modifier.fillMaxWidth()
            )
        }
        3 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_gender_question))
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Gender.entries.forEach { gender ->
                    ActivityCard(
                        title = gender.label(),
                        description = "",
                        selected = state.gender == gender,
                        onClick = { viewModel.updateGender(gender) }
                    )
                }
            }
        }
        4 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_height_question))
            LocalizedTextField(
                value = state.heightCm,
                onValueChange = viewModel::updateHeight,
                label = stringResource(id = R.string.profile_field_height),
                keyboardType = KeyboardType.Decimal,
                trailingText = stringResource(id = R.string.common_cm),
                modifier = Modifier.fillMaxWidth()
            )
        }
        5 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_weight_question))
            LocalizedTextField(
                value = state.currentWeightKg,
                onValueChange = viewModel::updateCurrentWeight,
                label = stringResource(id = R.string.profile_field_weight),
                keyboardType = KeyboardType.Decimal,
                trailingText = stringResource(id = R.string.common_kg),
                modifier = Modifier.fillMaxWidth()
            )
        }
        6 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_activity_question))
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ActivityLevel.entries.forEach { level ->
                    ActivityCard(
                        title = level.title(),
                        description = level.description(),
                        selected = state.activityLevel == level,
                        onClick = { viewModel.updateActivityLevel(level) }
                    )
                }
            }
        }
        7 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_goal_question))
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                GoalType.entries.forEach { goal ->
                    GoalCard(
                        title = goal.title(),
                        description = goal.description(),
                        selected = state.goalType == goal,
                        onClick = { viewModel.updateGoalType(goal) }
                    )
                }
            }
        }
        8 -> {
            QuestionTitle(stringResource(id = R.string.onboarding_step_target_weight_question))
            if (state.goalType == GoalType.MAINTAIN_WEIGHT) {
                Text(
                    text = stringResource(id = R.string.onboarding_target_weight_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary
                )
            } else {
                LocalizedTextField(
                    value = state.targetWeightKg,
                    onValueChange = viewModel::updateTargetWeight,
                    label = stringResource(id = R.string.profile_field_target_weight),
                    keyboardType = KeyboardType.Decimal,
                    trailingText = stringResource(id = R.string.common_kg),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
private fun QuestionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.headlineMedium,
        color = TextPrimary,
        modifier = Modifier.padding(bottom = 24.dp)
    )
}
