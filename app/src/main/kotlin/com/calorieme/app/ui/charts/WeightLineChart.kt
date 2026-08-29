package com.calorieme.app.ui.charts

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.calorieme.app.ui.components.EmptyState
import com.calorieme.app.ui.theme.SoftCyan
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.TextMuted

data class WeightPoint(val label: String, val weightKg: Double)

@Composable
fun WeightLineChart(
    points: List<WeightPoint>,
    modifier: Modifier = Modifier,
    emptyTitle: String = "",
    emptySubtitle: String = ""
) {
    if (points.size < 2) {
        Box(modifier = modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
            EmptyState(title = emptyTitle, subtitle = emptySubtitle)
        }
        return
    }

    val minWeight = points.minOf { it.weightKg }
    val maxWeight = points.maxOf { it.weightKg }
    val range = (maxWeight - minWeight).takeIf { it > 0.1 } ?: 1.0

    var animationTarget by remember { mutableFloatStateOf(0f) }
    val animatedFraction by animateFloatAsState(
        targetValue = animationTarget,
        animationSpec = tween(durationMillis = 900, easing = LinearEasing),
        label = "weightChart"
    )
    androidx.compose.runtime.LaunchedEffect(points) { animationTarget = 1f }

    Box(modifier = modifier.fillMaxWidth().height(200.dp)) {
        Canvas(modifier = Modifier.fillMaxWidth().height(200.dp)) {
            val stepX = size.width / (points.size - 1)
            fun yFor(weight: Double): Float {
                val ratio = (weight - minWeight) / range
                return size.height - (ratio * (size.height - 24f)).toFloat() - 12f
            }

            // Horizontal guide lines
            val guideY = listOf(0.2f, 0.5f, 0.8f)
            guideY.forEach { fraction ->
                drawLine(
                    color = TextMuted.copy(alpha = 0.12f),
                    start = Offset(0f, size.height * fraction),
                    end = Offset(size.width, size.height * fraction),
                    strokeWidth = 1f
                )
            }

            val fullPath = androidx.compose.ui.graphics.Path().apply {
                points.forEachIndexed { index, point ->
                    val x = index * stepX
                    val y = yFor(point.weightKg)
                    if (index == 0) moveTo(x, y) else lineTo(x, y)
                }
            }

            val measure = androidx.compose.ui.graphics.PathMeasure()
            measure.setPath(fullPath, false)
            val animatedPath = androidx.compose.ui.graphics.Path()
            measure.getSegment(0f, measure.length * animatedFraction, animatedPath, true)

            drawPath(
                path = animatedPath,
                brush = androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(PurplePrimary, SoftCyan)),
                style = Stroke(width = 4f, cap = StrokeCap.Round)
            )

            points.forEachIndexed { index, point ->
                if (index.toFloat() / (points.size - 1) <= animatedFraction) {
                    val x = index * stepX
                    val y = yFor(point.weightKg)
                    drawCircle(color = SoftCyan, radius = 5f, center = Offset(x, y))
                }
            }
        }
    }
}
