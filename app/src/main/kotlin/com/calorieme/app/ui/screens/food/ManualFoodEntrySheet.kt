package com.calorieme.app.ui.screens.food

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.calorieme.app.domain.model.FoodEntry
import com.calorieme.app.domain.model.MealType
import com.calorieme.app.ui.components.LocalizedTextField
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.theme.BackgroundSecondary
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.util.label
import java.time.LocalDate
import java.time.LocalTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualFoodEntrySheet(
    existingEntry: FoodEntry?,
    onDismiss: () -> Unit,
    onSave: (FoodEntry) -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState()
) {
    var name by remember { mutableStateOf(existingEntry?.foodName ?: "") }
    var portion by remember { mutableStateOf(existingEntry?.portion ?: "") }
    var calories by remember { mutableStateOf(existingEntry?.calories?.toString() ?: "") }
    var protein by remember { mutableStateOf(existingEntry?.proteinGrams?.toString() ?: "") }
    var carbs by remember { mutableStateOf(existingEntry?.carbsGrams?.toString() ?: "") }
    var fat by remember { mutableStateOf(existingEntry?.fatGrams?.toString() ?: "") }
    var mealType by remember { mutableStateOf(existingEntry?.mealType ?: MealType.BREAKFAST) }

    val isValid = name.isNotBlank() && (calories.toIntOrNull() ?: -1) >= 0

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = BackgroundSecondary) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp)
        ) {
            Text(
                text = stringResource(id = R.string.food_manual_entry_title),
                style = MaterialTheme.typography.titleLarge,
                color = TextPrimary
            )
            Spacer(modifier = Modifier.height(16.dp))

            LocalizedTextField(
                value = name,
                onValueChange = { name = it },
                label = stringResource(id = R.string.food_name_label),
                placeholder = stringResource(id = R.string.food_name_placeholder),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(12.dp))

            LocalizedTextField(
                value = portion,
                onValueChange = { portion = it },
                label = stringResource(id = R.string.food_portion_label),
                placeholder = stringResource(id = R.string.food_portion_placeholder),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(12.dp))

            LocalizedTextField(
                value = calories,
                onValueChange = { calories = it.filter { c -> c.isDigit() } },
                label = stringResource(id = R.string.food_calories_label),
                keyboardType = KeyboardType.Number,
                trailingText = stringResource(id = R.string.common_kcal),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(12.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                LocalizedTextField(
                    value = protein,
                    onValueChange = { protein = it.filterDecimal() },
                    label = stringResource(id = R.string.food_protein_label),
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f)
                )
                LocalizedTextField(
                    value = carbs,
                    onValueChange = { carbs = it.filterDecimal() },
                    label = stringResource(id = R.string.food_carbs_label),
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f)
                )
                LocalizedTextField(
                    value = fat,
                    onValueChange = { fat = it.filterDecimal() },
                    label = stringResource(id = R.string.food_fat_label),
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(modifier = Modifier.height(16.dp))

            Text(text = stringResource(id = R.string.food_meal_type_label), style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            Spacer(modifier = Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                MealType.entries.forEach { meal ->
                    if (meal == mealType) {
                        com.calorieme.app.ui.components.PrimaryButton(
                            text = meal.label(),
                            onClick = { mealType = meal },
                            modifier = Modifier.weight(1f)
                        )
                    } else {
                        com.calorieme.app.ui.components.SecondaryButton(
                            text = meal.label(),
                            onClick = { mealType = meal },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(24.dp))

            PrimaryButton(
                text = stringResource(id = R.string.common_save),
                enabled = isValid,
                onClick = {
                    val entry = FoodEntry(
                        id = existingEntry?.id ?: 0L,
                        foodName = name.trim(),
                        mealType = mealType,
                        portion = portion.ifBlank { null },
                        calories = calories.toIntOrNull() ?: 0,
                        proteinGrams = protein.toDoubleOrNull() ?: 0.0,
                        carbsGrams = carbs.toDoubleOrNull() ?: 0.0,
                        fatGrams = fat.toDoubleOrNull() ?: 0.0,
                        imageUri = existingEntry?.imageUri,
                        entryDate = existingEntry?.entryDate ?: LocalDate.now(),
                        entryTime = existingEntry?.entryTime ?: LocalTime.now(),
                        createdAt = existingEntry?.createdAt ?: System.currentTimeMillis()
                    )
                    onSave(entry)
                }
            )
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

private fun String.filterDecimal(): String = filterIndexed { index, c ->
    c.isDigit() || (c == '.' && !this.take(index).contains('.'))
}
