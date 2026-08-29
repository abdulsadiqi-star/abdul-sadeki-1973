package com.calorieme.app.ui.theme

import androidx.compose.ui.graphics.Brush

/** Reserved for hero cards, primary buttons, progress rings and charts only — not overused. */
object AppGradients {
    val HeroPurpleBlue = Brush.linearGradient(listOf(PurplePrimary, ElectricBlue))
    val PrimaryButton = Brush.linearGradient(listOf(SecondaryPurple, PurpleBright))
    val CyanBlue = Brush.linearGradient(listOf(ElectricBlue, SoftCyan))
    val ScreenBackground = Brush.verticalGradient(listOf(BackgroundMain, BackgroundSecondary))
    val CardSheen = Brush.linearGradient(listOf(ElevatedCard, CardBackground))
}
