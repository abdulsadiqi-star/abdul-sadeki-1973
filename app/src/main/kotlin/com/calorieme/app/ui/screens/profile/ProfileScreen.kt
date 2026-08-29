package com.calorieme.app.ui.screens.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.calorieme.app.R
import com.calorieme.app.domain.model.AppLanguage
import com.calorieme.app.ui.LocalAppContainer
import com.calorieme.app.ui.LocalAppLanguage
import com.calorieme.app.ui.components.AppCard
import com.calorieme.app.ui.components.ConfirmDialog
import com.calorieme.app.ui.components.LoadingState
import com.calorieme.app.ui.components.ProfileRow
import com.calorieme.app.ui.components.SectionTitle
import com.calorieme.app.ui.theme.CardBorder
import com.calorieme.app.ui.theme.ElevatedCard
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary
import com.calorieme.app.util.Formatters
import com.calorieme.app.util.label
import com.calorieme.app.util.title
import com.calorieme.app.viewmodel.ProfileViewModel
import com.calorieme.app.viewmodel.factoryOf

private enum class ProfileDialog { NONE, EDIT_INFO, LANGUAGE, ABOUT, PRIVACY, CLEAR_DATA_CONFIRM, RESET_APP_CONFIRM }

@Composable
fun ProfileScreen(modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val language = LocalAppLanguage.current
    val viewModel: ProfileViewModel = viewModel(
        factory = factoryOf {
            ProfileViewModel(
                container.userProfileRepository,
                container.updateProfileUseCase,
                container.changeLanguageUseCase,
                container.clearLoggedDataUseCase,
                container.resetAppUseCase
            )
        }
    )
    val profile by viewModel.profile.collectAsStateWithLifecycle()
    var activeDialog by remember { mutableStateOf(ProfileDialog.NONE) }

    if (profile == null) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingState() }
        return
    }
    val currentProfile = profile!!

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        Text(
            text = stringResource(id = R.string.profile_screen_title),
            style = MaterialTheme.typography.headlineMedium,
            color = TextPrimary
        )
        Spacer(modifier = Modifier.height(20.dp))

        ProfileHeaderCard(
            name = currentProfile.name,
            goalLabel = currentProfile.goalType.title(),
            weightLabel = "${Formatters.weight(currentProfile.currentWeightKg, language)} ${stringResource(id = R.string.common_kg)}"
        )
        Spacer(modifier = Modifier.height(24.dp))

        SectionTitle(
            text = stringResource(id = R.string.profile_edit_info),
            trailingText = stringResource(id = R.string.common_edit),
            onTrailingClick = { activeDialog = ProfileDialog.EDIT_INFO }
        )
        Spacer(modifier = Modifier.height(12.dp))
        AppCard(modifier = Modifier.fillMaxWidth()) {
            ProfileRow(stringResource(id = R.string.profile_field_name), currentProfile.name)
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_age), "${currentProfile.age}")
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_gender), currentProfile.gender.label())
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_height), "${Formatters.weight(currentProfile.heightCm, language)} ${stringResource(id = R.string.common_cm)}")
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_weight), "${Formatters.weight(currentProfile.currentWeightKg, language)} ${stringResource(id = R.string.common_kg)}")
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_activity), currentProfile.activityLevel.title())
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_goal), currentProfile.goalType.title())
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_target_weight), "${Formatters.weight(currentProfile.targetWeightKg, language)} ${stringResource(id = R.string.common_kg)}")
            HorizontalDivider(color = CardBorder)
            ProfileRow(stringResource(id = R.string.profile_field_daily_calories), "${currentProfile.dailyCalorieTarget} ${stringResource(id = R.string.common_kcal)}")
        }
        Spacer(modifier = Modifier.height(28.dp))

        SectionTitle(text = stringResource(id = R.string.profile_section_settings))
        Spacer(modifier = Modifier.height(12.dp))
        AppCard(modifier = Modifier.fillMaxWidth()) {
            ProfileRow(
                label = stringResource(id = R.string.profile_app_language),
                value = if (language == AppLanguage.PERSIAN) stringResource(id = R.string.language_persian_name) else stringResource(id = R.string.language_english_name),
                showChevron = true,
                onClick = { activeDialog = ProfileDialog.LANGUAGE }
            )
            HorizontalDivider(color = CardBorder)
            ProfileRow(
                label = stringResource(id = R.string.profile_about_app),
                value = "",
                showChevron = true,
                onClick = { activeDialog = ProfileDialog.ABOUT }
            )
            HorizontalDivider(color = CardBorder)
            ProfileRow(
                label = stringResource(id = R.string.profile_privacy),
                value = "",
                showChevron = true,
                onClick = { activeDialog = ProfileDialog.PRIVACY }
            )
            HorizontalDivider(color = CardBorder)
            ProfileRow(
                label = stringResource(id = R.string.profile_clear_data),
                value = "",
                showChevron = true,
                onClick = { activeDialog = ProfileDialog.CLEAR_DATA_CONFIRM }
            )
            HorizontalDivider(color = CardBorder)
            ProfileRow(
                label = stringResource(id = R.string.profile_reset_app),
                value = "",
                showChevron = true,
                onClick = { activeDialog = ProfileDialog.RESET_APP_CONFIRM }
            )
        }
        Spacer(modifier = Modifier.height(32.dp))
    }

    when (activeDialog) {
        ProfileDialog.EDIT_INFO -> EditProfileSheet(
            profile = currentProfile,
            onDismiss = { activeDialog = ProfileDialog.NONE },
            onSave = { updated ->
                viewModel.saveProfile(
                    current = currentProfile,
                    name = updated.name,
                    age = updated.age,
                    gender = updated.gender,
                    heightCm = updated.heightCm,
                    currentWeightKg = updated.currentWeightKg,
                    activityLevel = updated.activityLevel,
                    goalType = updated.goalType,
                    targetWeightKg = updated.targetWeightKg
                )
                activeDialog = ProfileDialog.NONE
            }
        )
        ProfileDialog.LANGUAGE -> LanguageChoiceSheet(
            current = language,
            onDismiss = { activeDialog = ProfileDialog.NONE },
            onSelect = {
                viewModel.changeLanguage(it)
                activeDialog = ProfileDialog.NONE
            }
        )
        ProfileDialog.ABOUT -> InfoSheet(
            title = stringResource(id = R.string.profile_about_app),
            body = stringResource(id = R.string.profile_about_body),
            onDismiss = { activeDialog = ProfileDialog.NONE }
        )
        ProfileDialog.PRIVACY -> InfoSheet(
            title = stringResource(id = R.string.profile_privacy),
            body = stringResource(id = R.string.profile_privacy_body),
            onDismiss = { activeDialog = ProfileDialog.NONE }
        )
        ProfileDialog.CLEAR_DATA_CONFIRM -> ConfirmDialog(
            title = stringResource(id = R.string.profile_clear_data_confirm_title),
            message = stringResource(id = R.string.profile_clear_data_confirm_message),
            confirmText = stringResource(id = R.string.common_confirm),
            cancelText = stringResource(id = R.string.common_cancel),
            onConfirm = {
                viewModel.clearLoggedData()
                activeDialog = ProfileDialog.NONE
            },
            onDismiss = { activeDialog = ProfileDialog.NONE }
        )
        ProfileDialog.RESET_APP_CONFIRM -> ConfirmDialog(
            title = stringResource(id = R.string.profile_reset_app_confirm_title),
            message = stringResource(id = R.string.profile_reset_app_confirm_message),
            confirmText = stringResource(id = R.string.common_confirm),
            cancelText = stringResource(id = R.string.common_cancel),
            onConfirm = {
                viewModel.resetApp()
                activeDialog = ProfileDialog.NONE
            },
            onDismiss = { activeDialog = ProfileDialog.NONE }
        )
        ProfileDialog.NONE -> Unit
    }
}

@Composable
private fun ProfileHeaderCard(name: String, goalLabel: String, weightLabel: String) {
    AppCard(modifier = Modifier.fillMaxWidth(), elevated = true) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(ElevatedCard),
                contentAlignment = Alignment.Center
            ) {
                Icon(imageVector = Icons.Filled.Person, contentDescription = null, tint = PurplePrimary, modifier = Modifier.size(36.dp))
            }
            Spacer(modifier = Modifier.height(12.dp))
            Text(text = name, style = MaterialTheme.typography.titleLarge, color = TextPrimary)
            Spacer(modifier = Modifier.height(4.dp))
            Text(text = "$goalLabel · $weightLabel", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }
    }
}
