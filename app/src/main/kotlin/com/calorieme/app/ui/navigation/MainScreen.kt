package com.calorieme.app.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.calorieme.app.R
import com.calorieme.app.ui.components.AppScaffold
import com.calorieme.app.ui.components.BottomNavItem
import com.calorieme.app.ui.components.BottomNavigationBar
import com.calorieme.app.ui.screens.food.FoodScreen
import com.calorieme.app.ui.screens.home.HomeScreen
import com.calorieme.app.ui.screens.profile.ProfileScreen
import com.calorieme.app.ui.screens.progress.ProgressScreen

@Composable
fun MainScreen(modifier: Modifier = Modifier) {
    val tabNavController = rememberNavController()

    val items = listOf(
        BottomNavItem(Routes.HOME, stringResource(id = R.string.nav_home), Icons.Filled.Home),
        BottomNavItem(Routes.FOOD, stringResource(id = R.string.nav_food), Icons.Filled.Restaurant),
        BottomNavItem(Routes.PROGRESS, stringResource(id = R.string.nav_progress), Icons.Filled.TrendingUp),
        BottomNavItem(Routes.PROFILE, stringResource(id = R.string.nav_profile), Icons.Filled.Person)
    )

    val backStackEntry by tabNavController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.hierarchy?.firstOrNull { destination ->
        items.any { it.route == destination.route }
    }?.route ?: Routes.HOME

    AppScaffold(
        modifier = modifier,
        bottomBar = {
            BottomNavigationBar(
                items = items,
                selectedRoute = currentRoute,
                onItemClick = { item ->
                    tabNavController.navigate(item.route) {
                        popUpTo(tabNavController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                }
            )
        }
    ) { padding ->
        NavHost(
            navController = tabNavController,
            startDestination = Routes.HOME,
            modifier = Modifier.padding(bottom = padding.calculateBottomPadding())
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    onLogFoodClick = {
                        tabNavController.navigate(Routes.FOOD) {
                            popUpTo(tabNavController.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                    onLogWeightClick = {
                        tabNavController.navigate(Routes.PROGRESS) {
                            popUpTo(tabNavController.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                    onProfileClick = {
                        tabNavController.navigate(Routes.PROFILE) {
                            popUpTo(tabNavController.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                )
            }
            composable(Routes.FOOD) { FoodScreen() }
            composable(Routes.PROGRESS) { ProgressScreen() }
            composable(Routes.PROFILE) { ProfileScreen() }
        }
    }
}
