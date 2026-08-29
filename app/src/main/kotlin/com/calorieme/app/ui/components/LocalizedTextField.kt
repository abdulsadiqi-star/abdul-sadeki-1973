package com.calorieme.app.ui.components

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.calorieme.app.ui.theme.CardBorder
import com.calorieme.app.ui.theme.ElevatedCard
import com.calorieme.app.ui.theme.ErrorRed
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.TextMuted
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary

/** A dark, rounded text field styled to match the app's cards; works correctly under RTL. */
@Composable
fun LocalizedTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    isError: Boolean = false,
    supportingText: String? = null,
    singleLine: Boolean = true,
    trailingText: String? = null
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        label = { Text(label) },
        placeholder = if (placeholder != null) {
            { Text(placeholder, color = TextMuted) }
        } else null,
        trailingIcon = if (trailingText != null) {
            { Text(trailingText, color = TextSecondary) }
        } else null,
        supportingText = if (supportingText != null) {
            { Text(supportingText, color = if (isError) ErrorRed else TextSecondary) }
        } else null,
        isError = isError,
        singleLine = singleLine,
        shape = RoundedCornerShape(16.dp),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = keyboardType),
        textStyle = MaterialTheme.typography.bodyLarge,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = ElevatedCard,
            unfocusedContainerColor = ElevatedCard,
            disabledContainerColor = ElevatedCard,
            errorContainerColor = ElevatedCard,
            focusedBorderColor = PurplePrimary,
            unfocusedBorderColor = CardBorder,
            errorBorderColor = ErrorRed,
            focusedTextColor = TextPrimary,
            unfocusedTextColor = TextPrimary,
            focusedLabelColor = PurplePrimary,
            unfocusedLabelColor = TextSecondary,
            cursorColor = PurplePrimary
        )
    )
}
