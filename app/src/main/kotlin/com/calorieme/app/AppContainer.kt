package com.calorieme.app

import android.content.Context
import androidx.room.Room
import com.calorieme.app.ai.FoodRecognitionService
import com.calorieme.app.ai.MockFoodRecognitionService
import com.calorieme.app.data.db.AppDatabase
import com.calorieme.app.data.local.PreferencesManager
import com.calorieme.app.data.repository.FoodRepository
import com.calorieme.app.data.repository.FoodRepositoryImpl
import com.calorieme.app.data.repository.SettingsRepository
import com.calorieme.app.data.repository.SettingsRepositoryImpl
import com.calorieme.app.data.repository.UserProfileRepository
import com.calorieme.app.data.repository.UserProfileRepositoryImpl
import com.calorieme.app.data.repository.WeightRepository
import com.calorieme.app.data.repository.WeightRepositoryImpl
import com.calorieme.app.domain.usecase.AddFoodEntryUseCase
import com.calorieme.app.domain.usecase.CalculateBmiUseCase
import com.calorieme.app.domain.usecase.ChangeLanguageUseCase
import com.calorieme.app.domain.usecase.ClearLoggedDataUseCase
import com.calorieme.app.domain.usecase.CompleteOnboardingUseCase
import com.calorieme.app.domain.usecase.DeleteFoodEntryUseCase
import com.calorieme.app.domain.usecase.DeleteWeightEntryUseCase
import com.calorieme.app.domain.usecase.GetMonthlyReportUseCase
import com.calorieme.app.domain.usecase.LogWeightEntryUseCase
import com.calorieme.app.domain.usecase.ObserveDailyTotalsUseCase
import com.calorieme.app.domain.usecase.ObserveWeightProgressUseCase
import com.calorieme.app.domain.usecase.ResetAppUseCase
import com.calorieme.app.domain.usecase.UpdateFoodEntryUseCase
import com.calorieme.app.domain.usecase.UpdateProfileUseCase

/**
 * Hand-rolled composition root. The app is small enough that a DI framework
 * (Hilt, etc.) would add build complexity without a real payoff — this
 * container just builds each layer once and wires it into the next.
 */
class AppContainer(context: Context) {

    private val database: AppDatabase = Room.databaseBuilder(
        context.applicationContext,
        AppDatabase::class.java,
        AppDatabase.DATABASE_NAME
    ).build()

    private val preferencesManager = PreferencesManager(context.applicationContext)

    val userProfileRepository: UserProfileRepository = UserProfileRepositoryImpl(database.userProfileDao())
    val foodRepository: FoodRepository = FoodRepositoryImpl(database.foodEntryDao())
    val weightRepository: WeightRepository = WeightRepositoryImpl(database.weightEntryDao())
    val settingsRepository: SettingsRepository = SettingsRepositoryImpl(preferencesManager)

    val foodRecognitionService: FoodRecognitionService = MockFoodRecognitionService()

    val calculateBmiUseCase = CalculateBmiUseCase()
    val completeOnboardingUseCase = CompleteOnboardingUseCase(userProfileRepository, settingsRepository)
    val updateProfileUseCase = UpdateProfileUseCase(userProfileRepository)
    val observeDailyTotalsUseCase = ObserveDailyTotalsUseCase(foodRepository)
    val observeWeightProgressUseCase = ObserveWeightProgressUseCase(weightRepository)
    val getMonthlyReportUseCase = GetMonthlyReportUseCase(foodRepository, weightRepository)
    val addFoodEntryUseCase = AddFoodEntryUseCase(foodRepository)
    val updateFoodEntryUseCase = UpdateFoodEntryUseCase(foodRepository)
    val deleteFoodEntryUseCase = DeleteFoodEntryUseCase(foodRepository)
    val logWeightEntryUseCase = LogWeightEntryUseCase(weightRepository, userProfileRepository)
    val deleteWeightEntryUseCase = DeleteWeightEntryUseCase(weightRepository)
    val changeLanguageUseCase = ChangeLanguageUseCase(settingsRepository)
    val clearLoggedDataUseCase = ClearLoggedDataUseCase(foodRepository, weightRepository)
    val resetAppUseCase = ResetAppUseCase(foodRepository, weightRepository, userProfileRepository, settingsRepository)
}
