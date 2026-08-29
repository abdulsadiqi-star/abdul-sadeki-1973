package com.calorieme.app.ui.components

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.calorieme.app.ui.theme.SuccessGreen
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.ui.theme.WarningAmber

/** A compact metric tile for weight-summary grids (starting/current/target/change). */
@Composable
fun WeightMetricCard(
    label: String,
    valueText: String,
    modifier: Modifier = Modifier,
    isPositiveHighlighted: Boolean? = null
) {
    val valueColor = when (isPositiveHighlighted) {
        true -> SuccessGreen
        false -> WarningAmber
        null -> TextPrimary
    }
    AppCard(modifier = modifier, elevated = true) {
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
        Spacer(modifier = Modifier.height(4.dp))
        Text(text = valueText, style = MaterialTheme.typography.titleLarge, color = valueColor)
    }
}
