package com.calorieme.app.ui.screens.food

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.calorieme.app.R
import com.calorieme.app.ui.theme.BackgroundSecondary
import com.calorieme.app.ui.theme.ErrorRed
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary

@Composable
fun DeleteFoodConfirmDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BackgroundSecondary,
        titleContentColor = TextPrimary,
        textContentColor = TextSecondary,
        title = { Text(text = stringResource(id = R.string.food_delete_confirm_title)) },
        text = { Text(text = stringResource(id = R.string.food_delete_confirm_message)) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(text = stringResource(id = R.string.common_delete), color = ErrorRed)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(text = stringResource(id = R.string.common_cancel), color = TextSecondary)
            }
        }
    )
}
