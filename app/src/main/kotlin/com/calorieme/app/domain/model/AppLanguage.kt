package com.calorieme.app.domain.model

enum class AppLanguage(val code: String) {
    ENGLISH("en"),
    PERSIAN("fa");

    companion object {
        fun fromCode(code: String?): AppLanguage? = entries.find { it.code == code }
    }
}
