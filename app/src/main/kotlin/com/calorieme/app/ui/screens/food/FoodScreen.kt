package com.calorieme.app.ui.screens.food

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.calorieme.app.R
import com.calorieme.app.domain.model.FoodEntry
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.LocalAppLanguage
import com.calorieme.app.ui.components.AppCard
import com.calorieme.app.ui.components.EmptyState
import com.calorieme.app.ui.components.FoodEntryCard
import com.calorieme.app.ui.components.PrimaryButton
import com.calorieme.app.ui.components.SectionTitle
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.util.Formatters
import com.calorieme.app.util.label
import com.calorieme.app.viewmodel.FoodAnalysisUiState
import com.calorieme.app.viewmodel.FoodViewModel
import com.calorieme.app.viewmodel.factoryOf

@Composable
fun FoodScreen(modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val language = LocalAppLanguage.current
    val viewModel: FoodViewModel = viewModel(
        factory = factoryOf {
            FoodViewModel(
                container.foodRepository,
                container.addFoodEntryUseCase,
                container.updateFoodEntryUseCase,
                container.deleteFoodEntryUseCase,
                container.foodRecognitionService
            )
        }
    )

    val todayEntries by viewModel.todayEntries.collectAsStateWithLifecycle()
    val analysisState by viewModel.analysisState.collectAsStateWithLifecycle()

    var showManualEntry by remember { mutableStateOf(false) }
    var editingEntry by remember { mutableStateOf<FoodEntry?>(null) }
    var entryPendingDelete by remember { mutableStateOf<FoodEntry?>(null) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri -> uri?.let(viewModel::analyzeImage) }

    val kcalUnit = stringResource(id = R.string.common_kcal)

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Text(
                text = stringResource(id = R.string.food_screen_title),
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary
            )
        }

        item {
            AnalyzeFoodCard(
                onChoosePhoto = {
                    photoPickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                onManualEntry = { showManualEntry = true }
            )
        }

        item {
            SectionTitle(text = stringResource(id = R.string.food_today_title))
        }

        if (todayEntries.isEmpty()) {
            item {
                EmptyState(
                    icon = Icons.Filled.Restaurant,
                    title = stringResource(id = R.string.food_empty_title),
                    subtitle = stringResource(id = R.string.food_empty_subtitle),
                    ctaText = stringResource(id = R.string.food_empty_cta),
                    onCtaClick = { showManualEntry = true }
                )
            }
        } else {
            items(todayEntries, key = { it.id }) { entry ->
                FoodEntryCard(
                    foodName = entry.foodName,
                    mealTypeLabel = entry.mealType.label(),
                    timeLabel = Formatters.time(entry.entryTime, language),
                    caloriesLabel = "${entry.calories} $kcalUnit",
                    imageUri = entry.imageUri,
                    onClick = { editingEntry = entry },
                    onDeleteClick = { entryPendingDelete = entry }
                )
            }
        }
    }

    if (showManualEntry || editingEntry != null) {
        ManualFoodEntrySheet(
            existingEntry = editingEntry,
            onDismiss = {
                showManualEntry = false
                editingEntry = null
            },
            onSave = { entry ->
                if (editingEntry != null) viewModel.updateEntry(entry) else viewModel.addEntry(entry)
                showManualEntry = false
                editingEntry = null
            }
        )
    }

    if (analysisState !is FoodAnalysisUiState.Idle) {
        FoodAnalysisSheet(
            state = analysisState,
            onDismiss = viewModel::resetAnalysis,
            onAddToToday = { entry ->
                viewModel.addEntry(entry)
                viewModel.resetAnalysis()
            }
        )
    }

    entryPendingDelete?.let { entry ->
        DeleteFoodConfirmDialog(
            onConfirm = {
                viewModel.deleteEntry(entry)
                entryPendingDelete = null
            },
            onDismiss = { entryPendingDelete = null }
        )
    }
}

@Composable
private fun AnalyzeFoodCard(onChoosePhoto: () -> Unit, onManualEntry: () -> Unit) {
    AppCard(modifier = Modifier.fillMaxWidth(), elevated = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(imageVector = Icons.Filled.CameraAlt, contentDescription = null, tint = PurplePrimary)
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = stringResource(id = R.string.food_analyze_title),
                style = MaterialTheme.typography.titleMedium,
                color = TextPrimary
            )
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = stringResource(id = R.string.food_analyze_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary
        )
        Spacer(modifier = Modifier.height(16.dp))
        PrimaryButton(text = stringResource(id = R.string.food_choose_photo), onClick = onChoosePhoto)
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = stringResource(id = R.string.food_or_manual_entry),
            style = MaterialTheme.typography.labelLarge,
            color = PurplePrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onManualEntry)
                .padding(vertical = 4.dp)
        )
    }
}
