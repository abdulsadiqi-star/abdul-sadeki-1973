package com.calorieme.app.ui.screens.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.calorieme.app.R
import com.calorieme.app.domain.model.AppLanguage
import com.calorieme.app.ui.components.LanguageCard
import com.calorieme.app.ui.theme.BackgroundSecondary
import com.calorieme.app.ui.theme.TextPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LanguageChoiceSheet(
    current: AppLanguage,
    onDismiss: () -> Unit,
    onSelect: (AppLanguage) -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState()
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = BackgroundSecondary) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
            Text(text = stringResource(id = R.string.profile_app_language), style = MaterialTheme.typography.titleLarge, color = TextPrimary)
            Spacer(modifier = Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                LanguageCard(
                    languageName = stringResource(id = R.string.language_persian_name),
                    directionLabel = stringResource(id = R.string.language_persian_direction),
                    selected = current == AppLanguage.PERSIAN,
                    onClick = { onSelect(AppLanguage.PERSIAN) },
                    modifier = Modifier.weight(1f)
                )
                LanguageCard(
                    languageName = stringResource(id = R.string.language_english_name),
                    directionLabel = stringResource(id = R.string.language_english_direction),
                    selected = current == AppLanguage.ENGLISH,
                    onClick = { onSelect(AppLanguage.ENGLISH) },
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
