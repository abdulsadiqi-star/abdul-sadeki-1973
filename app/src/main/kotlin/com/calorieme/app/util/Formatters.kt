package com.calorieme.app.util

import com.calorieme.app.domain.model.AppLanguage
import java.text.NumberFormat
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * Centralizes locale-aware display formatting so date/number presentation
 * can be improved in one place later (e.g. full Jalali calendar support)
 * without touching every screen.
 */
object Formatters {

    private fun localeFor(language: AppLanguage): Locale = when (language) {
        AppLanguage.PERSIAN -> Locale.forLanguageTag("fa-IR")
        AppLanguage.ENGLISH -> Locale.US
    }

    fun number(value: Int, language: AppLanguage): String =
        NumberFormat.getIntegerInstance(localeFor(language)).format(value)

    fun weight(valueKg: Double, language: AppLanguage): String {
        val rounded = Math.round(valueKg * 10.0) / 10.0
        return NumberFormat.getInstance(localeFor(language)).apply {
            minimumFractionDigits = if (rounded == rounded.toLong().toDouble()) 0 else 1
            maximumFractionDigits = 1
        }.format(rounded)
    }

    fun signedWeightChange(deltaKg: Double, language: AppLanguage): String {
        val magnitude = weight(kotlin.math.abs(deltaKg), language)
        return when {
            deltaKg > 0.05 -> "+$magnitude"
            deltaKg < -0.05 -> "-$magnitude"
            else -> magnitude
        }
    }

    fun mediumDate(date: LocalDate, language: AppLanguage): String {
        val locale = localeFor(language)
        val formatter = DateTimeFormatter.ofPattern("d MMMM yyyy", locale)
        return date.format(formatter)
    }

    fun shortDayLabel(date: LocalDate, language: AppLanguage): String {
        val locale = localeFor(language)
        return date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale) + " " + date.dayOfMonth
    }

    fun time(time: LocalTime, language: AppLanguage): String {
        val locale = localeFor(language)
        val formatter = DateTimeFormatter.ofPattern("h:mm a", locale)
        return time.format(formatter)
    }
}
