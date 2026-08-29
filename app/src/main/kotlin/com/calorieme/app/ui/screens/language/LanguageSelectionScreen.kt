package com.calorieme.app.ui.screens.language

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.lifecycle.viewmodel.compose.viewModel
import com.calorieme.app.R
import com.calorieme.app.domain.model.AppLanguage
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.components.LanguageCard
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.viewmodel.LanguageSelectionViewModel
import com.calorieme.app.viewmodel.factoryOf

@Composable
fun LanguageSelectionScreen(modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val viewModel: LanguageSelectionViewModel = viewModel(
        factory = factoryOf { LanguageSelectionViewModel(container.changeLanguageUseCase) }
    )

    var selected by remember { mutableStateOf<AppLanguage?>(null) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = stringResource(id = R.string.language_select_title),
            style = MaterialTheme.typography.headlineMedium,
            color = TextPrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(id = R.string.language_select_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(40.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            LanguageCard(
                languageName = stringResource(id = R.string.language_persian_name),
                directionLabel = stringResource(id = R.string.language_persian_direction),
                selected = selected == AppLanguage.PERSIAN,
                onClick = { selected = AppLanguage.PERSIAN },
                modifier = Modifier.weight(1f)
            )
            LanguageCard(
                languageName = stringResource(id = R.string.language_english_name),
                directionLabel = stringResource(id = R.string.language_english_direction),
                selected = selected == AppLanguage.ENGLISH,
                onClick = { selected = AppLanguage.ENGLISH },
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(modifier = Modifier.height(40.dp))

        PrimaryButton(
            text = stringResource(id = R.string.language_continue),
            enabled = selected != null,
            onClick = { selected?.let { viewModel.selectLanguage(it) } }
        )
    }
}
