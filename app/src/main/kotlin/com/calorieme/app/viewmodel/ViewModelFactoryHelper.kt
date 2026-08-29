package com.calorieme.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.viewModelFactory

/**
 * Builds a [ViewModelProvider.Factory] from a plain lambda. Paired with
 * `LocalAppContainer.current` captured by each screen, this keeps
 * ViewModel construction a one-liner without pulling in a DI framework.
 */
inline fun <reified VM : ViewModel> factoryOf(crossinline create: () -> VM): ViewModelProvider.Factory =
    viewModelFactory {
        initializer { create() }
    }
