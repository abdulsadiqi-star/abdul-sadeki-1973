package com.calorieme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.calorieme.app.ui.theme.CardBackground
import com.calorieme.app.ui.theme.CardBorder
import com.calorieme.app.ui.theme.ElevatedCard

/**
 * The base surface for CalorieMe: large rounded corners, a faint border and
 * a dark card fill. Set [gradient] for hero/highlighted cards instead of a
 * flat fill — used sparingly (hero calorie card, selected goal, etc.).
 */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    elevated: Boolean = false,
    gradient: Brush? = null,
    cornerRadius: Dp = 24.dp,
    contentPadding: PaddingValues = PaddingValues(20.dp),
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    content: @Composable ColumnScope.() -> Unit
) {
    val shape = RoundedCornerShape(cornerRadius)
    Column(
        modifier = modifier
            .clip(shape)
            .then(
                if (gradient != null) Modifier.background(gradient)
                else Modifier
                    .background(if (elevated) ElevatedCard else CardBackground)
                    .border(1.dp, CardBorder, shape)
            )
            .padding(contentPadding),
        verticalArrangement = verticalArrangement,
        content = content
    )
}
