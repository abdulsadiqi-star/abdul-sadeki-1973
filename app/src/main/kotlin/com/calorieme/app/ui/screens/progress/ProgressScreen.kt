package com.calorieme.app.ui.screens.progress

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.calorieme.app.R
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.LocalAppLanguage
import com.calorieme.app.ui.components.AppCard
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.components.SectionTitle
import com.calorieme.app.ui.components.WeightMetricCard
import com.calorieme.app.ui.charts.CalorieBarChart
import com.calorieme.app.ui.charts.CalorieBarPoint
import com.calorieme.app.ui.charts.WeightLineChart
import com.calorieme.app.ui.charts.WeightPoint
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.TextMuted
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.util.Formatters
import com.calorieme.app.viewmodel.ProgressViewModel
import com.calorieme.app.viewmodel.WeightRangeFilter
import com.calorieme.app.viewmodel.factoryOf

@Composable
fun ProgressScreen(modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val language = LocalAppLanguage.current
    val viewModel: ProgressViewModel = viewModel(
        factory = factoryOf {
            ProgressViewModel(
                container.userProfileRepository,
                container.weightRepository,
                container.foodRepository,
                container.logWeightEntryUseCase,
                container.deleteWeightEntryUseCase
            )
        }
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showLogWeight by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = stringResource(id = R.string.progress_screen_title),
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary
            )
        }
        Spacer(modifier = Modifier.height(20.dp))

        val profile = state.profile
        if (profile != null) {
            SectionTitle(text = stringResource(id = R.string.progress_weight_summary_title))
            Spacer(modifier = Modifier.height(12.dp))

            val currentWeight = state.allWeightEntries.maxByOrNull { it.date }?.weightKg ?: profile.currentWeightKg
            val totalChange = currentWeight - profile.startingWeightKg

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                WeightMetricCard(
                    label = stringResource(id = R.string.progress_weight_starting),
                    valueText = "${Formatters.weight(profile.startingWeightKg, language)} ${stringResource(id = R.string.common_kg)}",
                    modifier = Modifier.weight(1f)
                )
                WeightMetricCard(
                    label = stringResource(id = R.string.progress_weight_current),
                    valueText = "${Formatters.weight(currentWeight, language)} ${stringResource(id = R.string.common_kg)}",
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(modifier = Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                WeightMetricCard(
                    label = stringResource(id = R.string.progress_weight_target),
                    valueText = "${Formatters.weight(profile.targetWeightKg, language)} ${stringResource(id = R.string.common_kg)}",
                    modifier = Modifier.weight(1f)
                )
                WeightMetricCard(
                    label = stringResource(id = R.string.progress_weight_total_change),
                    valueText = "${Formatters.signedWeightChange(totalChange, language)} ${stringResource(id = R.string.common_kg)}",
                    isPositiveHighlighted = totalChange <= 0,
                    modifier = Modifier.weight(1f)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
            PrimaryButton(text = stringResource(id = R.string.weight_log_title), onClick = { showLogWeight = true })
            Spacer(modifier = Modifier.height(28.dp))
        }

        SectionTitle(text = stringResource(id = R.string.progress_weight_chart_title))
        Spacer(modifier = Modifier.height(12.dp))
        RangeFilterRow(selected = state.rangeFilter, onSelect = viewModel::setRangeFilter)
        Spacer(modifier = Modifier.height(12.dp))
        AppCard(modifier = Modifier.fillMaxWidth()) {
            WeightLineChart(
                points = state.filteredWeightEntries.map { WeightPoint(it.date.toString(), it.weightKg) },
                emptyTitle = stringResource(id = R.string.progress_empty_title),
                emptySubtitle = stringResource(id = R.string.progress_empty_subtitle)
            )
        }
        Spacer(modifier = Modifier.height(28.dp))

        SectionTitle(text = stringResource(id = R.string.progress_calorie_chart_title))
        Spacer(modifier = Modifier.height(12.dp))
        AppCard(modifier = Modifier.fillMaxWidth()) {
            val target = profile?.dailyCalorieTarget ?: 0
            CalorieBarChart(
                points = state.calorieHistory.map { (date, calories) -> CalorieBarPoint(date.toString(), calories, target) },
                emptyTitle = stringResource(id = R.string.progress_empty_title),
                emptySubtitle = stringResource(id = R.string.progress_empty_subtitle)
            )
        }
        Spacer(modifier = Modifier.height(28.dp))

        SectionTitle(text = stringResource(id = R.string.progress_monthly_report_title))
        Spacer(modifier = Modifier.height(12.dp))
        MonthlyReportCard(state = state, language = language)
        Spacer(modifier = Modifier.height(32.dp))
    }

    if (showLogWeight) {
        LogWeightSheet(
            onDismiss = { showLogWeight = false },
            onSave = { weight, date ->
                viewModel.logWeight(weight, date)
                showLogWeight = false
            }
        )
    }
}

@Composable
private fun RangeFilterRow(selected: WeightRangeFilter, onSelect: (WeightRangeFilter) -> Unit) {
    val options = listOf(
        WeightRangeFilter.SEVEN_DAYS to R.string.progress_filter_7d,
        WeightRangeFilter.THIRTY_DAYS to R.string.progress_filter_30d,
        WeightRangeFilter.THREE_MONTHS to R.string.progress_filter_3m,
        WeightRangeFilter.ALL to R.string.progress_filter_all
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        options.forEach { (filter, stringRes) ->
            val isSelected = filter == selected
            AppCard(
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = { onSelect(filter) }),
                elevated = isSelected,
                contentPadding = PaddingValues(vertical = 10.dp)
            ) {
                Text(
                    text = stringResource(id = stringRes),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (isSelected) PurplePrimary else TextMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}
