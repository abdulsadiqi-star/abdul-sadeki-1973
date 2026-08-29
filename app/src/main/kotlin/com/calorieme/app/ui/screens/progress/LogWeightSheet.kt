package com.calorieme.app.ui.screens.progress

import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.calorieme.app.R
import com.calorieme.app.ui.components.LocalizedTextField
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.theme.BackgroundSecondary
import com.calorieme.app.ui.theme.TextPrimary
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogWeightSheet(
    onDismiss: () -> Unit,
    onSave: (Double, LocalDate) -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState()
) {
    var weightText by remember { mutableStateOf("") }
    val isValid = weightText.toDoubleOrNull()?.let { it in 25.0..300.0 } == true

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = BackgroundSecondary) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
            Text(
                text = stringResource(id = R.string.weight_log_title),
                style = MaterialTheme.typography.titleLarge,
                color = TextPrimary
            )
            Spacer(modifier = Modifier.height(16.dp))
            LocalizedTextField(
                value = weightText,
                onValueChange = { weightText = it.filterIndexed { i, c -> c.isDigit() || (c == '.' && !weightText.take(i).contains('.')) } },
                label = stringResource(id = R.string.weight_log_label),
                keyboardType = KeyboardType.Decimal,
                trailingText = stringResource(id = R.string.common_kg),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(24.dp))
            PrimaryButton(
                text = stringResource(id = R.string.common_save),
                enabled = isValid,
                onClick = { weightText.toDoubleOrNull()?.let { onSave(it, LocalDate.now()) } }
            )
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
