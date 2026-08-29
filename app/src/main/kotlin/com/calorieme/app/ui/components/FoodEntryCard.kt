package com.calorieme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.calorieme.app.ui.theme.ElevatedCard
import com.calorieme.app.ui.theme.ErrorRed
import com.calorieme.app.ui.theme.PurplePrimary
import com.calorieme.app.ui.theme.TextPrimary
import com.calorieme.app.ui.theme.TextSecondary

@Composable
fun FoodEntryCard(
    foodName: String,
    mealTypeLabel: String,
    timeLabel: String,
    caloriesLabel: String,
    modifier: Modifier = Modifier,
    imageUri: String? = null,
    onClick: () -> Unit = {},
    onDeleteClick: (() -> Unit)? = null
) {
    AppCard(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        contentPadding = PaddingValues(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(ElevatedCard),
                contentAlignment = Alignment.Center
            ) {
                if (imageUri != null) {
                    AsyncImage(
                        model = imageUri,
                        contentDescription = foodName,
                        modifier = Modifier.size(52.dp).clip(CircleShape),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Icon(imageVector = Icons.Filled.Restaurant, contentDescription = null, tint = PurplePrimary)
                }
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 14.dp, end = 8.dp)
            ) {
                Text(text = foodName, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                Text(
                    text = "$mealTypeLabel · $timeLabel",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text = caloriesLabel, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                if (onDeleteClick != null) {
                    IconButton(onClick = onDeleteClick) {
                        Icon(imageVector = Icons.Filled.Delete, contentDescription = null, tint = ErrorRed)
                    }
                }
            }
        }
    }
}
