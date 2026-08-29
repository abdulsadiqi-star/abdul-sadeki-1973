package com.calorieme.app.ui.screens.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import com.calorieme.app.domain.model.UserProfile
import com.calorieme.app.ui.components.ActivityCard
import com.calorieme.app.ui.components.GoalCard
import com.calorieme.app.ui.components.LocalizedTextField
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.theme.BackgroundSecondary
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.util.description
import com.calorieme.app.util.label
import com.calorieme.app.util.title
import com.calorieme.core.model.ActivityLevel
import com.calorieme.core.model.Gender
import com.calorieme.core.model.GoalType

data class ProfileEditResult(
    val name: String,
    val age: Int,
    val gender: Gender,
    val heightCm: Double,
    val currentWeightKg: Double,
    val activityLevel: ActivityLevel,
    val goalType: GoalType,
    val targetWeightKg: Double
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditProfileSheet(
    profile: UserProfile,
    onDismiss: () -> Unit,
    onSave: (ProfileEditResult) -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState()
) {
    var name by remember { mutableStateOf(profile.name) }
    var age by remember { mutableStateOf(profile.age.toString()) }
    var gender by remember { mutableStateOf(profile.gender) }
    var height by remember { mutableStateOf(profile.heightCm.toString()) }
    var weight by remember { mutableStateOf(profile.currentWeightKg.toString()) }
    var activityLevel by remember { mutableStateOf(profile.activityLevel) }
    var goalType by remember { mutableStateOf(profile.goalType) }
    var targetWeight by remember { mutableStateOf(profile.targetWeightKg.toString()) }

    val isValid = name.isNotBlank() &&
        (age.toIntOrNull() ?: -1) in 10..100 &&
        (height.toDoubleOrNull() ?: -1.0) in 80.0..250.0 &&
        (weight.toDoubleOrNull() ?: -1.0) in 25.0..300.0 &&
        (goalType == GoalType.MAINTAIN_WEIGHT || (targetWeight.toDoubleOrNull() ?: -1.0) in 25.0..300.0)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = BackgroundSecondary) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp)
        ) {
            Text(text = stringResource(id = R.string.profile_edit_info), style = MaterialTheme.typography.titleLarge, color = TextPrimary)
            Spacer(modifier = Modifier.height(16.dp))

            LocalizedTextField(value = name, onValueChange = { name = it }, label = stringResource(id = R.string.profile_field_name), modifier = Modifier.fillMaxWidth())
            Spacer(modifier = Modifier.height(12.dp))
            LocalizedTextField(value = age, onValueChange = { age = it.filter { c -> c.isDigit() } }, label = stringResource(id = R.string.profile_field_age), keyboardType = KeyboardType.Number, modifier = Modifier.fillMaxWidth())
            Spacer(modifier = Modifier.height(12.dp))

            Text(text = stringResource(id = R.string.profile_field_gender), style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            Spacer(modifier = Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Gender.entries.forEach { g ->
                    ActivityCard(title = g.label(), description = "", selected = gender == g, onClick = { gender = g })
                }
            }
            Spacer(modifier = Modifier.height(12.dp))

            LocalizedTextField(value = height, onValueChange = { height = it.filterDecimal() }, label = stringResource(id = R.string.profile_field_height), keyboardType = KeyboardType.Decimal, trailingText = stringResource(id = R.string.common_cm), modifier = Modifier.fillMaxWidth())
            Spacer(modifier = Modifier.height(12.dp))
            LocalizedTextField(value = weight, onValueChange = { weight = it.filterDecimal() }, label = stringResource(id = R.string.profile_field_weight), keyboardType = KeyboardType.Decimal, trailingText = stringResource(id = R.string.common_kg), modifier = Modifier.fillMaxWidth())
            Spacer(modifier = Modifier.height(16.dp))

            Text(text = stringResource(id = R.string.profile_field_activity), style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            Spacer(modifier = Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ActivityLevel.entries.forEach { level ->
                    ActivityCard(title = level.title(), description = level.description(), selected = activityLevel == level, onClick = { activityLevel = level })
                }
            }
            Spacer(modifier = Modifier.height(16.dp))

            Text(text = stringResource(id = R.string.profile_field_goal), style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            Spacer(modifier = Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                GoalType.entries.forEach { goal ->
                    GoalCard(title = goal.title(), description = goal.description(), selected = goalType == goal, onClick = { goalType = goal })
                }
            }

            if (goalType != GoalType.MAINTAIN_WEIGHT) {
                Spacer(modifier = Modifier.height(12.dp))
                LocalizedTextField(
                    value = targetWeight,
                    onValueChange = { targetWeight = it.filterDecimal() },
                    label = stringResource(id = R.string.profile_field_target_weight),
                    keyboardType = KeyboardType.Decimal,
                    trailingText = stringResource(id = R.string.common_kg),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Spacer(modifier = Modifier.height(24.dp))
            PrimaryButton(
                text = stringResource(id = R.string.common_save),
                enabled = isValid,
                onClick = {
                    onSave(
                        ProfileEditResult(
                            name = name.trim(),
                            age = age.toInt(),
                            gender = gender,
                            heightCm = height.toDouble(),
                            currentWeightKg = weight.toDouble(),
                            activityLevel = activityLevel,
                            goalType = goalType,
                            targetWeightKg = targetWeight.toDoubleOrNull() ?: weight.toDouble()
                        )
                    )
                }
            )
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

private fun String.filterDecimal(): String = filterIndexed { index, c ->
    c.isDigit() || (c == '.' && !this.take(index).contains('.'))
}
