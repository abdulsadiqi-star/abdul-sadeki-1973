package com.calorieme.app.ui.screens.food

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.calorieme.app.R
import com.calorieme.app.ai.FoodAnalysisError
import com.calorieme.app.ai.FoodAnalysisResult
import com.calorieme.app.domain.model.FoodEntry
import com.calorieme.app.domain.model.MealType
import com.calorieme.app.ui.components.LoadingState
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.components.SecondaryButton
import com.calorieme.app.ui.theme.BackgroundSecondary
import com.calorieme.app.ui.theme.ErrorRed
import com.calorieme.app.ui.theme.TextMuted
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.viewmodel.FoodAnalysisUiState
import java.time.LocalDate
import java.time.LocalTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FoodAnalysisSheet(
    state: FoodAnalysisUiState,
    onDismiss: () -> Unit,
    onAddToToday: (FoodEntry) -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState()
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = BackgroundSecondary) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            when (state) {
                is FoodAnalysisUiState.Idle -> Unit
                is FoodAnalysisUiState.Loading -> AnalyzingContent(imageUri = state.imageUri)
                is FoodAnalysisUiState.Success -> ResultContent(
                    imageUri = state.imageUri,
                    result = state.result,
                    onAddToToday = onAddToToday
                )
                is FoodAnalysisUiState.Error -> ErrorContent(error = state.error)
            }
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun AnalyzingContent(imageUri: String) {
    AsyncImage(
        model = imageUri,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp)
            .clip(RoundedCornerShape(20.dp))
    )
    Spacer(modifier = Modifier.height(20.dp))
    LoadingState(
        message = stringResource(id = R.string.food_analyzing_title) + "\n" + stringResource(id = R.string.food_analyzing_subtitle)
    )
}

@Composable
private fun ResultContent(imageUri: String, result: FoodAnalysisResult, onAddToToday: (FoodEntry) -> Unit) {
    AsyncImage(
        model = imageUri,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            .clip(RoundedCornerShape(20.dp))
    )
    Spacer(modifier = Modifier.height(16.dp))
    Text(text = result.foodName, style = MaterialTheme.typography.titleLarge, color = TextPrimary)
    Text(text = result.portion, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    Spacer(modifier = Modifier.height(12.dp))

    Row(modifier = Modifier.fillMaxWidth()) {
        AnalysisStat(label = stringResource(id = R.string.food_calories_label), value = "${result.calories}")
        AnalysisStat(label = stringResource(id = R.string.food_protein_label), value = "${result.proteinGrams.toInt()}")
        AnalysisStat(label = stringResource(id = R.string.food_carbs_label), value = "${result.carbsGrams.toInt()}")
        AnalysisStat(label = stringResource(id = R.string.food_fat_label), value = "${result.fatGrams.toInt()}")
    }

    Spacer(modifier = Modifier.height(8.dp))
    Text(
        text = stringResource(id = R.string.food_result_confidence, result.confidencePercent),
        style = MaterialTheme.typography.bodySmall,
        color = TextMuted
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text(
        text = stringResource(id = R.string.food_result_estimate_note),
        style = MaterialTheme.typography.bodySmall,
        color = TextMuted,
        textAlign = TextAlign.Center
    )
    Spacer(modifier = Modifier.height(20.dp))

    PrimaryButton(
        text = stringResource(id = R.string.food_result_add_to_today),
        onClick = {
            onAddToToday(
                FoodEntry(
                    foodName = result.foodName,
                    mealType = MealType.SNACK,
                    portion = result.portion,
                    calories = result.calories,
                    proteinGrams = result.proteinGrams,
                    carbsGrams = result.carbsGrams,
                    fatGrams = result.fatGrams,
                    imageUri = imageUri,
                    entryDate = LocalDate.now(),
                    entryTime = LocalTime.now(),
                    createdAt = System.currentTimeMillis()
                )
            )
        }
    )
}

@Composable
private fun AnalysisStat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.padding(end = 16.dp)) {
        Text(text = value, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
    }
}

@Composable
private fun ErrorContent(error: FoodAnalysisError) {
    val message = when (error) {
        FoodAnalysisError.NO_INTERNET -> stringResource(id = R.string.error_no_internet)
        else -> stringResource(id = R.string.food_analysis_error)
    }
    Text(
        text = message,
        style = MaterialTheme.typography.bodyLarge,
        color = ErrorRed,
        textAlign = TextAlign.Center
    )
}
