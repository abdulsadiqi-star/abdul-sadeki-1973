package com.calorieme.app.ui.charts

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.calorieme.app.ui.components.EmptyState
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.SoftCyan
import com.calorieme.app.ui.theme.TextMuted

data class CalorieBarPoint(val label: String, val consumedCalories: Int, val targetCalories: Int)

@Composable
fun CalorieBarChart(
    points: List<CalorieBarPoint>,
    modifier: Modifier = Modifier,
    emptyTitle: String = "",
    emptySubtitle: String = ""
) {
    if (points.isEmpty()) {
        Box(modifier = modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
            EmptyState(title = emptyTitle, subtitle = emptySubtitle)
        }
        return
    }

    val maxValue = (points.maxOf { maxOf(it.consumedCalories, it.targetCalories) }).coerceAtLeast(1)
    val averageTarget = points.map { it.targetCalories }.average().toFloat()

    var animationTarget by remember { mutableFloatStateOf(0f) }
    val animatedFraction by animateFloatAsState(
        targetValue = animationTarget,
        animationSpec = tween(durationMillis = 800, easing = LinearEasing),
        label = "calorieChart"
    )
    LaunchedEffect(points) { animationTarget = 1f }

    Canvas(modifier = modifier.fillMaxWidth().height(200.dp)) {
        val barCount = points.size
        val spacing = size.width * 0.02f
        val barWidth = (size.width - spacing * (barCount + 1)) / barCount
        val chartHeight = size.height - 8f

        // Target guide line
        val targetY = chartHeight - (averageTarget / maxValue) * chartHeight
        drawLine(
            color = TextMuted.copy(alpha = 0.5f),
            start = Offset(0f, targetY),
            end = Offset(size.width, targetY),
            strokeWidth = 2f,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))
        )

        points.forEachIndexed { index, point ->
            val barHeight = (point.consumedCalories.toFloat() / maxValue) * chartHeight * animatedFraction
            val x = spacing + index * (barWidth + spacing)
            val y = chartHeight - barHeight

            drawRoundRect(
                brush = Brush.verticalGradient(listOf(SoftCyan, PurplePrimary)),
                topLeft = Offset(x, y),
                size = Size(barWidth, barHeight),
                cornerRadius = CornerRadius(barWidth / 3, barWidth / 3)
            )
        }
    }
}
