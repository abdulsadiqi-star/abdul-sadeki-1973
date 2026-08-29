package com.calorieme.app.ui.screens.progress

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.calorieme.app.R
import com.calorieme.app.domain.model.AppLanguage
import com.calorieme.app.ui.components.AppCard
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.util.Formatters
import com.calorieme.app.viewmodel.ProgressUiState

@Composable
fun MonthlyReportCard(state: ProgressUiState, language: AppLanguage, modifier: Modifier = Modifier) {
    val report = state.monthlyReport

    AppCard(modifier = modifier.fillMaxWidth(), elevated = true) {
        if (report == null || report.loggedDaysCount == 0) {
            Text(
                text = stringResource(id = R.string.progress_report_summary_no_data),
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary
            )
            return@AppCard
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            ReportStat(
                label = stringResource(id = R.string.progress_report_total_calories),
                value = Formatters.number(report.totalCaloriesConsumed, language)
            )
            ReportStat(
                label = stringResource(id = R.string.progress_report_avg_calories),
                value = Formatters.number(report.averageDailyCalories, language)
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            ReportStat(
                label = stringResource(id = R.string.progress_report_start_weight),
                value = report.startingWeightKg?.let { "${Formatters.weight(it, language)} ${stringResource(id = R.string.common_kg)}" } ?: "--"
            )
            ReportStat(
                label = stringResource(id = R.string.progress_report_end_weight),
                value = report.endingWeightKg?.let { "${Formatters.weight(it, language)} ${stringResource(id = R.string.common_kg)}" } ?: "--"
            )
            ReportStat(
                label = stringResource(id = R.string.progress_report_weight_change),
                value = report.totalWeightChangeKg?.let { "${Formatters.signedWeightChange(it, language)} ${stringResource(id = R.string.common_kg)}" } ?: "--"
            )
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = stringResource(id = R.string.progress_report_logged_days, report.loggedDaysCount),
            style = MaterialTheme.typography.bodySmall,
            color = TextSecondary
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = summaryText(report.totalWeightChangeKg, language),
            style = MaterialTheme.typography.bodyMedium,
            color = TextPrimary
        )
    }
}

@Composable
private fun ReportStat(label: String, value: String) {
    Column {
        Text(text = value, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
    }
}

@Composable
private fun summaryText(weightChangeKg: Double?, language: AppLanguage): String {
    if (weightChangeKg == null) return stringResource(id = R.string.progress_report_summary_stable)
    val magnitude = Formatters.weight(kotlin.math.abs(weightChangeKg), language)
    return when {
        weightChangeKg < -0.2 -> stringResource(id = R.string.progress_report_summary_loss, magnitude)
        weightChangeKg > 0.2 -> stringResource(id = R.string.progress_report_summary_gain, magnitude)
        else -> stringResource(id = R.string.progress_report_summary_stable)
    }
}
