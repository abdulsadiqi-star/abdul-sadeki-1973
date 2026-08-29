package com.calorieme.app.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MonitorWeight
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.calorieme.app.R
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.components.AppCard
import com.calorieme.app.ui.components.LoadingState
import com.calorieme.app.ui.components.MacroProgressBar
import com.calorieme.app.ui.components.MetricCard
import com.calorieme.app.ui.components.ProgressRing
import com.calorieme.app.ui.components.SectionTitle
import com.calorieme.app.ui.theme.ElevatedCard
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.SuccessGreen
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.ui.theme.WarningAmber
import com.calorieme.app.util.label
import com.calorieme.app.viewmodel.HomeUiState
import com.calorieme.app.viewmodel.HomeViewModel
import com.calorieme.app.viewmodel.factoryOf

@Composable
fun HomeScreen(
    onLogFoodClick: () -> Unit,
    onLogWeightClick: () -> Unit,
    onProfileClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val container = LocalAppContainer.current
    val viewModel: HomeViewModel = viewModel(
        factory = factoryOf {
            HomeViewModel(
                container.userProfileRepository,
                container.observeDailyTotalsUseCase,
                container.observeWeightProgressUseCase,
                container.calculateBmiUseCase
            )
        }
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    if (state.isLoading) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingState() }
        return
    }

    val profile = state.profile ?: return

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
    ) {
        Spacer(modifier = Modifier.height(12.dp))
        HomeHeader(name = profile.name, onProfileClick = onProfileClick)
        Spacer(modifier = Modifier.height(24.dp))

        HeroCalorieCard(state = state)
        Spacer(modifier = Modifier.height(24.dp))

        SectionTitle(text = stringResource(id = R.string.home_macros_title))
        Spacer(modifier = Modifier.height(12.dp))
        MacrosCard(state = state)
        Spacer(modifier = Modifier.height(24.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            BmiMiniCard(state = state, modifier = Modifier.weight(1f))
            GoalMiniCard(state = state, modifier = Modifier.weight(1f))
        }
        Spacer(modifier = Modifier.height(24.dp))

        SectionTitle(text = stringResource(id = R.string.home_quick_actions_title))
        Spacer(modifier = Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            QuickActionCard(
                icon = Icons.Filled.Restaurant,
                label = stringResource(id = R.string.home_quick_action_log_food),
                onClick = onLogFoodClick,
                modifier = Modifier.weight(1f)
            )
            QuickActionCard(
                icon = Icons.Filled.MonitorWeight,
                label = stringResource(id = R.string.home_quick_action_log_weight),
                onClick = onLogWeightClick,
                modifier = Modifier.weight(1f)
            )
        }
        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun HomeHeader(name: String, onProfileClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(
                text = stringResource(id = R.string.home_greeting, name),
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary
            )
            Text(
                text = stringResource(id = R.string.home_greeting_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary
            )
        }
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(ElevatedCard)
                .clickable(onClick = onProfileClick),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Filled.Person,
                contentDescription = stringResource(id = R.string.nav_profile),
                tint = PurplePrimary,
                modifier = Modifier.size(22.dp)
            )
        }
    }
}

@Composable
private fun HeroCalorieCard(state: HomeUiState) {
    val totals = state.dailyTotals
    val consumed = totals?.consumedCalories ?: 0
    val target = totals?.targetCalories ?: (state.profile?.dailyCalorieTarget ?: 1)
    val remaining = totals?.remainingCalories ?: target
    val progress = if (target > 0) consumed.toFloat() / target.toFloat() else 0f

    AppCard(modifier = Modifier.fillMaxWidth(), elevated = true) {
        Text(
            text = stringResource(id = R.string.home_calories_title),
            style = MaterialTheme.typography.titleMedium,
            color = TextSecondary
        )
        Spacer(modifier = Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            ProgressRing(progress = progress, ringSize = 140.dp, strokeWidth = 12.dp) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(text = "$consumed", style = MaterialTheme.typography.headlineMedium, color = TextPrimary)
                    Text(text = stringResource(id = R.string.common_kcal), style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                }
            }
            Spacer(modifier = Modifier.width(20.dp))
            Column {
                Text(
                    text = stringResource(id = R.string.home_calories_of_target, "$consumed", "$target"),
                    style = MaterialTheme.typography.bodyLarge,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = if (remaining >= 0) {
                        stringResource(id = R.string.home_calories_remaining, "$remaining")
                    } else {
                        stringResource(id = R.string.home_calories_over, "${-remaining}")
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (remaining >= 0) SuccessGreen else WarningAmber
                )
            }
        }
    }
}

@Composable
private fun MacrosCard(state: HomeUiState) {
    val totals = state.dailyTotals
    val gramsUnit = stringResource(id = R.string.common_grams_short)
    AppCard(modifier = Modifier.fillMaxWidth()) {
        MacroProgressBar(
            label = stringResource(id = R.string.home_macro_protein),
            amountText = "${totals?.proteinGrams?.toInt() ?: 0} $gramsUnit",
            progress = ((totals?.proteinGrams ?: 0.0) / 150.0).toFloat()
        )
        Spacer(modifier = Modifier.height(16.dp))
        MacroProgressBar(
            label = stringResource(id = R.string.home_macro_carbs),
            amountText = "${totals?.carbsGrams?.toInt() ?: 0} $gramsUnit",
            progress = ((totals?.carbsGrams ?: 0.0) / 250.0).toFloat()
        )
        Spacer(modifier = Modifier.height(16.dp))
        MacroProgressBar(
            label = stringResource(id = R.string.home_macro_fat),
            amountText = "${totals?.fatGrams?.toInt() ?: 0} $gramsUnit",
            progress = ((totals?.fatGrams ?: 0.0) / 70.0).toFloat()
        )
    }
}

@Composable
private fun BmiMiniCard(state: HomeUiState, modifier: Modifier = Modifier) {
    val bmi = state.bmi
    MetricCard(
        title = stringResource(id = R.string.home_bmi_title),
        value = bmi?.value?.let { "%.1f".format(it) } ?: "--",
        unit = bmi?.category?.label(),
        modifier = modifier
    )
}

@Composable
private fun GoalMiniCard(state: HomeUiState, modifier: Modifier = Modifier) {
    val progress = state.weightProgress
    MetricCard(
        title = stringResource(id = R.string.home_goal_title),
        value = "${progress?.progressPercent ?: 0}%",
        modifier = modifier
    )
}

@Composable
private fun QuickActionCard(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    AppCard(
        modifier = modifier.clickable(onClick = onClick),
        elevated = true
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = PurplePrimary)
            Spacer(modifier = Modifier.height(8.dp))
            Text(text = label, style = MaterialTheme.typography.labelLarge, color = TextPrimary)
        }
    }
}
