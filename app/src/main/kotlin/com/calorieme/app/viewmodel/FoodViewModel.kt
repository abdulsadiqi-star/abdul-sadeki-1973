package com.calorieme.app.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.calorieme.app.ai.FoodAnalysisError
import com.calorieme.app.ai.FoodAnalysisRequest
import com.calorieme.app.ai.FoodAnalysisResponse
import com.calorieme.app.ai.FoodAnalysisResult
import com.calorieme.app.ai.FoodRecognitionService
import com.calorieme.app.data.repository.FoodRepository
import com.calorieme.app.domain.model.FoodEntry
import com.calorieme.app.domain.usecase.AddFoodEntryUseCase
import com.calorieme.app.domain.usecase.DeleteFoodEntryUseCase
import com.calorieme.app.domain.usecase.UpdateFoodEntryUseCase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate

sealed interface FoodAnalysisUiState {
    data object Idle : FoodAnalysisUiState
    data class Loading(val imageUri: String) : FoodAnalysisUiState
    data class Success(val imageUri: String, val result: FoodAnalysisResult) : FoodAnalysisUiState
    data class Error(val imageUri: String, val error: FoodAnalysisError) : FoodAnalysisUiState
}

class FoodViewModel(
    private val foodRepository: FoodRepository,
    private val addFoodEntryUseCase: AddFoodEntryUseCase,
    private val updateFoodEntryUseCase: UpdateFoodEntryUseCase,
    private val deleteFoodEntryUseCase: DeleteFoodEntryUseCase,
    private val foodRecognitionService: FoodRecognitionService
) : ViewModel() {

    val todayEntries: StateFlow<List<FoodEntry>> = foodRepository.observeEntriesForDate(LocalDate.now())
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _analysisState = MutableStateFlow<FoodAnalysisUiState>(FoodAnalysisUiState.Idle)
    val analysisState: StateFlow<FoodAnalysisUiState> = _analysisState.asStateFlow()

    fun analyzeImage(uri: Uri) {
        viewModelScope.launch {
            _analysisState.value = FoodAnalysisUiState.Loading(uri.toString())
            when (val response = foodRecognitionService.analyzeFood(FoodAnalysisRequest(uri))) {
                is FoodAnalysisResponse.Success ->
                    _analysisState.value = FoodAnalysisUiState.Success(uri.toString(), response.result)
                is FoodAnalysisResponse.Error ->
                    _analysisState.value = FoodAnalysisUiState.Error(uri.toString(), response.error)
            }
        }
    }

    fun resetAnalysis() {
        _analysisState.value = FoodAnalysisUiState.Idle
    }

    fun addEntry(entry: FoodEntry) {
        viewModelScope.launch { addFoodEntryUseCase(entry) }
    }

    fun updateEntry(entry: FoodEntry) {
        viewModelScope.launch { updateFoodEntryUseCase(entry) }
    }

    fun deleteEntry(entry: FoodEntry) {
        viewModelScope.launch { deleteFoodEntryUseCase(entry) }
    }
}
