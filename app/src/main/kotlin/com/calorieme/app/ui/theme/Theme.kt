package com.calorieme.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

/**
 * CalorieMe is an intentionally single, premium dark theme — it does not
 * follow the system light/dark setting, matching the wellness-app visual
 * direction the product is designed around.
 */
private val CalorieMeColorScheme = darkColorScheme(
    primary = PurplePrimary,
    onPrimary = TextPrimary,
    primaryContainer = ElevatedCard,
    onPrimaryContainer = TextPrimary,
    secondary = ElectricBlue,
    onSecondary = TextPrimary,
    secondaryContainer = CardBackground,
    onSecondaryContainer = TextPrimary,
    tertiary = SoftCyan,
    onTertiary = BackgroundMain,
    background = BackgroundMain,
    onBackground = TextPrimary,
    surface = CardBackground,
    onSurface = TextPrimary,
    surfaceVariant = ElevatedCard,
    onSurfaceVariant = TextSecondary,
    error = ErrorRed,
    onError = TextPrimary,
    outline = CardBorder,
    outlineVariant = DividerColor
)

@Composable
fun CalorieMeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CalorieMeColorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
